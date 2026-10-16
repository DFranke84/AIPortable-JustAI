const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { getDb } = require('../db');

// ---------------------------------------------------------------------------
// Research library link — indexes the separate E:\Research library *in
// place*. Research already has clean text for every item (its .md files,
// including OCR'd text for scanned PDFs) and a full index in CATALOG.json,
// so this only reads those: nothing is ever written to the Research folder
// and no PDF/image is copied into data/library/. What lands in library.db is
// the search index (text + vectors) plus a root-relative pointer to each file.
//
// Docs are stored like a bulk import (external_id set), so they get the
// existing two-stage search for free: a whole-doc vector per doc computed
// here, and chunks built lazily the first time a search shortlists the doc.
// ---------------------------------------------------------------------------

const SOURCE = 'research';
const EXTERNAL_PREFIX = 'research:';
// Folders under the Research root that are never indexed: recipes (personal
// collection + Cooking School), the raw ZIM/PDF downloads, and build output.
const EXCLUDED_CATEGORIES = new Set(['recipes']);
const EXCLUDED_PREFIXES = ['recipes/', '_'];
const TEXT_BATCH = 400; // docs per DB transaction during the text phase
const EMBED_BATCH = 16; // docs per Ollama /api/embed request
const EMBED_CHARS = 4000; // title + start of body — enough for a whole-doc vector

function docIdFor(relFile) {
  return 'res_' + crypto.createHash('sha1').update(relFile).digest('hex').slice(0, 20);
}

function hashBody(body) {
  return crypto.createHash('sha256').update(body.trim(), 'utf8').digest('hex');
}

function stripFrontMatter(md) {
  const m = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return m ? md.slice(m[0].length) : md;
}

