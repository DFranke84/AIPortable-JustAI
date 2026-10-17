const { app, BrowserWindow, ipcMain, clipboard, dialog, protocol, shell, screen } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const { initDb, getDb } = require('./db');
const { OllamaManager, HOST: OLLAMA_HOST, PORT: OLLAMA_PORT } = require('./services/ollama');
const { LMStudioManager } = require('./services/lmstudio');
const { ZimSearch, PORT: ZIM_SEARCH_PORT } = require('./services/zimSearch');
const { ModelDownloader, TIERS: CATALOG_TIERS } = require('./services/modelCatalog');
const { MobileServer } = require('./services/mobileServer');
const { VoiceInput } = require('./services/voiceInput');
const { Library } = require('./services/library');
const { ResearchSync } = require('./services/researchSync');
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

// The separate Research library (E:\Research) that the AI indexes in place —
// also a host setting, since drive letters are a property of the machine.
// Order: the folder the user picked (if it still exists), a "Research"
// folder beside the app folder (E:\AIPortable-JustAI -> E:\Research, so it
// follows the drive letter), then E:\Research. null = not connected.
function getResearchRoot() {
  const candidates = [hostSettings.researchRoot, path.join(portableRoot, '..', 'Research'), 'E:\\Research'].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'CATALOG.json'))) return path.resolve(c);
  }
  return null;
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
  { scheme: 'research', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ---------------------------------------------------------------------------
// Services (instantiated once app is ready)
// ---------------------------------------------------------------------------
let ollamaProcess = null;
let ollama, lmstudio, downloader, mobileServer, voiceInput, library, researchSync;

// Which runtime answers chats: 'ollama' (default) or 'lmstudio'. Ollama is
// started either way — library search embeddings always use its
// nomic-embed-text (the precomputed library vectors were built with it), and
// the model catalog/downloads are Ollama-only.
function getLlmBackend() {
  return hostSettings.llmBackend === 'lmstudio' ? 'lmstudio' : 'ollama';
}
function chatBackend() {
  return getLlmBackend() === 'lmstudio' ? lmstudio : ollama;
}
// Runtime for the standalone image tools (Analyze Image, translating an
// image): the chat runtime, unless the user ticked "Use Ollama for image
// tools" to keep e.g. a small Ollama vision model for those while chatting
// through LM Studio. Images attached in chat always go to the chat model.
function visionBackend() {
  return hostSettings.visionUseOllama ? ollama : chatBackend();
}
function backendFor(purpose) {
  return purpose === 'vision' ? visionBackend() : chatBackend();
}
function getLmstudioAutoLoad() {
  return hostSettings.lmstudioAutoLoad !== false; // default on
}
// Whether LM Studio models may "think" before answering (default on = each
// model's own default). Off = faster replies; see lmstudio.js reasoningEffort.
function getLmstudioThinking() {
  return hostSettings.lmstudioThinking !== false;
}

// Whether the *chat* runtime is reachable — what the status dot shows.
// kiwix-serve for searching .zim archives from chat (services/zimSearch.js).
// JustAI has no Wikipedia viewer, so this is its only kiwix process.
const zimSearch = new ZimSearch();
function findBundledKiwix() {
  const platDir = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  const exe = process.platform === 'win32' ? 'kiwix-serve.exe' : 'kiwix-serve';
  const candidate = path.join(getResourcesDir(), 'kiwix', platDir, exe);
  return fs.existsSync(candidate) ? candidate : null;
}

async function runtimeReady() {
  if (getLlmBackend() === 'lmstudio') return (await lmstudio.checkConnection()).connected;
  return ollamaReady();
}

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

// Ollama's model runners (llama-server.exe) can outlive an Ollama that
// crashed or was killed, each still holding a model in RAM/VRAM (three such
// orphans were found on 2026-10-17). Before starting our own Ollama, stop
// runners that belong to this app's copy of Ollama and whose parent process
// no longer exists. A reused parent PID only means one is left alone.
function killOrphanRunners() {
  if (process.platform !== 'win32') return Promise.resolve();
  const ours = path.join(getResourcesDir(), 'ollama').toLowerCase();
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };
  const query = "Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\" | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.ParentProcessId, $_.ExecutablePath }";
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', query], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      if (!err) {
        for (const line of String(stdout).split(/\r?\n/)) {
          const [pid, ppid, exe] = line.split('|');
          if (!exe || !exe.toLowerCase().startsWith(ours) || alive(Number(ppid))) continue;
          try { process.kill(Number(pid)); console.log(`[ollama] stopped orphaned runner ${pid}`); } catch { /* already gone */ }
        }
      }
      resolve();
    });
  });
}

