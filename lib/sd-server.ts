/**
 * HTTP client for stable-diffusion.cpp's sd-server — the image engine.
 *
 * sd-server speaks an async job API: POST /sdcpp/v1/img_gen returns a job id,
 * GET /sdcpp/v1/jobs/<id> polls it to a terminal state, and the finished
 * image comes back inline as base64 PNG. No local files are exchanged with
 * the engine; the caller saves the bytes into the conversation workspace.
 *
 * Server-only. The request-body builder is pure and exported for tests.
 */
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { getSetting, setSetting } from './db';

// ─── Configuration ───────────────────────────────────────────────
export function sdUrl(): string {
  return (process.env.SDCPP_URL ?? 'http://127.0.0.1:8190').replace(/\/+$/, '');
}

export function sdPort(): number {
  const m = /:(\d+)(?:\/|$)/.exec(sdUrl());
  return m ? Number(m[1]) : 8190;
}

/** The stable-diffusion.cpp checkout; models live in <dir>/models/. */
export function sdDir(): string {
  return process.env.SDCPP_DIR ?? path.join(os.homedir(), 'stable-diffusion.cpp');
}

/** GGUFs that are text encoders, not diffusion models (they share one dir). */
export const ENCODER_RE = /qwen3vl|mmproj|encoder/i;

/** GGUFs that are pixel-space diffusion models, not chat models. */
export const DIFFUSION_RE = /sakura-iris|iris-3b|flux|stable-diffusion|\bsd[-_]?xl|diffusion/i;

/** The admin/env-configured models folder, or null when unset. */
export function configuredModelsHome(): string | null {
  const saved = getSetting('models_home');
  if (saved && path.isAbsolute(saved)) return saved;
  const env = process.env.CHAKOR_MODEL_HOME;
  if (env && path.isAbsolute(env)) return env;
  return null;
}

/**
 * The one folder every GGUF lives in — chat models, diffusion models, and
 * text encoders together. Order: the admin's panel choice (app_settings), then
 * CHAKOR_MODEL_HOME, then the legacy default <SDCPP_DIR>/models. Chat model
 * scanning (lib/local-llama.ts) always includes this folder.
 */
export function modelsHome(): string {
  return configuredModelsHome() ?? path.join(sdDir(), 'models');
}

/** Persist the admin's models-folder choice (callers validate first). */
export function setModelsHome(dir: string): void {
  setSetting('models_home', dir);
}

export type ModelKind = 'chat' | 'image' | 'encoder';

/** Best-effort kind guess from a file name; chat when nothing matches. */
export function guessModelKind(name: string): ModelKind {
  if (ENCODER_RE.test(name)) return 'encoder';
  if (DIFFUSION_RE.test(name)) return 'image';
  return 'chat';
}

