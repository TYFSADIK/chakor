#!/usr/bin/env node
/**
 * Chakor doctor — verifies every piece of the environment Chakor uses and
 * prints what is ready, what is missing, and how to fix it. Run after
 * setup.sh / install.sh, or any time something misbehaves:
 *
 *     npm run doctor
 *
 * Exit code 0 = all required checks pass (optional extras only warn).
 * Plain Node, no app imports — it must work even when the app itself cannot.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(root, 'package.json'));

let failures = 0;
let warnings = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg, fix) => { warnings++; console.log(`  ! ${msg}${fix ? `\n      fix: ${fix}` : ''}`); };
const fail = (msg, fix) => { failures++; console.log(`  ✗ ${msg}${fix ? `\n      fix: ${fix}` : ''}`); };
const section = (msg) => console.log(`\n${msg}`);

// ---- .env.local (parsed by hand — no dotenv dependency) --------------------
const envPath = path.join(root, '.env.local');
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
}
const envOr = (k, dflt) => (env[k] !== undefined && env[k] !== '' ? env[k] : (process.env[k] || dflt));

// ---- required ---------------------------------------------------------------
section('Core (required)');

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 20) ok(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} — Chakor needs Node 20+`, 'install Node 20: https://nodejs.org or bash install.sh');

try {
  require.resolve('next');
  ok('App dependencies installed (node_modules)');
} catch {
  fail('node_modules missing or incomplete', 'run: npm install --legacy-peer-deps');
}

try {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:');
  probe.exec('CREATE TABLE t (x)');
  probe.close();
  ok('better-sqlite3 native module loads');
} catch (e) {
  fail(`better-sqlite3 does not load on this Node (${e.message})`,
    'rebuild it: npm rebuild better-sqlite3  (it must be built against the Node that runs the app)');
}

if (fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) ok('Production build present (.next)');
else fail('No production build', 'run: npm run build');

if (!fs.existsSync(envPath)) {
  fail('.env.local is missing', 'run: bash setup.sh  (or: cp .env.example .env.local and set AUTH_SECRET)');
} else if (!env.AUTH_SECRET || env.AUTH_SECRET.includes('REPLACE_ME')) {
  fail('AUTH_SECRET is not set in .env.local',
    'generate one: openssl rand -base64 32  and paste it into .env.local');
} else {
  ok('.env.local with a real AUTH_SECRET');
}

const dbPath = path.resolve(root, envOr('CHAKOR_DB_PATH', './data/chakor.db'));
try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.accessSync(path.dirname(dbPath), fs.constants.W_OK);
  ok(`Database location writable (${path.relative(root, dbPath) || dbPath})`);
} catch {
  fail(`Database directory not writable: ${path.dirname(dbPath)}`, 'check ownership/permissions of the data folder');
}

// ---- chat model -------------------------------------------------------------
section('Chat model (need at least one)');

const home = os.homedir();
const llamaBin = envOr('LLAMA_SERVER_BIN', '')
  || [path.join(home, 'llama.cpp', 'build', 'bin', 'llama-server')].find((p) => fs.existsSync(p))
  || '';
let chatReady = false;

if (llamaBin && fs.existsSync(llamaBin)) {
  ok(`llama-server binary: ${llamaBin}`);
  const scanDirs = [
    envOr('LLAMA_GGUF', ''),
    ...(envOr('CHAKOR_MODELS_DIR', '').split(':').filter(Boolean)),
    path.join(home, 'Downloads'), path.join(home, 'models'),
    path.join(home, '.lmstudio', 'models'), path.join(home, 'llama.cpp', 'models'),
  ].filter(Boolean);
  const ggufs = [];
  for (const d of scanDirs) {
    try {
      const st = fs.statSync(d);
      if (st.isFile() && d.toLowerCase().endsWith('.gguf')) ggufs.push(d);
      else if (st.isDirectory()) {
        for (const f of fs.readdirSync(d, { recursive: true })) {
          if (String(f).toLowerCase().endsWith('.gguf')) ggufs.push(path.join(d, String(f)));
        }
      }
    } catch { /* unreadable dir — skip */ }
  }
  if (ggufs.length > 0) {
    ok(`${ggufs.length} GGUF model(s) found, e.g. ${path.basename(ggufs[0])}`);
    chatReady = true;
  } else {
    warn('No .gguf chat model found', 'download one inside the app (Settings -> Models) or from huggingface.co');
  }
} else {
  warn('llama-server binary not found', 'build it: bash install.sh --with-llama-cpp');
}