async function ensureOllamaRunning() {
  if (await ollamaReady()) {
    // Already serving — either our own instance kept from last session, or
    // someone else's (see weSpawnedOllama note above).
    await adoptKeptOllama();
    return true;
  }
  await killOrphanRunners();
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
          ['taskkill', ['/F', '/T', '/IM', 'kiwix-serve.exe']],
        ]
      : [
          ['pkill', ['-f', 'whisper-server']],
          ['pkill', ['-f', 'kiwix-serve']],
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
    await zimSearch.stop(); // holds no model state worth keeping resident — always tear it down
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
  await zimSearch.stop();
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

// Saved whenever the window is resized/moved (debounced) and again right
// before shutdown — not only from the window's 'close' event: quitting ends
// with app.exit() (see before-quit), which never fires 'close', so the size
// was never actually saved on a normal Exit.
// getNormalBounds() (not getBounds()) so a maximized window still remembers
// its restored size/position, not the maximized ones.
function saveWindowState() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  hostSettings.windowMaximized = win.isMaximized();
  hostSettings.windowBounds = win.getNormalBounds();
  saveHostSettings();
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
  // Rarely Chromium's network service crashes during start-up (seen right
  // after another Electron app quit, 2026-10-17) and the first page load
  // stalls blank — and this window, hidden until ready-to-show, never
  // appears, so the app looks like it didn't start. One reload after 15 s
  // recovers it; if even that doesn't paint, show the window anyway.
  const startupWatchdog = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isVisible()) return;
    win.webContents.reload();
    setTimeout(() => { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); }, 10000);
  }, 15000);
  win.once('ready-to-show', () => clearTimeout(startupWatchdog));
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
    saveWindowState();
  });
  let windowStateTimer = null;
  const saveSoon = () => { clearTimeout(windowStateTimer); windowStateTimer = setTimeout(saveWindowState, 500); };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, saveSoon);
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
      return serveFile(filePath, request);
    } catch (err) {
      return new Response('error: ' + err.message, { status: 500 });
    }
  });
}

const CONTENT_TYPES = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
};

// Read-only file response with HTTP Range support (pdf.js fetches just the
// pages being viewed of a large scan, if ranges are honored).
function serveFile(filePath, request) {
  const stat = fs.statSync(filePath);
  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
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
        'Content-Type': contentType,
      },
    });
  }

  const data = fs.readFileSync(filePath);
  return new Response(data, {
    status: 200,
    headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(stat.size), 'Content-Type': contentType },
  });
}

// ---------------------------------------------------------------------------
// Files in the linked Research library, served in place (never copied) as
// "research://root/<path relative to the Research folder>" — the page images
// and original PDFs the Library Browser shows for a linked doc. Read-only
// (GET/HEAD only) and confined to the Research root, like the other schemes.
// ---------------------------------------------------------------------------
function registerResearchProtocol() {
  protocol.handle('research', async (request) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('read-only', { status: 405 });
      const u = new URL(request.url);
      const relPath = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const filePath = researchSync.resolve(relPath);
      if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return new Response('not found', { status: 404 });
      return serveFile(filePath, request);
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
  registerResearchProtocol();

  ollama = new OllamaManager();
  // A request needing a bigger context than the model is loaded with makes
  // Ollama reload it — tell the UI so the wait isn't a mystery (see fitOptions).
  ollama.onReload = (info) => win?.webContents.send('model-reload', info);
  lmstudio = new LMStudioManager({ getAutoLoad: getLmstudioAutoLoad, getThinking: getLmstudioThinking });
  downloader = new ModelDownloader(ollama, dataDir);
  // The phone server only needs the current model + chatStream, routed to
  // whichever runtime is active at the time of each request.
  mobileServer = new MobileServer({
    getCurrentModel: () => chatBackend().getCurrentModel(),
    chatStream: (...args) => chatBackend().chatStream(...args),
  });
  voiceInput = new VoiceInput(getResourcesDir());
  voiceInput.detect();
  library = new Library(ollama, libraryStorageDir);
  researchSync = new ResearchSync({ library, ollama, getRoot: getResearchRoot });
  researchSync.on('progress', (p) => win?.webContents.send('research-sync-progress', p));

  downloader.on('progress', (data) => win?.webContents.send('pull-progress', data));
  downloader.on('complete', (data) => win?.webContents.send('pull-complete', data));
  downloader.on('error', (data) => win?.webContents.send('pull-error', data));

  createWindow();
  // One-time migration check for very old uploads — after the window is up,
  // never before it: on a cold disk it used to hold the window back for up
  // to ~30 s (2026-10-17), so a double-click looked like it did nothing.
  setTimeout(() => {
    const migrated = library.backfillChunks();
    if (migrated > 0) console.log(`[library] chunked ${migrated} doc(s) uploaded before chunking existed`);
  }, 3000);
  await ensureOllamaRunning();
  win?.webContents.send('ollama-status', { ready: await runtimeReady(), backend: getLlmBackend() });
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
  saveWindowState();
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
  const title = await chatBackend().generateTitle(model, text);
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

  await chatBackend().chatStream({ model, messages, options }, (evt) => {
    event.sender.send('chat-token', { streamId, ...evt });
  });
  return { success: true };
});

