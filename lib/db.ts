import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = process.env.CHAKOR_DB_PATH || './data/chakor.db';

// Ensure data directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');

  // Bootstrap schema (idempotent)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      email         TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      is_admin      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL DEFAULT 'new session',
      model       TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
      content         TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

    -- v2: RAG tables (created now, unused until v2)
    CREATE TABLE IF NOT EXISTS documents (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename    TEXT NOT NULL,
      mime_type   TEXT,
      size_bytes  INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_idx   INTEGER NOT NULL,
      content     TEXT NOT NULL,
      embedding   BLOB  -- float32 array, populated in v2
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id);

    -- API keys for the OpenAI-compatible endpoint
    CREATE TABLE IF NOT EXISTS api_keys (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      token       TEXT NOT NULL UNIQUE,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      last_used   INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_apikey_user ON api_keys(user_id);

    -- Saved prompts (the prompt library)
    CREATE TABLE IF NOT EXISTS prompts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_prompts_user ON prompts(user_id, created_at DESC);

    -- Folders to group conversations in the sidebar.
    CREATE TABLE IF NOT EXISTS folders (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id, position);

    -- Compare: persisted votes that build the model A/B leaderboard.
    CREATE TABLE IF NOT EXISTS compare_votes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      winner      TEXT NOT NULL,
      models      TEXT,
      prompt      TEXT,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_compare_user ON compare_votes(user_id, created_at DESC);

    -- Notes: Keep-style notes and checklists.
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

    -- Memory: persistent facts the assistant recalls across conversations.
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

  // Idempotent migrations — ALTER TABLE silently fails if column exists
  const migrations = [
    `ALTER TABLE conversations ADD COLUMN share_slug TEXT`,
    `ALTER TABLE users ADD COLUMN display_name TEXT`,
    // Images attached to a message, stored as a JSON array of data URLs.
    `ALTER TABLE messages ADD COLUMN images TEXT`,
    // Sidebar organization: folders, pinning, archiving, tags (JSON array).
    `ALTER TABLE conversations ADD COLUMN folder_id INTEGER`,
    `ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE conversations ADD COLUMN tags TEXT`,
  ];
  for (const sql of migrations) {
    try { _db.exec(sql); } catch { /* column already exists */ }
  }
  try {
    _db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_share ON conversations(share_slug) WHERE share_slug IS NOT NULL`);
  } catch { /* index already exists */ }

  return _db;
}

// ─── Users ─────────────────────────────────────────────────────────
export interface User {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  created_at: number;
  is_admin: number;
}

export function getUserByUsername(username: string): User | undefined {
  return db().prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
}

export function getUserById(id: number): User | undefined {
  return db().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function createUser(username: string, passwordHash: string, email?: string): number {
  const isFirstUser = (db().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c === 0;
  const result = db()
    .prepare('INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?)')
    .run(username, email ?? null, passwordHash, isFirstUser ? 1 : 0);
  return Number(result.lastInsertRowid);
}

// ─── Conversations ─────────────────────────────────────────────────
export interface Conversation {
  id: string;
  user_id: number;
  title: string;
  model: string;
  created_at: number;
  updated_at: number;
  folder_id: number | null;
  pinned: number;
  archived: number;
  tags?: string[];
}

function parseTags(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length ? (arr as string[]) : undefined;
  } catch {
    return undefined;
  }
}

export function listConversations(userId: number): Conversation[] {
  const rows = db()
    .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT 200')
    .all(userId) as Array<Conversation & { tags?: unknown }>;
  return rows.map((r) => ({ ...r, tags: parseTags(r.tags) }));
}

export function getConversation(id: string, userId: number): Conversation | undefined {
  return db()
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(id, userId) as Conversation | undefined;
}

export function createConversation(id: string, userId: number, model: string, title = 'new session'): void {
  db()
    .prepare('INSERT INTO conversations (id, user_id, model, title) VALUES (?, ?, ?, ?)')
    .run(id, userId, model, title);
}

export function updateConversationTitle(id: string, userId: number, title: string): void {
  db()
    .prepare('UPDATE conversations SET title = ?, updated_at = strftime(\'%s\', \'now\') WHERE id = ? AND user_id = ?')
    .run(title, id, userId);
}

export function touchConversation(id: string): void {
  db().prepare('UPDATE conversations SET updated_at = strftime(\'%s\', \'now\') WHERE id = ?').run(id);
}

export function deleteConversation(id: string, userId: number): void {
  db().prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(id, userId);
}

export function setConversationFolder(id: string, userId: number, folderId: number | null): void {
  db().prepare('UPDATE conversations SET folder_id = ? WHERE id = ? AND user_id = ?').run(folderId, id, userId);
}

export function setConversationPinned(id: string, userId: number, pinned: boolean): void {
  db().prepare('UPDATE conversations SET pinned = ? WHERE id = ? AND user_id = ?').run(pinned ? 1 : 0, id, userId);
}

export function setConversationArchived(id: string, userId: number, archived: boolean): void {
  db().prepare('UPDATE conversations SET archived = ? WHERE id = ? AND user_id = ?').run(archived ? 1 : 0, id, userId);
}

export function setConversationTags(id: string, userId: number, tags: string[]): void {
  db().prepare('UPDATE conversations SET tags = ? WHERE id = ? AND user_id = ?').run(tags.length ? JSON.stringify(tags) : null, id, userId);
}

// ─── Folders ───────────────────────────────────────────────────────
export interface Folder {
  id: number;
  user_id: number;
  name: string;
  position: number;
  created_at: number;
}

export function listFolders(userId: number): Folder[] {
  return db().prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY position ASC, id ASC').all(userId) as Folder[];
}

export function createFolder(userId: number, name: string): Folder {
  const pos = (db().prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM folders WHERE user_id = ?').get(userId) as { p: number }).p;
  const result = db().prepare('INSERT INTO folders (user_id, name, position) VALUES (?, ?, ?)').run(userId, name, pos);
  return db().prepare('SELECT * FROM folders WHERE id = ?').get(Number(result.lastInsertRowid)) as Folder;
}

export function renameFolder(id: number, userId: number, name: string): void {
  db().prepare('UPDATE folders SET name = ? WHERE id = ? AND user_id = ?').run(name, id, userId);
}

export function deleteFolder(id: number, userId: number): void {
  const d = db();
  const tx = d.transaction(() => {
    d.prepare('UPDATE conversations SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').run(id, userId);
    d.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').run(id, userId);
  });
  tx();
}

// ─── Messages ──────────────────────────────────────────────────────
export interface Message {
  id: number;
  conversation_id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
  created_at: number;
}

function parseImages(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length ? (arr as string[]) : undefined;
  } catch {
    return undefined;
  }
}

export function listMessages(conversationId: string): Message[] {
  const rows = db()
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC')
    .all(conversationId) as Array<Message & { images?: unknown }>;
  return rows.map((r) => ({ ...r, images: parseImages(r.images) }));
}

export function addMessage(
  conversationId: string,
  role: Message['role'],
  content: string,
  images?: string[],
): number {
  const result = db()
    .prepare('INSERT INTO messages (conversation_id, role, content, images) VALUES (?, ?, ?, ?)')
    .run(conversationId, role, content, images && images.length ? JSON.stringify(images) : null);
  touchConversation(conversationId);
  return Number(result.lastInsertRowid);
}

export function deleteMessagesFrom(conversationId: string, fromMessageId: number): void {
  db()
    .prepare('DELETE FROM messages WHERE conversation_id = ? AND id >= ?')
    .run(conversationId, fromMessageId);
  touchConversation(conversationId);
}

// ─── Documents ─────────────────────────────────────────────────────
export interface Document {
  id: number;
  user_id: number;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: number;
}

export function listDocuments(userId: number): Document[] {
  return db()
    .prepare('SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Document[];
}

export function addDocument(userId: number, filename: string, mimeType: string, sizeBytes: number): number {
  const result = db()
    .prepare('INSERT INTO documents (user_id, filename, mime_type, size_bytes) VALUES (?, ?, ?, ?)')
    .run(userId, filename, mimeType, sizeBytes);
  return Number(result.lastInsertRowid);
}

export function getDocument(id: number, userId: number): Document | undefined {
  return db()
    .prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?')
    .get(id, userId) as Document | undefined;
}

export function deleteDocument(id: number, userId: number): void {
  db().prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(id, userId);
}

export function countUserDocuments(userId: number): number {
  return (db().prepare('SELECT COUNT(*) AS c FROM documents WHERE user_id = ?').get(userId) as { c: number }).c;
}

// ─── Chunks ────────────────────────────────────────────────────────
export interface Chunk {
  id: number;
  document_id: number;
  chunk_idx: number;
  content: string;
}

export function addChunks(documentId: number, chunks: string[]): void {
  const stmt = db().prepare('INSERT INTO chunks (document_id, chunk_idx, content) VALUES (?, ?, ?)');
  const insert = db().transaction((items: string[]) => {
    items.forEach((content, idx) => stmt.run(documentId, idx, content));
  });
  insert(chunks);
}

export function getChunksForUser(userId: number): Array<Chunk & { filename: string }> {
  return db().prepare(`
    SELECT c.id, c.document_id, c.chunk_idx, c.content, d.filename
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE d.user_id = ?
  `).all(userId) as Array<Chunk & { filename: string }>;
}

// ─── Sharing ───────────────────────────────────────────────────────
export function setShareSlug(convId: string, slug: string): void {
  db().prepare('UPDATE conversations SET share_slug = ? WHERE id = ?').run(slug, convId);
}

export function getConversationBySlug(slug: string): (Conversation & { share_slug: string }) | undefined {
  return db()
    .prepare('SELECT * FROM conversations WHERE share_slug = ?')
    .get(slug) as (Conversation & { share_slug: string }) | undefined;
}

// ─── User profile ──────────────────────────────────────────────────
export function updateDisplayName(userId: number, displayName: string): void {
  db().prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, userId);
}

export function updatePassword(userId: number, passwordHash: string): void {
  db().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

// ─── API keys (for the OpenAI-compatible endpoint) ─────────────────
export interface ApiKey {
  id: number;
  user_id: number;
  name: string;
  token: string;
  created_at: number;
  last_used: number | null;
}

export function createApiKey(userId: number, name: string, token: string): ApiKey {
  const result = db()
    .prepare('INSERT INTO api_keys (user_id, name, token) VALUES (?, ?, ?)')
    .run(userId, name, token);
  return db().prepare('SELECT * FROM api_keys WHERE id = ?').get(Number(result.lastInsertRowid)) as ApiKey;
}

export function listApiKeys(userId: number): ApiKey[] {
  return db()
    .prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as ApiKey[];
}

export function deleteApiKey(id: number, userId: number): void {
  db().prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(id, userId);
}

/** Look up a key by its raw token. Used to authenticate API requests. */
export function getApiKeyByToken(token: string): ApiKey | undefined {
  return db().prepare('SELECT * FROM api_keys WHERE token = ?').get(token) as ApiKey | undefined;
}

export function touchApiKey(id: number): void {
  db().prepare('UPDATE api_keys SET last_used = strftime(\'%s\', \'now\') WHERE id = ?').run(id);
}

// ─── Prompt library ────────────────────────────────────────────────
export interface Prompt {
  id: number;
  user_id: number;
  title: string;
  body: string;
  created_at: number;
}

export function listPrompts(userId: number): Prompt[] {
  return db()
    .prepare('SELECT * FROM prompts WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Prompt[];
}

export function createPrompt(userId: number, title: string, body: string): Prompt {
  const result = db()
    .prepare('INSERT INTO prompts (user_id, title, body) VALUES (?, ?, ?)')
    .run(userId, title, body);
  return db().prepare('SELECT * FROM prompts WHERE id = ?').get(Number(result.lastInsertRowid)) as Prompt;
}

export function deletePrompt(id: number, userId: number): void {
  db().prepare('DELETE FROM prompts WHERE id = ? AND user_id = ?').run(id, userId);
}

// ─── Daily stats (last 7 days) ─────────────────────────────────────
export function dailyMessageStats(): Array<{ day: string; count: number }> {
  return db().prepare(`
    SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS count
    FROM messages
    WHERE created_at >= strftime('%s', 'now', '-7 days')
    GROUP BY day
    ORDER BY day ASC
  `).all() as Array<{ day: string; count: number }>;
}

// ─── Compare (model A/B leaderboard) ───────────────────────────────
export function addCompareVote(userId: number, winner: string, models: string[], prompt: string): void {
  db()
    .prepare('INSERT INTO compare_votes (user_id, winner, models, prompt) VALUES (?, ?, ?, ?)')
    .run(userId, winner, JSON.stringify(models), prompt.slice(0, 2000));
}

export function compareLeaderboard(userId: number): Array<{ model: string; wins: number }> {
  return db()
    .prepare('SELECT winner AS model, COUNT(*) AS wins FROM compare_votes WHERE user_id = ? GROUP BY winner ORDER BY wins DESC')
    .all(userId) as Array<{ model: string; wins: number }>;
}

// ─── Notes ─────────────────────────────────────────────────────────
export interface NoteItem { text: string; done: boolean }
export interface Note {
  id: string;
  user_id: number;
  title: string;
  body: string;
  color: string | null;
  pinned: number;
  archived: number;
  items?: NoteItem[];
  created_at: number;
  updated_at: number;
}

function parseItems(raw: unknown): NoteItem[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? (a as NoteItem[]) : undefined;
  } catch {
    return undefined;
  }
}

export function listNotes(userId: number): Note[] {
  const rows = db()
    .prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC')
    .all(userId) as Array<Note & { items?: unknown }>;
  return rows.map((r) => ({ ...r, items: parseItems(r.items) }));
}

export function getNote(id: string, userId: number): Note | undefined {
  const r = db()
    .prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?')
    .get(id, userId) as (Note & { items?: unknown }) | undefined;
  return r ? { ...r, items: parseItems(r.items) } : undefined;
}

export function createNote(
  id: string,
  userId: number,
  fields: { title?: string; body?: string; color?: string | null; items?: NoteItem[] },
): void {
  db()
    .prepare('INSERT INTO notes (id, user_id, title, body, color, items) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, fields.title ?? '', fields.body ?? '', fields.color ?? null, fields.items && fields.items.length ? JSON.stringify(fields.items) : null);
}

export function updateNote(
  id: string,
  userId: number,
  fields: Partial<{ title: string; body: string; color: string | null; pinned: boolean; archived: boolean; items: NoteItem[] }>,
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.title !== undefined) { sets.push('title = ?'); vals.push(fields.title); }
  if (fields.body !== undefined) { sets.push('body = ?'); vals.push(fields.body); }
  if (fields.color !== undefined) { sets.push('color = ?'); vals.push(fields.color); }
  if (fields.pinned !== undefined) { sets.push('pinned = ?'); vals.push(fields.pinned ? 1 : 0); }
  if (fields.archived !== undefined) { sets.push('archived = ?'); vals.push(fields.archived ? 1 : 0); }
  if (fields.items !== undefined) { sets.push('items = ?'); vals.push(fields.items.length ? JSON.stringify(fields.items) : null); }
  if (!sets.length) return;
  sets.push("updated_at = strftime('%s', 'now')");
  vals.push(id, userId);
  db().prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals);
}

export function deleteNote(id: string, userId: number): void {
  db().prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, userId);
}

// ─── Memory ────────────────────────────────────────────────────────
export interface Memory {
  id: string;
  user_id: number;
  content: string;
  pinned: number;
  source: string | null;
  created_at: number;
  updated_at: number;
}

export function listMemories(userId: number): Memory[] {
  return db()
    .prepare('SELECT * FROM memories WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC')
    .all(userId) as Memory[];
}

export function createMemory(id: string, userId: number, content: string, source = 'user'): Memory {
  db()
    .prepare('INSERT INTO memories (id, user_id, content, source) VALUES (?, ?, ?, ?)')
    .run(id, userId, content.slice(0, 2000), source);
  return db().prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory;
}

export function updateMemory(id: string, userId: number, fields: Partial<{ content: string; pinned: boolean }>): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.content !== undefined) { sets.push('content = ?'); vals.push(fields.content.slice(0, 2000)); }
  if (fields.pinned !== undefined) { sets.push('pinned = ?'); vals.push(fields.pinned ? 1 : 0); }
  if (!sets.length) return;
  sets.push("updated_at = strftime('%s', 'now')");
  vals.push(id, userId);
  db().prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals);
}

export function deleteMemory(id: string, userId: number): void {
  db().prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').run(id, userId);
}

/** A capped, pinned-first slice of memories for injecting into the system prompt. */
export function memoriesForPrompt(userId: number, maxItems = 14, maxChars = 2200): string[] {
  const rows = listMemories(userId);
  const out: string[] = [];
  let used = 0;
  for (const m of rows) {
    if (out.length >= maxItems) break;
    const t = m.content.trim();
    if (!t) continue;
    if (used + t.length > maxChars) break;
    out.push(t);
    used += t.length;
  }
  return out;
}
