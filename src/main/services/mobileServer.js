const http = require('http');
const os = require('os');

const MOBILE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Local AI — Mobile</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #14171c; color: #e7e5df; margin: 0; padding: 16px; }
    #log { display: flex; flex-direction: column; gap: 10px; margin-bottom: 80px; }
    .msg { padding: 10px 12px; border-radius: 10px; max-width: 85%; white-space: pre-wrap; }
    .user { background: #20252d; align-self: flex-end; margin-left: auto; }
    .assistant { background: transparent; }
    form { position: fixed; bottom: 0; left: 0; right: 0; display: flex; gap: 8px; padding: 12px; background: #14171c; border-top: 1px solid #2a2f38; }
    input { flex: 1; background: #20252d; border: 1px solid #2a2f38; color: #e7e5df; border-radius: 8px; padding: 10px; font-size: 15px; }
    button { background: #c98a3d; border: none; border-radius: 8px; padding: 0 16px; font-weight: 600; }
  </style>
</head>
<body>
  <div id="log"></div>
  <form id="f"><input id="i" placeholder="Message…" autocomplete="off" /><button>Send</button></form>
  <script>
    const log = document.getElementById('log');
    function add(role, text) {
      const d = document.createElement('div');
      d.className = 'msg ' + role;
      d.textContent = text;
      log.appendChild(d);
      window.scrollTo(0, document.body.scrollHeight);
      return d;
    }
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('i');
      const text = input.value.trim();
      if (!text) return;
      add('user', text);
      input.value = '';
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: [] }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const bubble = add('assistant', '');
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\\n\\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.content) { full += evt.content; bubble.textContent = full; }
          } catch {}
        }
      }
    });
  </script>
</body>
</html>`;

class MobileServer {
  constructor(ollama) {
    this.ollama = ollama;
    this.server = null;
    this.port = 4600;
    this.running = false;
  }

  getLocalIP() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
    return '127.0.0.1';
  }

  start() {
    if (this.running) return { success: true, url: `http://${this.getLocalIP()}:${this.port}` };

    this.server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end(MOBILE_HTML);
        return;
      }

      if (req.method === 'GET' && req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ online: true, model: this.ollama.getCurrentModel() }));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/chat') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { message, history } = JSON.parse(body);
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
            const messages = [...(history || []), { role: 'user', content: message }];
            await this.ollama.chatStream({ model: this.ollama.getCurrentModel(), messages }, (evt) => {
              if (evt.message?.content) {
                res.write(`data: ${JSON.stringify({ content: evt.message.content })}\n\n`);
              }
            });
            res.end();
          } catch (err) {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    this.server.listen(this.port, '0.0.0.0', () => {
      this.running = true;
    });

    this.server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        this.port++;
        this.server.listen(this.port, '0.0.0.0');
      }
    });

    return { success: true, url: `http://${this.getLocalIP()}:${this.port}` };
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.running = false;
    }
  }

  getStatus() {
    return { running: this.running, url: this.running ? `http://${this.getLocalIP()}:${this.port}` : null, port: this.port };
  }
}

module.exports = { MobileServer };