// Standalone streaming completion shared by one-off utility views (Analyze
// Image, Translate) — same underlying ollama.chatStream()/'chat-token'
// event pair as chat:send, but deliberately does NOT touch the
// chats/messages tables. These are one-shot lookups, not saved
// conversations — nothing here should show up in the chat sidebar.
// `purpose: 'vision'` routes to the image-tools runtime (see visionBackend).
ipcMain.handle('utility:stream', async (event, { streamId, model, messages, options, purpose }) => {
  await backendFor(purpose).chatStream({ model, messages, options }, (evt) => {
    event.sender.send('chat-token', { streamId, ...evt });
  });
  return { success: true };
});

ipcMain.handle('chat:save-assistant-message', (e, { chatId, content }) => {
  getDb().prepare('INSERT INTO messages (chat_id, role, content, created_at) VALUES (?,?,?,?)').run(chatId, 'assistant', content, new Date().toISOString());
  return { success: true };
});

// Both runtimes, since a utility stream may be on the other one (see visionBackend).
ipcMain.handle('chat:abort', () => {
  zimSearch.cancel();
  const a = ollama.abortGeneration();
  const b = lmstudio.abortGeneration();
  return a || b;
});

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
// These route to the active runtime; `purpose: 'vision'` selects the
// image-tools runtime instead (see visionBackend). The channel names keep
// their historical "ollama:" prefix.
ipcMain.handle('ollama:list-models', (e, purpose) => backendFor(purpose).getModels());
ipcMain.handle('ollama:current-model', () => chatBackend().getCurrentModel());
ipcMain.handle('ollama:set-model', (e, name) => chatBackend().setCurrentModel(name));
ipcMain.handle('ollama:status', async () => ({ ready: await runtimeReady(), backend: getLlmBackend() }));
ipcMain.handle('ollama:running-models', (e, purpose) => backendFor(purpose).getRunningModels());
ipcMain.handle('ollama:model-capabilities', async (e, name, purpose) => backendFor(purpose).getModelCapabilities(name));

