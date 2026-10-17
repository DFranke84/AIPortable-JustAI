const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../db');
const { extractText } = require('./textExtract');
const { chunkText } = require('./chunking');

// Content-identity hash for duplicate detection on upload — trimmed rather
// than raw so trailing-whitespace differences between two copies of the
// same file don't produce different hashes.
function hashBody(body) {
  return crypto.createHash('sha256').update(body.trim(), 'utf8').digest('hex');
}

const ACCEPTED_EXT = new Set(['.txt', '.md', '.text', '.pdf', '.docx', '.doc']);

// Keeps user-typed categories in one consistent form (lowercase,
// hyphen-separated — e.g. "home-repair") so a new category doesn't fragment
// the category list with a near-duplicate of an existing one over trivial
// case/spacing differences.
function normalizeCategory(raw) {
  return (raw || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// How many candidate documents the doc-level stage-1 filter hands off to
// chunk-level stage-2 re-ranking. Generous on purpose — stage 2 is what
// actually decides what's relevant; stage 1 only needs to not throw away
// anything plausible.
const SHORTLIST_SIZE = 40;

// Words too common to help a keyword match.
const STOPWORDS = new Set(('a an and are as at be but by can do does for from how i if in into is it its me my near no not of on or our should so than that the their them then there these they this to us was we what when where which who why will with you your about any some get have has had just').split(' '));

// Turns a natural-language question into an FTS5 query: the meaningful
// words OR-ed together (each quoted, so FTS5 operators in the text are
// inert), with results ranked by BM25 in the SQL. A plain sanitized string
// would be an implicit AND of every word — "how should I store drinking
// water" then only matches text containing all seven words, i.e. almost
// nothing. Returns null when nothing searchable is left.
function ftsQuery(text) {
  const words = [...new Set((text || '').toLowerCase().match(/[a-z0-9]+/g) || [])]
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return words.length ? words.map((w) => `"${w}"`).join(' OR ') : null;
}

// Chunks embedded per Ollama request when filling in missing vectors.
const EMBED_BATCH = 16;

class Library {
  constructor(ollama, storageDir) {
    this.ollama = ollama;
    this.storageDir = storageDir; // where uploaded file bodies are stored on disk
    fs.mkdirSync(this.storageDir, { recursive: true });

    // In-memory cache of every row in library_doc_embeddings, as one big
    // Float32Array plus a parallel doc_id array — built lazily on first use.
    // This exists because docLevelSearch runs on every chat send when RAG is
    // on (see renderer.js's send handler), and better-sqlite3 is fully
    // synchronous on Electron's main thread: re-fetching ~50MB of BLOB rows
    // from disk on every message would risk a visible whole-app stall.
    // library_doc_embeddings is only ever written by bulk imports, never by
    // uploadDoc/deleteUpload (which don't touch that table), so there's no
    // runtime invalidation to wire up — it's simply built once per session.
    this._docVectorCache = null;
  }

  // ---- upload -------------------------------------------------------
  async uploadDoc({ name, base64, category }) {
    const db = getDb();
    const ext = path.extname(name).toLowerCase();
    if (!ACCEPTED_EXT.has(ext)) {
      return { ok: false, error: `Unsupported file type ${ext || '(none)'} — accepted: ${[...ACCEPTED_EXT].sort().join(', ')}` };
    }
    const normCategory = normalizeCategory(category);
    if (!normCategory) {
      return { ok: false, error: 'A category is required — pick an existing one or add a new one.' };
    }
    const buf = Buffer.from(base64, 'base64');

    // Extract text and check for a pre-existing duplicate *before* writing
    // anything to disk or the DB — a scanned/empty-text file skips the
    // check entirely (see hashBody's doc comment: an empty-string hash
    // isn't a meaningful signature).
    const { text: body, warning } = await extractText(buf, ext);
    const hash = body && body.trim() ? hashBody(body) : null;
    if (hash) {
      const existing = db.prepare('SELECT id, title, category, source_url, external_id FROM library_docs WHERE content_hash = ? LIMIT 1').get(hash);
      if (existing) {
        return { ok: false, duplicate: true, existing };
      }
    }

    const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const storedName = `${id}${ext}`;
    fs.writeFileSync(path.join(this.storageDir, storedName), buf);
    const title = name.replace(new RegExp(`\\${ext}$`), '');

    db.prepare('INSERT INTO library_docs (id, title, filename, ext, size, created_at, category, content_hash) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, title, storedName, ext, buf.length, new Date().toISOString(), normCategory, hash);
    db.prepare('INSERT INTO library_docs_fts (doc_id, title, body) VALUES (?,?,?)').run(id, title, body || '');

    const chunkCount = this.insertChunks(id, body || '');

    return { ok: true, entry: { id, title, filename: storedName, ext, size: buf.length, chunkCount }, warning };
  }

  // Splits `body` and writes one row per chunk into library_chunks +
  // library_chunks_fts. Idempotent — clears any existing chunks for the
  // doc first, so it doubles as a re-chunk operation (used by the startup
  // backfill for any doc that has no chunks yet).
  insertChunks(docId, body) {
    const db = getDb();
    const existingIds = db.prepare('SELECT id FROM library_chunks WHERE doc_id = ?').all(docId).map((r) => r.id);
    if (existingIds.length) {
      const delEmb = db.prepare('DELETE FROM library_chunk_embeddings WHERE chunk_id = ?');
      for (const cid of existingIds) delEmb.run(cid);
      db.prepare('DELETE FROM library_chunks_fts WHERE doc_id = ?').run(docId);
      db.prepare('DELETE FROM library_chunks WHERE doc_id = ?').run(docId);
    }

    const chunks = chunkText(body);
    const insertChunk = db.prepare('INSERT INTO library_chunks (id, doc_id, chunk_index, text) VALUES (?,?,?,?)');
    // The FTS row shares the chunk's rowid (as researchSync.js relies on).
    const insertFts = db.prepare('INSERT INTO library_chunks_fts (rowid, chunk_id, doc_id, text) VALUES (?,?,?,?)');
    chunks.forEach((text, i) => {
      const chunkId = `${docId}_c${i}`;
      const info = insertChunk.run(chunkId, docId, i, text);
      insertFts.run(info.lastInsertRowid, chunkId, docId, text);
    });
    return chunks.length;
  }

  // Startup safety net: chunks any uploaded doc that has no chunks yet,
  // straight from the already-extracted text in library_docs_fts, so it
  // doesn't need to re-parse the original PDF/DOCX bytes. Safe to call on
  // every startup — it only touches docs that have zero chunks so far.
  //
  // Deliberately excludes bulk-imported docs (external_id IS NOT NULL):
  // those stay unchunked until a real search shortlists them (see
  // docLevelSearch/search below), so a large import isn't chunked eagerly.
  // Uploads from before chunking existed get chunked once. Finds them by id
  // first (the idx_library_docs_uploads partial index makes that instant) and
  // only then reads their text — joining the full-text table up front read
  // the whole multi-GB library every launch: ~30 s on a cold disk.
  backfillChunks() {
    const db = getDb();
    const ids = db
      .prepare(`
        SELECT d.id FROM library_docs d
        WHERE d.external_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM library_chunks c WHERE c.doc_id = d.id)
      `)
      .all()
      .map((r) => r.id);
    if (!ids.length) return 0;
    const bodyOf = db.prepare('SELECT body FROM library_docs_fts WHERE doc_id = ?');
    const docs = ids.map((id) => ({ id, body: bodyOf.get(id)?.body }));
    let migrated = 0;
    for (const doc of docs) {
      if (!doc.body) continue;
      this.insertChunks(doc.id, doc.body);
      migrated++;
    }
    return migrated;
  }

  listUploads() {
    // chunkCount is a small nicety so the Library tab can show that
    // chunking actually happened, not just that a file exists. Restricted
    // to external_id IS NULL — bulk-imported docs live in the same table
    // but belong in the "Reference Library" browser, not mixed into this
    // list of things you personally uploaded.
    return getDb()
      .prepare(`
        SELECT d.*, (SELECT COUNT(*) FROM library_chunks c WHERE c.doc_id = d.id) AS chunkCount
        FROM library_docs d
        WHERE d.external_id IS NULL
        ORDER BY d.created_at DESC
      `)
      .all();
  }

  deleteUpload(id) {
    const db = getDb();
    const doc = db.prepare('SELECT * FROM library_docs WHERE id = ?').get(id);
    if (!doc) return false;
    // Guard against deleting bulk-imported docs through the upload UI's
    // delete button — they aren't managed this way, and their rows don't
    // have an uploaded file under this.storageDir to clean up anyway.
    if (doc.external_id !== null) return false;
    try { fs.unlinkSync(path.join(this.storageDir, doc.filename)); } catch { /* already gone */ }

    const chunkIds = db.prepare('SELECT id FROM library_chunks WHERE doc_id = ?').all(id).map((r) => r.id);
    const delEmb = db.prepare('DELETE FROM library_chunk_embeddings WHERE chunk_id = ?');
    for (const cid of chunkIds) delEmb.run(cid);
    db.prepare('DELETE FROM library_chunks_fts WHERE doc_id = ?').run(id);
    db.prepare('DELETE FROM library_chunks WHERE doc_id = ?').run(id);
    db.prepare('DELETE FROM library_docs_fts WHERE doc_id = ?').run(id);
    db.prepare('DELETE FROM library_docs WHERE id = ?').run(id);
    return true;
  }

  readUpload(id) {
    const db = getDb();
    const doc = db.prepare('SELECT * FROM library_docs WHERE id = ?').get(id);
    if (!doc) return null;
    const ftsRow = db.prepare('SELECT body FROM library_docs_fts WHERE doc_id = ?').get(id);
    return { ...doc, body: ftsRow?.body || '' };
  }

  // ---- keyword search (chunk-level FTS5) ------------------------------
  // `docIds`, if given, restricts results to that set of documents (used by
  // the two-stage search below to scope stage-2 to the stage-1 shortlist).
  keywordSearch(query, limit = 8, docIds = null) {
    const db = getDb();
    try {
      if (docIds && docIds.length === 0) return [];
      const match = ftsQuery(query);
      if (!match) return [];
      const scope = docIds ? `AND c.doc_id IN (${docIds.map(() => '?').join(',')})` : '';
      return db
        .prepare(`
          SELECT c.id AS chunk_id, c.doc_id, c.chunk_index,
                 snippet(library_chunks_fts, 2, '', '', '…', 24) AS preview
          FROM library_chunks_fts f
          JOIN library_chunks c ON c.id = f.chunk_id
          WHERE library_chunks_fts MATCH ? ${scope}
          ORDER BY rank
          LIMIT ?
        `)
        .all(match, ...(docIds || []), limit);
    } catch {
      return [];
    }
  }

  // ---- semantic search (chunk-level embeddings) ------------------------
  // Lazily embeds any chunk that doesn't have a stored vector yet, then
  // ranks by cosine similarity. Brute-force scan over all chunks — fine at
  // personal-library scale (thousands of chunks); swap for a real vector
  // index past that. In the two-stage design this table only ever holds
  // chunks for docs that have actually been shortlisted by docLevelSearch
  // at some point (or genuine user uploads), so it stays naturally bounded
  // rather than growing to cover every bulk-imported doc.
  // Batched (EMBED_BATCH chunks per Ollama request) — a newly shortlisted
  // long document can bring in dozens of chunks at once, and one round trip
  // per chunk made the first search touching it take many seconds.
  // `docIds`, if given, limits the check to those documents — with a fully
  // prepared Research library there are hundreds of thousands of chunks,
  // too many to re-check on every chat.
  async ensureChunksEmbedded(embedModel, docIds = null) {
    const db = getDb();
    if (docIds && docIds.length === 0) return;
    const scope = docIds ? `AND c.doc_id IN (${docIds.map(() => '?').join(',')})` : '';
    const missing = db.prepare(`
      SELECT c.id, c.text FROM library_chunks c
      WHERE NOT EXISTS (SELECT 1 FROM library_chunk_embeddings e WHERE e.chunk_id = c.id) ${scope}
    `).all(...(docIds || []));
    const insert = db.prepare('INSERT OR REPLACE INTO library_chunk_embeddings (chunk_id, vector, dims) VALUES (?,?,?)');
    for (let i = 0; i < missing.length; i += EMBED_BATCH) {
      const batch = missing.slice(i, i + EMBED_BATCH);
      const vecs = await this.ollama.embedMany(embedModel, batch.map((c) => c.text));
      if (!vecs) continue;
      db.transaction(() => {
        batch.forEach((c, j) => {
          if (vecs[j]) insert.run(c.id, Buffer.from(new Float32Array(vecs[j]).buffer), vecs[j].length);
        });
      })();
    }
  }

  async semanticSearch(query, embedModel, limit = 8, docIds = null) {
    if (docIds && docIds.length === 0) return [];
    const db = getDb();
    const queryVec = await this.ollama.embed(embedModel, query);
    if (!queryVec) return [];
    await this.ensureChunksEmbedded(embedModel, docIds);

    const scope = docIds ? `WHERE c.doc_id IN (${docIds.map(() => '?').join(',')})` : '';
    const rows = db
      .prepare(`
        SELECT e.chunk_id, e.vector, e.dims, c.doc_id, c.chunk_index
        FROM library_chunk_embeddings e
        JOIN library_chunks c ON c.id = e.chunk_id
        ${scope}
      `)
      .all(...(docIds || []));
    const scored = rows.map((r) => {
      const vec = new Float32Array(r.vector.buffer, r.vector.byteOffset, r.dims);
      let dot = 0;
      for (let i = 0; i < queryVec.length; i++) dot += queryVec[i] * vec[i];
      return { chunk_id: r.chunk_id, doc_id: r.doc_id, chunk_index: r.chunk_index, score: dot };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  // Combined chunk-level search: keyword + semantic, reciprocal-rank fusion.
  // `docIds`, if given, scopes both signals to that set of documents.
  async chunkSearch(query, embedModel, limit = 8, docIds = null) {
    const kw = this.keywordSearch(query, Math.max(limit, 20), docIds);
    let sem = [];
    try { sem = await this.semanticSearch(query, embedModel, Math.max(limit, 20), docIds); } catch { /* embed model may be missing */ }

    const scores = new Map();
    kw.forEach((r, i) => scores.set(r.chunk_id, (scores.get(r.chunk_id) || 0) + 1 / (60 + i + 1)));
    sem.forEach((r, i) => scores.set(r.chunk_id, (scores.get(r.chunk_id) || 0) + 1 / (60 + i + 1)));

    const rankedIds = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
    const db = getDb();
    return rankedIds
      .map((chunkId) => {
        const row = db
          .prepare(`
            SELECT c.id AS chunk_id, c.doc_id, c.chunk_index, c.text, d.title, d.source
            FROM library_chunks c
            JOIN library_docs d ON d.id = c.doc_id
            WHERE c.id = ?
          `)
          .get(chunkId);
        if (!row) return null;
        const kwHit = kw.find((r) => r.chunk_id === chunkId);
        return {
          chunkId: row.chunk_id,
          docId: row.doc_id,
          chunkIndex: row.chunk_index,
          title: row.title,
          source: row.source,
          text: row.text,
          preview: kwHit?.preview || row.text.slice(0, 160),
        };
      })
      .filter(Boolean);
  }

  // ---- stage 1: cheap doc-level filter over the whole library ----------
  // Combines doc-level keyword search (library_docs_fts) with a brute-force
  // dot product against the cached whole-doc embedding matrix, RRF-fused
  // into a shortlist of candidate doc_ids. Never touches library_chunks —
  // this is meant to be cheap enough to run on every search regardless of
  // how large the library grows.
  async docLevelSearch(query, embedModel, limit = SHORTLIST_SIZE) {
    const db = getDb();

    let kw = [];
    try {
      const match = ftsQuery(query);
      if (match) {
        kw = db
          .prepare(`
            SELECT doc_id FROM library_docs_fts WHERE library_docs_fts MATCH ? ORDER BY rank LIMIT ?
          `)
          .all(match, Math.max(limit, 40));
      }
    } catch { /* malformed FTS query — fall back to semantic only */ }

    let sem = [];
    try {
      const queryVec = await this.ollama.embed(embedModel, query);
      if (queryVec) {
        const cache = this._loadDocVectorCache();
        const qv = Float32Array.from(queryVec);
        const scored = new Array(cache.docIds.length);
        for (let i = 0; i < cache.docIds.length; i++) {
          const offset = i * cache.dims;
          let dot = 0;
          for (let j = 0; j < cache.dims; j++) dot += qv[j] * cache.vectors[offset + j];
          scored[i] = { doc_id: cache.docIds[i], score: dot };
        }
        scored.sort((a, b) => b.score - a.score);
        sem = scored.slice(0, Math.max(limit, 40));
      }
    } catch { /* embed model may be missing */ }

    const scores = new Map();
    kw.forEach((r, i) => scores.set(r.doc_id, (scores.get(r.doc_id) || 0) + 1 / (60 + i + 1)));
    sem.forEach((r, i) => scores.set(r.doc_id, (scores.get(r.doc_id) || 0) + 1 / (60 + i + 1)));

    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([docId]) => docId);
  }

  // Builds (or returns the cached) in-memory matrix of every whole-document
  // embedding, as one Float32Array of shape [N * dims] plus a parallel
  // docIds array — see the constructor comment for why this is cached
  // rather than re-queried on every call.
  _loadDocVectorCache() {
    if (this._docVectorCache) return this._docVectorCache;
    const db = getDb();
    const rows = db.prepare('SELECT doc_id, vector, dims FROM library_doc_embeddings').all();
    const dims = rows[0]?.dims || 0;
    const vectors = new Float32Array(rows.length * dims);
    const docIds = new Array(rows.length);
    rows.forEach((r, i) => {
      docIds[i] = r.doc_id;
      vectors.set(new Float32Array(r.vector.buffer, r.vector.byteOffset, r.dims), i * dims);
    });
    this._docVectorCache = { vectors, docIds, dims };
    return this._docVectorCache;
  }

  // ---- top-level search: stage 1 (doc filter) -> stage 2 (chunk re-rank) --
  // This is what buildContext() and the manual Library search UI call. User
  // uploads (external_id IS NULL) are always included in stage 2 regardless
  // of the stage-1 shortlist — there are only ever a handful of them, and
  // this is a strict superset of the app's pre-two-stage behavior (which
  // searched everything unconditionally), so it can't regress anything.
  async search(query, embedModel, limit = 8) {
    const db = getDb();
    const uploadIds = db.prepare('SELECT id FROM library_docs WHERE external_id IS NULL').all().map((r) => r.id);
    const shortlist = await this.docLevelSearch(query, embedModel);
    const docIds = [...new Set([...uploadIds, ...shortlist])];

    if (docIds.length === 0) return [];

    // Chunk (and queue for embedding) any shortlisted doc that hasn't been
    // touched before — cheap after the first time a given doc is ever
    // relevant to something, since insertChunks()/ensureChunksEmbedded() are
    // both idempotent/incremental.
    const unchunked = db
      .prepare(`
        SELECT d.id FROM library_docs d
        WHERE d.id IN (${docIds.map(() => '?').join(',')})
          AND NOT EXISTS (SELECT 1 FROM library_chunks c WHERE c.doc_id = d.id)
      `)
      .all(...docIds);
    // Linked Research docs keep their FTS row at the doc's own rowid (see
    // researchSync.js), which is an indexed lookup; the doc_id scan is the
    // fallback for everything else.
    const byRowid = db.prepare('SELECT f.body FROM library_docs d JOIN library_docs_fts f ON f.rowid = d.rowid AND f.doc_id = d.id WHERE d.id = ?');
    const byDocId = db.prepare('SELECT body FROM library_docs_fts WHERE doc_id = ?');
    for (const { id } of unchunked) {
      const ftsRow = byRowid.get(id) || byDocId.get(id);
      if (ftsRow?.body) this.insertChunks(id, ftsRow.body);
    }
    if (unchunked.length) {
      try { await this.ensureChunksEmbedded(embedModel, unchunked.map((r) => r.id)); } catch { /* embed model may be missing */ }
    }

    return this.chunkSearch(query, embedModel, limit, docIds);
  }

  // ---- Library Browser: paginated/filterable listing of every doc -------
  // Keyset-paginated on SQLite's implicit rowid (stable insertion order),
  // not on `id`/`external_id`, since those aren't sortable in a meaningful
  // way across both user uploads (doc_<timestamp>_<rand>) and imported docs
  // (lib_<source id>). `cursor`, when given, is the last rowid seen.
  browse({ category = null, source = null, search = null, cursor = null, limit = 50 } = {}) {
    const db = getDb();
    const clauses = [];
    const params = [];
    if (category) { clauses.push('d.category = ?'); params.push(category); }
    // '__local__' = the user's own uploads, which carry no source value.
    if (source === '__local__') clauses.push('d.source IS NULL');
    else if (source) { clauses.push('d.source = ?'); params.push(source); }
    if (search) { clauses.push('d.title LIKE ?'); params.push(`%${search}%`); }
    if (cursor) { clauses.push('d.rowid > ?'); params.push(cursor); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = db
      .prepare(`
        SELECT d.rowid AS rowid, d.id, d.title, d.category, d.source, d.source_url, d.license, d.word_count,
               d.pdf_filename, d.ext_path, d.ext_original, d.external_id, d.ext,
               (SELECT COUNT(*) FROM library_doc_images i WHERE i.doc_id = d.id) AS imageCount
        FROM library_docs d
        ${where}
        ORDER BY d.rowid
        LIMIT ?
      `)
      .all(...params, limit);

    return {
      items: rows.map(({ rowid, ...rest }) => rest),
      nextCursor: rows.length === limit ? rows[rows.length - 1].rowid : null,
    };
  }

  // Category/source values for filter UIs. Categories carry a doc count
  // (shown in both the Reference Library filter and the upload category
  // picker) since "pick a category" is a lot more useful with "home-repair
  // (12)" than a bare, uncapitalized "home-repair".
  browseFacets() {
    const db = getDb();
    return {
      categories: db.prepare('SELECT category, COUNT(*) AS count FROM library_docs WHERE category IS NOT NULL GROUP BY category ORDER BY category').all(),
      sources: db.prepare('SELECT DISTINCT source FROM library_docs WHERE source IS NOT NULL ORDER BY source').all().map((r) => r.source),
    };
  }

  // Full detail for one doc: metadata + body + any extracted images, each
  // with a ready-to-use libimg:// URL (see registerLibraryImagesProtocol in
  // main.js).
  getDoc(id) {
    const db = getDb();
    const doc = db.prepare('SELECT * FROM library_docs WHERE id = ?').get(id);
    if (!doc) return null;
    const ftsRow = db.prepare('SELECT body FROM library_docs_fts WHERE doc_id = ?').get(id);
    const images = db
      .prepare('SELECT filename FROM library_doc_images WHERE doc_id = ? ORDER BY filename')
      .all(id)
      .map((r) => ({ filename: r.filename, url: `libimg://${encodeURIComponent(doc.asset_dir || id)}/${r.filename}` }));
    return { ...doc, body: ftsRow?.body || '', images };
  }

  // ---- bulk removal / reset ---------------------------------------------
  // Deletes every library row belonging to the docs matched by `docWhere`
  // (a WHERE clause over library_docs aliased as d) — chunks, both FTS
  // tables, embeddings, image rows and the docs themselves — in one
  // transaction. Set-based rather than per-doc, since the FTS doc_id columns
  // are UNINDEXED (a per-doc delete is a full scan each time).
  deleteDocsWhere(docWhere, params = []) {
    const db = getDb();
    const ids = `SELECT d.id FROM library_docs d WHERE ${docWhere}`;
    const run = db.transaction(() => {
      db.prepare(`DELETE FROM library_chunk_embeddings WHERE chunk_id IN (SELECT c.id FROM library_chunks c WHERE c.doc_id IN (${ids}))`).run(...params);
      db.prepare(`DELETE FROM library_chunks_fts WHERE doc_id IN (${ids})`).run(...params);
      db.prepare(`DELETE FROM library_chunks WHERE doc_id IN (${ids})`).run(...params);
      db.prepare(`DELETE FROM library_docs_fts WHERE doc_id IN (${ids})`).run(...params);
      db.prepare(`DELETE FROM library_doc_embeddings WHERE doc_id IN (${ids})`).run(...params);
      db.prepare(`DELETE FROM library_doc_images WHERE doc_id IN (${ids})`).run(...params);
      return db.prepare(`DELETE FROM library_docs WHERE id IN (${ids})`).run(...params).changes;
    });
    const removed = run();
    this.invalidateDocVectors();
    return removed;
  }

  // Wipes every library table (uploads, linked Research docs, imports).
  // Files under storageDir are the caller's job (main.js sends them to the
  // Recycle Bin), since that needs Electron's shell.
  clearAll() {
    const db = getDb();
    db.transaction(() => {
      for (const t of ['library_chunk_embeddings', 'library_chunks_fts', 'library_chunks', 'library_docs_fts', 'library_doc_embeddings', 'library_doc_images', 'library_docs', 'library_meta']) {
        db.prepare(`DELETE FROM ${t}`).run();
      }
    })();
    this.invalidateDocVectors();
  }

  // The whole-doc vector cache is built once per session (see constructor);
  // anything that adds/removes doc embeddings must drop it.
  invalidateDocVectors() {
    this._docVectorCache = null;
  }

  // FTS5 keeps deleted rows' index segments until it's told to rebuild, so
  // after a big removal (a reset) VACUUM alone wouldn't shrink library.db.
  // Rebuilding from the (now smaller) content tables drops them.
  compactSearchIndex() {
    const db = getDb();
    db.prepare("INSERT INTO library_docs_fts(library_docs_fts) VALUES('rebuild')").run();
    db.prepare("INSERT INTO library_chunks_fts(library_chunks_fts) VALUES('rebuild')").run();
  }

  getMeta(key) {
    return getDb().prepare('SELECT value FROM library_meta WHERE key = ?').get(key)?.value ?? null;
  }

  setMeta(key, value) {
    getDb().prepare('INSERT OR REPLACE INTO library_meta (key, value) VALUES (?, ?)').run(key, value == null ? null : String(value));
  }

  // ---- RAG: build chat context from the top matches -------------------
  // Returns { text, sources }. Multiple matching chunks from the same doc
  // are merged into one block (ordered by position in the doc) instead of
  // repeating the title once per chunk. Callers should treat an empty
  // `text` as "nothing relevant, don't inject anything" rather than an
  // error.
  async buildContext(query, embedModel, { limit = 5, maxCharsPerDoc = 1200 } = {}) {
    const results = await this.search(query, embedModel, limit);
    if (results.length === 0) return { text: '', sources: [] };

    const byDoc = new Map();
    for (const r of results) {
      if (!byDoc.has(r.docId)) byDoc.set(r.docId, { title: r.title, source: r.source, chunks: [] });
      byDoc.get(r.docId).chunks.push(r);
    }

    const parts = [];
    const sources = [];
    for (const [docId, group] of byDoc) {
      group.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      const body = group.chunks.map((c) => c.text).join('\n…\n').slice(0, maxCharsPerDoc);
      parts.push(`### ${group.title}\n${body}`);
      sources.push({ id: docId, title: group.title, kind: group.source === 'research' ? 'research' : 'local' });
    }
    return { text: parts.join('\n\n---\n\n'), sources };
  }
}

module.exports = { Library };
