import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { streamForModel } from '@/lib/dispatch';
import { getModel, defaultModel } from '@/lib/models';
import { buildSystemPrompt } from '@/lib/system-prompt';
import type { ChatMessage } from '@/lib/llama';

/**
 * Compare run: stream one prompt through one model, no conversation, no DB.
 * The Compare page opens several of these in parallel, one per model, and lays
 * the answers out side by side. Deliberately bare: same system prompt for every
 * model so the comparison is fair.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const modelId = typeof body?.modelId === 'string' ? body.modelId : undefined;
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'prompt required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const model = (modelId ? getModel(modelId) : null) ?? defaultModel();
  const system = buildSystemPrompt();
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const deltas = streamForModel({
          modelId: model.id,
          messages,
          system,
          signal: req.signal,
          onStats: (s) => send({ stats: s }),
        });
        for await (const d of deltas) send({ delta: d });
      } catch (err: unknown) {
        const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
        if (!isAbort) send({ error: err instanceof Error ? err.message : String(err) });
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
