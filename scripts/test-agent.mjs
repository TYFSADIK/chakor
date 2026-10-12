#!/usr/bin/env node
/**
 * Live Agent Workspace verification against a running instance.
 * Registers a throwaway user, asks the agent to create a presentation,
 * then verifies: SSE event flow, workspace file listing, download,
 * path traversal rejection, and delete.
 *
 * Usage: node scripts/test-agent.mjs [baseUrl]
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

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
};

const user = `smoke-${Date.now().toString(36)}`;
const password = 'Sm0ke!pass' + Date.now().toString(36);

// register + login
let body = { username: user, password };
if (process.env.REGISTRATION_MODE === 'invite') body.invite = process.env.INVITE_CODE ?? '';
let r = await api('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
check('register', r.ok, `status=${r.status}`);
const csrfRes = await api('/api/auth/csrf');
const { csrfToken } = await csrfRes.json();
const form = new URLSearchParams({ csrfToken, username: user, password, callbackUrl: BASE + '/' });
r = await api('/api/auth/callback/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
check('login', [...jar.keys()].some((k) => k.includes('session-token')));

// create conversation
r = await api('/api/conversations', { method: 'POST' });
const conv = await r.json();
const convId = conv.id;
check('create conversation', r.ok && !!convId);

// run the agent
r = await api('/api/agent/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    conversationId: convId,
    message: 'Create a presentation named q3-report.pptx titled "Q3 Report" with one content slide titled "Revenue" with bullets: Up 12 percent, Driven by enterprise, Strong pipeline. Then confirm it exists.',
  }),
});
check('agent endpoint streams', r.ok && (r.headers.get('content-type') ?? '').includes('text/event-stream'));

const events = [];
let finalAnswer = '';
if (r.ok && r.body) {
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const e = JSON.parse(data);
        events.push(e);
        if (e.type === 'final_answer') finalAnswer = e.content ?? '';
      } catch { /* partial */ }
    }
  }
}

const kinds = events.map((e) => e.type);
check('agent emitted status events', kinds.includes('status'));
check('agent called a tool', kinds.includes('tool_call'), kinds.filter((k) => k === 'tool_call').length + ' calls');
check('agent produced tool results', kinds.includes('tool_result'));
check('agent gave a final answer', finalAnswer.length > 10, finalAnswer.length + ' chars');
// Retry prompts ("invalid JSON; asking the agent to retry") are graceful
// recovery, not failures; only unrecovered errors count.
const hardErrors = events.filter((e) => e.type === 'error' && !/retry/i.test(e.message ?? ''));
check('no unrecovered error events', hardErrors.length === 0, hardErrors.map((e) => e.message).join('; ').slice(0, 200));
const retried = events.some((e) => e.type === 'error');
const recovered = retried && finalAnswer.length > 10;
if (retried) check('agent recovered from malformed tool call', recovered);
const usedPptx = events.some((e) => e.type === 'tool_call' && e.tool === 'generate_pptx');
check('used generate_pptx tool (not raw python)', usedPptx);

// workspace file list
r = await api(`/api/workspace/${convId}`);
const list = await r.json();
check('workspace lists the file', r.ok && list.files?.some((f) => f.name === 'q3-report.pptx'), (list.files ?? []).map((f) => f.name).join(','));

// download
r = await api(`/api/workspace/${convId}/files/q3-report.pptx`);
const buf = Buffer.from(await r.arrayBuffer());
check('download works and is a real pptx (PK zip)', r.ok && buf.subarray(0, 2).toString('latin1') === 'PK', `${buf.length} bytes, type=${r.headers.get('content-type')}`);

// traversal blocked (Next normalizes ".." to a 308 redirect; dotfiles 404)
r = await api(`/api/workspace/${convId}/files/${encodeURIComponent('..')}`);
const travStatus = r.status;
r = await api(`/api/workspace/${convId}/files/${encodeURIComponent('.sandbox_script.py')}`);
check('path traversal / dotfiles rejected', [400, 404, 308].includes(travStatus) && r.status === 404, `statuses ${travStatus},${r.status}`);

// delete
r = await api(`/api/workspace/${convId}/files/q3-report.pptx`, { method: 'DELETE' });
check('delete works', r.ok);
r = await api(`/api/workspace/${convId}`);
const after = await r.json();
check('file gone after delete', !(after.files ?? []).some((f) => f.name === 'q3-report.pptx'));

// cleanup conversation
await api(`/api/conversations/${convId}`, { method: 'DELETE' });

console.log(failures === 0 ? '\nVERDICT: PASS' : `\nVERDICT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
