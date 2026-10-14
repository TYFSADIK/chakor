/**
 * Image generation orchestration on top of stable-diffusion.cpp's sd-server
 * (see lib/sd-server.ts for the HTTP client and lib/sd-supervisor.ts for the
 * process supervisor).
 *
 * The image model is an Iris-architecture pixel-space DiT in GGUF (default:
 * Sakura-Iris-3B), with a Qwen3-VL text encoder — ComfyUI cannot run it.
 *
 * The chat model (llama.cpp) and sd-server share one GPU. On a card with
 * 12+ GB VRAM (or a unified-memory machine with 32+ GB RAM) both can stay
 * resident: 'parallel'. Below that, 'swap': the chat model is stopped while
 * an image generates, then brought back. IMAGE_ENGINE_MODE=swap|parallel
 * forces the choice; auto decides from the hardware.
 *
 * Server-only. The pure pieces (mode decision, settings parsing, model
 * listing) are exported separately so tests never need a live engine.
 */
import { promises as fs } from 'node:fs';
import { exec } from 'node:child_process';
import * as path from 'node:path';
import { getSetting, setSetting, imageGenerationsToday, recordImageGeneration, IMAGE_GEN_DAILY_LIMIT } from './db';
import type { Hardware } from './hardware';
import { chatInflightCount, ensureLlamaActive, setImageSwapActive } from './backends';
import { llamaSupervisor } from './llama-supervisor';
import { sdSupervisor } from './sd-supervisor';
import { ImageGenError, ENCODER_RE, sanitizeGgufName, modelsHome, getModelKinds } from './sd-server';
import { logger, errText } from './logger';

export { ImageGenError };
export { sanitizeGgufName } from './sd-server';

// ─── Admin settings (app_settings table) ─────────────────────────
// Off by default: no user can generate images until an admin flips it on.
const SETTING_ENABLED = 'image_gen_enabled';
const SETTING_ALLOWLIST = 'image_gen_allowlist';
const SETTING_MODEL = 'image_model';

export interface ImageGenSettings {
  enabled: boolean;
  /** User ids allowed to generate (admins are always allowed). */
  allowlist: number[];
}

export function readImageGenSettings(): ImageGenSettings {
  const enabled = getSetting(SETTING_ENABLED) === 'true';
  let allowlist: number[] = [];
  try {
    const raw = JSON.parse(getSetting(SETTING_ALLOWLIST) ?? '[]');
    if (Array.isArray(raw)) allowlist = raw.filter((n): n is number => Number.isInteger(n) && n > 0);
  } catch { /* treat corrupt value as empty */ }
  return { enabled, allowlist };
}

export function isImageGenAllowed(userId: number, isAdmin: boolean): boolean {
  const s = readImageGenSettings();
  if (!s.enabled) return false;
  return isAdmin || s.allowlist.includes(userId);
}

/** Remaining allowance today. Admins run the hardware — never limited. */
export function imageGenRemaining(userId: number, isAdmin = false): number {
  if (isAdmin) return Number.POSITIVE_INFINITY;
  return Math.max(0, IMAGE_GEN_DAILY_LIMIT - imageGenerationsToday(userId));
}

export { IMAGE_GEN_DAILY_LIMIT, imageGenerationsToday, recordImageGeneration };

// ─── Swap vs. parallel (pure) ────────────────────────────────────
export type ImageMode = 'swap' | 'parallel';

export function decideImageMode(hw: Hardware, envMode?: string): ImageMode {
  const m = (envMode ?? process.env.IMAGE_ENGINE_MODE ?? 'auto').trim().toLowerCase();
  if (m === 'parallel') return 'parallel';
  if (m === 'swap') return 'swap';
  if (hw.unifiedMemory && hw.totalRamGb >= 32) return 'parallel';
  if ((hw.gpuVramGb ?? 0) >= 12) return 'parallel';
  return 'swap';
}

/**
 * Image generation is refused only when the machine has no accelerator at
 * all — a small GPU is slow (minutes per image), not disqualified.
 */
export function hardwareCanAttemptImageGen(hw: Hardware): boolean {
  return hw.hasGpu || hw.unifiedMemory;
}

// ─── Quality presets (admin-selectable) ──────────────────────────
// Iris is trained at 1024² and smaller sizes show patch artifacts, so
// 'quality' is the default; fast/balanced trade fidelity for speed on
// small cards. The admin-panel choice (image_quality setting) wins over
// the IMAGE_DEFAULT_SIZE / IMAGE_DEFAULT_STEPS env overrides.
export type ImageQuality = 'fast' | 'balanced' | 'quality';

export const IMAGE_QUALITY_PRESETS: Record<ImageQuality, { width: number; height: number; steps: number }> = {
  fast:     { width: 512,  height: 512,  steps: 12 },
  balanced: { width: 768,  height: 768,  steps: 20 },
  quality:  { width: 1024, height: 1024, steps: 30 },
};

export const IMAGE_QUALITIES = Object.keys(IMAGE_QUALITY_PRESETS) as ImageQuality[];

