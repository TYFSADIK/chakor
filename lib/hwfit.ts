/**
 * Will this model actually run on this machine? Given a GGUF's real on-disk size
 * (Chakor already stat()s every model file) and the detected hardware, decide
 * whether it fits comfortably, is tight, or is too big and would crash.
 *
 * This is the heart of the "stop llama.cpp from OOM-crashing on small laptops"
 * fix: the picker can mark a 4 GB model red on a 4 GB laptop before the user ever
 * loads it. Inspired by odysseus' services/hwfit/fit.py, but simpler and more
 * accurate for the self-host case because we measure the file instead of guessing
 * from a parameter-count catalog.
 *
 * Server-only (consumes lib/hardware). The numbers are deliberately a touch
 * conservative: better to warn just before a real out-of-memory than just after.
 */
import type { Hardware } from './hardware';

export type FitLevel = 'fits' | 'tight' | 'too_big' | 'unknown';

export interface ModelFit {
  level: FitLevel;
  /** Estimated memory to run the model at `atCtx` tokens of context, in GB. */
  neededGb: number;
  /** Comfortable budget (fits entirely here = fast). */
  budgetGb: number;
  /** Hard ceiling. Above this the machine runs out of memory and llama.cpp dies. */
  ceilingGb: number;
  atCtx: number;
  /** Largest context that still stays inside the comfortable budget (0 = none). */
  maxFitCtx: number;
  /** Would it run entirely on the GPU (vs. spilling to system RAM / CPU). */
  onGpu: boolean;
  /** One-line, plain-language explanation for the UI. */
  reason: string;
}

const GB = 1_000_000_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Memory the model needs resident to run at a given context length.
 *   weights  — the GGUF is already quantized on disk, so its size is the weights.
 *   kv cache — grows with context and (loosely) model size.
 *   overhead — compute buffers + runtime, a flat reserve.
 */
export function estimateNeededGb(sizeBytes: number, ctx: number): number {
  const weights = sizeBytes / GB;
  const kv = (Math.max(ctx, 512) / 4096) * Math.max(0.25, weights * 0.1);
  const overhead = 0.5;
  return round1(weights + kv + overhead);
}

/** The comfortable budget and the hard out-of-memory ceiling for this machine. */
export function memoryBudget(hw: Hardware): { comfortable: number; ceiling: number; place: 'gpu' | 'ram' } {
  // Discrete GPU: everything-on-GPU (VRAM) is the fast/comfortable path; the real
  // OOM wall is host RAM, since llama.cpp can spill layers to it (just slower).
  if (hw.hasGpu && !hw.unifiedMemory && hw.gpuVramGb && hw.gpuVramGb > 0) {
    return { comfortable: hw.gpuVramGb, ceiling: Math.max(hw.totalRamGb, hw.gpuVramGb), place: 'gpu' };
  }
  // Unified memory (Apple Silicon / AMD APU): one shared pool. The detected
  // "VRAM" is the working set; keep a little back for the OS.
  if (hw.hasGpu && hw.unifiedMemory && hw.gpuVramGb && hw.gpuVramGb > 0) {
    return { comfortable: hw.gpuVramGb, ceiling: round1(hw.totalRamGb * 0.92), place: 'gpu' };
  }
  // CPU only: comfortable = what's free now, ceiling = total RAM.
  return { comfortable: hw.availableRamGb, ceiling: hw.totalRamGb, place: 'ram' };
}

const CTX_LADDER = [2048, 4096, 8192, 16384, 32768, 65536, 131072];

/** Largest context whose estimate stays within `budget` (>= 2048, else 0). */
function largestCtxWithin(sizeBytes: number, budget: number): number {
  let best = 0;
  for (const c of CTX_LADDER) {
    if (estimateNeededGb(sizeBytes, c) <= budget) best = c;
    else break;
  }
  return best;
}

