const { app, BrowserWindow, ipcMain, clipboard, dialog, protocol, shell, screen } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const { initDb, getDb } = require('./db');
const { OllamaManager, HOST: OLLAMA_HOST, PORT: OLLAMA_PORT } = require('./services/ollama');
const { ModelDownloader, TIERS: CATALOG_TIERS } = require('./services/modelCatalog');
const { MobileServer } = require('./services/mobileServer');
const { VoiceInput } = require('./services/voiceInput');
const { Library } = require('./services/library');
const { extractText } = require('./services/textExtract');
const { syncModels } = require('./services/modelSync');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const ATTACHMENT_TEXT_EXT = new Set(['.txt', '.md', '.text', '.pdf', '.docx', '.doc']);

// If a previous instance is still around (e.g. it launched Ollama, the user
// left models loaded, and — see the app.exit() note near before-quit below —
// the process itself was still alive), a second double-click of the launcher
// should surface that instance's window rather than spawn a whole new
// Electron app on top of it. Without this, "leave models running" plus a
// relaunch produces two overlapping app windows sharing one Ollama backend.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// ---------------------------------------------------------------------------
// Portability — this is what makes "copy the folder to a USB drive" or
// "copy it to another folder or machine" actually work.
//
// app.getPath('userData') resolves to the OS's per-user profile folder
// (e.g. C:\Users\<you>\AppData\Roaming\aiportable-justai). That's fine for a
// normally-installed app, but it means chats/library would live on
// whatever machine you last ran the app on — not on the USB drive or
// portable folder itself. So instead, all app data lives in a `data/`
// folder next to the app:
//
//   - Packaged (electron-builder `--dir` / portable build): next to the
//     actual .exe/binary, i.e. dirname(process.execPath). Copy that whole
//     output folder anywhere — USB, another drive, another machine — and
//     `data/` travels with it.
//   - Dev / unpacked (`npm start` from source): next to the project root
//     (two levels up from src/main/), so running straight from a folder
//     you've copied anywhere works the same way.
// ---------------------------------------------------------------------------
function getPortableRoot() {
  if (app.isPackaged) return path.dirname(process.execPath);
  return path.resolve(__dirname, '..', '..');
}

function getResourcesDir() {
  // In a packaged app, electron-builder's `extraResources` config (see
  // package.json) copies resources/ into <root>/resources next to the
  // executable — process.resourcesPath points straight at it. In dev,
  // resources/ sits at the project root.
  if (app.isPackaged) return process.resourcesPath;
  return path.join(getPortableRoot(), 'resources');
}

const portableRoot = getPortableRoot();
const dataDir = path.join(portableRoot, 'data');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const dbPath = path.join(dataDir, 'chats.db');
const libraryDbPath = path.join(dataDir, 'library.db');
const libraryStorageDir = path.join(dataDir, 'library');
const libraryPdfsDir = path.join(libraryStorageDir, 'pdfs');
const portableModelsDir = path.join(dataDir, 'models'); // the default, travels-with-the-drive location

// ---------------------------------------------------------------------------
// Host settings — a small per-machine preference file, deliberately stored
// in the OS user-data folder rather than the portable data/ directory. Where
// a model actually gets pulled to should follow the machine ("this PC's own
// fast SSD"), not the USB drive — if it lived in data/settings.json instead,
// plugging the drive into a different computer would carry over a path
// (e.g. "C:\OllamaModels") that has no reason to exist there. Each machine
// gets its own independent choice, defaulting cleanly to the portable folder
// when unset.
// ---------------------------------------------------------------------------
const hostSettingsPath = path.join(app.getPath('userData'), 'host-settings.json');
let hostSettings = {};

