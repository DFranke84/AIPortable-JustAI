const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

// Expects, if you want this feature, a whisper.cpp server binary + model
// bundled at resources/whisper/<platform>/ — see README for where to get
// prebuilt binaries. Falls back to "unavailable" cleanly if absent.
//
// Audio contract: the renderer converts its MediaRecorder output (WebM/Opus)
// to 16 kHz mono 16-bit PCM WAV before it ever reaches here (see
// audioBlobToWav in renderer.js). Stock whisper-server builds decode only
// WAV/MP3/FLAC/Vorbis unless started with --convert (which needs ffmpeg), so
// sending WAV is what lets this work with no extra dependencies.
class VoiceInput {
  constructor(resourcesPath) {
    this.resourcesPath = resourcesPath;
    this.binPath = null;
    this.modelPath = null;
    this.available = false;
    this.serverProcess = null;
    this.port = null;
    this.ready = false;
    this.lastError = null;
  }

  detect() {
    const platDir = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const binName = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
    const dir = path.join(this.resourcesPath, 'whisper', platDir);
    const bin = path.join(dir, binName);
    const model = path.join(dir, 'model.bin');
    if (fs.existsSync(bin) && fs.existsSync(model)) {
      this.binPath = bin;
      this.modelPath = model;
      this.available = true;
    }
  }

  checkAvailability() {
    return { available: this.available, engine: this.available ? 'whisper.cpp' : 'not available', running: this.ready };
  }

  // Asks the OS for a currently-free port rather than hardcoding one — a
  // fixed port (this used to be 8080) collides with any dev server or other
  // tool that happens to be using it, and whisper-server then just fails to
  // bind with nothing visible in the UI.
  _findFreePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
      });
    });
  }

  async startServer() {
    if (!this.available || this.serverProcess) return;
    this.lastError = null;
    this.port = await this._findFreePort();

    let stderrTail = '';
    const proc = spawn(
      this.binPath,
      ['-m', this.modelPath, '--host', '127.0.0.1', '--port', String(this.port), '-l', 'en'],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, cwd: path.dirname(this.binPath) }
    );
    this.serverProcess = proc;
    proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });
    // Without an 'error' listener, a spawn failure (missing DLL, wrong
    // architecture, no execute permission) is thrown as an uncaught
    // exception in the main process instead of surfacing as a normal error.
    proc.on('error', (err) => { this.lastError = `Could not start whisper-server: ${err.message}`; });
    proc.on('exit', (code) => {
      if (this.serverProcess === proc) { this.serverProcess = null; this.ready = false; }
      if (!this.lastError && code) this.lastError = `whisper-server exited with code ${code}. ${stderrTail.trim().split('\n').slice(-3).join(' ')}`;
    });

    // Model load time varies with disk speed (a USB drive can be slow), so
    // allow up to ~20s before giving up.
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (this.serverProcess !== proc) return; // exited or failed to spawn
      try {
        await this._httpGet(`http://127.0.0.1:${this.port}/`);
        this.ready = true;
        return;
      } catch { /* keep polling */ }
    }
    this.lastError = 'whisper-server did not become ready in time.';
    this.stopServer();
  }

  stopServer() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
    this.ready = false;
  }

  async transcribe(filePath) {
    if (!this.available) return { success: false, error: 'Voice input not available' };
    if (!this.ready) {
      await this.startServer();
      if (!this.ready) return { success: false, error: this.lastError || 'Could not start transcription server' };
    }
    let res;
    try {
      res = await this._postForm(`http://127.0.0.1:${this.port}/inference`, filePath, { response_format: 'json' });
    } catch (err) {
      this.ready = false; // server likely died — restart it on the next attempt
      return { success: false, error: `Transcription server unreachable: ${err.message}` };
    }

    // whisper-server replies with JSON both on success ({"text": "..."}) and
    // on failure ({"error": "..."}, with a 4xx/5xx status) — the raw body
    // must never be handed back as if it were the transcript.
    let body = null;
    try { body = JSON.parse(res.body); } catch { /* handled below */ }
    if (res.status !== 200 || !body || typeof body.text !== 'string') {
      const detail = body?.error || res.body.slice(0, 200) || `HTTP ${res.status}`;
      return { success: false, error: `Transcription failed: ${detail}` };
    }
    // Whisper marks silence/noise with bracketed tags like [BLANK_AUDIO] —
    // those aren't speech, so strip them rather than typing them into chat.
    const text = body.text.replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE)\]/gi, '').replace(/\s+/g, ' ').trim();
    return { success: true, text };
  }

  _httpGet(url) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: 2000 }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });
  }

  // multipart/form-data POST with the audio file plus plain text fields.
  // Resolves { status, body } for any HTTP response (callers check status);
  // rejects only on a connection-level failure.
  _postForm(url, filePath, fields = {}) {
    return new Promise((resolve, reject) => {
      const boundary = '----localai' + Date.now();
      const fileBuf = fs.readFileSync(filePath);
      const filename = path.basename(filePath);
      const parts = [];
      for (const [name, value] of Object.entries(fields)) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
      }
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`));
      parts.push(fileBuf);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
      const payload = Buffer.concat(parts);
      const u = new URL(url);
      const req = http.request(
        { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length } },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}

module.exports = { VoiceInput };
