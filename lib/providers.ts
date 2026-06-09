import type { ChatMessage, ContentPart, LlamaStats } from './llama';

// Re-export for use in chat route
export type { ChatMessage };

type StatsCb = (s: LlamaStats) => void;

// OpenAI, Ollama, OpenRouter and llama.cpp all eat the `{type:'image_url'}`
// parts array as-is. Anthropic and Google use their own shapes, so we translate
// just for them. A data URL looks like: data:image/png;base64,iVBORw0K...
const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/s;

function toAnthropicContent(content: string | ContentPart[]) {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    const m = DATA_URL_RE.exec(part.image_url.url);
    if (m) return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
    return { type: 'image', source: { type: 'url', url: part.image_url.url } };
  });
}

function toGoogleParts(content: string | ContentPart[]) {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((part) => {
    if (part.type === 'text') return { text: part.text };
    const m = DATA_URL_RE.exec(part.image_url.url);
    if (m) return { inline_data: { mime_type: m[1], data: m[2] } };
    return { text: '' };
  });
}

// Shared SSE reader for OpenAI-compatible streams (llama.cpp + OpenAI + Ollama
// + OpenRouter). Emits token stats when the upstream reports usage (or, for
// llama.cpp, its native timings). We never fabricate numbers: if usage is
// missing, no stats are sent.
async function* readOpenAISSE(
  res: Response,
  onStats?: StatsCb,
): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const start = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let emittedNative = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
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
          if (typeof delta === 'string' && delta.length > 0) yield delta;
          if (parsed.usage) {
            completionTokens = parsed.usage.completion_tokens ?? completionTokens;
            promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
          }
          // llama.cpp reports its own measured timings — prefer those.
          if (parsed.timings && onStats) {
            onStats({
              promptTokens: parsed.timings.prompt_n ?? parsed.usage?.prompt_tokens ?? 0,
              generationTokens: parsed.timings.predicted_n ?? parsed.usage?.completion_tokens ?? 0,
              generationMs: parsed.timings.predicted_ms ?? 0,
              tokensPerSecond: parsed.timings.predicted_per_second ?? 0,
            });
            emittedNative = true;
          }
        } catch { /* malformed frame */ }
      }
    }
  } finally {
    if (onStats && !emittedNative && completionTokens > 0) {
      const ms = Date.now() - start;
      onStats({
        promptTokens,
        generationTokens: completionTokens,
        generationMs: ms,
        tokensPerSecond: ms > 0 ? completionTokens / (ms / 1000) : 0,
      });
    }
    reader.releaseLock();
  }
}

export async function* streamOpenAI(
  messages: ChatMessage[],
  modelId: string,
  signal?: AbortSignal,
  onStats?: StatsCb,
): AsyncGenerator<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, messages, stream: true, stream_options: { include_usage: true } }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
  }

  yield* readOpenAISSE(res, onStats);
}

export async function* streamOllama(
  messages: ChatMessage[],
  modelId: string,
  signal?: AbortSignal,
  onStats?: StatsCb,
  numCtx?: number,
): AsyncGenerator<string> {
  const base = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';

  // Ollama exposes an OpenAI-compatible endpoint, so we can reuse the same reader.
  // num_ctx actually resizes the model's context window per request — this is what
  // makes the UI's "context length" control real for Ollama models.
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(numCtx && numCtx > 0 ? { options: { num_ctx: Math.round(numCtx) } } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 300)}`);
  }

  yield* readOpenAISSE(res, onStats);
}

export async function* streamOpenRouter(
  messages: ChatMessage[],
  modelId: string,
  signal?: AbortSignal,
  onStats?: StatsCb,
): AsyncGenerator<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      // OpenRouter uses these for attribution / rankings (optional but recommended).
      'HTTP-Referer': process.env.APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:3001',
      'X-Title': process.env.APP_NAME ?? 'Chakor',
    },
    body: JSON.stringify({ model: modelId, messages, stream: true, stream_options: { include_usage: true } }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }

  // OpenRouter is OpenAI-compatible — reuse the same SSE reader.
  yield* readOpenAISSE(res, onStats);
}

export async function* streamAnthropic(
  messages: ChatMessage[],
  modelId: string,
  system: string,
  signal?: AbortSignal,
  onStats?: StatsCb,
): AsyncGenerator<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const userAssistantMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: toAnthropicContent(m.content) }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 8192,
      system,
      messages: userAssistantMessages,
      stream: true,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const start = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const evt of events) {
        const line = evt.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            const t = parsed.delta.text;
            if (typeof t === 'string' && t.length > 0) yield t;
          }
          // Anthropic reports input tokens at start, cumulative output at each delta.
          if (parsed.type === 'message_start') promptTokens = parsed.message?.usage?.input_tokens ?? promptTokens;
          if (parsed.usage?.output_tokens) completionTokens = parsed.usage.output_tokens;
          if (parsed.type === 'message_stop') return;
        } catch { /* skip */ }
      }
    }
  } finally {
    if (onStats && completionTokens > 0) {
      const ms = Date.now() - start;
      onStats({ promptTokens, generationTokens: completionTokens, generationMs: ms, tokensPerSecond: ms > 0 ? completionTokens / (ms / 1000) : 0 });
    }
    reader.releaseLock();
  }
}

export async function* streamGoogle(
  messages: ChatMessage[],
  modelId: string,
  system: string,
  signal?: AbortSignal,
  onStats?: StatsCb,
): AsyncGenerator<string> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not configured');

  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: toGoogleParts(m.content),
    }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${apiKey}&alt=sse`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: 8192, temperature: 0.7 },
      }),
      signal,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google AI ${res.status}: ${text.slice(0, 300)}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const start = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const evt of events) {
        const line = evt.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof text === 'string' && text.length > 0) yield text;
          if (parsed.usageMetadata) {
            promptTokens = parsed.usageMetadata.promptTokenCount ?? promptTokens;
            completionTokens = parsed.usageMetadata.candidatesTokenCount ?? completionTokens;
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    if (onStats && completionTokens > 0) {
      const ms = Date.now() - start;
      onStats({ promptTokens, generationTokens: completionTokens, generationMs: ms, tokensPerSecond: ms > 0 ? completionTokens / (ms / 1000) : 0 });
    }
    reader.releaseLock();
  }
}
