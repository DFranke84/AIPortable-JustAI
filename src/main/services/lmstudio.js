const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// LM Studio's local server, as an alternative chat runtime to Ollama. Exposes
// the same method names OllamaManager does for everything chat-related
// (getModels, getRunningModels, getModelCapabilities, chatStream,
// abortGeneration, generateTitle, identifyImage, current-model) so callers can
// swap one for the other. Deliberately *not* implemented: pull/delete (the
// app's catalog is Ollama-only — models are managed in LM Studio itself) and
// embed (library search stays on Ollama's nomic-embed-text, which the
// precomputed library vectors were built with).
//
// Chat goes through LM Studio's OpenAI-compatible /v1/chat/completions;
// model listing/loading uses its native REST API (/api/v1/models), which —
// unlike /v1/models — reports vision support and which models are loaded.
// chatStream() re-emits each streamed delta in Ollama's NDJSON event shape
// ({ message: { content }, done }) so the renderer's token handlers and the
// mobile server don't need to know which runtime is answering.

const HOST = '127.0.0.1';
const DEFAULT_PORT = 1234;
const SERVER_CONFIG_PATH = path.join(os.homedir(), '.lmstudio', '.internal', 'http-server-config.json');

// LM Studio's own server settings (port, Just-in-Time loading). Best-effort:
// the file is LM Studio internals and may be missing (not installed on this
// PC, or a future version moves it), in which case callers get nulls.
function readServerConfig() {
  try {
    return JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function getPort() {
  const port = readServerConfig()?.port;
  return Number.isInteger(port) ? port : DEFAULT_PORT;
}

// Rejects on HTTP >= 400 with LM Studio's own error text, unlike ollama.js's
// request() which leaves status checking to callers — every caller here
// wants the failure surfaced (e.g. "model not found") rather than parsed.
function request(reqPath, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    const req = http.request({ hostname: HOST, port: getPort(), path: reqPath, method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* leave as text */ }
        if (res.statusCode >= 400) return reject(new Error(errorText(parsed) || `LM Studio returned HTTP ${res.statusCode}`));
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function errorText(body) {
  if (!body) return null;
  if (typeof body === 'string') return body.trim() || null;
  const err = body.error;
  if (typeof err === 'string') return err;
  return err?.message || null;
}

// The renderer sends images as bare base64 (Ollama's `images` field); the
// OpenAI format needs a data: URL with a real MIME type, sniffed here from
// the base64 of each format's magic bytes.
function imageDataUrl(base64) {
  const mime =
    base64.startsWith('iVBOR') ? 'image/png'
    : base64.startsWith('R0lG') ? 'image/gif'
    : base64.startsWith('UklG') ? 'image/webp'
    : base64.startsWith('Qk') ? 'image/bmp'
    : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

// Ollama-style { role, content, images? } -> OpenAI-style, where a message
// with images carries a content *array* of text + image_url parts.
function toOpenAIMessages(messages) {
  return messages.map((m) => {
    if (!m.images?.length) return { role: m.role, content: m.content };
    const parts = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    for (const img of m.images) parts.push({ type: 'image_url', image_url: { url: imageDataUrl(img) } });
    return { role: m.role, content: parts };
  });
}

class LMStudioManager {
  constructor({ getAutoLoad } = {}) {
    this.currentModel = null;
    this.currentRequest = null;
    // Read live (not captured once) so toggling the setting applies to the
    // very next request.
    this.getAutoLoad = getAutoLoad || (() => true);
  }

  getPort() {
    return getPort();
  }

  // true/false from LM Studio's settings, or null if it can't be determined.
  getJitEnabled() {
    const jit = readServerConfig()?.justInTimeModelLoading;
    return typeof jit === 'boolean' ? jit : null;
  }

  async listAll() {
    const res = await request('/api/v1/models');
    return Array.isArray(res?.models) ? res.models : [];
  }

  async checkConnection() {
    try {
      const models = await this.getModels();
      return { connected: true, models };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }

  // Chat-capable models only (embedding models can't answer a chat). `name`
  // is LM Studio's model key — what the chat API expects as `model`.
  async getModels() {
    try {
      const all = await this.listAll();
      return all
        .filter((m) => m.type !== 'embedding')
        .map((m) => ({
          name: m.key,
          // Quantization tells apart variants that share a display name
          // (e.g. the same model downloaded at Q4_K_S and Q5_K_M).
          label: `${m.display_name || m.key}${m.quantization?.name ? ` (${m.quantization.name})` : ''}`,
          size: m.size_bytes,
          vision: !!m.capabilities?.vision,
          loaded: (m.loaded_instances || []).length > 0,
          maxContextLength: m.max_context_length || null,
        }));
    } catch {
      return [];
    }
  }

  // Same shape the renderer reads from Ollama's /api/ps: name + the context
  // length it's actually loaded with.
  async getRunningModels() {
    try {
      const all = await this.listAll();
      const running = [];
      for (const m of all) {
        for (const inst of m.loaded_instances || []) {
          running.push({ name: m.key, instanceId: inst.id, context_length: inst.config?.context_length || null });
        }
      }
      return running;
    } catch {
      return [];
    }
  }

  async getModelCapabilities(name) {
    try {
      const all = await this.listAll();
      return { vision: !!all.find((m) => m.key === name)?.capabilities?.vision };
    } catch {
      return { vision: false };
    }
  }

  getCurrentModel() {
    return this.currentModel;
  }

  setCurrentModel(name) {
    this.currentModel = name;
    return true;
  }

  // Makes sure `model` will be answerable before a chat request goes out.
  // Already loaded -> nothing to do. Not loaded:
  //  - auto-load off: refuse with a message telling the user to load it in
  //    LM Studio (otherwise LM Studio's JIT would load it anyway behind the
  //    user's back).
  //  - auto-load on + LM Studio's Just-in-Time loading on: do nothing — the
  //    chat request itself loads it, and LM Studio unloads the previous
  //    JIT-loaded model first, so models don't pile up in VRAM.
  //  - auto-load on + JIT off/unknown: load it explicitly via the REST API,
  //    honoring the requested context length (num_ctx) when there is one.
  async ensureLoaded(model, numCtx) {
    // LM Studio doesn't reject an unknown model name: it silently answers
    // with whatever model is already loaded (observed 2026-10 with JIT
    // loading on). So confirm the model exists first — otherwise a renamed or
    // deleted model would quietly chat as a different one.
    const all = await this.listAll();
    const entry = all.find((m) => m.key === model);
    if (!entry) throw new Error(`"${model}" wasn't found in LM Studio — it may have been renamed or deleted. Pick another model.`);
    if ((entry.loaded_instances || []).length > 0) return;
    if (!this.getAutoLoad()) {
      throw new Error(`"${model}" isn't loaded in LM Studio. Load it there first, or turn on "Auto-load" in Tools → Models.`);
    }
    if (this.getJitEnabled() === true) return;
    await request('/api/v1/models/load', {
      method: 'POST',
      body: { model, ...(numCtx ? { context_length: numCtx } : {}) },
    });
  }

  // Streams OpenAI SSE chunks, forwarding each content delta to `onToken` in
  // Ollama's event shape. `options.num_ctx` only matters when this call has
  // to load the model explicitly (see ensureLoaded) — LM Studio fixes context
  // length at load time and has no per-request equivalent. Reasoning tokens
  // (delta.reasoning_content) are dropped, matching how the renderer already
  // ignores Ollama's separate `thinking` field.
  async chatStream({ model, messages, options }, onToken) {
    await this.ensureLoaded(model, options?.num_ctx);
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ model, messages: toOpenAIMessages(messages), stream: true });
      const req = http.request(
        { hostname: HOST, port: getPort(), path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          if (res.statusCode >= 400) {
            let buf = '';
            res.on('data', (c) => (buf += c));
            res.on('end', () => {
              this.currentRequest = null;
              let parsed = buf;
              try { parsed = JSON.parse(buf); } catch { /* leave as text */ }
              reject(new Error(errorText(parsed) || `LM Studio returned HTTP ${res.statusCode}`));
            });
            return;
          }
          let carry = '';
          let sentDone = false;
          const handleLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) return;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') {
              if (!sentDone) { sentDone = true; onToken({ message: { role: 'assistant', content: '' }, done: true }); }
              return;
            }
            let chunk;
            try { chunk = JSON.parse(payload); } catch { return; }
            if (chunk.error) throw new Error(errorText(chunk) || 'LM Studio reported an error');
            const choice = chunk.choices?.[0];
            const content = choice?.delta?.content;
            if (content) onToken({ message: { role: 'assistant', content }, done: false });
            if (choice?.finish_reason && !sentDone) {
              sentDone = true;
              onToken({ message: { role: 'assistant', content: '' }, done: true, done_reason: choice.finish_reason });
            }
          };
          let failed = null;
          res.on('data', (chunk) => {
            carry += chunk.toString();
            const lines = carry.split('\n');
            carry = lines.pop();
            for (const line of lines) {
              try { handleLine(line); } catch (err) { failed = failed || err; }
            }
          });
          res.on('end', () => {
            this.currentRequest = null;
            try { if (carry) handleLine(carry); } catch (err) { failed = failed || err; }
            if (failed) return reject(failed);
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
      this.currentRequest.destroy(new Error('Aborted by user')); // see OllamaManager.abortGeneration
      this.currentRequest = null;
      return true;
    }
    return false;
  }

  async complete(model, messages, options) {
    await this.ensureLoaded(model, options?.num_ctx);
    const res = await request('/v1/chat/completions', {
      method: 'POST',
      body: { model, messages: toOpenAIMessages(messages), stream: false },
    });
    return res?.choices?.[0]?.message?.content?.trim() || null;
  }

  // Best-effort, like OllamaManager.generateTitle — null on any failure.
  async generateTitle(model, userText) {
    try {
      return await this.complete(model, [
        {
          role: 'system',
          content:
            'Reply with only a short 3-6 word title summarizing the topic of the ' +
            'following message. No punctuation, no quotes, no explanation — just the title itself.',
        },
        { role: 'user', content: userText },
      ]);
    } catch {
      return null;
    }
  }

  // Best-effort, like OllamaManager.identifyImage — null on any failure.
  async identifyImage(model, imageBase64, options) {
    try {
      return await this.complete(
        model,
        [
          {
            role: 'system',
            content:
              'Identify the main subject of this image in a short phrase suitable as a ' +
              'search query — species/object name plus 2-3 key visual traits. Reply with ' +
              'only that phrase, no punctuation, no explanation.',
          },
          { role: 'user', content: '', images: [imageBase64] },
        ],
        options
      );
    } catch {
      return null;
    }
  }
}

module.exports = { LMStudioManager, DEFAULT_PORT };