// ---------------------------------------------------------------------------
// IPC — chat runtime selection (Ollama vs. LM Studio)
// ---------------------------------------------------------------------------
async function getBackendSettings() {
  const lm = await lmstudio.checkConnection();
  return {
    backend: getLlmBackend(),
    visionUseOllama: !!hostSettings.visionUseOllama,
    lmstudioAutoLoad: getLmstudioAutoLoad(),
    lmstudioThinking: getLmstudioThinking(),
    lmstudio: {
      reachable: lm.connected,
      port: lmstudio.getPort(),
      jitEnabled: lmstudio.getJitEnabled(),
      loaded: lm.connected ? lm.models.filter((m) => m.loaded).map((m) => m.label) : [],
      modelCount: lm.connected ? lm.models.length : 0,
    },
  };
}
ipcMain.handle('backend:get', () => getBackendSettings());
ipcMain.handle('backend:set', async (e, patch = {}) => {
  if (patch.backend === 'ollama' || patch.backend === 'lmstudio') hostSettings.llmBackend = patch.backend;
  if (typeof patch.visionUseOllama === 'boolean') hostSettings.visionUseOllama = patch.visionUseOllama;
  if (typeof patch.lmstudioAutoLoad === 'boolean') hostSettings.lmstudioAutoLoad = patch.lmstudioAutoLoad;
  if (typeof patch.lmstudioThinking === 'boolean') hostSettings.lmstudioThinking = patch.lmstudioThinking;
  saveHostSettings();
  // Same event as startup, so the renderer refreshes its model lists and
  // status dot for the newly selected runtime.
  win?.webContents.send('ollama-status', { ready: await runtimeReady(), backend: getLlmBackend() });
  return getBackendSettings();
});

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
// A loaded Ollama model keeps the context it was loaded with until it needs
// a bigger one (see fitOptions in ollama.js), so a new setting wouldn't take
// effect for it. If the chat model is loaded at a different size, unload it:
// the next message (or Load model) loads it at the new size.
// LM Studio fixes context at load time too, but its models are managed in
// LM Studio itself, so they're left alone.
ipcMain.handle('settings:set-context-size', async (e, size) => {
  hostSettings.contextSize = CONTEXT_SIZE_PRESETS.includes(size) ? size : null;
  saveHostSettings();
  const chosen = getContextSize();
  let unloaded = null;
  const model = ollama.getCurrentModel();
  if (getLlmBackend() === 'ollama' && model) {
    const resident = (await ollama.getRunningModels()).find((m) => m.name === model);
    if (resident && resident.context_length !== chosen) {
      await ollama.unloadModel(model);
      unloaded = model;
    }
  }
  return { size: chosen, unloaded };
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
ipcMain.handle('library:identify-image', async (e, { model, imageBase64, options, purpose }) => backendFor(purpose).identifyImage(model, imageBase64, options));
ipcMain.handle('library:browse', (e, payload) => library.browse(payload));
ipcMain.handle('library:browse-facets', () => library.browseFacets());
ipcMain.handle('library:get-doc', (e, id) => library.getDoc(id));
// Opens a doc's original file in the system viewer: an imported scan
// (data/library/pdfs), a linked Research doc's original (in place, in the
// Research folder), or one of the user's own uploads (data/library).
ipcMain.handle('library:open-pdf', (e, id) => {
  const doc = library.getDoc(id);
  if (!doc) return { ok: false, error: 'Document not found.' };
  let filePath = null;
  if (doc.source === 'research') {
    if (!doc.ext_original) return { ok: false, error: 'No original file on record for this page.' };
    filePath = researchSync.resolve(doc.ext_original);
    if (!filePath) return { ok: false, error: 'Research library not connected — check Tools/Settings → Library.' };
  } else if (doc.pdf_filename) {
    filePath = path.join(libraryPdfsDir, doc.pdf_filename);
  } else if (doc.external_id === null && doc.filename) {
    filePath = path.join(libraryStorageDir, doc.filename);
  }
  if (!filePath) return { ok: false, error: 'No original file on record for this doc.' };
  if (!fs.existsSync(filePath)) return { ok: false, error: 'The original file is missing on disk.' };
  return shell.openPath(filePath).then((openErr) => (openErr ? { ok: false, error: openErr } : { ok: true }));
});

// ---------------------------------------------------------------------------
// IPC — Research library link (see services/researchSync.js)
// ---------------------------------------------------------------------------
ipcMain.handle('research:status', () => researchSync.status());
ipcMain.handle('research:sync', (e, { embedModel, onlyPrefixes } = {}) => {
  // Fire and forget — progress arrives on 'research-sync-progress'.
  const started = !researchSync.running && !!getResearchRoot();
  researchSync.sync({ embedModel, onlyPrefixes });
  return { started };
});
ipcMain.handle('research:pause', () => { researchSync.pause(); return true; });
ipcMain.handle('research:dismiss-notice', () => { researchSync.dismissNotice(); return true; });
ipcMain.handle('research:read-doc', (e, id) => {
  const doc = library.getDoc(id);
  if (!doc || doc.source !== 'research') return { ok: false, error: 'Not a Research page.' };
  return researchSync.readDoc(doc);
});
// Opens a file a Research page links to (e.g. a PDF report) in the system
// viewer — confined to the Research folder.
ipcMain.handle('research:open-file', (e, relPath) => {
  const filePath = researchSync.resolve(relPath);
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'File not found in the Research library.' };
  return shell.openPath(filePath).then((openErr) => (openErr ? { ok: false, error: openErr } : { ok: true }));
});
ipcMain.handle('research:choose-root', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose your Research library folder (the one containing CATALOG.json)',
    properties: ['openDirectory'],
  });
  if (canceled || !filePaths[0]) return { ok: false, canceled: true };
  if (!fs.existsSync(path.join(filePaths[0], 'CATALOG.json'))) {
    return { ok: false, error: 'That folder has no CATALOG.json — pick the top-level Research folder.' };
  }
  hostSettings.researchRoot = filePaths[0];
  saveHostSettings();
  return { ok: true, root: getResearchRoot() };
});

