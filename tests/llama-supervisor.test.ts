import { describe, it, expect } from 'vitest';
import { classifyFailureText } from '@/lib/llama-supervisor';

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
