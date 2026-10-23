// Check for updates (Tools/Settings → System).
//
// When the AI Research Suite is installed next to this app
// (..\AI-Research-Suite\update.ps1), it does the work: it knows every piece of
// the suite, checks GitHub (or a folder of zips) and replaces only program
// files. On its own (a copy without the suite, or Linux) we just ask GitHub
// for this app's latest release and point at the download page.
//
// The weekly check is off unless the user turned it on (installer or this
// panel); it lives in AI-Research-Suite\settings.json so every app shares it.
// Only api.github.com is ever contacted.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function cmpVersion(a, b) {
  const pa = String(a || '0').replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'AI-Research-Suite-Updater', Accept: 'application/vnd.github+json' }, timeout: 20000 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(res.statusCode === 404 ? 'no release published yet' : `GitHub said ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('no answer from GitHub (offline?)')));
    req.on('error', reject);
  });
}

function firstLine(text) {
  const line = String(text || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
  return line.replace(/^[-*]\s*/, '').slice(0, 110);
}

class Updates {
  // name: this app's folder/repo name (e.g. 'AIPortable-JustAI'); launcher: file to start it again after an update
  constructor({ root, name, repo, title, launcher }) {
    this.root = root;
    this.name = name;
    this.repo = repo;
    this.title = title;
    this.launcher = launcher;
    this.suiteDir = path.join(root, '..', 'AI-Research-Suite');
  }

  updaterPath() {
    const p = path.join(this.suiteDir, 'update.ps1');
    return process.platform === 'win32' && fs.existsSync(p) ? p : null;
  }

  installedVersion() {
    const m = readJson(path.join(this.root, 'release-manifest.json'));
    if (m && m.version) return m.version;
    try { return fs.readFileSync(path.join(this.root, 'VERSION'), 'utf8').trim(); } catch { return ''; }
  }

  settings() {
    return { weeklyCheck: false, lastCheck: null, ...(readJson(path.join(this.suiteDir, 'settings.json')) || {}) };
  }

  saveSettings(changes) {
    if (!fs.existsSync(this.suiteDir)) return;
    fs.writeFileSync(path.join(this.suiteDir, 'settings.json'), JSON.stringify({ ...this.settings(), ...changes }, null, 2));
  }

  state() {
    const s = this.settings();
    return {
      name: this.name,
      version: this.installedVersion(),
      git: fs.existsSync(path.join(this.root, '.git')),
      suite: !!this.updaterPath(),
      weeklyCheck: !!s.weeklyCheck,
      lastCheck: s.lastCheck,
    };
  }

  setWeekly(on) { this.saveSettings({ weeklyCheck: !!on }); }

  // { components: [{ name, title, installed, latest, update, status, notes, page }], updates, source }
  async check() {
    const up = this.updaterPath();
    const result = up ? await this.checkWithSuite(up) : await this.checkGitHub();
    if (up) this.saveSettings({ lastCheck: new Date().toISOString() });
    return { ...result, state: this.state() };
  }

  checkWithSuite(up) {
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', up, '-Check', '-Json'], { windowsHide: true });
      let out = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('the update check took too long')); }, 90000);
      child.stdout.on('data', (d) => { out += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', () => {
        clearTimeout(timer);
        const start = out.indexOf('{');
        const data = start >= 0 ? (() => { try { return JSON.parse(out.slice(start)); } catch { return null; } })() : null;
        if (!data) return reject(new Error('the suite updater gave no answer'));
        if (data.error) return reject(new Error(data.error));
        resolve(data);
      });
    });
  }

  async checkGitHub() {
    const installed = this.installedVersion();
    const row = { name: this.name, title: this.title, installed, latest: '', update: false, status: '', notes: '', page: `https://github.com/${this.repo}/releases` };
    try {
      const rel = await getJson(`https://api.github.com/repos/${this.repo}/releases/latest`);
      row.latest = String(rel.tag_name || '').replace(/^v/i, '');
      row.notes = firstLine(rel.body);
      row.page = rel.html_url || row.page;
      row.update = cmpVersion(row.latest, installed) > 0;
      row.status = row.update ? 'update available' : 'up to date';
    } catch (e) {
      row.status = `could not check (${e.message})`;
    }
    return { source: 'github.com', updates: row.update ? 1 : 0, components: [row] };
  }

  // Starts the suite updater in its own window; it waits for this app to
  // close, updates, then starts the app again. The caller quits the app.
  startUpdate() {
    const up = this.updaterPath();
    if (!up) throw new Error('The AI Research Suite updater is not installed next to this app.');
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', up, '-Yes', '-WaitPid', String(process.pid)];
    if (this.launcher && fs.existsSync(this.launcher)) args.push('-Restart', this.launcher);
    spawn('powershell.exe', args, { detached: true, stdio: 'ignore', cwd: this.suiteDir }).unref();
  }

  // Weekly check, only if turned on. Resolves to the check result when there is something new.
  async weeklyCheckDue() {
    const s = this.settings();
    if (!s.weeklyCheck || !this.updaterPath()) return null;
    if (s.lastCheck && Date.now() - new Date(s.lastCheck).getTime() < WEEK_MS) return null;
    try {
      const r = await this.check();
      return r.updates > 0 ? r : null;
    } catch { return null; }
  }
}

module.exports = { Updates, cmpVersion };
