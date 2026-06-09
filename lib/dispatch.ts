import type { ChatMessage, LlamaStats } from './llama';
import { streamChat } from './llama';
import { streamOpenAI, streamAnthropic, streamGoogle, streamOpenRouter, streamOllama, streamLmStudio } from './providers';
import { getModel, llamaEndpoint, defaultModel } from './models';

export interface DispatchOptions {
  modelId?: string;
  messages: ChatMessage[];
  /** System prompt, needed separately by Anthropic and Google. */
  system: string;
  /**
   * Effective context length in tokens, from the UI's context control. Trims old
   * history to fit (so the model "remembers" exactly this much), and for Ollama
   * also resizes the model's real context window via num_ctx.
   */
  contextSize?: number;
  signal?: AbortSignal;
  onStats?: (s: LlamaStats) => void;
}

/** Rough token estimate: ~4 chars/token for text, a flat cost per image. */
function estimateTokens(content: ChatMessage['content']): number {
  if (typeof content === 'string') return Math.ceil(content.length / 4);
  let n = 0;
  for (const part of content) {
    if (part.type === 'text') n += Math.ceil(part.text.length / 4);
    else n += 512; // images don't map to text tokens cleanly; reserve a chunk
  }
  return n;
}

/**
 * Keep the system message and the newest turns that fit the context budget,
 * dropping the oldest. Reserve room for the reply so a full window doesn't leave
 * nothing to generate. This is what makes the context control honest for every
 * provider, not just the ones with a server-side knob.
 */
function trimToContext(messages: ChatMessage[], contextSize?: number): ChatMessage[] {
  if (!contextSize || contextSize <= 0) return messages;
  const reserve = Math.min(2048, Math.floor(contextSize / 4));
  const budget = Math.max(512, contextSize - reserve);

  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  let used = system.reduce((n, m) => n + estimateTokens(m.content), 0);

  const kept: ChatMessage[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimateTokens(rest[i].content);
    // Always keep the most recent message even if it alone is over budget.
    if (kept.length > 0 && used + cost > budget) break;
    used += cost;
    kept.unshift(rest[i]);
  }
  return [...system, ...kept];
}

/**
 * One place that turns a model id + messages into a token stream, picking the
 * right provider. Both the chat UI route and the OpenAI-compatible /v1 endpoint
 * go through here so they never drift apart.
 */
export function streamForModel(opts: DispatchOptions): AsyncGenerator<string> {
  const { modelId, system, signal, onStats, contextSize } = opts;
  const model = (modelId ? getModel(modelId) : null) ?? defaultModel();
  const messages = trimToContext(opts.messages, contextSize);

  switch (model.provider) {
    case 'openai':
      return streamOpenAI(messages, model.id, signal, onStats);
    case 'anthropic':
      return streamAnthropic(messages, model.id, system, signal, onStats);
    case 'google':
      return streamGoogle(messages, model.id, system, signal, onStats);
    case 'openrouter':
      return streamOpenRouter(messages, model.id, signal, onStats);
    case 'ollama':
      return streamOllama(messages, model.id.replace(/^ollama:/, ''), signal, onStats, contextSize);
    case 'lmstudio':
      return streamLmStudio(messages, model.id.replace(/^lmstudio:/, ''), signal, onStats);
    default:
      return streamChat({
        model: llamaEndpoint(),
        messages,
        signal,
        temperature: 0.75,
        top_p: 0.95,
        top_k: 60,
        min_p: 0.02,
        repeat_penalty: 1.0,
        max_tokens: 8192,
        onStats,
      });
  }
}
