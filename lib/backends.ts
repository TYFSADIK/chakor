/**
 * Which local AI engines are actually up right now. Chakor can talk to three
 * local backends - llama.cpp (which it supervises itself), Ollama, and LM Studio
 * - and the whole point of this module is to answer, at a glance: which of them
 * is running, and how many models can I reach through each.
 *
 * This is what powers the fix for "llama.cpp crashed, now switching to Ollama or
 * LM Studio errors out": the UI probes all three, and when the one you picked is
 * down it can point you straight at one that is up, with models ready to go.
 *
 * Server-only. Every probe fails fast (short timeout) and never throws, so a
 * dead engine just reports running:false instead of breaking the page.
 */
import { promises as fs } from 'node:fs';
import { discoverOllamaModels, discoverLmStudioModels, OLLAMA_BASE_URL, LMSTUDIO_BASE_URL } from './models';
import { liveProps, readRuntimeEnv, resolveModelPath } from './local-llama';
import { llamaSupervisor } from './llama-supervisor';
import { detectHardware } from './hardware';
import { maxContextForModel } from './hwfit';

export type EngineId = 'llama' | 'ollama' | 'lmstudio';

export interface EngineStatus {
  id: EngineId;
  label: string;
  running: boolean;
  baseUrl: string;
  /** How many chat models are reachable through this engine right now. */
  modelCount: number;
  /** Model names/ids, for the picker to offer when steering the user across. */
  models: string[];
  /** One-line, plain-language status for the UI. */
  detail: string;
  /** llama.cpp only: Chakor is running the server itself (vs. an external one). */
  managed?: boolean;
  /** llama.cpp only: last crash/launch error, if any. */
  error?: string | null;
  /** llama.cpp only: the supervisor gave up after repeated crashes. */
  crashed?: boolean;
}

async function probeLlama(): Promise<EngineStatus> {
  const [live, st] = await Promise.all([liveProps(), Promise.resolve(llamaSupervisor.status())]);
  const running = live.online;
  let detail: string;
  if (running) {
    detail = st.managing
      ? `Running ${live.modelName ?? 'a model'}${st.crashed ? '' : ' (managed by Chakor)'}`
      : `Running ${live.modelName ?? 'a model'} (external server)`;
  } else if (st.crashed) {
    detail = 'Stopped after repeated crashes - the model is likely too big for this machine';
  } else if (!st.enabled) {
    detail = 'Supervision off';
  } else {
    detail = st.lastError ? 'Not running' : 'Not running';
  }
  return {
    id: 'llama',
    label: 'llama.cpp',
    running,
    baseUrl: process.env.LLAMA_BASE_URL ?? 'http://127.0.0.1:4546',
    modelCount: running ? 1 : 0,
    models: running && live.modelName ? [live.modelName] : [],
    detail,
    managed: st.managing,
    error: st.lastError,
    crashed: st.crashed,
  };
}

async function probeOllama(): Promise<EngineStatus> {
  const models = await discoverOllamaModels();
  return {
    id: 'ollama',
    label: 'Ollama',
    running: models.length > 0 || (await ollamaReachable()),
    baseUrl: OLLAMA_BASE_URL,
    modelCount: models.length,
    models: models.map((m) => m.name),
    detail: models.length ? `${models.length} model${models.length === 1 ? '' : 's'} installed` : 'Not running or no models',
  };
}

// discoverOllamaModels returns [] both when Ollama is down AND when it's up with
// nothing pulled. A tiny extra probe tells those apart so the UI can say "running
// but empty" vs "not running".
async function ollamaReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch {
    return false;
  }
}

async function probeLmStudio(): Promise<EngineStatus> {
  const models = await discoverLmStudioModels();
  let reachable = models.length > 0;
  if (!reachable) {
    try {
      const r = await fetch(`${LMSTUDIO_BASE_URL}/models`, { signal: AbortSignal.timeout(1200) });
      reachable = r.ok;
    } catch {
      reachable = false;
    }
  }
  return {
    id: 'lmstudio',
    label: 'LM Studio',
    running: reachable,
    baseUrl: LMSTUDIO_BASE_URL,
    modelCount: models.length,
    models: models.map((m) => m.name),
    detail: models.length
      ? `${models.length} model${models.length === 1 ? '' : 's'} loaded`
      : reachable
        ? 'Running, no model loaded'
        : 'Not running',
  };
}

/** Probe all three local engines at once. Never throws. */
export async function probeEngines(): Promise<EngineStatus[]> {
  return Promise.all([probeLlama(), probeOllama(), probeLmStudio()]);
}