function loadHostSettings() {
  try {
    return JSON.parse(fs.readFileSync(hostSettingsPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveHostSettings() {
  try {
    fs.mkdirSync(path.dirname(hostSettingsPath), { recursive: true });
    fs.writeFileSync(hostSettingsPath, JSON.stringify(hostSettings, null, 2));
  } catch (err) {
    console.error('Could not save host settings:', err.message);
  }
}

// The folder Ollama should actually use right now: the configured host
// folder if one is set and still exists on this machine, else the portable
// default. Falls back silently (no error) if a previously-configured host
// folder has since disappeared — e.g. an external drive that isn't plugged
// in this time.
function getEffectiveModelsDir() {
  const custom = hostSettings.customModelsDir;
  if (custom && fs.existsSync(custom)) return custom;
  return portableModelsDir;
}

// Which GPU-size catalog tier(s) (4K/8K/12K/24K/32K) to pull the Models tab's
// list from — also a host setting, not a portable one: VRAM is a property of
// this machine's GPU, so plugging the same portable data/ folder into a
// different PC shouldn't carry over a tier choice that no longer fits.
// Defaults to every tier whose file actually exists on disk, so a fresh
// install (or one where the saved choice named a tier that's since gone
// missing) shows the fullest list rather than an empty one.
function getSelectedCatalogTiers() {
  const available = downloader.listAvailableTiers().filter((t) => t.available).map((t) => t.tier);
  const saved = Array.isArray(hostSettings.catalogTiers) ? hostSettings.catalogTiers.filter((t) => available.includes(t)) : [];
  return saved.length ? saved : available;
}

// User-configurable context length (num_ctx), a host setting for the same
// reason the GPU tier is: it's a property of this machine's VRAM, not of the
// portable data/ folder. null means "Auto" — leave Ollama's own vram-based
// sizing alone, the behavior before this setting existed. When set, it's
// used as the floor for every chat request (renderer.js still raises it
// further, never lowers it, when a request needs more — see chat send).
const CONTEXT_SIZE_PRESETS = [2048, 4096, 8192, 16384, 32768, 65536];
function getContextSize() {
  const saved = hostSettings.contextSize;
  return CONTEXT_SIZE_PRESETS.includes(saved) ? saved : null;
}

function findBundledOllama() {
  const platDir = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  const exe = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  const candidate = path.join(getResourcesDir(), 'ollama', platDir, exe);
  return fs.existsSync(candidate) ? candidate : null;
}

// ---------------------------------------------------------------------------
// Custom schemes for library assets (extracted images, original PDF scans).
// Must be registered before app is ready.
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  { scheme: 'libimg', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'libpdf', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ---------------------------------------------------------------------------
// Services (instantiated once app is ready)
// ---------------------------------------------------------------------------
let ollamaProcess = null;
let ollama, downloader, mobileServer, voiceInput, library;

// Whether *this app* launched the Ollama process currently serving requests.
// Only true when we spawned it ourselves (with OLLAMA_MODELS pointed at the
// portable data/ folder below) — false when some other already-running
// Ollama instance (its own tray app, a system service, a terminal) answered
// first, in which case model pulls go wherever *that* instance is configured
// to store them, not our portable folder, and we have no way to change it.
let weSpawnedOllama = false;

// PID of the Ollama server this app owns — either the one spawned this
// session, or one spawned by a *previous* session that the user left
// running via "keep models loaded" and that we re-adopted at startup (see
// adoptKeptOllama). This, not the image name, is what shutdown kills, so an
// unrelated Ollama (tray app, service, terminal) is never touched.
let ownedOllamaPid = null;

// Resolves true if `pid` is a live ollama process. Used to tell our own
// kept-alive server from a previous session apart from a foreign instance.
function isOllamaPid(pid) {
  return new Promise((resolve) => {
    if (!Number.isInteger(pid) || pid <= 0) return resolve(false);
    if (process.platform !== 'win32') {
      try { process.kill(pid, 0); resolve(true); } catch { resolve(false); }
      return;
    }
    execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
      resolve(!err && /"ollama\.exe"/i.test(stdout || ''));
    });
  });
}

// When Ollama is already answering at startup, check whether it's the one we
// left running on our last exit. If so, it's still ours to manage (folder
// switches, shutdown); otherwise it's foreign and we leave it alone.
async function adoptKeptOllama() {
  const pid = hostSettings.keptOllamaPid;
  if (!pid) return false;
  delete hostSettings.keptOllamaPid;
  saveHostSettings();
  if (!(await isOllamaPid(pid))) return false;
  ownedOllamaPid = pid;
  weSpawnedOllama = true;
  appendOllamaLog(`[AIPortable] Re-adopted Ollama (PID ${pid}) left running by the previous session — its earlier log output isn't available.\n`);
  return true;
}

function ollamaReady() {
  return new Promise((resolve) => {
    const req = http.get({ hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/tags', timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// A bounded in-memory tail of Ollama's own stdout/stderr, for the System
// tab's log viewer (see the ollama:get-log IPC handler below) — there's no
// visible console window to glance at (see the windowsHide note above), so
// this is how the app surfaces what Ollama itself is logging. Capped so a
// noisy/long-running session can't grow this unbounded; a live tail doesn't
// need history beyond a screenful or two anyway.
const OLLAMA_LOG_MAX_CHARS = 200_000;
let ollamaLog = '';
function appendOllamaLog(chunk) {
  ollamaLog += chunk.toString();
  if (ollamaLog.length > OLLAMA_LOG_MAX_CHARS) {
    ollamaLog = ollamaLog.slice(ollamaLog.length - OLLAMA_LOG_MAX_CHARS);
  }
}

async function ensureOllamaRunning() {
  if (await ollamaReady()) {
    // Already serving — either our own instance kept from last session, or
    // someone else's (see weSpawnedOllama note above).
    await adoptKeptOllama();
    return true;
  }
  const bin = findBundledOllama() || 'ollama';
  const modelsDir = getEffectiveModelsDir();
  try {
    fs.mkdirSync(modelsDir, { recursive: true });
    // OLLAMA_MODELS points at either the portable data/models folder or a
    // host-machine folder the user chose (see the models:* IPC handlers) —
    // only takes effect for the process we spawn here, not one that was
    // already running before this app started.
    // windowsHide: true so the packaged build (a plain double-clicked .exe,
    // no wrapping batch/vbs console for ollama.exe to silently attach to)
    // doesn't get a surprise console window auto-allocated for it. Verified
    // this has nothing to do with whether Ollama's own log output is
    // visible in dev mode — see appendOllamaLog below for that instead.
    ollamaProcess = spawn(bin, ['serve'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, OLLAMA_MODELS: modelsDir },
    });
    ollamaProcess.stdout.on('data', appendOllamaLog);
    ollamaProcess.stderr.on('data', appendOllamaLog);
    ollamaProcess.on('error', (err) => console.error('Failed to spawn Ollama:', err.message));
  } catch (err) {
    console.error('Could not start Ollama:', err.message);
    return false;
  }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 400));
    if (await ollamaReady()) {
      weSpawnedOllama = true;
      ownedOllamaPid = ollamaProcess?.pid || null;
      return true;
    }
  }
  return false;
}

// Stops the Ollama process we're managing and starts it again, picking up
// whatever getEffectiveModelsDir()/hostSettings currently resolve to — used
// after the user changes the model storage folder or the console-visibility
// setting, since both are only read at spawn time. A no-op (returns
// immediately) if Ollama isn't ours to manage: some other already-running
// instance owns the port, and stopping/starting our own process wouldn't
// touch it.
async function restartManagedOllama(message) {
  if (!weSpawnedOllama) return { restarted: false, ready: await ollamaReady() };
  win?.webContents.send('ollama-restart-status', { message });
  await unloadRunningModels();
  await stopOllama();
  await new Promise((r) => setTimeout(r, 400)); // let the OS release the port before we rebind it
  const ready = await ensureOllamaRunning();
  win?.webContents.send('ollama-status', { ready });
  return { restarted: true, ready };
}

// Kills only the Ollama server we own (spawned or re-adopted), by PID. On
// Windows, `taskkill /T` takes down the whole tree — ollama.exe spawns each
// loaded model as a child llama-server.exe runner, which a plain kill() of
// ollama.exe would leave orphaned and still holding the model in memory.
// Any other Ollama on the machine is deliberately left untouched.
function stopOllama() {
  const pid = ownedOllamaPid;
  ownedOllamaPid = null;
  weSpawnedOllama = false;
  const child = ollamaProcess;
  ollamaProcess = null;
  if (!pid) return Promise.resolve();
  if (process.platform !== 'win32') {
    try { process.kill(pid); } catch { /* already gone */ }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 3000);
    execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true }, done);
  }).finally(() => { if (child && !child.killed) { try { child.kill(); } catch { /* already gone */ } } });
}

