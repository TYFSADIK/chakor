import type { ModelEndpoint } from './models';
export type { ModelEndpoint };

/**
 * A piece of message content. Plain text uses the string form of ChatMessage;
 * when images are attached we switch to the OpenAI-style parts array. Most
 * backends (llama.cpp, OpenAI, Ollama, OpenRouter) take this format directly;
 * Anthropic and Google get converted in providers.ts.
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface LlamaStats {
  promptTokens: number;
  generationTokens: number;
  generationMs: number;
  tokensPerSecond: number;
}

export interface ChatOptions {
  model: ModelEndpoint;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repeat_penalty?: number;
  max_tokens?: number;
  signal?: AbortSignal;
  onStats?: (stats: LlamaStats) => void;
}

/**
 * Stream a chat completion from llama-server.
 *
 * We hit /v1/chat/completions (NOT /completion) so llama.cpp applies
 * the model's own chat template. This is what the built-in web UI does
 * and is why responses feel correct.
 *
 * We DO NOT inject any system prompt by default. If the caller passes one
 * in `messages`, it's used; otherwise the model runs "naked" like the
 * built-in UI does.
 */
export async function* streamChat(opts: ChatOptions): AsyncGenerator<string> {
  const body = {
    // llama-server accepts any model name; it uses whatever is loaded
    model: opts.model.label,
    messages: opts.messages,
    stream: true,
    temperature: opts.temperature ?? 0.8,
    top_p: opts.top_p ?? 0.95,
    top_k: opts.top_k ?? 60,
    min_p: opts.min_p ?? 0.02,
    // llama.cpp uses "repeat_penalty" in its native API; OpenAI uses
    // "frequency_penalty" / "presence_penalty". llama-server accepts both
    // on /v1/chat/completions. We send the llama native one.
    repeat_penalty: opts.repeat_penalty ?? 1.0,
    // Explicit large cap avoids ambiguous -1 behaviour in some llama.cpp builds
    max_tokens: opts.max_tokens ?? 8192,
  };

  const res = await fetch(`${opts.model.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`llama.cpp error ${res.status}: ${text.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by \n\n
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const evt of events) {
        const line = evt.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            yield delta;
          }
          if (parsed.timings && opts.onStats) {
            opts.onStats({
              promptTokens: parsed.timings.prompt_n ?? parsed.usage?.prompt_tokens ?? 0,
              generationTokens: parsed.timings.predicted_n ?? parsed.usage?.completion_tokens ?? 0,
              generationMs: parsed.timings.predicted_ms ?? 0,
              tokensPerSecond: parsed.timings.predicted_per_second ?? 0,
            });
          }
        } catch {
          // skip malformed frames
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Generate a short conversation title from the first user message.
 * Single non-streaming request, tiny max_tokens.
 */
export async function generateTitle(
  model: ModelEndpoint,
  firstUserMessage: string,
): Promise<string> {
  try {
    const res = await fetch(`${model.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.label,
        messages: [
          {
            role: 'user',
            content:
              `Generate a 3-6 word title for a chat that starts with this message. ` +
              `Reply with ONLY the title, no quotes, no punctuation at the end.\n\n` +
              `Message: ${firstUserMessage.slice(0, 400)}`,
          },
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: 20,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return firstUserMessage.slice(0, 40);
    const json = await res.json();
    const title = (json.choices?.[0]?.message?.content ?? '').trim();
    return title.replace(/^["'`]|["'`.]$/g, '').slice(0, 60) || firstUserMessage.slice(0, 40);
  } catch {
    return firstUserMessage.slice(0, 40);
  }
}
