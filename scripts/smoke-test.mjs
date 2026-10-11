#!/usr/bin/env node
/**
 * Chakor live smoke test — exercises the real server end to end:
 * health, register, login, models, chat streaming, conversations, notes,
 * memories, share page (public), /v1 Bearer API, and auth gates.
 *
 * Usage:  node scripts/smoke-test.mjs [baseUrl]
 * Default baseUrl: http://127.0.0.1:3001  (pass :3002 for a staging build)
 *
 * Registration mode is read from .env.local (invite code included if needed).
 * A throwaway user `smoke-<rand>` is created; its data is deleted again at the
 * end when possible (conversation/notes/memories are cleaned up explicitly).
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:3001';

// ── tiny cookie jar ──────────────────────────────────────────────
const jar = new Map();
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
function storeCookies(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
async function api(p, opts = {}) {
  const res = await fetch(BASE + p, {
    ...opts,
    headers: { cookie: cookieHeader(), ...(opts.headers || {}) },
    redirect: 'manual',
  });
  storeCookies(res);
  return res;
}

// ── env (registration mode / invite code) ────────────────────────
function readEnv() {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    const get = (k) => /^(\w+)="?([^"\n]*)"?\s*$/m.exec(text)?.[0]?.startsWith(k) ? new RegExp(`^${k}="?([^"\\n]*)"?`, 'm').exec(text)?.[1] : undefined;
    return { mode: get('REGISTRATION_MODE'), invite: get('INVITE_CODE') };
  } catch { return {}; }
}

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

async function readSSE(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const lines = part.split('\n').filter((l) => l.startsWith('data:'));
      if (!lines.length) continue;
      const data = lines.map((l) => l.slice(5)).join('\n').trim();
      if (data === '[DONE]') return;
      try { onEvent(JSON.parse(data)); } catch { /* ignore non-JSON frames */ }
    }
  }
}

const rand = Math.random().toString(36).slice(2, 8);
const user = `smoke-${rand}`;
const password = `smoke-pass-${rand}-12345`;

console.log(`\nChakor smoke test against ${BASE}\n`);

// 1. health
{
  const r = await fetch(`${BASE}/api/health`);
  const d = await r.json().catch(() => null);
  check('GET /api/health is public and ok', r.status === 200 && d?.ok === true && d?.db === 'up', `status=${r.status}`);
}

// 2. auth gates
{
  const r = await fetch(`${BASE}/api/conversations`, { redirect: 'manual' });
  check('GET /api/conversations without session is rejected', [307, 401, 302].includes(r.status), `status=${r.status}`);
  const r2 = await fetch(`${BASE}/api/admin/users`, { redirect: 'manual' });
  check('GET /api/admin/users without session is rejected', [307, 401, 302].includes(r2.status), `status=${r2.status}`);
}

// 3. register
{
  const { mode, invite } = readEnv();
  const body = { username: user, password };
  if ((mode || 'closed') === 'invite') body.invite = invite;
  const r = await api('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  check(`POST /api/register (mode=${mode ?? '?'})`, r.ok, `status=${r.status} ${d.error ?? ''}`);
}

// 4. login (next-auth credentials CSRF flow)
{
  const csrfRes = await api('/api/auth/csrf');
  const { csrfToken } = await csrfRes.json();
  const form = new URLSearchParams({ csrfToken, username: user, password, callbackUrl: BASE + '/' });
  const r = await api('/api/auth/callback/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  const hasSession = [...jar.keys()].some((k) => k.includes('session-token'));
  check('login via credentials sets a session cookie', hasSession, `status=${r.status} keys=${[...jar.keys()].join(',')}`);
}

// 5. models
let modelId = null;
{
  const r = await api('/api/models');
  const d = await r.json().catch(() => null);
  const models = Array.isArray(d) ? d : [];
  modelId = models.find((m) => m.provider === 'llama')?.id ?? models[0]?.id ?? null;
  check('GET /api/models returns at least one model', models.length > 0, `count=${models.length}`);
}

// 6. chat streaming
let convId = null, assistantText = '';
if (modelId) {
  const r = await api('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Reply with exactly the word: OK', modelId, useRag: false, useSearch: false }),
  });
  check('POST /api/chat returns 200 SSE', r.status === 200 && (r.headers.get('content-type') || '').includes('text/event-stream'), `status=${r.status}`);
  convId = r.headers.get('x-conversation-id');
  await readSSE(r, (p) => { if (p.delta) assistantText += p.delta; if (p.error) assistantText = ''; });
  check('chat streamed a non-empty assistant reply', assistantText.trim().length > 0, `got ${assistantText.length} chars`);
}

// 7. conversations list contains it
if (convId) {
  const r = await api('/api/conversations');
  const d = await r.json().catch(() => []);
  check('new conversation appears in list', Array.isArray(d) && d.some((c) => c.id === convId));
}

// 8. share page is public
if (convId) {
  const r = await api(`/api/conversations/${convId}/share`, { method: 'POST' });
  const d = await r.json().catch(() => ({}));
  check('POST share returns a slug', r.ok && typeof d.slug === 'string' && d.slug.length >= 20, `slug=${d.slug}`);
  if (d.slug) {
    const pub = await fetch(`${BASE}/share/${d.slug}`);
    const html = await pub.text();
    check('GET /share/[slug] is public and renders', pub.status === 200 && html.length > 500, `status=${pub.status}`);
  }
}

// 9. notes CRUD
{
  const c = await api('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'smoke', content: 'hello note' }) });
  const note = await c.json().catch(() => null);
  check('POST /api/notes', c.ok && note?.id, `status=${c.status}`);
  if (note?.id) {
    const d = await api(`/api/notes/${note.id}`, { method: 'DELETE' });
    check('DELETE /api/notes/[id]', d.ok, `status=${d.status}`);
  }
}

// 10. memories CRUD
{
  const c = await api('/api/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'smoke test memory' }) });
  const mem = await c.json().catch(() => null);
  check('POST /api/memories', c.ok && mem?.id, `status=${c.status}`);
  if (mem?.id) {
    const d = await api(`/api/memories/${mem.id}`, { method: 'DELETE' });
    check('DELETE /api/memories/[id]', d.ok, `status=${d.status}`);
  }
}

// 11. /v1 Bearer API
{
  const c = await api('/api/user/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'smoke' }) });
  const key = await c.json().catch(() => null);
  const token = key?.token;
  check('POST /api/user/keys returns a raw token once', c.ok && typeof token === 'string' && token.length > 20);
  if (token) {
    const m = await fetch(`${BASE}/v1/models`, { headers: { authorization: `Bearer ${token}` } });
    check('GET /v1/models with Bearer', m.status === 200, `status=${m.status}`);
    if (modelId) {
      const cc = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'Reply with exactly the word: OK' }], stream: false }),
      });
      const d = await cc.json().catch(() => null);
      check('POST /v1/chat/completions (non-stream)', cc.status === 200 && (d?.choices?.[0]?.message?.content ?? '').length > 0, `status=${cc.status}`);
    }
    const bad = await fetch(`${BASE}/v1/models`, { headers: { authorization: 'Bearer sk-chakor-wrong' } });
    check('GET /v1/models with wrong key is 401', bad.status === 401, `status=${bad.status}`);
    if (key?.id) await api(`/api/user/keys/${key.id}`, { method: 'DELETE' });
  }
}

// 12. cleanup: delete the test conversation
if (convId) {
  const d = await api(`/api/conversations/${convId}`, { method: 'DELETE' });
  check('cleanup: delete test conversation', d.ok, `status=${d.status}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