/** Stored kind overrides: { "<file>.gguf": "chat" | "image" | "encoder" }. */
export function getModelKinds(): Record<string, ModelKind> {
  try {
    const raw = getSetting('model_kinds');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, ModelKind> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === 'chat' || v === 'image' || v === 'encoder') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function setModelKind(name: string, kind: ModelKind | null): void {
  const kinds = getModelKinds();
  if (kind === null) delete kinds[name];
  else kinds[name] = kind;
  setSetting('model_kinds', JSON.stringify(kinds));
}

/** Basename-only .gguf names; anything else (traversal, separators) is null. */
export function sanitizeGgufName(name: string): string | null {
  if (typeof name !== 'string') return null;
  const base = path.basename(name);
  if (base !== name || base.startsWith('.') || !base.toLowerCase().endsWith('.gguf')) return null;
  return base;
}

export interface EncoderFile { name: string; size: number }

/** Text-encoder GGUFs in the models folder (Qwen3-VL, mmproj, …). */
export function listEncoders(): EncoderFile[] {
  const dir = modelsHome();
  const kinds = getModelKinds();
  try {
    const out: EncoderFile[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.gguf') || f.endsWith('.part')) continue;
      const tagged = kinds[f];
      if (tagged ? tagged !== 'encoder' : !ENCODER_RE.test(f)) continue;
      const st = fs.statSync(path.join(dir, f));
      if (st.isFile()) out.push({ name: f, size: st.size });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Text encoder (Qwen3-VL) for the Iris pipeline. SDCPP_ENCODER wins; otherwise
 * auto-discover one in the models dir, preferring the Sakura-matched
 * uncensored encoder, then the stock instruct build, then anything
 * encoder-shaped.
 */
export function sdEncoderPath(): string {
  if (process.env.SDCPP_ENCODER) return process.env.SDCPP_ENCODER;
  const dir = modelsHome();
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.gguf') && !f.endsWith('.part'));
  } catch { /* dir missing — fall through to the legacy default */ }
  for (const re of [/sakura.*textencoder/i, /qwen3vl-4b-instruct/i, /qwen3vl|textencoder|mmproj/i]) {
    const hit = files.find((f) => re.test(f));
    if (hit) return path.join(dir, hit);
  }
  return path.join(dir, 'Qwen3VL-4B-Instruct-Q4_K_M.gguf');
}

const SETTING_ENCODER = 'image_encoder';

/**
 * The encoder actually used: the admin's panel choice when it still exists on
 * disk, else the env/auto-discovery default. Takes effect on the next render
 * (the engine loads the encoder at spawn).
 */
export function resolveEncoderPath(): string {
  const saved = getSetting(SETTING_ENCODER);
  if (saved) {
    const clean = sanitizeGgufName(saved);
    if (clean) {
      const p = path.join(modelsHome(), clean);
      if (fs.existsSync(p)) return p;
    }
  }
  return sdEncoderPath();
}

/** Persist the admin's encoder choice (callers validate existence first). */
export function setActiveEncoder(name: string): void {
  const clean = sanitizeGgufName(name);
  if (!clean) throw new Error('invalid encoder name');
  setSetting(SETTING_ENCODER, clean);
}

export class ImageGenError extends Error {}

// ─── Request builder (pure) ──────────────────────────────────────
// Iris sampling recommendations: dpm++2m, CFG 3, 20–30 steps, dimensions in
// multiples of 16, at most 1024×1024.
export interface ImgGenOpts {
  prompt: string;
  width: number;
  height: number;
  steps?: number;
  /** -1 = random. */
  seed?: number;
  /** sd.cpp preview mode: 'none' | 'proj' | 'tae' | 'vae'. Default SDCPP_PREVIEW or 'proj'. */
  preview?: string;
}

/** Live-preview mode for in-progress renders; SDCPP_PREVIEW overrides. */
export function defaultPreviewMode(): string {
  const v = (process.env.SDCPP_PREVIEW ?? 'proj').trim().toLowerCase();
  return ['none', 'proj', 'tae', 'vae'].includes(v) ? v : 'proj';
}

function clampDim(n: number): number {
  if (!Number.isFinite(n)) return 512;
  return Math.min(1024, Math.max(16, Math.floor(n / 16) * 16));
}

function clampSteps(n: number | undefined): number {
  if (!Number.isFinite(n)) return 20;
  return Math.min(50, Math.max(1, Math.floor(n as number)));
}

export interface ImgGenRequest {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  seed: number;
  batch_count: number;
  sample_params: {
    sample_method: string;
    sample_steps: number;
    guidance: { txt_cfg: number };
  };
  preview: string;
  preview_interval: number;
  output_format: string;
}

export function buildImgGenRequest(opts: ImgGenOpts): ImgGenRequest {
  return {
    prompt: opts.prompt,
    negative_prompt: '',
    width: clampDim(opts.width),
    height: clampDim(opts.height),
    seed: Number.isFinite(opts.seed) ? Math.floor(opts.seed as number) : -1,
    batch_count: 1,
    sample_params: {
      sample_method: 'dpm++2m',
      sample_steps: clampSteps(opts.steps),
      guidance: { txt_cfg: 3 },
    },
    preview: opts.preview ?? defaultPreviewMode(),
    preview_interval: 1,
    output_format: 'png',
  };
}

// ─── Client ──────────────────────────────────────────────────────
export interface SdCapabilities {
  supported_modes?: string[];
  [key: string]: unknown;
}

/** Health/discovery probe. Null when the server is down. */
export async function sdCapabilities(): Promise<SdCapabilities | null> {
  try {
    const r = await fetch(`${sdUrl()}/sdcpp/v1/capabilities`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    return (await r.json()) as SdCapabilities;
  } catch {
    return null;
  }
}

/** Submit an img_gen job. Returns the job id. */
export async function submitImgGen(body: ImgGenRequest, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${sdUrl()}/sdcpp/v1/img_gen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new ImageGenError('cancelled');
    throw new ImageGenError('Could not reach the image engine — is sd-server running?');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ImageGenError(`The image engine rejected the request (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new ImageGenError('The image engine did not return a job id.');
  return data.id;
}

interface SdJob {
  id: string;
  status: 'queued' | 'generating' | 'completed' | 'failed' | 'cancelled' | string;
  result?: { images?: Array<{ b64_json?: string }> } | null;
  error?: { message?: string } | null;
  preview?: { pass?: number; step?: number; total_steps?: number; b64_json?: string } | null;
}

const POLL_INTERVAL_MS = 2000;
// A 1024px/30-step job takes ~30 minutes on a 4 GB card, so the hard cap must
// be generous. The stall watchdog only arms once the engine has reported real
// step progress — sd-server with `preview: 'none'` (our default) never does,
// and there a flat "no progress" timer would kill every healthy slow job.
// IMAGE_JOB_TIMEOUT_MINUTES overrides the hard cap.
const HARD_TIMEOUT_MIN = (() => {
  const n = Number(process.env.IMAGE_JOB_TIMEOUT_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 45;
})();
const STALL_TIMEOUT_MS = 5 * 60_000;

/** Ask sd-server to cancel a job. Best effort; never throws. */
export async function cancelJob(id: string): Promise<void> {
  try {
    await fetch(`${sdUrl()}/sdcpp/v1/jobs/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* best effort */ }
}

export interface SdJobResult {
  bytes: Buffer;
  /** Last observed sampling step progress, for progress display. */
  steps: { step: number; total: number } | null;
}

/**
 * Poll a job to its terminal state. Completed resolves with the PNG bytes;
 * failed/cancelled/timeout throw ImageGenError. When the caller's signal
 * fires, the job is cancelled server-side before throwing 'cancelled'.
 * onProgress fires on every new step or new preview frame; previewB64 is the
 * engine's latest in-progress PNG (base64) when the job runs with a preview
 * mode, undefined otherwise.
 */
export async function pollJob(
  id: string,
  signal?: AbortSignal,
  onProgress?: (step: number, total: number, previewB64?: string) => void,
): Promise<SdJobResult> {
  const hardDeadline = Date.now() + HARD_TIMEOUT_MIN * 60_000;
  let lastAdvanceAt = Date.now();
  let lastStep = 0;
  let lastPreview: string | undefined;
  let sawProgress = false;
  let lastSteps: SdJobResult['steps'] = null;
  try {
    for (;;) {
      if (signal?.aborted) throw new ImageGenError('cancelled');
      if (Date.now() > hardDeadline) throw new ImageGenError(`The image engine took too long (${HARD_TIMEOUT_MIN} minutes). Try a smaller size or fewer steps.`);
      if (sawProgress && Date.now() - lastAdvanceAt > STALL_TIMEOUT_MS) throw new ImageGenError('The image engine stopped making progress. It may be stuck — try again.');

      let job: SdJob | undefined;
      try {
        const res = await fetch(`${sdUrl()}/sdcpp/v1/jobs/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(5000) });
        if (res.status === 404 || res.status === 410) throw new ImageGenError('The image job vanished from the engine.');
        if (res.ok) job = (await res.json()) as SdJob;
      } catch (e) {
        if (e instanceof ImageGenError) throw e;
        // transient network error — keep polling
      }

      if (job) {
        const p = job.preview;
        if (p?.step && p?.total_steps) {
          lastSteps = { step: p.step, total: p.total_steps };
          sawProgress = true;
          const stepChanged = p.step > lastStep;
          if (stepChanged) {
            lastStep = p.step;
            lastAdvanceAt = Date.now();
          }
          // Only forward when something actually changed — preview frames are
          // ~1 MB, no sense re-streaming an identical one every poll.
          const b64 = p.b64_json || undefined;
          if (stepChanged || b64 !== lastPreview) {
            onProgress?.(p.step, p.total_steps, b64);
            lastPreview = b64;
          }
        }
        if (job.status === 'completed') {
          const b64 = job.result?.images?.[0]?.b64_json;
          if (!b64) throw new ImageGenError('The image engine finished but returned no image.');
          return { bytes: Buffer.from(b64, 'base64'), steps: lastSteps };
        }
        if (job.status === 'failed') {
          throw new ImageGenError(job.error?.message ?? 'The image engine failed to generate.');
        }
        if (job.status === 'cancelled') throw new ImageGenError('cancelled');
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } finally {
    if (signal?.aborted) void cancelJob(id);
  }
}