// Best-effort cleanup of anything we spawned, mirroring the reference app's
// shutdown behavior so a quit doesn't leave orphaned processes. Returns a
// promise that resolves once every kill command has actually exited (or
// after a timeout) — this used to be fire-and-forget, which was harmless
// back when before-quit finished with app.quit() (which waits for Node's
// event loop to drain naturally, incidentally giving these plenty of time to
// run). Now that before-quit uses app.exit() for an immediate hard exit (see
// that note), performShutdown has to actually await this, or app.exit() can
// kill our own process before taskkill/pkill get a chance to finish killing
// theirs — leaving ollama.exe/llama-server.exe orphaned even after the user
// asked to free memory.
function killStragglers() {
  const targets =
    process.platform === 'win32'
      ? [
          // No ollama.exe / llama-server.exe here: those image names are
          // shared with any other Ollama on the PC (tray app, service), so
          // killing by name would take down instances that aren't ours.
          // stopOllama() already tree-kills our own server and its runners by PID.
          ['taskkill', ['/F', '/T', '/IM', 'whisper-server.exe']],
        ]
      : [
          ['pkill', ['-f', 'whisper-server']],
        ];

  const waits = targets.map(
    ([cmd, args]) =>
      new Promise((resolve) => {
        try {
          const child = spawn(cmd, args, { stdio: 'ignore' });
          child.on('exit', resolve);
          child.on('error', resolve);
        } catch {
          resolve();
        }
      })
  );

  const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
  return Promise.race([Promise.all(waits), timeout]);
}

