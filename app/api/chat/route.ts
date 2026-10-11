import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getConversation,
  createConversation,
  addMessage,
  listMessages,
  updateConversationTitle,
  getChunksForUser,
  memoriesForPrompt,
} from '@/lib/db';
import { generateTitle } from '@/lib/llama';
import { streamForModel } from '@/lib/dispatch';
import type { ChatMessage, ContentPart } from '@/lib/llama';
import { runAgent, supportsTools } from '@/lib/agent';
import { searxSearch, formatSearchContext } from '@/lib/searxng';
import { runDeepResearch } from '@/lib/research';
import { bm25Search, formatRagContext } from '@/lib/rag';
import { getModel, llamaEndpoint, defaultModel } from '@/lib/models';
import { buildSystemPrompt, buildResearchPrompt } from '@/lib/system-prompt';
import { engineForProvider, activateEngine, lastActiveEngine, trackChatStart, trackChatEnd } from '@/lib/backends';
import { readAppSettings } from '@/lib/app-settings';
import { logger, errText } from '@/lib/logger';
import { randomUUID } from 'node:crypto';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }
  const userId = (session.user as unknown as { id: number }).id;

  const body = await req.json().catch(() => null);
  if (!body) {
    return new Response(JSON.stringify({ error: 'invalid body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { conversationId, message, useSearch, useRag, modelId, useDeepResearch, images, tools, contextSize } = body as {
    conversationId?: string;
    message: string;
    useSearch?: boolean;
    useRag?: boolean;
    modelId?: string;
    useDeepResearch?: boolean;
    images?: string[];
    tools?: string[];
    contextSize?: number;
  };

  // Effective context length chosen in the UI. Clamp to a sane band; the dispatch
  // layer trims history to fit and passes it to providers that can resize live.
  const ctxSize = typeof contextSize === 'number' && contextSize > 0
    ? Math.min(1_000_000, Math.max(512, Math.round(contextSize)))
    : undefined;

  // Only keep well-formed image data URLs, and cap the count to keep payloads sane.
  const cleanImages = Array.isArray(images)
    ? images.filter((u) => typeof u === 'string' && u.startsWith('data:image/')).slice(0, 4)
    : [];
  const text = typeof message === 'string' ? message.trim() : '';
  const toolIds = Array.isArray(tools) ? tools.filter((t): t is string => typeof t === 'string') : [];

  if (!text && cleanImages.length === 0) {
    return new Response(JSON.stringify({ error: 'message required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Resolve model — fall back to default local model
  const selectedModel = (modelId ? getModel(modelId) : null) ?? defaultModel();
  const useTools = toolIds.length > 0 && supportsTools(selectedModel);

  // One model at a time (unless the user allows multiple): if this message uses a
  // different local engine than the last one, evict the others first so the new
  // model has room instead of OOM-crashing. Skips instantly when nothing changed,
  // and never blocks the chat on its own failure.
  try {
    const target = engineForProvider(selectedModel.provider);
    if (target && target !== lastActiveEngine() && !(await readAppSettings()).multiModel) {
      await activateEngine(target);
    }
  } catch { /* best effort */ }

  // Resolve or create conversation
  let convId = conversationId;
  let isNewConv = false;
  if (convId) {
    const conv = getConversation(convId, userId);
    if (!conv) {
      return new Response(JSON.stringify({ error: 'conversation not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    convId = randomUUID();
    createConversation(convId, userId, selectedModel.id);
    isNewConv = true;
  }

  // Cap history load — the dispatch layer trims to fit context anyway.
  const priorMessages = listMessages(convId, 200);
  const isFirstMessage = priorMessages.length === 0;

  // Build user content — RAG → Deep Research / Search → plain
  let userContent = text;
  let searchSources: { title: string; url: string; snippet?: string }[] = [];
  const researchSteps: { name: string; args: string; result: string }[] = [];

  if (useRag) {
    try {
      const allChunks = getChunksForUser(userId);
      if (allChunks.length > 0) {
        const relevant = bm25Search(userContent, allChunks, 6);
        if (relevant.length > 0) userContent = formatRagContext(relevant) + userContent;
      }
    } catch { /* non-fatal */ }
  }

  if (useDeepResearch || useSearch) {
    try {
      if (useDeepResearch) {
        // Full pipeline: plan angles -> search them all -> read the strongest
        // pages in full -> build a cited context block. Progress steps are
        // streamed to the UI as tool chips so the user sees the work happen.
        const research = await runDeepResearch(text, {
          model: selectedModel,
          onStep: (s) => researchSteps.push(s),
        });
        if (research.context) {
          searchSources = research.sources;
          userContent = research.context + userContent;
        }
      } else {
        const results = await searxSearch(text, 10).catch(() => []);
        if (results.length > 0) {
          searchSources = results.map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
          userContent = formatSearchContext(text, results) + userContent;
        }
      }
    } catch { /* non-fatal */ }
  }

  const userMsgId = addMessage(convId, 'user', text, cleanImages.length ? cleanImages : undefined);

  let systemPrompt = useDeepResearch ? buildResearchPrompt() : buildSystemPrompt();
  // Recall: fold the user's saved memories into the system prompt so the
  // assistant carries context across conversations.
  const mems = memoriesForPrompt(userId);
  if (mems.length) {
    systemPrompt += `\n\n## What you remember about ${session.user.name ?? 'the user'}\n`
      + `Saved facts to use when relevant. Do not mention or list these unless asked.\n`
      + mems.map((m) => `- ${m}`).join('\n');
  }

  // When images are attached, the user turn becomes OpenAI-style content parts.
  const userMessageContent: string | ContentPart[] = cleanImages.length
    ? [
        ...(userContent.trim() ? [{ type: 'text' as const, text: userContent }] : []),
        ...cleanImages.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ]
    : userContent;

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...priorMessages
      .filter((m) => m.role !== 'system')
      .map((m): ChatMessage => ({
        role: m.role as 'user' | 'assistant',
        content: m.images && m.images.length
          ? [
              ...(m.content.trim() ? [{ type: 'text' as const, text: m.content }] : []),
              ...m.images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
            ]
          : m.content,
      })),
    { role: 'user', content: userMessageContent },
  ];

  const encoder = new TextEncoder();
  let fullResponse = '';
  const finalConvId = convId;

  // Register this stream so engine switching never evicts a backend mid-generation
  // (which would truncate this reply and save it as if complete).
  trackChatStart();
  let trackEnded = false;
  const endTracking = () => {
    if (trackEnded) return;
    trackEnded = true;
    trackChatEnd();
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      send({ userMsgId });
      if (searchSources.length > 0) send({ sources: searchSources });
      for (const s of researchSteps) send({ toolEvent: s });

      try {
        const deltaStream = useTools
          ? runAgent({
              model: selectedModel,
              messages: chatMessages,
              toolIds,
              userId,
              signal: req.signal,
              onStats: (stats) => send({ stats }),
              onTool: (e) => send({ toolEvent: e }),
            })
          : streamForModel({
              modelId: selectedModel.id,
              messages: chatMessages,
              system: systemPrompt,
              contextSize: ctxSize,
              // Research briefings should be factual, not creative.
              temperature: useDeepResearch ? 0.4 : undefined,
              signal: req.signal,
              onStats: (stats) => send({ stats }),
            });

        for await (const delta of deltaStream) {
          fullResponse += delta;
          // Best-effort backpressure: if the client reads slower than the model
          // produces, yield a tick before piling more into the queue.
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            await new Promise<void>((r) => setImmediate(r));
          }
          send({ delta });
        }
      } catch (err: unknown) {
        const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
        if (!isAbort) {
          // The real error can contain internals — log it server-side, send a
          // generic message to the browser.
          logger.error('chat stream failed', { model: selectedModel.id, provider: selectedModel.provider, err: errText(err) });
          send({ error: 'The model failed to respond. Please try again or switch models.' });
        }
      } finally {
        endTracking();
        if (fullResponse) {
          const assistantMsgId = addMessage(finalConvId, 'assistant', fullResponse);
          send({ assistantMsgId });
          if (isFirstMessage) {
            generateTitle(llamaEndpoint(), text || 'Image')
              .then((title) => updateConversationTitle(finalConvId, userId, title))
              .catch(() => {});
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
    cancel() {
      // Client disconnected before consuming everything — release the slot.
      endTracking();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Conversation-Id': finalConvId,
      'X-New-Conversation': isNewConv ? '1' : '0',
    },
  });
}
