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
  if (!authenticateApiKey(req)) return err('Invalid API key', 401);

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.messages)) return err('messages array required', 400);

  const messages = body.messages as ChatMessage[];
  const modelId: string | undefined = body.model;
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
    return err(e instanceof Error ? e.message : 'model error', 500);
  }

  if (!wantStream) {
    let content = '';
    try {
      for await (const d of deltas) content += d;
    } catch (e) {
      return err(e instanceof Error ? e.message : 'stream error', 500);
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
        if (!isAbort) send({ error: { message: e instanceof Error ? e.message : 'stream error' } });
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
