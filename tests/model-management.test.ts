import { describe, it, expect } from 'vitest';
import { isVisionModel } from '@/lib/models';
import { sanitizeRepoFile, matchingMmproj } from '@/lib/huggingface';
import { buildLlamaArgs } from '@/lib/local-llama';

describe('isVisionModel', () => {
  it('recognizes the newer vision families', () => {
    for (const name of [
      'gemma-4-E2B-it-Q4_K_M.gguf',
      'gemma-3-4b-it-q4_k_m',
      'qwen2-vl-7b-instruct',
      'Qwen2.5-VL-3B-Instruct-Q8_0.gguf',
      'qwen3-vl-8b',
      'llava-1.6-mistral-7b',
      'pixtral-12b',
      'MiniCPM-V-2_6',
    ]) {
      expect(isVisionModel(name), name).toBe(true);
    }
  });

  it('does not flag plain text models', () => {
    for (const name of ['qwen3-4b-instruct', 'llama-3.1-8b', 'mistral-7b-v0.3', 'gemma-2-9b-it']) {
      expect(isVisionModel(name), name).toBe(false);
    }
  });
});

describe('sanitizeRepoFile', () => {
  it('allows up to 3 subdirectory levels', () => {
    expect(sanitizeRepoFile('model.gguf')).toBe('model.gguf');
    expect(sanitizeRepoFile('q4/model.gguf')).toBe('q4/model.gguf');
    expect(sanitizeRepoFile('a/b/c/model.gguf')).toBe('a/b/c/model.gguf');
    expect(sanitizeRepoFile('a/b/c/d/model.gguf')).toBeNull();
  });

  it('rejects traversal, absolute paths, and non-gguf', () => {
    expect(sanitizeRepoFile('../model.gguf')).toBeNull();
    expect(sanitizeRepoFile('a/../../model.gguf')).toBeNull();
    // Leading slashes are normalized away, so this becomes "etc/model.gguf".
    expect(sanitizeRepoFile('/etc/model.gguf')).toBe('etc/model.gguf');
    expect(sanitizeRepoFile('model.bin')).toBeNull();
  });
});

describe('matchingMmproj', () => {
  it('pairs an mmproj with its model by filename stem', () => {
    expect(
      matchingMmproj('gemma-4-E2B-it-Q4_K_M.gguf', [
        'qwen3-8b.mmproj.gguf',
        'gemma-4-E2B-it.mmproj.gguf',
      ]),
    ).toBe('gemma-4-E2B-it.mmproj.gguf');
  });

  it('returns null when several mmprojs share a folder and none matches', () => {
    expect(
      matchingMmproj('qwen3-8b-Q4_K_M.gguf', ['mmproj-model-f16.gguf', 'gemma-4-E2B-it.mmproj.gguf']),
    ).toBeNull();
  });

  it('falls back to a lone mmproj (bartowski-style names)', () => {
    expect(matchingMmproj('gemma-3-4b-it-Q4_K_M.gguf', ['mmproj-model-f16.gguf'])).toBe('mmproj-model-f16.gguf');
  });
});

describe('buildLlamaArgs', () => {
  it('adds chat-template-kwargs only for Qwen3-family models', () => {
    const qwen = buildLlamaArgs({ model: '/models/Qwen3-4B-Q4_K_M.gguf', ctx: 8192 });
    expect(qwen).toContain('--chat-template-kwargs');
    const other = buildLlamaArgs({ model: '/models/gemma-3-4b-it.gguf', ctx: 8192 });
    expect(other).not.toContain('--chat-template-kwargs');
  });
});