/** Score one model file against the machine at a reference context length. */
export function fitModel(sizeBytes: number, hw: Hardware, ctx = 4096): ModelFit {
  if (!sizeBytes || sizeBytes <= 0) {
    return {
      level: 'unknown', neededGb: 0, budgetGb: 0, ceilingGb: 0, atCtx: ctx,
      maxFitCtx: 0, onGpu: false, reason: 'Size unknown',
    };
  }
  const { comfortable, ceiling, place } = memoryBudget(hw);
  const needed = estimateNeededGb(sizeBytes, ctx);
  const maxFitCtx = largestCtxWithin(sizeBytes, comfortable);

  let level: FitLevel;
  let reason: string;
  const onGpu = place === 'gpu' && needed <= comfortable;

  if (needed <= comfortable * 0.9) {
    level = 'fits';
    reason = place === 'gpu' ? `Runs on the GPU (~${needed} GB)` : `Fits in RAM (~${needed} GB)`;
  } else if (needed <= ceiling) {
    level = 'tight';
    reason = place === 'gpu'
      ? `Too big for ${round1(comfortable)} GB VRAM — runs partly on CPU, slower`
      : `Tight: ~${needed} GB of ${round1(ceiling)} GB, close to the limit`;
  } else {
    level = 'too_big';
    reason = `Needs ~${needed} GB but this machine has ${round1(ceiling)} GB — it will run out of memory`;
  }

  return {
    level,
    neededGb: needed,
    budgetGb: round1(comfortable),
    ceilingGb: round1(ceiling),
    atCtx: ctx,
    maxFitCtx,
    onGpu,
    reason,
  };
}

/**
 * Best model to default to on this machine: the largest file that still fits
 * comfortably (biggest usually means highest quality). Falls back to the
 * smallest "tight" one if nothing fits cleanly, so there's always a suggestion.
 */
export function recommendedModelPath(
  models: { path: string; size: number }[],
  hw: Hardware,
): string | null {
  if (!models.length) return null;
  const scored = models.map((m) => ({ ...m, fit: fitModel(m.size, hw) }));
  const fits = scored.filter((m) => m.fit.level === 'fits').sort((a, b) => b.size - a.size);
  if (fits.length) return fits[0].path;
  const tight = scored.filter((m) => m.fit.level === 'tight').sort((a, b) => a.size - b.size);
  if (tight.length) return tight[0].path;
  return null;
}

/** A safe context length to load a given model at on this machine. */
export function recommendedCtx(sizeBytes: number, hw: Hardware, want = 8192): number {
  const { comfortable } = memoryBudget(hw);
  const max = largestCtxWithin(sizeBytes, comfortable);
  if (max <= 0) return 2048; // nothing comfortable; smallest sensible window
  return Math.min(want, max);
}

/**
 * The biggest context this machine can actually back for a given model, using
 * all available memory (VRAM if the model fits there, otherwise system RAM for
 * the KV cache). This is what "context = maximum your hardware allows" loads at.
 */
export function maxContextForModel(sizeBytes: number, hw: Hardware): number {
  const fit = fitModel(sizeBytes, hw);
  const { comfortable, ceiling } = memoryBudget(hw);
  // GPU-resident model: KV must share VRAM with the weights. CPU/offload model:
  // KV lives in system RAM, so budget against the (larger) RAM ceiling.
  const budget = (fit.onGpu ? comfortable : ceiling) * 0.92;
  const max = largestCtxWithin(sizeBytes, budget);
  return Math.min(Math.max(max || 2048, 2048), 32768);
}

/**
 * Can this machine comfortably hold more than one local model in memory at once?
 * Used to decide whether to even offer the "keep multiple models loaded" option.
 * A roomy GPU (or lots of RAM on a CPU box) can; a modest laptop cannot, so it
 * gets the safe one-model-at-a-time default.
 */
export function canRunMultipleModels(hw: Hardware): boolean {
  if (hw.hasGpu && !hw.unifiedMemory && hw.gpuVramGb) return hw.gpuVramGb >= 16;
  if (hw.unifiedMemory && hw.gpuVramGb) return hw.gpuVramGb >= 24; // shared pool, keep headroom
  return hw.totalRamGb >= 32; // CPU-only
}
