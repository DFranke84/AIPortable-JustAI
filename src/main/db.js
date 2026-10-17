const Database = require('better-sqlite3');

let db = null;

// Two physical files under one connection: `chats.db` (main schema) holds
// just chats/messages — small, and safe to delete/reset without losing
// anything else. `library.db` (attached as schema "lib") holds every
// library_* table — kept separate so resetting chat history (deleting
// chats.db) never touches the library, and vice versa.
// ATTACH keeps this to one connection, so unqualified queries in library.js
// (e.g. `SELECT * FROM library_docs`) just work — SQLite resolves
// unqualified table names across attached schemas automatically.
function initDb(dbPath, libraryDbPath) {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.prepare('ATTACH DATABASE ? AS lib').run(libraryDbPath);
  db.pragma('lib.journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );
  `);

  db.exec(`
    -- Uploaded documents for local library search (RAG).
    CREATE TABLE IF NOT EXISTS lib.library_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Full extracted text per doc. Not queried directly for search anymore
    -- (that's chunk-level now, below) — this is the archival copy used to
    -- (re)build chunks, including the one-time backfill for docs uploaded
    -- before chunking existed.
    CREATE VIRTUAL TABLE IF NOT EXISTS lib.library_docs_fts USING fts5(
      doc_id UNINDEXED, title, body
    );

    -- Chunk-level search and RAG context. One doc -> many chunks, each
    -- independently keyword-indexed and (lazily) embedded, so a match deep
    -- inside a long document surfaces on its own instead of losing out to
    -- whatever happened to be in the document's first few thousand
    -- characters.
    CREATE TABLE IF NOT EXISTS lib.library_chunks (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      FOREIGN KEY (doc_id) REFERENCES library_docs(id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS lib.library_chunks_fts USING fts5(
      chunk_id UNINDEXED, doc_id UNINDEXED, text
    );

    CREATE TABLE IF NOT EXISTS lib.library_chunk_embeddings (
      chunk_id TEXT PRIMARY KEY,
      vector BLOB NOT NULL,
      dims INTEGER NOT NULL
    );

    -- Whole-document embeddings for bulk-imported docs (external_id set).
    -- Used as a cheap stage-1 filter over a large collection before any
    -- chunking happens, since chunking/embedding all of it up front would
    -- produce far too many chunks to brute-force scan on every search.
    CREATE TABLE IF NOT EXISTS lib.library_doc_embeddings (
      doc_id TEXT PRIMARY KEY,
      vector BLOB NOT NULL,
      dims INTEGER NOT NULL
    );

    -- Images belonging to a doc, stored as real files under
    -- data/library/images/<asset_dir>/ and shown in the Library Browser.
    CREATE TABLE IF NOT EXISTS lib.library_doc_images (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      ext TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS lib.idx_library_chunks_doc_id ON library_chunks(doc_id);
    CREATE INDEX IF NOT EXISTS lib.idx_library_doc_images_doc_id ON library_doc_images(doc_id);
  `);

  // SQLite has no `ADD COLUMN IF NOT EXISTS` — these columns are applied as
  // a guarded post-step rather than inside the CREATE TABLE above, so an
  // existing library.db picks them up too.
  ensureColumn(db, 'lib.library_docs', 'library_docs', 'category', 'TEXT');
  ensureColumn(db, 'lib.library_docs', 'library_docs', 'source', 'TEXT');
  ensureColumn(db, 'lib.library_docs', 'library_docs', 'source_url', 'TEXT');
  ensureColumn(db, 'lib.library_docs', 'library_docs', 'license', 'TEXT');
  ensureColumn(db, 'lib.library_docs', 'library_docs', 'word_count', 'INTEGER');
  // Set for docs added by a bulk import (a stable id from the source
  // collection, doubling as that import's idempotency key), NULL for docs
  // uploaded through the app. backfillChunks() uses it to only ever eagerly
  // chunk real uploads — bulk-imported docs are chunked lazily on search.
  ensureColumn(db, 'lib.library_docs', 'library_docs', 'external_id', 'TEXT');
  // Set when a doc has an original PDF scan stored under data/library/pdfs/
  // — the filename to open, relative to that folder, or NULL if there's no
  // scan on file. A descriptive filename rather than an internal id, so it's
  // recognizable from outside the app (Explorer, a file picker, etc).
  ensureColumn(db, 'lib.library_docs', 'library_docs', 'pdf_filename', 'TEXT');
  // Human-readable folder name (derived from the doc's title) under
  // data/library/images/ holding this doc's images, or NULL if it has none. Deliberately not
  // the internal doc id, for the same "recognizable outside the app" reason
  // as pdf_filename above.
  ensureColumn(db, 'lib.library_docs', 'library_docs', 'asset_dir', 'TEXT');
  // SHA-256 of the doc's trimmed extracted text — lets uploadDoc() reject a
  // new upload that's already present anywhere in the library instead of
  // silently creating a duplicate. NULL for docs with no/empty extracted text (e.g. a scanned
  // PDF), since an empty-string hash isn't a meaningful content signature —
  // those are never flagged as duplicates of each other.
  ensureColumn(db, 'lib.library_docs', 'library_docs', 'content_hash', 'TEXT');

  // Linked docs (source='research'): indexed from a folder outside the app
  // (the E:\Research library) and read in place — nothing is copied into
  // data/library/. ext_path is the .md file and ext_original the original
  // PDF (if any), both relative to the Research root so the link survives a
  // drive-letter change; ext_mtime is that .md's mtime at last sync, the
  // cheap first check for "has this file changed?" (see researchSync.js).
  ensureColumn(db, 'lib.library_docs', 'library_docs', 'ext_path', 'TEXT');
  // Which .zim archives a chat searches and how (Quick/Thorough), as JSON —
  // see zim:save-settings in main.js. NULL = never set; uses the last-used choice.
  ensureColumn(db, 'chats', 'chats', 'zim_settings', 'TEXT');
  ensureColumn(db, 'lib.library_docs', 'library_docs', 'ext_original', 'TEXT');
  ensureColumn(db, 'lib.library_docs', 'library_docs', 'ext_mtime', 'INTEGER');

  db.exec(`CREATE INDEX IF NOT EXISTS lib.idx_library_docs_content_hash ON library_docs(content_hash);`);
  db.exec(`CREATE INDEX IF NOT EXISTS lib.idx_library_docs_source ON library_docs(source);`);
  // Your own uploads (not the bulk-imported/Research docs) — keeps the
  // start-up migration check (Library.backfillChunks) from scanning every doc.
  db.exec(`CREATE INDEX IF NOT EXISTS lib.idx_library_docs_uploads ON library_docs(id) WHERE external_id IS NULL;`);
  // (source, id) lets the Research status count (shown as the window opens) be
  // answered from the index alone: 1.4 s -> 8 ms on 19,795 pages.
  db.exec(`CREATE INDEX IF NOT EXISTS lib.idx_library_docs_source_id ON library_docs(source, id);`);

  // Small key/value store that lives inside library.db (so it travels with
  // the index if library.db is copied to another app) — e.g. the
  // CATALOG.json mtime as of the last Research sync.
  db.exec(`CREATE TABLE IF NOT EXISTS lib.library_meta (key TEXT PRIMARY KEY, value TEXT);`);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS lib.idx_library_docs_external_id
      ON library_docs(external_id) WHERE external_id IS NOT NULL;
  `);

  return db;
}

// `qualifiedTable` (e.g. "lib.library_docs") is used for the ALTER TABLE;
// `pragmaTable` (the bare name) is used for PRAGMA table_info, which takes
// the schema as a prefix on the pragma itself (`PRAGMA lib.table_info(x)`),
// not as part of the table argument.
function ensureColumn(db, qualifiedTable, pragmaTable, col, decl) {
  const schema = qualifiedTable.includes('.') ? qualifiedTable.split('.')[0] : 'main';
  const cols = db.prepare(`PRAGMA ${schema}.table_info(${pragmaTable})`).all().map((r) => r.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${qualifiedTable} ADD COLUMN ${col} ${decl}`);
}

function getDb() {
  if (!db) throw new Error('Database not initialized — call initDb() first');
  return db;
}

module.exports = { initDb, getDb };
