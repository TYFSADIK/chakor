import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { OLLAMA_BASE_URL } from '@/lib/models';
import { sseStream } from '@/lib/sse';
import { logger, errText } from '@/lib/logger';
import type { Session } from 'next-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600; // big pulls take a while; don't cut the stream

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

  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();

  const stream = sseStream(async (sink) => {
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
          try { if (!sink.send(JSON.parse(trimmed))) return; } catch { /* skip partial */ }
        }
      }
      if (buffer.trim()) { try { sink.send(JSON.parse(buffer.trim())); } catch { /* ignore */ } }
    } catch (e) {
      const isAbort = e instanceof Error && (e.name === 'AbortError' || e.message.includes('aborted'));
      if (!isAbort) {
        logger.error('ollama pull stream failed', { name, err: errText(e) });
        sink.send({ error: 'The model pull failed. Check that Ollama is running and try again.' });
      }
    } finally {
      reader.releaseLock();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Without this, nginx and tunnels like cloudflared buffer the whole stream
      // and the progress bar sits frozen until the pull finishes. This is the
      // usual reason "Ollama pull doesn't work" — it was working, just invisible.
      'X-Accel-Buffering': 'no',
    },
  });
}