async function httpOk(url, ms = 2000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return r.ok;
  } catch { return false; }
}

if (await httpOk(`${envOr('OLLAMA_BASE_URL', 'http://127.0.0.1:11434')}/api/tags`)) {
  ok('Ollama is running');
  chatReady = true;
} else {
  warn('Ollama not reachable (optional)', 'install it from https://ollama.com or skip — llama.cpp/cloud keys also work');
}

const cloudKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'OPENROUTER_API_KEY'].filter((k) => env[k]);
if (cloudKeys.length > 0) {
  ok(`Cloud key(s) configured: ${cloudKeys.join(', ')}`);
  chatReady = true;
}
if (!chatReady) fail('No usable chat model path found', 'install Ollama, build llama.cpp (bash install.sh --with-llama-cpp), or add a cloud API key to .env.local');

// ---- image generation (optional) -------------------------------------------
section('Image generation (optional)');

const sdDir = envOr('SDCPP_DIR', path.join(home, 'stable-diffusion.cpp'));
const sdBin = path.join(sdDir, 'build', 'bin', 'sd-server');
const sdModels = path.join(sdDir, 'models');
const ENCODER_RE = /qwen3vl|mmproj|encoder/i;
if (!fs.existsSync(sdBin)) {
  warn('sd-server not built', 'build it: bash install.sh --with-images');
} else {
  ok(`sd-server binary: ${sdBin}`);
  let ggufs = [];
  try { ggufs = fs.readdirSync(sdModels).filter((f) => f.toLowerCase().endsWith('.gguf')); } catch { /* no dir */ }
  const diff = ggufs.filter((f) => !ENCODER_RE.test(f));
  const enc = ggufs.filter((f) => ENCODER_RE.test(f));
  if (diff.length > 0) ok(`Diffusion model(s): ${diff.join(', ')}`);
  else warn('No diffusion model in ' + sdModels, 'bash install.sh --with-images downloads Sakura-Iris-3B for you');
  if (enc.length > 0) ok(`Text encoder(s): ${enc.join(', ')}`);
  else warn('No text encoder in ' + sdModels, 'the Sakura-Iris pipeline needs a Qwen3-VL encoder GGUF next to the model');
}

// ---- extras -----------------------------------------------------------------
section('Extras (optional)');

const pyBin = envOr('CHAKOR_PYTHON', '') || path.join(root, '.venv', 'bin', 'python');
if (fs.existsSync(pyBin)) ok(`Agent Workspace Python: ${pyBin}`);
else warn('Python venv missing — document tools (docx/pptx/charts) will not work', 'run: bash setup.sh');

if (await httpOk(`${envOr('SEARXNG_URL', 'http://127.0.0.1:8080')}/search?q=test&format=json`)) {
  ok('SearXNG web search answering');
} else if (env.BRAVE_SEARCH_API_KEY) {
  ok('Brave Search key configured');
} else {
  warn('No SearXNG/Brave — web search will use the DuckDuckGo fallback', 'for a local search engine: bash install.sh --with-searxng');
}

// ---- verdict ----------------------------------------------------------------
console.log('\n' + '-'.repeat(60));
if (failures === 0) {
  console.log(`Doctor: READY. ${warnings} optional thing(s) to consider. Start with: npm start`);
} else {
  console.log(`Doctor: ${failures} required check(s) failed, ${warnings} warning(s). Fix the ✗ items above.`);
}
process.exit(failures === 0 ? 0 : 1);