export function isImageQuality(v: unknown): v is ImageQuality {
  return typeof v === 'string' && (IMAGE_QUALITIES as string[]).includes(v);
}

/** The admin's chosen preset (default 'quality'). */
export function imageQuality(): ImageQuality {
  const v = getSetting('image_quality');
  return isImageQuality(v) ? v : 'quality';
}

export function defaultImageSize(mode: ImageMode): { width: number; height: number } {
  const q = getSetting('image_quality');
  if (isImageQuality(q)) {
    const p = IMAGE_QUALITY_PRESETS[q];
    return { width: p.width, height: p.height };
  }
  const raw = process.env.IMAGE_DEFAULT_SIZE;
  if (raw) {
    const m = /^(\d{2,4})\s*x\s*(\d{2,4})$/i.exec(raw.trim());
    if (m) return { width: Number(m[1]), height: Number(m[2]) };
  }
  return { width: 1024, height: 1024 };
}

export function defaultImageSteps(): number {
  const q = getSetting('image_quality');
  if (isImageQuality(q)) return IMAGE_QUALITY_PRESETS[q].steps;
  const n = Number(process.env.IMAGE_DEFAULT_STEPS);
  return Number.isFinite(n) && n > 0 ? Math.min(100, Math.floor(n)) : 30;
}

/**
 * Rough render-time estimate in seconds, shown as the ETA in the chat bubble.
 * Calibrated on a 4 GB GTX 1650 Ti in swap mode (~28 min for quality);
 * big cards in parallel mode are an order of magnitude faster. Honest
 * ballpark, not a promise — the client shows it as "≈".
 */
export function estimateImageSeconds(mode: ImageMode, q: ImageQuality): number {
  const table: Record<ImageMode, Record<ImageQuality, number>> = {
    swap:     { fast: 240, balanced: 840, quality: 1800 },
    parallel: { fast: 30,  balanced: 75,  quality: 150 },
  };
  return table[mode][q];
}

// ─── Image model management (GGUF files in the shared models folder) ───
// Preference order when no admin choice is saved: Q8_0 is measurably clean,
// Q4_K_M is the smaller/faster but visibly lossy fallback.
export const DEFAULT_IMAGE_MODELS = [
  'Sakura-Iris-3B-Q8_0-4.15GiB.gguf',
  'Sakura-Iris-3B-Q4_K_M-3.14GiB.gguf',
];

/** Diffusion models and the Qwen3-VL text encoder share one directory. */
export function imageModelsDir(): string {
  return modelsHome();
}

export interface ImageModelFile { name: string; size: number }

/**
 * Diffusion-model GGUFs only. A file tagged chat/encoder via the admin
 * upload is never listed; untagged files keep the legacy heuristic (anything
 * not encoder-shaped counts) so pre-tagging installs are unaffected.
 */
