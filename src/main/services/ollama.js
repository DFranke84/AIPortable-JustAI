const http = require('http');

const HOST = '127.0.0.1';
const PORT = 11434;

function request(reqPath, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    // Content-Length is set explicitly rather than left to Node's default
    // chunked transfer encoding — Ollama's server reads a chunked body fine
    // on POST routes (e.g. /api/pull, /api/chat) but not on DELETE (e.g.
    // /api/delete), which otherwise responds 400 "missing request body"
    // even though the body was written to the socket.
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    const req = http.request(
      { hostname: HOST, port: PORT, path: reqPath, method, headers },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

class OllamaManager {
  constructor() {
    this.currentModel = null;
    this.currentRequest = null; // in-flight request, so abortGeneration() can kill it
    this.onReload = null; // ({ model, from, to }) => void — set by main.js to tell the UI
  }

  // Ollama reloads a model whenever a request's num_ctx differs from the one
  // it's loaded with — larger, smaller, or left out entirely (measured
  // 2026-10-17: the auto chat-title request, which sent no num_ctx, reloaded
  // a 16K model back to the 4K default, then the next ZIM question reloaded
  // it to 16K again). So no request ever shrinks a loaded model: a missing or
  // smaller num_ctx becomes the resident size. A request that needs MORE
  // still reloads, and is reported through onReload so the UI can say so.
  async fitOptions(model, options) {
    let resident = null;
    try {
      resident = (await request('/api/ps')).models?.find((m) => m.name === model || m.model === model);
    } catch { /* can't tell — send as asked */ }
    if (!resident?.context_length) return options; // not loaded yet: an ordinary first load
    const want = options?.num_ctx;
    if (!want || want <= resident.context_length) return { ...(options || {}), num_ctx: resident.context_length };
    this.onReload?.({ model, from: resident.context_length, to: want });
    return options;
  }

  async checkConnection() {
    try {
      const res = await request('/api/tags');
      return { connected: true, models: res.models || [] };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }

  async getModels() {
    try {
      const res = await request('/api/tags');
      return res.models || [];
    } catch {
      return [];
    }
  }

  // Removes a model's manifest + any blobs no longer referenced by another
  // installed model. request() never inspects status codes (see above), so
  // success/failure here is read from the body instead: Ollama's /api/delete
  // responds with an empty body on success and a JSON {error} on failure
  // (e.g. unknown model name).
  async deleteModel(name) {
    try {
      const res = await request('/api/delete', { method: 'DELETE', body: { model: name } });
      if (res && typeof res === 'object' && res.error) return { success: false, error: res.error };
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getCurrentModel() {
    return this.currentModel;
  }

  setCurrentModel(name) {
    this.currentModel = name;
    return true;
  }

  // Streams NDJSON chat tokens to `onToken`. Returns once the stream ends.
  // `options` is forwarded as-is into Ollama's request body (e.g. num_ctx) —
  // see the num_ctx override in chat:send for why a vision request needs one.
  async chatStream({ model, messages, options }, onToken) {
    options = await this.fitOptions(model, options);
    return new Promise((resolve, reject) => {
      // keep_alive: -1 tells Ollama to keep the model resident indefinitely
      // instead of evicting it after its default 5-minute idle timer — once
      // loaded, a model only leaves memory via explicit unloadModel() (app
      // shutdown) or the user switching models, never from sitting idle.
      const body = JSON.stringify({ model, messages, stream: true, keep_alive: -1, ...(options ? { options } : {}) });
      const req = http.request(
        { hostname: HOST, port: PORT, path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let carry = '';
          res.on('data', (chunk) => {
            carry += chunk.toString();
            const lines = carry.split('\n');
            carry = lines.pop();
            for (const line of lines) {
              if (!line.trim()) continue;
              try { onToken(JSON.parse(line)); } catch { /* ignore partial line */ }
            }
          });
          res.on('end', () => {
            this.currentRequest = null;
            // A streaming reply's chunks always end in '\n', so a normal
            // stream leaves `carry` empty here. But Ollama reports a
            // request-level failure (bad model, a vision model choking on
            // the image, etc.) as a single `{"error": "..."}` object with NO
            // trailing newline — that line never gets pulled out of `carry`
            // by the split-on-'\n' loop above, so without this it's silently
            // dropped: zero tokens, promise resolves as if nothing was
            // wrong, and the UI is left showing the "..." placeholder
            // forever with no error. Parse whatever's left and surface it.
            const leftover = carry.trim();
            if (leftover) {
              try {
                const parsed = JSON.parse(leftover);
                if (parsed && parsed.error) return reject(new Error(parsed.error));
                onToken(parsed);
              } catch { /* not JSON — nothing more we can do with it */ }
            }
            resolve();
          });
        }
      );
      req.on('error', (err) => { this.currentRequest = null; reject(err); });
      req.write(body);
      req.end();
      this.currentRequest = req;
    });
  }

  abortGeneration() {
    if (this.currentRequest) {
      // destroy() with no argument doesn't reliably emit 'error' on a
      // Node http.ClientRequest, which is the only thing that settles
      // chatStream()'s promise on this path — without an explicit error,
      // an aborted request could just hang forever instead of rejecting.
      this.currentRequest.destroy(new Error('Aborted by user'));
      this.currentRequest = null;
      return true;
    }
    return false;
  }

  // Short, non-streamed completion used to auto-title a chat from its first
  // exchange. Best-effort: returns null on any failure so the caller can
  // just leave the chat as "New chat" rather than surfacing an error over
  // something cosmetic.
  async generateTitle(model, userText) {
    try {
      // Capped like searchKeywords: a model ignoring think:false could
      // otherwise think for minutes — holding up the next question behind it.
      const options = { ...(await this.fitOptions(model, undefined)), num_predict: 200 };
      const res = await request('/api/chat', {
        method: 'POST',
        body: {
          model,
          stream: false,
          think: false, // a thinking model otherwise reasons at length over a 3-6 word title
          keep_alive: -1, // don't let this reset the model's idle timer to the 5-minute default — see chatStream
          options,
          messages: [
            {
              role: 'system',
              content:
                'Reply with only a short 3-6 word title summarizing the topic of the ' +
                'following message. No punctuation, no quotes, no explanation — just the title itself.',
            },
            { role: 'user', content: userText },
          ],
        },
      });
      const title = res?.message?.content?.trim();
      return title || null;
    } catch {
      return null;
    }
  }

  // Short, non-streamed completion that describes a photo's main subject as
  // a search-query-shaped phrase, used to feed the library's two-stage
  // search when a user attaches only an image with no typed text (see
  // renderer.js's send handler). Best-effort like generateTitle — returns
  // null on failure so the caller can just fall back to no library context
  // rather than surfacing an error over something that degrades gracefully.
  // `options` (typically just { num_ctx }) should match whatever the caller's
  // *next* request against the same model will use — Ollama reloads a model
  // whenever num_ctx changes between requests (it's baked into the model's
  // KV-cache allocation at load time, not just an idle-eviction thing), so a
  // mismatch here means every identify-then-analyze/translate pair reloads
  // the model twice in a row for no reason, even though it's the same model
  // both times and never actually left memory.
  async identifyImage(model, imageBase64, options) {
    try {
      options = await this.fitOptions(model, options);
      const res = await request('/api/chat', {
        method: 'POST',
        body: {
          model,
          stream: false,
          keep_alive: -1,
          ...(options ? { options } : {}),
          messages: [
            {
              role: 'system',
              content:
                "Identify the main subject of this image in a short phrase suitable as a " +
                "search query — species/object name plus 2-3 key visual traits. Reply with " +
                "only that phrase, no punctuation, no explanation.",
            },
            { role: 'user', content: '', images: [imageBase64] },
          ],
        },
      });
      const phrase = res?.message?.content?.trim();
      return phrase || null;
    } catch {
      return null;
    }
  }

  // Short, non-streamed completion that turns a chat question into search
  // words for the .zim archives (see zimSearch.js). Best-effort like
  // generateTitle — null on failure, and the caller searches with the
  // question itself instead. `options` should match the chat request that
  // follows, for the same reload reason as identifyImage.
  async searchKeywords(model, messages, options) {
    try {
      // num_predict caps the reply (hidden thinking included) so this stays a
      // few seconds: some models ignore think:false — qwen3-vl:8b thought for
      // 2 min over four search words (measured 2026-10-17). Cut off before
      // writing any, the reply is empty and the caller searches the question.
      // num_predict is per-request; it doesn't make Ollama reload the model.
      options = { ...(await this.fitOptions(model, options)), num_predict: 300 };
      const res = await request('/api/chat', {
        method: 'POST',
        body: { model, stream: false, think: false, keep_alive: -1, options, messages },
      });
      return res?.message?.content?.trim() || null;
    } catch {
      return null;
    }
  }

  // One non-streamed turn with tools offered (Thorough ZIM search). Returns
  // the model's reply, the tool calls it asked for in a runtime-neutral
  // shape, and the assistant message to append before the tool results.
  async chatTools(model, messages, tools, options) {
    options = await this.fitOptions(model, options);
    const res = await request('/api/chat', {
      method: 'POST',
      body: { model, messages, tools, stream: false, think: false, keep_alive: -1, ...(options ? { options } : {}) },
    });
    if (res?.error) throw new Error(res.error);
    const msg = res?.message || {};
    const toolCalls = (msg.tool_calls || []).map((c, i) => ({ id: String(i), name: c.function?.name, args: c.function?.arguments || {} }));
    return {
      content: msg.content || '',
      toolCalls,
      assistantMessage: { role: 'assistant', content: msg.content || '', ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) },
    };
  }

  toolResultMessage(call, content) {
    return { role: 'tool', tool_name: call.name, content };
  }

  // Models currently resident in Ollama's memory (RAM/VRAM), per /api/ps —
  // this is the source of truth for whether a model is "loaded" right now,
  // as opposed to merely installed.
  async getRunningModels() {
    try {
      const res = await request('/api/ps');
      return res.models || [];
    } catch {
      return [];
    }
  }

  // Loads a model into memory without generating anything (an empty
  // /api/generate request) — the "Load model" button. `options.num_ctx` must
  // match the chat that follows, or Ollama reloads it then anyway.
  async loadModel(name, options) {
    options = await this.fitOptions(name, options);
    const res = await request('/api/generate', { method: 'POST', body: { model: name, keep_alive: -1, ...(options ? { options } : {}) } });
    if (res?.error) throw new Error(res.error);
    return true;
  }

  // keep_alive: 0 tells Ollama to evict the model immediately instead of
  // waiting out its idle timer — used on graceful shutdown so quitting the
  // app actually frees RAM/VRAM right away rather than leaving it to Ollama's
  // own clock (which won't even fire once we kill the process anyway).
  async unloadModel(name) {
    try {
      await request('/api/generate', { method: 'POST', body: { model: name, keep_alive: 0 } });
      return true;
    } catch {
      return false;
    }
  }

  // /api/show reports a top-level `capabilities` array (e.g. ["completion", "vision"])
  // on current Ollama versions — the authoritative signal for "this model accepts
  // images". Older Ollama versions don't return it, so fall back to details.families,
  // which lists the sub-models a model is built from; multimodal models include a
  // CLIP-family vision encoder there. That fallback is name-based, though — some
  // vision families (e.g. Qwen2.5-VL's "qwen25vl") don't literally contain
  // "clip"/"vision", so it's a weaker, best-effort signal than `capabilities`.
  async getModelCapabilities(name) {
    try {
      const res = await request('/api/show', { method: 'POST', body: { model: name } });
      if (Array.isArray(res?.capabilities)) {
        return { vision: res.capabilities.includes('vision'), tools: res.capabilities.includes('tools') };
      }
      const families = [
        ...(res?.details?.families || []),
        ...(res?.details?.family ? [res.details.family] : []),
      ];
      const vision = families.some((f) => /clip|vision/i.test(f));
      return { vision };
    } catch {
      return { vision: false };
    }
  }

  // Several texts in one request (the Research sync embeds thousands of
  // docs — one HTTP round trip per doc would dominate the run time).
  // Returns an array parallel to `texts`, or null if the request failed.
  async embedMany(model, texts) {
    try {
      const res = await request('/api/embed', { method: 'POST', body: { model, input: texts, keep_alive: -1 } });
      return Array.isArray(res.embeddings) && res.embeddings.length === texts.length ? res.embeddings : null;
    } catch {
      return null;
    }
  }

  async embed(model, text) {
    try {
      const res = await request('/api/embed', { method: 'POST', body: { model, input: [text], keep_alive: -1 } });
      return res.embeddings?.[0] || null;
    } catch {
      return null;
    }
  }

  async pullModel(name, onProgress) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ name, stream: true });
      const req = http.request(
        { hostname: HOST, port: PORT, path: '/api/pull', method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let carry = '';
          res.on('data', (chunk) => {
            carry += chunk.toString();
            const lines = carry.split('\n');
            carry = lines.pop();
            for (const line of lines) {
              if (!line.trim()) continue;
              try { onProgress?.(JSON.parse(line)); } catch { /* ignore */ }
            }
          });
          res.on('end', () => resolve({ success: true }));
        }
      );
      req.on('error', (err) => reject(err));
      req.write(body);
      req.end();
    });
  }
}

module.exports = { OllamaManager, HOST, PORT };
