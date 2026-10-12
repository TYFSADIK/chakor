#!/usr/bin/env node
/**
 * Live Deep Research verification against a running instance.
 * Registers a throwaway user, asks a research question with useDeepResearch,
 * and reports: plan/search/read steps, source count, reply length, citations.
 *
 * Usage: node scripts/test-deep-research.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:3001';

const jar = new Map();
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { cookie: cookieHeader(), ...(opts.headers || {}) },
    redirect: 'manual',
  });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [pair] = sc.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return res;
}

const user = `smoke-${Date.now().toString(36)}`;
const password = 'Sm0ke!pass' + Date.now().toString(36);

// register (open or invite mode)
let body = { username: user, password };
if (process.env.REGISTRATION_MODE === 'invite') body.invite = process.env.INVITE_CODE ?? '';
let r = await api('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
if (!r.ok) { console.error('register failed', r.status, await r.text()); process.exit(1); }

// login
const csrfRes = await api('/api/auth/csrf');
const { csrfToken } = await csrfRes.json();
const form = new URLSearchParams({ csrfToken, username: user, password, callbackUrl: BASE + '/' });
r = await api('/api/auth/callback/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
if (![...jar.keys()].some((k) => k.includes('session-token'))) { console.error('login failed'); process.exit(1); }

// deep research chat
const question = 'What are the real-world energy costs of training large AI models, and how do researchers propose reducing them?';
r = await api('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: question, useDeepResearch: true }),
});
if (!r.ok || !r.body) { console.error('chat failed', r.status, await r.text()); process.exit(1); }

const steps = [];
let sources = [];
let reply = '';
let error = null;
const reader = r.body.getReader();
const dec = new TextDecoder();
let buf = '';
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const events = buf.split('\n\n');
  buf = events.pop() ?? '';
  for (const evt of events) {
    const line = evt.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') continue;
    try {
      const p = JSON.parse(data);
      if (p.toolEvent) steps.push(p.toolEvent);
      if (p.sources) sources = p.sources;
      if (p.delta) reply += p.delta;
      if (p.error) error = p.error;
    } catch { /* partial */ }
  }
}

console.log('--- DEEP RESEARCH LIVE TEST ---');
console.log('error:', error ?? 'none');
console.log('steps:', steps.map((s) => s.name).join(' -> ') || 'NONE');
for (const s of steps) {
  if (s.name === 'research_plan') console.log('plan:\n' + s.result);
  if (s.name === 'read_pages') console.log('pages read:', s.result.split('\n').length);
}
console.log('sources:', sources.length);
console.log('reply chars:', reply.length);
const citations = (reply.match(/\[\d+\]/g) ?? []).length;
console.log('citation markers in reply:', citations);
console.log('reply excerpt:', reply.slice(0, 400).replace(/\n+/g, ' | '));

const pass = !error && steps.length >= 2 && sources.length >= 5 && reply.length > 800 && citations >= 3;
console.log(pass ? 'VERDICT: PASS' : 'VERDICT: FAIL');
process.exit(pass ? 0 : 1);
