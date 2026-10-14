import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { streamForModel } from '@/lib/dispatch';
import { resolveChatModel } from '@/lib/models';
import { isAdminSession } from '@/lib/guard';
import { getSetting } from '@/lib/db';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { sseStream } from '@/lib/sse';
import { logger, errText } from '@/lib/logger';
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

  // Non-admins are pinned to the server's default model whatever id they send.
  const model = resolveChatModel(modelId, isAdminSession(session));
  const system = buildSystemPrompt({ customInstructions: getSetting('custom_instructions') ?? undefined });
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ];

  const stream = sseStream(async (sink) => {
    try {
      const deltas = streamForModel({
        modelId: model.id,
        messages,
        system,
        signal: req.signal,
        onStats: (s) => sink.send({ stats: s }),
      });
      for await (const d of deltas) {
        if (!sink.send({ delta: d })) break;
      }
    } catch (err: unknown) {
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
      if (!isAbort) {
        // Raw provider errors can contain internal endpoints and paths — log
        // the detail, send the client a generic message.
        logger.error('compare stream failed', { model: model.id, provider: model.provider, err: errText(err) });
        sink.send({ error: 'The model failed to respond. Please try again or switch models.' });
      }
    }
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
