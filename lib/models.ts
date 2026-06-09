export type ModelProvider = 'llama' | 'ollama' | 'lmstudio' | 'openai' | 'anthropic' | 'google' | 'openrouter';

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';

// LM Studio runs an OpenAI-compatible server (default port 1234). Point Chakor at
// it and whatever models you have loaded there show up automatically, the same
// way Ollama models do. This is the "I already use LM Studio" path.
export const LMSTUDIO_BASE_URL = (process.env.LMSTUDIO_BASE_URL ?? 'http://127.0.0.1:1234/v1').replace(/\/+$/, '');

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  contextWindow: number;
  badge?: string;
  /** Can this model take images, not just text. Drives the attach button. */
  vision?: boolean;
}

// Rough name match for local/Ollama vision models. We can't introspect a GGUF
// for an mmproj, so we go by the well-known families. False negatives just mean
// the attach button is hidden; users on a custom build can set LLAMA_VISION=true.
const VISION_NAME_RE = /llava|bakllava|moondream|minicpm-?v|pixtral|cogvlm|qwen2?\.?5?-?vl|llama-?3\.?2-?vision|granite3?\.?2?-?vision|gemma-?3|vision/i;

export function isVisionModel(name: string): boolean {
  return VISION_NAME_RE.test(name);
}

// Legacy interface kept for lib/llama.ts compatibility
export interface ModelEndpoint {
  id: string;
  label: string;
  url: string;
  description?: string;
}

export function getAvailableModels(): ModelConfig[] {
  const localName = process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? 'Chakor';
  const models: ModelConfig[] = [
    {
      id: process.env.LLAMA_MODEL ?? process.env.CHAKOR_MODEL_ALIAS ?? 'Chakor',
      name: `${localName} (Local)`,
      provider: 'llama',
      contextWindow: Number(process.env.LLAMA_CONTEXT ?? 8192),
      badge: 'LOCAL',
      vision: process.env.LLAMA_VISION === 'true',
    },
  ];

  if (process.env.OPENAI_API_KEY) {
    models.push(
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000, vision: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextWindow: 128000, vision: true },
    );
  }

  if (process.env.ANTHROPIC_API_KEY) {
    models.push(
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'anthropic', contextWindow: 200000, vision: true },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', contextWindow: 200000, vision: true },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', contextWindow: 200000, vision: true },
    );
  }

  if (process.env.GOOGLE_AI_API_KEY) {
    models.push(
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', contextWindow: 1000000, vision: true },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'google', contextWindow: 2000000, vision: true },
    );
  }

  // OpenRouter: one API key, hundreds of models (Llama, DeepSeek, Qwen, Mistral,
  // GPT, Claude, Gemini …). The list is user-defined because the catalog is huge.
  // Format: OPENROUTER_MODELS="id|Display Name, id2|Name 2"
  // e.g. "meta-llama/llama-3.3-70b-instruct|Llama 3.3 70B, deepseek/deepseek-chat|DeepSeek V3"
  if (process.env.OPENROUTER_API_KEY) {
    const raw = process.env.OPENROUTER_MODELS ?? '';
    const parsed = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry): ModelConfig | null => {
        const [id, name] = entry.split('|').map((s) => s.trim());
        return id ? { id, name: name || id, provider: 'openrouter', contextWindow: 0 } : null;
      })
      .filter((m): m is ModelConfig => m !== null);

    if (parsed.length > 0) {
      models.push(...parsed);
    } else {
      // Sensible defaults if the key is set but no list provided.
      models.push(
        { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', provider: 'openrouter', contextWindow: 131072 },
        { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', provider: 'openrouter', contextWindow: 64000 },
        { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', provider: 'openrouter', contextWindow: 131072 },
      );
    }
  }

  return models;
}

export function defaultModel(): ModelConfig {
  return getAvailableModels()[0];
}

export function getModel(id: string): ModelConfig | undefined {
  // Ollama + LM Studio models are discovered at runtime, so synthesize their
  // config from the id prefix instead of looking them up in the static list.
  if (id.startsWith('ollama:')) {
    const name = id.slice('ollama:'.length);
    return { id, name, provider: 'ollama', contextWindow: 0, vision: isVisionModel(name) };
  }
  if (id.startsWith('lmstudio:')) {
    const name = id.slice('lmstudio:'.length);
    return { id, name, provider: 'lmstudio', contextWindow: 0, vision: isVisionModel(name) };
  }
  return getAvailableModels().find((m) => m.id === id);
}

/**
 * Ask the local Ollama server which models are installed. Returns [] fast if
 * Ollama isn't running (connection refused is immediate). This is what lets
 * people run "any model": install Ollama, `ollama pull` whatever they want,
 * and it shows up here automatically.
 */
export async function discoverOllamaModels(): Promise<ModelConfig[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.models ?? []) as Array<{ name?: string }>)
      .map((m) => m.name)
      .filter((n): n is string => Boolean(n))
      .map((name) => ({ id: `ollama:${name}`, name, provider: 'ollama' as const, contextWindow: 0, vision: isVisionModel(name) }));
  } catch {
    return [];
  }
}

/**
 * Ask LM Studio which models it has loaded. Same idea as discoverOllamaModels:
 * returns [] fast if LM Studio's server isn't running. LM Studio exposes the
 * OpenAI-compatible /v1/models endpoint, so one GET lists everything available.
 */
export async function discoverLmStudioModels(): Promise<ModelConfig[]> {
  try {
    const res = await fetch(`${LMSTUDIO_BASE_URL}/models`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.data ?? []) as Array<{ id?: string }>)
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id))
      // LM Studio lists embedding models too; they can't chat, so drop them.
      .filter((id) => !/embed/i.test(id))
      .map((id) => ({ id: `lmstudio:${id}`, name: id, provider: 'lmstudio' as const, contextWindow: 0, vision: isVisionModel(id) }));
  } catch {
    return [];
  }
}

// Returns the local llama.cpp endpoint for lib/llama.ts
export function llamaEndpoint(): ModelEndpoint {
  return {
    id: 'llama',
    label: process.env.LLAMA_MODEL ?? process.env.CHAKOR_MODEL_ALIAS ?? 'Chakor',
    url: process.env.LLAMA_BASE_URL ?? process.env.CHAKOR_MODEL_URL ?? 'http://127.0.0.1:4546',
  };
}
