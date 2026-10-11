import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.CHAKOR_DB_PATH || './data/chakor.db';

const dir = dirname(DB_PATH);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// Keep in sync with the schema in lib/db.ts (including later migration columns).
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    is_admin      INTEGER NOT NULL DEFAULT 0,
    display_name  TEXT
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT 'new session',
    model       TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    share_slug  TEXT,
    folder_id   INTEGER,
    pinned      INTEGER NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0,
    tags        TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_share ON conversations(share_slug) WHERE share_slug IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_conv_folder ON conversations(folder_id);

  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
    content         TEXT NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    images          TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at);

  CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    mime_type   TEXT,
    size_bytes  INTEGER,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);

  CREATE TABLE IF NOT EXISTS chunks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_idx   INTEGER NOT NULL,
    content     TEXT NOT NULL,
    embedding   BLOB
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id);

  CREATE TABLE IF NOT EXISTS api_keys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    token       TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_used   INTEGER,
    token_tail  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_apikey_user ON api_keys(user_id);

  CREATE TABLE IF NOT EXISTS prompts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_prompts_user ON prompts(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS folders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id, position);

  CREATE TABLE IF NOT EXISTS compare_votes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    winner      TEXT NOT NULL,
    models      TEXT,
    prompt      TEXT,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_compare_user ON compare_votes(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    color       TEXT,
    pinned      INTEGER NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0,
    items       TEXT,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, pinned DESC, updated_at DESC);

  CREATE TABLE IF NOT EXISTS memories (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    source      TEXT,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, pinned DESC, updated_at DESC);
`);

const info = db.prepare('SELECT COUNT(*) AS c FROM users').get();
console.log(`[chakor] DB initialized at: ${DB_PATH}`);
console.log(`[chakor] Users in DB: ${info.c}`);
db.close();
