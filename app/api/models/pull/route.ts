import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { OLLAMA_BASE_URL } from '@/lib/models';
import type { Session } from 'next-auth';

function requireAdmin(session: Session | null) {
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(session.user as unknown as { isAdmin?: boolean }).isAdmin)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

/**
 * Pull an Ollama model from the registry: POST /api/models/pull { name }
 * Admin only (it downloads to the shared server). Ollama streams newline-
 * delimited JSON progress; we re-emit it as SSE so the UI can show a bar.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const deny = requireAdmin(session);
  if (deny) return deny;

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'model name required' }, { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
      signal: req.signal,
    });
  } catch {
    return NextResponse.json({ error: 'Could not reach Ollama. Is it running?' }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return NextResponse.json({ error: `Ollama ${upstream.status}: ${text.slice(0, 200)}` }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Ollama emits newline-delimited JSON, one progress object per line.
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try { send(JSON.parse(trimmed)); } catch { /* skip partial */ }
          }
        }
        if (buffer.trim()) { try { send(JSON.parse(buffer.trim())); } catch { /* ignore */ } }
      } catch (e) {
        const isAbort = e instanceof Error && (e.name === 'AbortError' || e.message.includes('aborted'));
        if (!isAbort) send({ error: e instanceof Error ? e.message : 'pull failed' });
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