/**
 * If the engine behind the user's selected model is down, suggest the best
 * running alternative (most models wins). Returns null when the selection is
 * fine or nothing better is available.
 */
export function suggestEngine(engines: EngineStatus[], selectedProvider: string): EngineStatus | null {
  const map: Record<string, EngineId> = { llama: 'llama', ollama: 'ollama', lmstudio: 'lmstudio' };
  const selected = map[selectedProvider];
  if (!selected) return null; // cloud model — nothing to steer
  const cur = engines.find((e) => e.id === selected);
  if (cur?.running) return null; // selected engine is fine
  const alternatives = engines.filter((e) => e.running && e.modelCount > 0).sort((a, b) => b.modelCount - a.modelCount);
  return alternatives[0] ?? null;
}

// ─── One model at a time: free the others when you switch engines ─────────────
// Most self-hosters can't hold two models in VRAM at once, so switching engines
// has to evict the previous one or the new one OOM-crashes. These helpers do that
// eviction; lib/app-settings' multiModel turns it off for machines that can cope.

/** Provider -> engine id. Cloud providers map to null (no local memory to free). */
export function engineForProvider(provider: string): EngineId | null {
  return provider === 'llama' || provider === 'ollama' || provider === 'lmstudio' ? provider : null;
}

/** Unload every model Ollama currently holds in memory. Returns how many. */
export async function unloadAllOllama(): Promise<number> {
  try {
    const ps = await fetch(`${OLLAMA_BASE_URL}/api/ps`, { signal: AbortSignal.timeout(2500) });
    if (!ps.ok) return 0;
    const data = await ps.json();
    const names = ((data.models ?? []) as Array<{ name?: string; model?: string }>)
      .map((m) => m.name ?? m.model).filter((n): n is string => Boolean(n));
    let n = 0;
    for (const name of names) {
      try {
        // keep_alive 0 tells Ollama to drop the model from memory right away.
        await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: name, prompt: '', stream: false, keep_alive: 0 }),
          signal: AbortSignal.timeout(8000),
        });
        n++;
      } catch { /* best effort */ }
    }
    return n;
  } catch { return 0; }
}

/** Free every local engine except `target`. Returns human labels of what we freed. */
export async function freeEnginesExcept(target: EngineId | null): Promise<string[]> {
  const freed: string[] = [];
  if (target !== 'llama') {
    const st = llamaSupervisor.status();
    if (st.running && st.managing) { await llamaSupervisor.stop(); freed.push('llama.cpp'); }
  }
  if (target !== 'ollama') {
    const n = await unloadAllOllama();
    if (n > 0) freed.push(`Ollama (${n})`);
  }
  // LM Studio has no remote-unload endpoint; its model stays until unloaded in
  // the app. Nothing to do here besides leave it be.
  return freed;
}

/** Make sure the supervised llama.cpp server is up, (re)starting it at the
 *  biggest context this machine can back for its model. */
export async function ensureLlamaActive(): Promise<void> {
  if (!llamaSupervisor.enabled) return;
  if ((await liveProps()).online) return; // already serving
  const cfg = await readRuntimeEnv();
  const modelPath = await resolveModelPath(cfg);
  let ctx = cfg.ctx ?? 8192;
  if (modelPath) {
    try {
      const [hw, size] = await Promise.all([detectHardware(), fs.stat(modelPath).then((s) => s.size)]);
      ctx = maxContextForModel(size, hw);
    } catch { /* fall back to saved/default ctx */ }
  }
  await llamaSupervisor.restart({ model: modelPath ?? undefined, ctx });
}

function activeEngineStore(): typeof globalThis & { __chakorActiveEngine?: EngineId | null } {
  return globalThis as typeof globalThis & { __chakorActiveEngine?: EngineId | null };
}
export function lastActiveEngine(): EngineId | null | undefined {
  return activeEngineStore().__chakorActiveEngine;
}

/**
 * Make `target` the one live local engine: evict the others, and if the target
 * is llama.cpp, bring it up at max context. No-op eviction for cloud targets
 * (they use no local memory, so we leave local engines as they are).
 */
export async function activateEngine(target: EngineId | null): Promise<{ freed: string[]; llamaStarted: boolean }> {
  const freed = await freeEnginesExcept(target);
  let llamaStarted = false;
  if (target === 'llama') {
    const wasOnline = (await liveProps()).online;
    await ensureLlamaActive();
    llamaStarted = !wasOnline && (await liveProps()).online;
  }
  activeEngineStore().__chakorActiveEngine = target;
  return { freed, llamaStarted };
}