// Asks Ollama to drop every currently-resident model from RAM/VRAM
// (keep_alive: 0) before we kill its process — a graceful unload instead of
// just yanking the process and hoping the OS reclaims memory promptly.
async function unloadRunningModels() {
  try {
    const running = await ollama.getRunningModels();
    for (const m of running) await ollama.unloadModel(m.name);
  } catch { /* best effort */ }
}

let shuttingDown = false;

// Set from the exit-confirmation dialog's checkbox (and remembered in
// hostSettings as the default for next time). When true, performShutdown
// leaves Ollama and whatever models it has loaded running in the background
// instead of tearing them down — ollamaProcess is a plain, non-detached child
// of this app but isn't part of any job object that would kill it when we
// exit, so it (and its resident models, kept alive forever by the
// keep_alive: -1 on every chat request — see ollama.js) simply keeps running
// for ensureOllamaRunning() to find already-serving on the next launch.
let exitKeepModelsLoaded = false;

// Full graceful shutdown: unload models, stop the servers we started, kill
// the ollama process (and any straggler), close the db. Used by both the
// explicit Exit action and the normal window-close/quit path. Skips tearing
// down Ollama/models entirely when the user opted to leave them loaded.
async function performShutdown(keepModelsLoaded) {
  if (keepModelsLoaded) {
    win?.webContents.send('shutdown-status', { message: 'Closing…' });
    // Remember which PID we left running so the next launch can re-adopt it
    // as ours instead of mistaking it for a foreign instance.
    if (weSpawnedOllama && ownedOllamaPid) {
      hostSettings.keptOllamaPid = ownedOllamaPid;
      saveHostSettings();
    }
    mobileServer?.stop();
    voiceInput?.stopServer();
    try { getDb()?.close(); } catch { /* already closed */ }
    return;
  }
  // An external Ollama's resident models may belong to other programs using
  // it, so only unload when the server is ours.
  if (weSpawnedOllama) {
    win?.webContents.send('shutdown-status', { message: 'Unloading models…' });
    await unloadRunningModels();
  }
  win?.webContents.send('shutdown-status', { message: 'Stopping services…' });
  mobileServer?.stop();
  voiceInput?.stopServer();
  await stopOllama();
  await killStragglers();
  try { getDb()?.close(); } catch { /* already closed */ }
}

// ---------------------------------------------------------------------------
// Window — normal native frame, no forced fullscreen
// ---------------------------------------------------------------------------
let win = null;

// Window size/position is a per-machine/monitor preference, same reasoning
// as the custom models folder — so it lives in the same hostSettings file
// rather than data/, and a drive plugged into a different PC just falls back
// to the default size instead of carrying over coordinates that make no
// sense on that screen.
function getSavedWindowBounds() {
  const saved = hostSettings.windowBounds;
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return null;

  // Drop a remembered position if it no longer lands on any currently
  // connected display (a monitor got unplugged, resolution changed, etc.) —
  // keep the remembered width/height either way and let Electron center it.
  const onScreen =
    typeof saved.x === 'number' &&
    typeof saved.y === 'number' &&
    screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return saved.x >= a.x - 50 && saved.y >= a.y - 50 && saved.x < a.x + a.width && saved.y < a.y + a.height;
    });

  return onScreen ? saved : { width: saved.width, height: saved.height };
}

