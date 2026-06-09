/**
 * Helpers for the local llama.cpp model: list the GGUF files on disk, read what
 * is running right now, persist the chosen launch config, and build the
 * llama-server argument list.
 *
 * Chakor supervises llama-server as a child process (see lib/llama-supervisor.ts,
 * started from instrumentation.ts), so the app and the model run under one
 * service and switching the model is just an in-process child restart — no sudo,
 * no second systemd unit.
 */
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isVisionModel } from './models';

const RUNTIME_ENV = process.env.CHAKOR_LLAMA_RUNTIME ?? path.join(process.cwd(), 'data', 'llama-runtime.env');

export function llamaUrl(): string {
  return process.env.LLAMA_BASE_URL ?? process.env.CHAKOR_MODEL_URL ?? 'http://127.0.0.1:4546';
}

function llamaPort(): number {
  const m = /:(\d+)(?:\/|$)/.exec(llamaUrl());
  return m ? Number(m[1]) : 4546;
}

export interface LiveProps {
  online: boolean;
  modelPath: string | null;
  modelName: string | null;
  alias: string | null;
  nCtx: number | null;
  vision: boolean;
}

/** What llama-server reports about itself right now — the source of truth. */
export async function liveProps(): Promise<LiveProps> {
  try {
    const res = await fetch(`${llamaUrl()}/props`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { online: false, modelPath: null, modelName: null, alias: null, nCtx: null, vision: false };
    const d = await res.json();
    const modelPath: string | null = d.model_path ?? null;
    const modalities = d.modalities ?? {};
    return {
      online: true,
      modelPath,
      modelName: modelPath ? path.basename(modelPath) : null,
      alias: d.model_alias ?? null,
      nCtx: d.default_generation_settings?.n_ctx ?? d.n_ctx ?? null,
      vision: Boolean(modalities.vision),
    };
  } catch {
    return { online: false, modelPath: null, modelName: null, alias: null, nCtx: null, vision: false };
  }
}

export interface LocalModel {
  path: string;
  name: string;
  size: number;
  vision: boolean;
}

const SKIP_RE = /mmproj|ggml-vocab|vocab|projector/i;

/** Directories we look in for .gguf files. Override/extend with CHAKOR_MODELS_DIR. */
function modelDirs(currentModelPath: string | null): string[] {
  const home = os.homedir();
  const dirs = new Set<string>();
  if (currentModelPath) dirs.add(path.dirname(currentModelPath));
  for (const d of (process.env.CHAKOR_MODELS_DIR ?? '').split(path.delimiter)) {
    if (d.trim()) dirs.add(d.trim());
  }
  dirs.add(path.join(home, 'Downloads'));
  dirs.add(path.join(home, 'models'));
  dirs.add(path.join(home, '.cache', 'llama.cpp'));
  dirs.add(path.join(home, '.lmstudio', 'models'));
  return [...dirs];
}

async function ggufFilesIn(dir: string, depth: number): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase().endsWith('.gguf') && !SKIP_RE.test(e.name)) {
      out.push(full);
    } else if (e.isDirectory() && depth > 0 && !e.name.startsWith('.')) {
      out.push(...(await ggufFilesIn(full, depth - 1)));
    }
  }
  return out;
}

/** Look for a `*mmproj*.gguf` sibling so vision models can be launched with sight. */
export async function findMmproj(modelPath: string): Promise<string | null> {
  try {
    const dir = path.dirname(modelPath);
    const files = await fs.readdir(dir);
    const m = files.find((f) => /mmproj/i.test(f) && f.toLowerCase().endsWith('.gguf'));
    return m ? path.join(dir, m) : null;
  } catch {
    return null;
  }
}

/** Every switchable GGUF on disk, de-duplicated, biggest first. */
export async function scanLocalModels(currentModelPath: string | null): Promise<LocalModel[]> {
  const dirs = modelDirs(currentModelPath);
  const seen = new Map<string, LocalModel>();
  for (const dir of dirs) {
    // Depth 2 covers LMStudio's publisher/repo/model.gguf layout and similar.
    for (const file of await ggufFilesIn(dir, 2)) {
      if (seen.has(file)) continue;
      let size = 0;
      try { size = (await fs.stat(file)).size; } catch { continue; }
      const name = path.basename(file);
      const hasMmproj = (await findMmproj(file)) !== null;
      seen.set(file, { path: file, name, size, vision: isVisionModel(name) || hasMmproj });
    }
  }
  return [...seen.values()].sort((a, b) => b.size - a.size);
}