// Text used for search: the page minus its YAML header and image markup
// (an image's file path is noise for both keyword and vector search), with
// links reduced to their visible text.
function searchableText(md) {
  return stripFrontMatter(md)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isIncluded(row, onlyPrefixes) {
  const file = (row.file || '').replace(/\\/g, '/');
  if (!file.toLowerCase().endsWith('.md')) return false;
  if (EXCLUDED_CATEGORIES.has(row.category)) return false;
  if (EXCLUDED_PREFIXES.some((p) => file.startsWith(p))) return false;
  if (onlyPrefixes && !onlyPrefixes.some((p) => file.startsWith(p))) return false;
  return true;
}

const tick = () => new Promise((r) => setImmediate(r));

class ResearchSync extends EventEmitter {
  // getRoot(): the Research folder to use right now, or null if not found.
  constructor({ library, ollama, getRoot }) {
    super();
    this.library = library;
    this.ollama = ollama;
    this.getRoot = getRoot;
    this.running = false;
    this.pauseRequested = false;
    this.progress = null;
  }

  catalogPath(root = this.getRoot()) {
    return root ? path.join(root, 'CATALOG.json') : null;
  }

  // Resolves a root-relative path to an absolute one inside the Research
  // root, or null if it would escape it (or there's no root).
  resolve(relPath) {
    const root = this.getRoot();
    if (!root || !relPath) return null;
    const rootAbs = path.resolve(root);
    const abs = path.resolve(rootAbs, relPath);
    return abs === rootAbs || abs.startsWith(rootAbs + path.sep) ? abs : null;
  }

  status() {
    const db = getDb();
    const root = this.getRoot();
    const counts = db.prepare(`
      SELECT COUNT(*) AS docs,
             (SELECT COUNT(*) FROM library_doc_embeddings e JOIN library_docs d2 ON d2.id = e.doc_id WHERE d2.source = ?) AS embedded
      FROM library_docs WHERE source = ?
    `).get(SOURCE, SOURCE);
    let catalogMtime = null;
    try { catalogMtime = Math.floor(fs.statSync(this.catalogPath(root)).mtimeMs); } catch { /* no catalog */ }
    const syncedMtime = Number(this.library.getMeta('research_catalog_mtime')) || null;
    const dismissedMtime = Number(this.library.getMeta('research_notice_dismissed_mtime')) || null;
    return {
      root,
      connected: !!(root && catalogMtime),
      docs: counts.docs,
      embedded: counts.embedded,
      lastSync: this.library.getMeta('research_last_sync'),
      // Something new in Research since the last full sync (and the user
      // hasn't already said "not now" to this particular catalog version).
      catalogChanged: !!(catalogMtime && catalogMtime !== syncedMtime),
      noticeDismissed: !!(catalogMtime && catalogMtime === dismissedMtime),
      catalogMtime,
      running: this.running,
      progress: this.progress,
    };
  }

  dismissNotice() {
    const { catalogMtime } = this.status();
    if (catalogMtime) this.library.setMeta('research_notice_dismissed_mtime', catalogMtime);
  }

  pause() {
    if (this.running) this.pauseRequested = true;
  }

  _emit(progress) {
    this.progress = progress;
    this.emit('progress', { ...progress, running: this.running });
  }

  // Full (or, with onlyPrefixes, partial) sync. Phase 1 brings the text
  // index in line with CATALOG.json (add / update / remove); phase 2 embeds
  // any linked doc that has no whole-doc vector yet. Both phases are
  // incremental, so a paused or interrupted run just picks up where it left
  // off next time.
  async sync({ embedModel, onlyPrefixes = null } = {}) {
    if (this.running) return { ok: false, error: 'A sync is already running.' };
    const root = this.getRoot();
    if (!root) return { ok: false, error: 'Research library folder not found.' };
    let catalog;
    let catalogMtime;
    try {
      const cp = this.catalogPath(root);
      catalogMtime = Math.floor(fs.statSync(cp).mtimeMs);
      catalog = JSON.parse(fs.readFileSync(cp, 'utf8'));
    } catch (err) {
      return { ok: false, error: `Couldn't read CATALOG.json: ${err.message}` };
    }

    this.running = true;
    this.pauseRequested = false;
    try {
      const text = await this._syncText(catalog, onlyPrefixes);
      const embed = await this._embedMissing(embedModel);
      // Only a complete, unfiltered, unpaused run counts as "in step with
      // this catalog" — a sample or paused run leaves the startup notice on.
      if (!onlyPrefixes && !embed.paused) {
        this.library.setMeta('research_catalog_mtime', catalogMtime);
      }
      this.library.setMeta('research_last_sync', new Date().toISOString());
      const result = { ok: true, ...text, ...embed };
      this._emit({ phase: embed.paused ? 'paused' : 'done', message: embed.paused ? 'Paused — Sync again to continue.' : 'Up to date.', result });
      return result;
    } catch (err) {
      this._emit({ phase: 'error', message: err.message });
      return { ok: false, error: err.message };
    } finally {
      this.running = false;
      this.pauseRequested = false;
      this.emit('progress', { ...this.progress, running: false });
    }
  }

  async _syncText(catalog, onlyPrefixes) {
    const db = getDb();
    const rows = catalog.filter((r) => isIncluded(r, onlyPrefixes));
    const existing = new Map(
      db.prepare('SELECT rowid, id, ext_path, ext_mtime, size, content_hash FROM library_docs WHERE source = ?').all(SOURCE).map((r) => [r.id, r])
    );

    const insDoc = db.prepare(`
      INSERT INTO library_docs (id, title, filename, ext, size, created_at, category, source, source_url, license, word_count,
                                external_id, content_hash, ext_path, ext_original, ext_mtime)
      VALUES (?, ?, '', '.md', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updDoc = db.prepare(`
      UPDATE library_docs SET title = ?, size = ?, category = ?, source_url = ?, license = ?, word_count = ?,
                              content_hash = ?, ext_path = ?, ext_original = ?, ext_mtime = ?
      WHERE id = ?
    `);
    const touchDoc = db.prepare('UPDATE library_docs SET ext_mtime = ?, size = ? WHERE id = ?');
    // The doc-level FTS row shares the doc's rowid, so it can be replaced
    // by rowid instead of scanning the UNINDEXED doc_id column.
    const insFts = db.prepare('INSERT INTO library_docs_fts (rowid, doc_id, title, body) VALUES (?, ?, ?, ?)');
    const delFts = db.prepare('DELETE FROM library_docs_fts WHERE rowid = ?');
    const delDocEmb = db.prepare('DELETE FROM library_doc_embeddings WHERE doc_id = ?');
    const chunkIds = db.prepare('SELECT id FROM library_chunks WHERE doc_id = ?');
    const delChunkEmb = db.prepare('DELETE FROM library_chunk_embeddings WHERE chunk_id = ?');
    const delChunkFts = db.prepare('DELETE FROM library_chunks_fts WHERE chunk_id = ?');
    const delChunks = db.prepare('DELETE FROM library_chunks WHERE doc_id = ?');

    const seen = new Set();
    let added = 0, updated = 0, unchanged = 0, missing = 0;
    const now = new Date().toISOString();

    for (let i = 0; i < rows.length; i += TEXT_BATCH) {
      const batch = rows.slice(i, i + TEXT_BATCH);
      // File reads happen outside the transaction; the DB writes for the
      // whole batch then go in as one transaction.
      const work = [];
      for (const row of batch) {
        const rel = row.file.replace(/\\/g, '/');
        const id = docIdFor(rel);
        const abs = this.resolve(rel);
        let stat;
        try { stat = abs && fs.statSync(abs); } catch { stat = null; }
        if (!stat) { missing++; continue; }
        seen.add(id);
        const mtime = Math.floor(stat.mtimeMs);
        const prev = existing.get(id);
        if (prev && prev.ext_mtime === mtime && prev.size === stat.size) { unchanged++; continue; }
        const body = searchableText(fs.readFileSync(abs, 'utf8'));
        const hash = body ? hashBody(body) : null;
        work.push({ row, rel, id, mtime, size: stat.size, body, hash, prev });
      }

      db.transaction(() => {
        for (const w of work) {
          const { row, rel, id, mtime, size, body, hash, prev } = w;
          const original = (row.original_file || '').replace(/\\/g, '/') || null;
          const words = Number(row.words) || null;
          if (!prev) {
            const info = insDoc.run(id, row.title || path.basename(rel, '.md'), size, now, row.category || null, SOURCE,
              row.source_url || null, row.license || null, words, EXTERNAL_PREFIX + rel, hash, rel, original, mtime);
            insFts.run(info.lastInsertRowid, id, row.title || '', body);
            added++;
          } else if (prev.content_hash === hash) {
            touchDoc.run(mtime, size, id); // touched on disk, same text
            unchanged++;
          } else {
            updDoc.run(row.title || path.basename(rel, '.md'), size, row.category || null, row.source_url || null,
              row.license || null, words, hash, rel, original, mtime, id);
            delFts.run(prev.rowid);
            insFts.run(prev.rowid, id, row.title || '', body);
            // Old vectors/chunks describe the old text — drop them; the
            // embed phase and lazy chunking rebuild them.
            delDocEmb.run(id);
            for (const { id: cid } of chunkIds.all(id)) { delChunkEmb.run(cid); delChunkFts.run(cid); }
            delChunks.run(id);
            updated++;
          }
        }
      })();

      this._emit({ phase: 'text', done: Math.min(i + TEXT_BATCH, rows.length), total: rows.length, message: `Reading Research pages… ${Math.min(i + TEXT_BATCH, rows.length).toLocaleString()} / ${rows.length.toLocaleString()}` });
      await tick(); // keep the window responsive between batches
    }

    // Anything linked before but gone now (removed from the catalog, file
    // deleted, or a folder now excluded). A partial sync only prunes inside
    // the folders it covered.
    const stale = [...existing.values()].filter((r) => {
      if (seen.has(r.id)) return false;
      if (onlyPrefixes) return onlyPrefixes.some((p) => (r.ext_path || '').startsWith(p));
      return true;
    }).map((r) => r.id);
    let removed = 0;
    for (let i = 0; i < stale.length; i += 500) {
      const ids = stale.slice(i, i + 500);
      removed += this.library.deleteDocsWhere(`d.id IN (${ids.map(() => '?').join(',')})`, ids);
    }
    if (added || updated) this.library.invalidateDocVectors();
    return { total: rows.length, added, updated, unchanged, removed, missing };
  }

  async _embedMissing(embedModel) {
    const db = getDb();
    const todo = db.prepare(`
      SELECT d.id, d.title, f.body
      FROM library_docs d
      JOIN library_docs_fts f ON f.rowid = d.rowid
      WHERE d.source = ? AND NOT EXISTS (SELECT 1 FROM library_doc_embeddings e WHERE e.doc_id = d.id)
    `).all(SOURCE);
    const insEmb = db.prepare('INSERT OR REPLACE INTO library_doc_embeddings (doc_id, vector, dims) VALUES (?, ?, ?)');
    let embedded = 0, failed = 0, paused = false;

    for (let i = 0; i < todo.length; i += EMBED_BATCH) {
      if (this.pauseRequested) { paused = true; break; }
      const batch = todo.slice(i, i + EMBED_BATCH);
      const texts = batch.map((d) => `${d.title}\n\n${d.body || ''}`.slice(0, EMBED_CHARS));
      const vecs = await this.ollama.embedMany(embedModel, texts);
      if (!vecs) {
        failed += batch.length;
        // Ollama down / model missing: no point hammering it for the rest.
        if (embedded === 0 && failed >= EMBED_BATCH * 3) break;
        continue;
      }
      db.transaction(() => {
        batch.forEach((d, j) => {
          const v = vecs[j];
          if (v) { insEmb.run(d.id, Buffer.from(new Float32Array(v).buffer), v.length); embedded++; }
        });
      })();
      this._emit({ phase: 'embed', done: Math.min(i + EMBED_BATCH, todo.length), total: todo.length, message: `Building search vectors… ${Math.min(i + EMBED_BATCH, todo.length).toLocaleString()} / ${todo.length.toLocaleString()}` });
    }
    if (embedded) this.library.invalidateDocVectors();
    return { embedded, embedFailed: failed, embedRemaining: todo.length - embedded, paused };
  }

  // Drops every linked Research doc from the index. Never touches the
  // Research folder itself or the user's own uploads.
  removeAll() {
    const removed = this.library.deleteDocsWhere('d.source = ?', [SOURCE]);
    for (const k of ['research_catalog_mtime', 'research_last_sync', 'research_notice_dismissed_mtime']) this.library.setMeta(k, null);
    return removed;
  }

  // Reads a linked doc's page live from the Research folder (so the viewer
  // always shows the current file, images and all) — read-only.
  readDoc(doc) {
    const abs = this.resolve(doc.ext_path);
    if (!abs) return { ok: false, error: 'Research library not connected.' };
    try {
      return { ok: true, body: stripFrontMatter(fs.readFileSync(abs, 'utf8')), dir: path.posix.dirname(doc.ext_path) };
    } catch {
      return { ok: false, error: 'This page is missing from the Research folder.' };
    }
  }
}

module.exports = { ResearchSync, SOURCE: SOURCE };