function createWindow() {
  const saved = getSavedWindowBounds();
  win = new BrowserWindow({
    width: saved?.width || 1180,
    height: saved?.height || 760,
    x: saved?.x,
    y: saved?.y,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: '#14171c',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (hostSettings.windowMaximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('close', (e) => {
    // Once shuttingDown is set, before-quit's second app.quit() pass is
    // already driving this close (Exit button, or this same dialog already
    // confirmed below) — let it through. Otherwise this is the very first
    // close attempt (native titlebar X, Alt+F4, …): block it and hand off to
    // the renderer's exit-confirmation dialog, same as the Exit button, so
    // the model runtime doesn't get torn down without asking.
    if (!shuttingDown) {
      e.preventDefault();
      win.webContents.send('close-requested');
      return;
    }
    // getNormalBounds() (not getBounds()) so a currently-maximized window
    // still remembers its restored size/position, not the maximized ones.
    hostSettings.windowMaximized = win.isMaximized();
    hostSettings.windowBounds = win.getNormalBounds();
    saveHostSettings();
  });
  win.on('closed', () => { win = null; });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Images belonging to library docs (data/library/images/<asset_dir>/),
// served as "libimg://<asset_dir>/<filename>" so the Library Browser can
// show them without copying anything into an app-bundled asset folder. A
// fresh install has none — this only serves anything once a document
// collection with extracted images has been imported into data/library.db.
// Guarded against path traversal (join + startsWith).
// ---------------------------------------------------------------------------
function registerLibraryImagesProtocol() {
  const imagesRoot = path.join(libraryStorageDir, 'images');
  fs.mkdirSync(imagesRoot, { recursive: true });

  protocol.handle('libimg', async (request) => {
    try {
      const u = new URL(request.url);
      const relPath = decodeURIComponent(u.hostname + u.pathname).replace(/^\/+/, ''); // "<doc_id>/<filename>"
      const filePath = path.join(imagesRoot, relPath);
      if (!filePath.startsWith(imagesRoot) || !fs.existsSync(filePath)) return new Response('not found', { status: 404 });

      const ext = path.extname(filePath).toLowerCase();
      const contentType = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
      const data = fs.readFileSync(filePath);
      return new Response(data, { status: 200, headers: { 'Content-Type': contentType } });
    } catch (err) {
      return new Response('error: ' + err.message, { status: 500 });
    }
  });
}

// ---------------------------------------------------------------------------
// Original PDF scans for library docs (data/library/pdfs/, referenced by
// library_docs.pdf_filename), served as "libpdf://<filename>.pdf" for the
// in-app viewer (src/renderer/pdfViewer.js, built on pdfjs-dist's own
// pdf_viewer.mjs). Range support matters here specifically — large scans can
// be 90MB+, and pdf.js will use range requests to fetch just the pages
// being viewed instead of the whole file up front, if the server supports it.
// ---------------------------------------------------------------------------
function registerLibraryPdfProtocol() {
  const pdfsRoot = path.join(libraryStorageDir, 'pdfs');
  fs.mkdirSync(pdfsRoot, { recursive: true });

  protocol.handle('libpdf', async (request) => {
    try {
      const u = new URL(request.url);
      const relPath = decodeURIComponent(u.hostname + u.pathname).replace(/^\/+/, '');
      const filePath = path.join(pdfsRoot, relPath);
      if (!filePath.startsWith(pdfsRoot) || !fs.existsSync(filePath)) return new Response('not found', { status: 404 });

      const stat = fs.statSync(filePath);
      const range = request.headers.get('range');

      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (!match) return new Response('bad range', { status: 416 });
        const start = parseInt(match[1], 10);
        const end = match[2] ? Math.min(parseInt(match[2], 10), stat.size - 1) : stat.size - 1;
        if (start >= stat.size || start > end) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
        }
        const chunkSize = end - start + 1;
        const buf = Buffer.alloc(chunkSize);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buf, 0, chunkSize, start);
        fs.closeSync(fd);
        return new Response(buf, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': 'application/pdf',
          },
        });
      }

      const data = fs.readFileSync(filePath);
      return new Response(data, {
        status: 200,
        headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(stat.size), 'Content-Type': 'application/pdf' },
      });
    } catch (err) {
      return new Response('error: ' + err.message, { status: 500 });
    }
  });
}