export interface RuntimeConfig {
  model?: string;
  ctx?: number;
  alias?: string;
  mmproj?: string;
}

export async function readRuntimeEnv(): Promise<RuntimeConfig> {
  try {
    const text = await fs.readFile(RUNTIME_ENV, 'utf8');
    const cfg: RuntimeConfig = {};
    for (const line of text.split('\n')) {
      const m = /^([A-Z_]+)=["']?(.*?)["']?\s*$/.exec(line.trim());
      if (!m) continue;
      if (m[1] === 'LLAMA_GGUF') cfg.model = m[2];
      else if (m[1] === 'LLAMA_CTX') cfg.ctx = Number(m[2]) || undefined;
      else if (m[1] === 'LLAMA_ALIAS') cfg.alias = m[2];
      else if (m[1] === 'LLAMA_MMPROJ') cfg.mmproj = m[2];
    }
    return cfg;
  } catch {
    return {};
  }
}

/** Persist the desired launch config. The wrapper reads this on next start. */
export async function writeRuntimeEnv(cfg: Required<Pick<RuntimeConfig, 'model' | 'ctx'>> & RuntimeConfig): Promise<void> {
  const alias = cfg.alias ?? process.env.LLAMA_MODEL ?? process.env.CHAKOR_MODEL_ALIAS ?? 'Chakor';
  const lines = [
    '# Written by Chakor. Controls the local llama.cpp launch (see scripts/llama-launch.sh).',
    `LLAMA_GGUF="${cfg.model}"`,
    `LLAMA_CTX="${Math.round(cfg.ctx)}"`,
    `LLAMA_ALIAS="${alias}"`,
    `LLAMA_MMPROJ="${cfg.mmproj ?? ''}"`,
    '',
  ];
  await fs.mkdir(path.dirname(RUNTIME_ENV), { recursive: true });
  await fs.writeFile(RUNTIME_ENV, lines.join('\n'), 'utf8');
}

/** Find the llama-server binary: explicit env, common build path, then PATH. */
export function resolveLlamaBin(): string {
  const candidates = [
    process.env.LLAMA_SERVER_BIN,
    path.join(os.homedir(), 'llama.cpp', 'build', 'bin', 'llama-server'),
    '/usr/local/bin/llama-server',
    '/usr/bin/llama-server',
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'llama-server'; // last resort: let the OS resolve it on PATH
}

/** Decide which GGUF to launch: saved choice, env default, else the largest found. */
export async function resolveModelPath(cfg: RuntimeConfig): Promise<string | null> {
  if (cfg.model && existsSync(cfg.model)) return cfg.model;
  const envDefault = process.env.LLAMA_GGUF;
  if (envDefault && existsSync(envDefault)) return envDefault;
  const found = await scanLocalModels(envDefault ?? null);
  return found[0]?.path ?? null;
}

/** The full llama-server argument list for a given model + context. */
export function buildLlamaArgs(opts: { model: string; ctx: number; alias?: string; mmproj?: string }): string[] {
  const alias = opts.alias ?? process.env.LLAMA_MODEL ?? process.env.CHAKOR_MODEL_ALIAS ?? 'Chakor';
  const args = [
    '--model', opts.model,
    '--alias', alias,
    '--port', String(llamaPort()),
    '--host', process.env.LLAMA_HOST ?? '0.0.0.0',
    '--ctx-size', String(Math.round(opts.ctx)),
    '--n-gpu-layers', process.env.LLAMA_NGL ?? '9999',
    '--threads', process.env.LLAMA_THREADS ?? '8',
    '--no-mmap',
    '--cache-ram', '0',
    '--n-predict', process.env.LLAMA_NPREDICT ?? '3000',
    '--chat-template-kwargs', '{"enable_thinking":false}',
  ];
  if (opts.mmproj && existsSync(opts.mmproj)) args.push('--mmproj', opts.mmproj);
  if (process.env.LLAMA_EXTRA) args.push(...process.env.LLAMA_EXTRA.split(' ').filter(Boolean));
  return args;
}

/** Poll /health until the server is back (after a restart), up to ~timeoutMs. */
export async function waitForHealthy(timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${llamaUrl()}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}