// Reset Library. scope 'research' = drop the Research index only; 'all' =
// empty every library table and send the app's own copied files
// (data/library: uploads, imported scans and images) to the Recycle Bin.
// library.db is backed up first. Chats and the Research folder itself are
// never touched.
ipcMain.handle('library:reset', async (e, { scope } = {}) => {
  if (scope !== 'research' && scope !== 'all') return { ok: false, error: 'Unknown reset scope.' };
  if (researchSync.running) return { ok: false, error: 'Pause the Research sync first.' };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const backupPath = path.join(dataDir, `library.db.bak-${stamp}`);
  try {
    await getDb().backup(backupPath, { attached: 'lib' });
  } catch (err) {
    return { ok: false, error: `Backup failed, so nothing was changed: ${err.message}` };
  }

  let removed;
  const trashFailed = [];
  if (scope === 'research') {
    removed = researchSync.removeAll();
  } else {
    removed = getDb().prepare('SELECT COUNT(*) AS n FROM library_docs').get().n;
    library.clearAll();
    for (const name of fs.readdirSync(libraryStorageDir)) {
      try { await shell.trashItem(path.join(libraryStorageDir, name)); } catch { trashFailed.push(name); }
    }
    fs.mkdirSync(path.join(libraryStorageDir, 'pdfs'), { recursive: true });
    fs.mkdirSync(path.join(libraryStorageDir, 'images'), { recursive: true });
  }
  try {
    library.compactSearchIndex();
    getDb().exec('VACUUM lib');
    getDb().pragma('lib.wal_checkpoint(TRUNCATE)'); // in WAL mode the shrink only lands on disk at checkpoint
  } catch { /* space is reclaimed on a later reset */ }
  return { ok: true, removed, backupPath, trashFailed };
});

// ---------------------------------------------------------------------------
// IPC — ZIM search for chat (services/zimSearch.js)
//
// Which folders are searched is the "ZIM archive folders" setting (Tools →
// Library): the Research library's _sources\zim (automatic, can be switched
// off) plus any folders the user adds. Per machine (hostSettings.zimFolders),
// since drive letters are. The ticked archives and Quick/Thorough mode are
// remembered per chat only (chats.zim_settings) — new chats start with none.
// ---------------------------------------------------------------------------
function zimFolderSettings() {
  const s = hostSettings.zimFolders || {};
  return { extra: Array.isArray(s.extra) ? s.extra : [], disabled: Array.isArray(s.disabled) ? s.disabled : [] };
}

function countZims(dir) {
  return ZimSearch.scanFolders([dir]).length;
}

// [{ key, label, path, auto, enabled, exists, count }] for the Tools list.
function zimFolderList() {
  const { extra, disabled } = zimFolderSettings();
  const research = getResearchRoot();
  const auto = [
    { key: 'research', label: 'Research library', path: research ? path.join(research, '_sources', 'zim') : null },
  ];
  return [
    ...auto.map((f) => ({ ...f, auto: true, enabled: !disabled.includes(f.key) })),
    ...extra.map((p) => ({ key: p, label: null, path: p, auto: false, enabled: true })),
  ].map((f) => {
    const exists = !!f.path && fs.existsSync(f.path);
    return { ...f, exists, count: exists ? countZims(f.path) : 0 };
  });
}

function zimSearchFolders() {
  return zimFolderList().filter((f) => f.enabled && f.exists).map((f) => f.path);
}

function saveZimFolderSettings(settings) {
  hostSettings.zimFolders = settings;
  saveHostSettings();
}

ipcMain.handle('zim:get-folders', () => zimFolderList());

ipcMain.handle('zim:add-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose a folder with .zim archives to search from chat',
    properties: ['openDirectory'],
  });
  if (canceled || !filePaths[0]) return { ok: false, canceled: true, folders: zimFolderList() };
  const chosen = path.resolve(filePaths[0]);
  const same = (a, b) => a && b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  if (zimFolderList().some((f) => same(f.path, chosen))) {
    return { ok: false, error: 'That folder is already in the list.', folders: zimFolderList() };
  }
  if (!countZims(chosen)) return { ok: false, error: 'That folder has no .zim files in it (sub-folders aren\'t searched).', folders: zimFolderList() };
  const s = zimFolderSettings();
  saveZimFolderSettings({ ...s, extra: [...s.extra, chosen] });
  return { ok: true, folders: zimFolderList() };
});