app.whenReady().then(async () => {
  fs.mkdirSync(dataDir, { recursive: true }); // must exist before better-sqlite3 opens chats.db inside it
  hostSettings = loadHostSettings();
  initDb(dbPath, libraryDbPath);
  registerLibraryImagesProtocol();
  registerLibraryPdfProtocol();

  ollama = new OllamaManager();
  downloader = new ModelDownloader(ollama, dataDir);
  mobileServer = new MobileServer(ollama);
  voiceInput = new VoiceInput(getResourcesDir());
  voiceInput.detect();
  library = new Library(ollama, libraryStorageDir);
  const migrated = library.backfillChunks();
  if (migrated > 0) console.log(`[library] chunked ${migrated} doc(s) uploaded before chunking existed`);

  downloader.on('progress', (data) => win?.webContents.send('pull-progress', data));
  downloader.on('complete', (data) => win?.webContents.send('pull-complete', data));
  downloader.on('error', (data) => win?.webContents.send('pull-error', data));

  createWindow();
  const ready = await ensureOllamaRunning();
  win?.webContents.send('ollama-status', { ready });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Intercepts the very first quit attempt (Exit button, window close, Alt+F4,
// Cmd+Q, …) to run the async graceful shutdown first, then lets the quit
// through on the second pass so it isn't blocked forever.
app.on('before-quit', (e) => {
  if (shuttingDown) return;
  e.preventDefault();
  shuttingDown = true;
  // app.exit() (hard, immediate process termination), not app.quit() (which
  // waits for Node's event loop to drain on its own). When the user chose to
  // leave models loaded, performShutdown() deliberately leaves ollamaProcess
  // running with its stdout/stderr pipes still attached — those open pipes
  // keep the event loop alive, so app.quit() would never actually let the
  // process (and, launched via the .bat/.vbs, its wrapping console window)
  // exit. All the async cleanup we need has already finished by this point,
  // so there's nothing left for a graceful quit to wait for anyway.
  performShutdown(exitKeepModelsLoaded).finally(() => app.exit(0));
});

// ---------------------------------------------------------------------------
// IPC — chats
// ---------------------------------------------------------------------------
ipcMain.handle('chat:create', () => {
  // Date.now() alone collides under Windows' ~15ms clock tick resolution
  // when two chats are created in quick succession (e.g. a double-click),
  // which trips the chats.id UNIQUE constraint.
  const id = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  getDb().prepare('INSERT INTO chats (id, title, created_at) VALUES (?,?,?)').run(id, 'New chat', new Date().toISOString());
  return { id };
});
ipcMain.handle('chat:list', () => getDb().prepare('SELECT * FROM chats ORDER BY created_at DESC').all());
ipcMain.handle('chat:history', (e, chatId) => getDb().prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC').all(chatId));
ipcMain.handle('chat:rename', (e, { chatId, title }) => {
  getDb().prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, chatId);
  return { success: true };
});
ipcMain.handle('chat:generate-title', async (e, { model, chatId, text }) => {
  const title = await ollama.generateTitle(model, text);
  if (title) {
    // Only overwrite the default title — if the user renamed the chat
    // manually while this generation was in flight, their name wins.
    getDb().prepare(`UPDATE chats SET title = ? WHERE id = ? AND title = 'New chat'`).run(title.slice(0, 60), chatId);
  }
  return { title };
});
ipcMain.handle('chat:delete', (e, chatId) => {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
  db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
  return { success: true };
});
ipcMain.handle('chat:clear-all', () => {
  const db = getDb();
  db.prepare('DELETE FROM messages').run();
  db.prepare('DELETE FROM chats').run();
  return { success: true };
});

ipcMain.handle('chat:send', async (event, { streamId, model, chatId, messages, options }) => {
  const now = new Date().toISOString();
  const userMsg = messages[messages.length - 1];
  getDb().prepare('INSERT INTO messages (chat_id, role, content, created_at) VALUES (?,?,?,?)').run(chatId, userMsg.role, userMsg.content, now);

  await ollama.chatStream({ model, messages, options }, (evt) => {
    event.sender.send('chat-token', { streamId, ...evt });
  });
  return { success: true };
});

// Standalone streaming completion shared by one-off utility views (Analyze
// Image, Translate) — same underlying ollama.chatStream()/'chat-token'
// event pair as chat:send, but deliberately does NOT touch the
// chats/messages tables. These are one-shot lookups, not saved
// conversations — nothing here should show up in the chat sidebar.
ipcMain.handle('utility:stream', async (event, { streamId, model, messages, options }) => {
  await ollama.chatStream({ model, messages, options }, (evt) => {
    event.sender.send('chat-token', { streamId, ...evt });
  });
  return { success: true };
});

ipcMain.handle('chat:save-assistant-message', (e, { chatId, content }) => {
  getDb().prepare('INSERT INTO messages (chat_id, role, content, created_at) VALUES (?,?,?,?)').run(chatId, 'assistant', content, new Date().toISOString());
  return { success: true };
});

ipcMain.handle('chat:abort', () => ollama.abortGeneration());

ipcMain.handle('chat:export', async (event, { chatId, title }) => {
  const messages = getDb().prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC').all(chatId);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export chat',
    defaultPath: `${(title || 'chat').replace(/[^\w -]/g, '_')}.txt`,
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return { success: false };
  let out = `${title}\nExported ${new Date().toLocaleString()}\n${'─'.repeat(40)}\n\n`;
  for (const m of messages) out += `[${m.role === 'user' ? 'You' : 'Assistant'}]\n${m.content}\n\n`;
  fs.writeFileSync(filePath, out, 'utf8');
  return { success: true, path: filePath };
});

// ---------------------------------------------------------------------------
// IPC — models
// ---------------------------------------------------------------------------
ipcMain.handle('ollama:list-models', () => ollama.getModels());
ipcMain.handle('ollama:current-model', () => ollama.getCurrentModel());
ipcMain.handle('ollama:set-model', (e, name) => ollama.setCurrentModel(name));
ipcMain.handle('ollama:status', async () => ({ ready: await ollamaReady() }));
ipcMain.handle('ollama:running-models', () => ollama.getRunningModels());
ipcMain.handle('ollama:model-capabilities', async (e, name) => ollama.getModelCapabilities(name));

ipcMain.handle('catalog:list', () => downloader.getCatalog(getSelectedCatalogTiers()));
// Unfiltered by the GPU-size picker — used by the main chat dropdown as a
// fallback so an already-installed model never loses its catalog prefix/size
// just because its tier isn't currently selected (see refreshModels() in
// renderer.js).
ipcMain.handle('catalog:list-all-tiers', () => downloader.getCatalog(CATALOG_TIERS.map((t) => t.tier)));
ipcMain.handle('catalog:status', () => downloader.getStatus());
ipcMain.handle('catalog:pull', (e, name) => downloader.pullModel(name));
ipcMain.handle('catalog:pull-missing', () => downloader.startBackgroundDownloads(getSelectedCatalogTiers()));
ipcMain.handle('catalog:cancel', (e, name) => downloader.cancelDownload(name));
ipcMain.handle('catalog:file-info', () => downloader.getCatalogInfo(getSelectedCatalogTiers()));
ipcMain.handle('catalog:reveal-file', (e, tier) => { const p = downloader.tierFilePath(tier); if (p) shell.showItemInFolder(p); });
ipcMain.handle('catalog:delete', (e, name) => ollama.deleteModel(name));

ipcMain.handle('catalog:tiers', () => downloader.listAvailableTiers());
ipcMain.handle('catalog:get-selected-tiers', () => getSelectedCatalogTiers());
ipcMain.handle('catalog:set-selected-tiers', (e, tiers) => {
  const available = downloader.listAvailableTiers().filter((t) => t.available).map((t) => t.tier);
  hostSettings.catalogTiers = Array.isArray(tiers) ? tiers.filter((t) => available.includes(t)) : [];
  saveHostSettings();
  return getSelectedCatalogTiers();
});

ipcMain.handle('settings:context-size-presets', () => CONTEXT_SIZE_PRESETS);
ipcMain.handle('settings:get-context-size', () => getContextSize());
ipcMain.handle('settings:set-context-size', (e, size) => {
  hostSettings.contextSize = CONTEXT_SIZE_PRESETS.includes(size) ? size : null;
  saveHostSettings();
  return getContextSize();
});

// ---------------------------------------------------------------------------
// IPC — mobile sync server
// ---------------------------------------------------------------------------
ipcMain.handle('mobile:start', () => mobileServer.start());
ipcMain.handle('mobile:stop', () => { mobileServer.stop(); return { success: true }; });
ipcMain.handle('mobile:status', () => mobileServer.getStatus());

// ---------------------------------------------------------------------------
// IPC — voice input
// ---------------------------------------------------------------------------
ipcMain.handle('voice:check', () => voiceInput.checkAvailability());
ipcMain.handle('voice:transcribe', async (event, base64Audio) => {
  const tmpPath = path.join(os.tmpdir(), `localai-rec-${Date.now()}.wav`);
  fs.writeFileSync(tmpPath, Buffer.from(base64Audio, 'base64'));
  const result = await voiceInput.transcribe(tmpPath);
  try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
  return result;
});

// ---------------------------------------------------------------------------
// IPC — library (upload + search)
// ---------------------------------------------------------------------------
ipcMain.handle('library:upload', (e, payload) => library.uploadDoc(payload));
ipcMain.handle('library:list-uploads', () => library.listUploads());
ipcMain.handle('library:delete-upload', (e, id) => library.deleteUpload(id));
ipcMain.handle('library:read-upload', (e, id) => library.readUpload(id));
ipcMain.handle('library:search', async (e, { query, embedModel }) => library.search(query, embedModel));
ipcMain.handle('library:context', async (e, { query, embedModel }) => library.buildContext(query, embedModel));
ipcMain.handle('library:identify-image', async (e, { model, imageBase64, options }) => ollama.identifyImage(model, imageBase64, options));
ipcMain.handle('library:browse', (e, payload) => library.browse(payload));
ipcMain.handle('library:browse-facets', () => library.browseFacets());
ipcMain.handle('library:get-doc', (e, id) => library.getDoc(id));
ipcMain.handle('library:open-pdf', (e, id) => {
  const doc = library.getDoc(id);
  if (!doc?.pdf_filename) return { ok: false, error: 'No original PDF on file for this doc.' };
  const filePath = path.join(libraryPdfsDir, doc.pdf_filename);
  if (!fs.existsSync(filePath)) return { ok: false, error: 'PDF file is missing on disk.' };
  return shell.openPath(filePath).then((openErr) => (openErr ? { ok: false, error: openErr } : { ok: true }));
});

// ---------------------------------------------------------------------------
// IPC — chat attachments (image / pdf / docx / text, one-off per message —
// not persisted to the library, unlike the Library tab's uploads)
// ---------------------------------------------------------------------------
ipcMain.handle('attachment:process', async (e, { name, base64 }) => {
  const ext = path.extname(name).toLowerCase();
  const buf = Buffer.from(base64, 'base64');

  if (IMAGE_EXT.has(ext)) {
    return { kind: 'image', base64, mime: `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}` };
  }
  if (ATTACHMENT_TEXT_EXT.has(ext)) {
    const { text, warning } = await extractText(buf, ext);
    return { kind: 'text', text, warning };
  }
  const supported = [...IMAGE_EXT, ...ATTACHMENT_TEXT_EXT].join(', ');
  return {
    kind: 'unsupported',
    error: `"${ext || '(no extension)'}" isn't a supported attachment type.\n\nSupported types: ${supported}`,
  };
});

// ---------------------------------------------------------------------------
// IPC — app lifecycle
// ---------------------------------------------------------------------------
ipcMain.handle('app:quit', (e, { keepLoaded = false } = {}) => {
  exitKeepModelsLoaded = keepLoaded;
  hostSettings.keepModelsLoadedOnExit = keepLoaded; // remembered as the checkbox's default next time
  saveHostSettings();
  app.quit();
});
ipcMain.handle('app:get-keep-loaded-pref', () => !!hostSettings.keepModelsLoadedOnExit);

// ---------------------------------------------------------------------------
// IPC — misc
// ---------------------------------------------------------------------------
ipcMain.handle('clipboard:write', (e, text) => { clipboard.writeText(String(text || '')); return true; });

ipcMain.handle('system:info', () => {
  const totalRAM = os.totalmem();
  const cpus = os.cpus();
  return {
    ramGB: Math.round((totalRAM / (1024 ** 3)) * 10) / 10,
    cpuModel: cpus[0]?.model || 'unknown',
    cpuCores: cpus.length,
    platform: process.platform,
    arch: process.arch,
  };
});

ipcMain.handle('ollama:get-log', () => ollamaLog);

// ---------------------------------------------------------------------------
// IPC — model storage location (portable folder vs. a host-machine folder)
// ---------------------------------------------------------------------------
// activeDir is only known when we own the server — an external Ollama uses
// its own configured folder, which we can't query over its API. For that
// case externalDirGuess is the folder it most likely uses: OLLAMA_MODELS if
// set in this user's environment, else Ollama's standard default.
function getModelsLocation() {
  return {
    portableDir: portableModelsDir,
    customDir: hostSettings.customModelsDir || null,
    activeDir: weSpawnedOllama ? getEffectiveModelsDir() : null,
    externalDirGuess: weSpawnedOllama ? null : (process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models')),
    managedByApp: weSpawnedOllama,
  };
}

ipcMain.handle('models:get-location', () => getModelsLocation());

ipcMain.handle('models:choose-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose a folder on this PC to store Ollama models',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths[0]) return { success: false };

  const chosen = filePaths[0];
  if (path.resolve(chosen) === path.resolve(portableModelsDir)) {
    return { success: false, error: 'That is already the portable folder used by default.' };
  }

  fs.mkdirSync(chosen, { recursive: true });
  hostSettings.customModelsDir = chosen;
  saveHostSettings();
  await restartManagedOllama('Switching model folder…');
  return {
    success: true,
    location: getModelsLocation(),
  };
});

ipcMain.handle('models:use-portable', async () => {
  hostSettings.customModelsDir = null;
  saveHostSettings();
  await restartManagedOllama('Switching model folder…');
  return {
    success: true,
    location: getModelsLocation(),
  };
});

// direction: 'toHost' copies portable -> host folder, 'toPortable' the
// reverse. Either way it's a plain merge-copy of model store files (see
// services/modelSync.js) — independent of which folder Ollama is actively
// serving from right now, so it works even when an external Ollama instance
// currently owns the port.
ipcMain.handle('models:sync', async (e, direction) => {
  const custom = hostSettings.customModelsDir;
  if (!custom) return { success: false, error: 'Choose a host folder first.' };

  const [src, dest] = direction === 'toHost' ? [portableModelsDir, custom] : [custom, portableModelsDir];
  try {
    const result = await syncModels(src, dest, (progress) => {
      win?.webContents.send('model-sync-progress', progress);
    });
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
