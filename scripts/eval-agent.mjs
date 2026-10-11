#!/usr/bin/env node
/* Agent A/B evaluation battery.
 *
 * Runs a fixed set of agent tasks against a Chakor server and reports
 * per-run metrics: malformed-JSON retries, hard errors, tool calls,
 * whether a final answer arrived, and whether the expected file appeared.
 *
 * Usage: node scripts/eval-agent.mjs [baseUrl] [label]
 */

const BASE = process.argv[2] || 'http://127.0.0.1:3001';
const LABEL = process.argv[3] || 'model';
const USERNAME = `eval-${Date.now()}`;
const PASSWORD = 'eval-pass-' + Math.random().toString(36).slice(2, 12);

const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', cookie: cookieHeader(), ...(opts.headers || {}) },
    redirect: 'manual',
  });
  // getSetCookie() keeps every Set-Cookie; single get() would collapse them.
  const setCookies = typeof r.headers.getSetCookie === 'function'
    ? r.headers.getSetCookie()
    : [r.headers.get('set-cookie')].filter(Boolean);
  for (const sc of setCookies) {
    const [pair] = sc.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return r;
}

async function login(username, password) {
  // Auth.js credentials flow: fetch a CSRF token, then post it as form data.
  const csrfRes = await api('/api/auth/csrf');
  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({ csrfToken, username, password, json: 'true' });
  const r = await api('/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  // Success is a 200 (json mode) or a 302 redirect; either way the jar must
  // now hold a session-token cookie.
  return [...jar.keys()].some((k) => k.includes('session-token')) || r.status === 200 || r.status === 302;
}

const BATTERY = [
  { name: 'write_file', msg: 'Save a file called shopping.txt with a short shopping list of 5 items.', expectFile: 'shopping.txt' },
  { name: 'docx', msg: 'Create a Word document called report.docx about the benefits of walking daily.', expectFile: 'report.docx' },
  { name: 'pptx', msg: 'Make a PowerPoint presentation called intro.pptx about the solar system with 4 slides.', expectFile: 'intro.pptx' },
  { name: 'python', msg: 'Use Python to compute the sum of all prime numbers below 100 and tell me the answer.' },
  { name: 'search_write', msg: 'Search the web for the current price of gold, then save your findings to gold.txt.', expectFile: 'gold.txt' },
  { name: 'list_read', msg: 'Write a file hello.txt containing the word hello, then read it back to me.', expectFile: 'hello.txt' },
];

async function runTask(task) {
  let r = await api('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title: 'eval-' + task.name }),
  });
  if (r.status !== 200 && r.status !== 201) return { task: task.name, fatal: 'create conv ' + r.status };
  const conv = await r.json();
  const convId = conv.id || conv.conversation?.id;

  const events = [];
  r = await api('/api/agent/execute', {
    method: 'POST',
    body: JSON.stringify({ conversationId: convId, message: task.msg }),
  });
  if (!r.ok || !r.body) return { task: task.name, fatal: 'execute ' + r.status };

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + 480000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const p of parts) {
      const line = p.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try { events.push(JSON.parse(data)); } catch { /* partial */ }
    }
  }

  let fileOk = null;
  if (task.expectFile) {
    r = await api(`/api/workspace/${convId}`);
    const list = await r.json().catch(() => ({ files: [] }));
    fileOk = (list.files || []).some((f) => f.name === task.expectFile);
  }
  // cleanup conversation (workspace dir is left behind intentionally; cheap)
  await api(`/api/conversations/${convId}`, { method: 'DELETE' }).catch(() => {});

  const errors = events.filter((e) => e.type === 'error');
  return {
    task: task.name,
    retries: errors.filter((e) => /retry/i.test(e.message || '')).length,
    hardErrors: errors.filter((e) => !/retry/i.test(e.message || '')).length,
    toolCalls: events.filter((e) => e.type === 'tool_call').length,
    final: events.some((e) => e.type === 'final_answer' && (e.content || '').length > 10),
    fileOk,
    events: events.length,
  };
}

async function main() {
  let r = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD }) });
  if (![200, 201, 409].includes(r.status)) { console.error('register failed', r.status); process.exit(1); }
  if (!(await login(USERNAME, PASSWORD))) { console.error('login failed: no session established'); process.exit(1); }

  console.log(`eval battery on ${BASE} [${LABEL}]`);
  const results = [];
  for (const task of BATTERY) {
    const res = await runTask(task);
    results.push(res);
    console.log(`  ${res.task.padEnd(14)} retries=${res.retries ?? '-'} hard=${res.hardErrors ?? '-'} calls=${res.toolCalls ?? '-'} final=${res.final ?? '-'} file=${res.fileOk ?? '-'}${res.fatal ? ' FATAL ' + res.fatal : ''}`);
  }
  const ok = results.filter((x) => !x.fatal);
  const sum = {
    label: LABEL,
    runs: results.length,
    completed: ok.filter((x) => x.final).length,
    filesOk: ok.filter((x) => x.fileOk === true).length,
    filesExpected: ok.filter((x) => x.fileOk !== null).length,
    retries: ok.reduce((a, x) => a + x.retries, 0),
    hardErrors: ok.reduce((a, x) => a + x.hardErrors, 0),
    toolCalls: ok.reduce((a, x) => a + x.toolCalls, 0),
  };
  console.log(JSON.stringify({ summary: sum }));
}

main().catch((e) => { console.error(e); process.exit(1); });
