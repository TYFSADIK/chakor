import { describe, it, expect } from 'vitest';
import { classifyFailureText, nglDegradeLadder } from '@/lib/llama-supervisor';

// Sample stderr tails as llama-server actually prints them before dying. The
// exit code alone is useless ("code=1"), so the classifier works off this text.
describe('classifyFailureText', () => {
  it('detects unknown model architectures', () => {
    expect(classifyFailureText(
      "llama_model_load: error loading model: error loading model architecture: unknown model architecture: 'qwen3moe'",
    )).toBe('unknown_arch');
    expect(classifyFailureText(
      'llama_model_load: error loading model: unsupported model architecture',
    )).toBe('unknown_arch');
    expect(classifyFailureText(
      "error: this architecture is not supported by this build of llama.cpp",
    )).toBe('unknown_arch');
  });

  it('detects out-of-memory failures', () => {
    expect(classifyFailureText(
      'ggml_backend_cuda_buffer_type_alloc_buffer: allocating 5120.00 MiB on device 0: cudaMalloc failed: out of memory',
    )).toBe('out_of_memory');
    expect(classifyFailureText(
      'llama_kv_cache_init: failed to allocate buffer for kv cache\nstd::bad_alloc',
    )).toBe('out_of_memory');
    expect(classifyFailureText('ggml_gallocr_reserve_n: failed to allocate graph buffer (OOM)')).toBe('out_of_memory');
    expect(classifyFailureText('mmap failed: Cannot allocate memory')).toBe('out_of_memory');
  });

  it('detects corrupt or truncated model files', () => {
    expect(classifyFailureText(
      'llama_model_load: error loading model: bad magic',
    )).toBe('corrupt_model');
    expect(classifyFailureText(
      'llama_model_loader: tensor data is corrupt or truncated',
    )).toBe('corrupt_model');
    expect(classifyFailureText(
      'error loading model: unexpected end of file while reading tensor data',
    )).toBe('corrupt_model');
    expect(classifyFailureText('not a valid gguf file')).toBe('corrupt_model');
  });

  it('falls back to unknown for unrecognized crashes', () => {
    expect(classifyFailureText('llama-server exited (code=1 signal=-)')).toBe('unknown');
    expect(classifyFailureText('')).toBe('unknown');
    expect(classifyFailureText('bind: address already in use')).toBe('unknown');
  });

  it('never derives spawn_error from stderr text (that kind is set by the spawn-error path only)', () => {
    expect(classifyFailureText('spawn /usr/local/bin/llama-server ENOENT')).toBe('unknown');
  });

  it('checks architecture before memory and corruption', () => {
    // A tail that mentions both: architecture is the more actionable cause.
    expect(classifyFailureText(
      "unknown model architecture: 'bert'\nfailed to alloc buffer",
    )).toBe('unknown_arch');
  });
});

describe('nglDegradeLadder', () => {
  it('halves down to 0 (CPU-only) from an explicit LLAMA_NGL ceiling', () => {
    expect(nglDegradeLadder(48)).toEqual([24, 12, 6, 3, 1, 0]);
  });

  it('treats the 9999 "all layers" default as starting at a real layer count', () => {
    // Halving 9999 would waste attempts on values no model can reach; the
    // first step down is 99, a typical full layer count.
    expect(nglDegradeLadder(9999)).toEqual([49, 24, 12, 6, 3, 0]);
  });

  it('always ends at 0 even when the rung cap cuts the halving short', () => {
    const ladder = nglDegradeLadder(99);
    expect(ladder[ladder.length - 1]).toBe(0);
    expect(ladder.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThan(ladder[i - 1]);
  });

  it('degrades straight to CPU-only from a single layer', () => {
    expect(nglDegradeLadder(1)).toEqual([0]);
  });

  it('has no ladder when GPU offload was already off', () => {
    expect(nglDegradeLadder(0)).toEqual([]);
  });

  it('rejects nonsense inputs', () => {
    expect(nglDegradeLadder(-5)).toEqual([]);
    expect(nglDegradeLadder(NaN)).toEqual([]);
    expect(nglDegradeLadder(Infinity)).toEqual([]);
  });

  it('never suggests a value above the starting point (LLAMA_NGL is the ceiling)', () => {
    for (const start of [1, 7, 32, 99, 999, 9999]) {
      for (const rung of nglDegradeLadder(start)) expect(rung).toBeLessThan(start);
    }
  });
});