export async function listImageModels(): Promise<ImageModelFile[]> {
  try {
    const kinds = getModelKinds();
    const out: ImageModelFile[] = [];
    for (const f of await fs.readdir(imageModelsDir())) {
      if (!f.toLowerCase().endsWith('.gguf') || f.endsWith('.part')) continue;
      const tagged = kinds[f];
      if (tagged ? tagged !== 'image' : ENCODER_RE.test(f)) continue;
      const st = await fs.stat(path.join(imageModelsDir(), f));
      if (st.isFile()) out.push({ name: f, size: st.size });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function imageModelPath(name: string): string {
  return path.join(imageModelsDir(), name);
}

/** The active image model: the admin's choice if it still exists, else the
 *  best-quality Sakura default present, else the first model found. */
export async function getActiveImageModel(): Promise<string | null> {
  const models = await listImageModels();
  if (models.length === 0) return null;
  const saved = getSetting(SETTING_MODEL);
  if (saved && models.some((m) => m.name === saved)) return saved;
  for (const preferred of DEFAULT_IMAGE_MODELS) {
    const hit = models.find((m) => m.name === preferred);
    if (hit) return hit.name;
  }
  return models[0].name;
}

/** Persist the admin's model choice (callers validate existence first). */
export function setActiveImageModel(name: string): void {
  const clean = sanitizeGgufName(name);
  if (!clean) throw new Error('invalid model name');
  setSetting(SETTING_MODEL, clean);
}

// ─── GPU handoff helpers ─────────────────────────────────────────
// Before a swap, wait for any in-flight chat streams to finish so a reply
// is never killed mid-generation.
export async function waitForChatIdle(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (chatInflightCount() > 0) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return true;
}

const NVIDIA_SMI_CMD = 'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits';

function runCmd(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 5000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** Parse `nvidia-smi --query-gpu=memory.used,memory.total` csv output ("1234, 8192"). */
export function parseNvidiaSmiMem(out: string): { usedMb: number; totalMb: number } {
  const m = /(\d+)\s*,\s*(\d+)/.exec(out);
  if (!m) throw new Error('unparseable nvidia-smi output');
  return { usedMb: Number(m[1]), totalMb: Number(m[2]) };
}

/**
 * sd-server takes seconds to release GPU memory after SIGTERM; starting the
 * chat model into still-held VRAM crashes it (llama_params_fit abort). Poll
 * nvidia-smi until at least minFreeMb is free, give up after timeoutMs (log
 * and proceed — better a risky restore than none). Without nvidia-smi there
 * is nothing to poll, so wait a fixed 5 s grace period instead.
 */
export async function waitForVramFree(minFreeMb = 2500, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let freeMb: number;
    try {
      const { usedMb, totalMb } = parseNvidiaSmiMem(await runCmd(NVIDIA_SMI_CMD));
      freeMb = totalMb - usedMb;
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
      return;
    }
    if (freeMb >= minFreeMb) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  logger.warn('VRAM still held after the wait window; restoring the chat model anyway', { minFreeMb });
}

// ─── Active job tracking (for the cancel endpoint) ───────────────
// Client disconnect no longer cancels a generation (it runs to completion
// and persists), so the cancel endpoint needs to find the live sd-server
// job by conversation.
export interface ActiveImageJob { jobId: string; startedAt: number }

const activeImageJobs = new Map<string, ActiveImageJob>();

export function trackImageJob(convId: string, jobId: string): void {
  activeImageJobs.set(convId, { jobId, startedAt: Date.now() });
}

export function getActiveImageJob(convId: string): ActiveImageJob | null {
  return activeImageJobs.get(convId) ?? null;
}

export function clearImageJob(convId: string, jobId?: string): void {
  if (!jobId || activeImageJobs.get(convId)?.jobId === jobId) activeImageJobs.delete(convId);
}

// One image job at a time, process-wide: the GPU can't run two diffusion
// runs, and two swaps would stop/start llama out from under each other.
let imageMutex: Promise<void> = Promise.resolve();

export async function withImageMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = imageMutex;
  let release!: () => void;
  imageMutex = new Promise<void>((r) => { release = r; });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export type ImageJobPhase = 'preparing' | 'restoring';

/**
 * Run one image job with the GPU choreography the mode demands, holding the
 * image mutex for the whole job.
 *
 * swap: wait for in-flight chats to finish → raise the swap flag (chat
 * requests get a friendly "image busy" answer instead of restarting llama
 * into occupied VRAM) → stop the llama server → start sd-server with the
 * text encoder on CPU → run the job → stop sd-server → lower the flag →
 * bring llama back (best effort, logged, never thrown back into the job).
 *
 * parallel: just make sure sd-server is up (no --clip-on-cpu) and run the
 * job; llama is never touched.
 */
export async function runImageJob<T>(
  mode: ImageMode,
  modelPath: string,
  fn: () => Promise<T>,
  onPhase?: (phase: ImageJobPhase) => void,
): Promise<T> {
  return withImageMutex(async () => {
    if (mode === 'parallel') {
      const res = await sdSupervisor.ensureRunning({ lowvram: false, modelPath });
      if (!res.ok) throw new ImageGenError(res.error ?? 'The image engine failed to start.');
      return await fn();
    }
    onPhase?.('preparing');
    await waitForChatIdle(30_000);
    // From here until sd-server is stopped the GPU belongs to the image job:
    // the flag tells every other path (chat, engine switching) not to restart
    // llama into occupied VRAM.
    setImageSwapActive(true);
    try {
      await llamaSupervisor.stop();
      try {
        const res = await sdSupervisor.ensureRunning({ lowvram: true, modelPath });
        if (!res.ok) throw new ImageGenError(res.error ?? 'The image engine failed to start.');
        return await fn();
      } finally {
        onPhase?.('restoring');
        try {
          await sdSupervisor.stop();
        } catch (e) {
          logImageGenError('sd-server stop after swap', e);
        }
        // sd-server releases VRAM seconds after SIGTERM; wait for it before
        // the chat model starts loading or it crashes on occupied memory.
        await waitForVramFree();
        // The GPU is free again — clear the flag before bringing llama back,
        // since ensureLlamaActive refuses to start while a swap is flagged.
        setImageSwapActive(false);
        try {
          await ensureLlamaActive();
        } catch (e) {
          logImageGenError('llama restore after swap', e);
        }
      }
    } finally {
      setImageSwapActive(false);
    }
  });
}

/** Convenience for the generate route: enabled/allowlist/daily-limit checks. */
export async function preflight(userId: number, isAdmin: boolean): Promise<
  | { ok: true; remaining: number }
  | { ok: false; status: number; error: string }
> {
  const settings = readImageGenSettings();
  if (!settings.enabled) {
    return { ok: false, status: 403, error: 'Image generation is turned off. An admin can enable it in the admin panel.' };
  }
  if (!isAdmin && !settings.allowlist.includes(userId)) {
    return { ok: false, status: 403, error: 'Image generation is not enabled for your account.' };
  }
  const remaining = imageGenRemaining(userId, isAdmin);
  if (remaining <= 0) {
    return { ok: false, status: 429, error: `Daily image limit reached (${IMAGE_GEN_DAILY_LIMIT}/day). Try again tomorrow.` };
  }
  return { ok: true, remaining };
}

export function logImageGenError(context: string, e: unknown): void {
  logger.error(context, { err: errText(e) });
}
