import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authenticateApiKey } from '@/lib/apiauth';
import { streamForModel } from '@/lib/dispatch';
import type { ChatMessage } from '@/lib/llama';

/**
 * OpenAI-compatible chat completions: POST /v1/chat/completions
 *
 * Point any OpenAI client at http://your-host/v1 with one of the keys you
 * created in Settings, and it talks to whatever model you name, local or cloud.
 * Supports both streaming (stream: true) and a single JSON response.
 *
 * This passes your messages through as-is. It does NOT inject Chakor's chat
 * personality, so the API behaves like a plain model server.
 */
function err(message: string, status: number) {
  return new Response(JSON.stringify({ error: { message, type: 'invalid_request_error' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  const user = authenticateApiKey(req);
  if (!user) return err('Invalid API key', 401);
  // Non-admin keys are pinned to the server's default model and only ever see
  // the masked "chakor" id, so they can't select or probe specific real models.
  const admin = user.is_admin === 1;

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.messages)) return err('messages array required', 400);

  // Shape + size caps (S9): registered keys can otherwise burn cloud quota with
  // unbounded payloads. Content may be a string or a parts array (vision), so
  // accept both and measure the text parts.
  const MAX_MESSAGES = 100;
  const MAX_TOTAL_CHARS = 20_000;
  const messages = body.messages as ChatMessage[];
  if (messages.length > MAX_MESSAGES) return err(`too many messages (max ${MAX_MESSAGES})`, 400);
  let totalChars = 0;
  for (const m of messages) {
    const c = (m as { content?: unknown })?.content;
    if (typeof (m as { role?: unknown })?.role !== 'string') {
      return err('each message must have a string role', 400);
    }
    if (typeof c === 'string') totalChars += c.length;
    else if (Array.isArray(c)) {
      for (const p of c) {
        if (typeof p?.text === 'string') totalChars += p.text.length;
      }
    } else return err('each message must have string content or a content-parts array', 400);
  }
  if (totalChars > MAX_TOTAL_CHARS) return err(`total message content too large (max ${MAX_TOTAL_CHARS} chars)`, 400);

  const modelId: string | undefined = admin ? body.model : undefined;
  const wantStream = body.stream === true;

  // Pull out a system message if the caller sent one (Anthropic/Google need it
  // separately); everything else flows through untouched. Content may be a parts
  // array for vision requests, so flatten any text parts down to a string.
  const sysContent = messages.find((m) => m.role === 'system')?.content;
  const system = typeof sysContent === 'string'
    ? sysContent
    : Array.isArray(sysContent)
      ? sysContent.map((p) => (p.type === 'text' ? p.text : '')).join('')
      : '';

  const id = 'chatcmpl-' + randomUUID();
  const created = Math.floor(Date.now() / 1000);
  const model = modelId ?? 'chakor';

  let deltas: AsyncGenerator<string>;
  try {
    deltas = streamForModel({ modelId, messages, system, signal: req.signal });
  } catch (e) {
    // Do not pass raw error messages to API clients — they can contain
    // internal endpoints or paths. Detail stays in the server log.
    console.error('v1/chat/completions model error:', e);
    return err('The model failed to respond', 500);
  }

  if (!wantStream) {
    let content = '';
    try {
      for await (const d of deltas) content += d;
    } catch (e) {
      console.error('v1/chat/completions stream error:', e);
      return err('The model failed to respond', 500);
    }
    return new Response(
      JSON.stringify({
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
        send({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] });

      try {
        chunk({ role: 'assistant' });
        for await (const d of deltas) chunk({ content: d });
        chunk({}, 'stop');
      } catch (e) {
        const isAbort = e instanceof Error && (e.name === 'AbortError' || e.message.includes('aborted'));
        if (!isAbort) {
          console.error('v1/chat/completions stream error:', e);
          send({ error: { message: 'The model failed to respond' } });
        }
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
