import { describe, it, expect, afterEach } from 'vitest';
import { maskedModel, resolveChatModel, defaultModel, MASKED_MODEL_ID } from '@/lib/models';

// lib/models reads process.env at call time, so tests can flip LLAMA_MODEL to
// prove the real model name never reaches the masked shapes.
const ORIG = { ...process.env };
afterEach(() => { process.env = { ...ORIG }; });

describe('maskedModel (the single entry non-admins see)', () => {
  it('is a synthetic "chakor" entry', () => {
    const m = maskedModel();
    expect(m.id).toBe(MASKED_MODEL_ID);
    expect(m.provider).toBe('chakor');
  });

  it('never contains the real model name', () => {
    process.env.LLAMA_MODEL = 'Qwen3.5-4B-Q4_K_M.gguf';
    delete process.env.NEXT_PUBLIC_APP_NAME;
    delete process.env.APP_NAME;
    const m = maskedModel();
    expect(m.id).toBe('chakor');
    expect(m.name).toBe('Chakor');
    expect(JSON.stringify(m)).not.toContain('Qwen');
  });
});

describe('resolveChatModel', () => {
  it('pins non-admins to the default model whatever id they send', () => {
    process.env.LLAMA_MODEL = 'Qwen3.5-4B-Q4_K_M.gguf';
    const def = defaultModel();
    // Including a hand-crafted real model name and the synthetic masked id.
    for (const id of [undefined, 'chakor', 'Qwen3.5-4B-Q4_K_M.gguf', 'ollama:qwen3:8b', 'gpt-4o']) {
      expect(resolveChatModel(id, false).id, String(id)).toBe(def.id);
    }
  });

  it('lets admins select any resolvable model', () => {
    const m = resolveChatModel('ollama:qwen3:8b', true);
    expect(m.provider).toBe('ollama');
    expect(m.name).toBe('qwen3:8b');
  });

  it('falls back to the default for admins when the id is missing or unknown', () => {
    expect(resolveChatModel(undefined, true).id).toBe(defaultModel().id);
    expect(resolveChatModel('no-such-model', true).id).toBe(defaultModel().id);
  });
});