ipcMain.handle('zim:remove-folder', (e, folderPath) => {
  const s = zimFolderSettings();
  saveZimFolderSettings({ ...s, extra: s.extra.filter((p) => p !== folderPath) });
  return zimFolderList();
});

// Switch one of the automatic folders on or off.
ipcMain.handle('zim:set-folder-enabled', (e, { key, enabled }) => {
  const s = zimFolderSettings();
  const disabled = s.disabled.filter((k) => k !== key);
  if (!enabled) disabled.push(key);
  saveZimFolderSettings({ ...s, disabled });
  return zimFolderList();
});


async function ensureZimSearch() {
  return zimSearch.ensureRunning(ZimSearch.scanFolders(zimSearchFolders()), findBundledKiwix());
}

ipcMain.handle('zim:list-searchable', async () => {
  const ok = await ensureZimSearch();
  const books = ok ? await zimSearch.listBooks() : [];
  return {
    // date and folder tell apart two versions of the same archive (e.g. Wikipedia 2026-04 and 2026-08).
    books: books
      .map(({ id, title, ftindex, articles, file }) => ({ id, title, ftindex, articles, date: /_(\d{4}-\d{2})[a-z]?$/.exec(id)?.[1] || null, folder: file ? path.dirname(file) : null }))
      .sort((a, b) => a.title.localeCompare(b.title) || (b.date || '').localeCompare(a.date || '')),
  };
});

// "Load model" button (and the step before a ZIM search): loads the chat
// model ahead of the first question. `zim` also starts the search server
// alongside, so both waits overlap instead of adding up.
ipcMain.handle('chat:load-model', async (e, { model, options, zim }) => {
  const [loaded] = await Promise.allSettled([chatBackend().loadModel(model, options), zim ? ensureZimSearch() : null]);
  if (loaded.status === 'rejected') return { success: false, error: loaded.reason?.message || String(loaded.reason) };
  return { success: true };
});

// titles let a reopened chat name its archives without starting the search server.
ipcMain.handle('zim:save-settings', (e, { chatId, books, mode, titles }) => {
  const settings = { books: Array.isArray(books) ? books : [], mode: mode === 'thorough' ? 'thorough' : 'quick', titles: titles || {} };
  if (chatId) getDb().prepare('UPDATE chats SET zim_settings = ? WHERE id = ?').run(JSON.stringify(settings), chatId);
  return { success: true };
});

// Thorough needs a model that can call tools; anything else quietly gets
// Quick, and `fellBack` lets the chat say so.
ipcMain.handle('zim:context', async (event, { model, question, previous, books, mode, options }) => {
  if (!(await ensureZimSearch())) return { text: '', sources: [], steps: ['ZIM search unavailable'] };
  const backend = chatBackend();
  const args = { backend, model, question, previous, bookIds: books, options };
  if (mode === 'thorough') {
    const caps = await backend.getModelCapabilities(model);
    if (caps.tools) return zimSearch.thorough({ ...args, onStep: (s) => event.sender.send('zim-step', s) });
    return { ...(await zimSearch.quick(args)), fellBack: true };
  }
  return zimSearch.quick(args);
});

// A ZIM source clicked in chat: JustAI has no Wikipedia viewer, so the
// article opens in a small window of its own, served by the same search
// kiwix-serve (it has every archive loaded). Only 127.0.0.1 pages may load
// there — links out of the archive are ignored rather than going online.
let zimArticleWindow = null;
ipcMain.handle('zim:open-article', async (e, { url, title }) => {
  if (!/^\/content\//.test(url || '') || !(await ensureZimSearch())) return { success: false };
  const viewerUrl = `http://127.0.0.1:${ZIM_SEARCH_PORT}/viewer#${url.replace(/^\/content\//, '')}`;
  if (!zimArticleWindow || zimArticleWindow.isDestroyed()) {
    zimArticleWindow = new BrowserWindow({
      width: 1000, height: 800, parent: win, title: title || 'Article', autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const local = (u) => u.startsWith(`http://127.0.0.1:${ZIM_SEARCH_PORT}/`);
    zimArticleWindow.webContents.on('will-navigate', (ev, u) => { if (!local(u)) ev.preventDefault(); });
    zimArticleWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }
  await zimArticleWindow.loadURL(viewerUrl);
  zimArticleWindow.show();
  zimArticleWindow.focus();
  return { success: true };
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
