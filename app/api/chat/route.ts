import { NextRequest } from 'next/server';
import { requireUser, isAdminSession } from '@/lib/guard';
import { sseStream } from '@/lib/sse';
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
import { llamaEndpoint, resolveChatModel, MASKED_MODEL_ID } from '@/lib/models';
import { buildSystemPrompt, buildResearchPrompt } from '@/lib/system-prompt';
import { engineForProvider, activateEngine, lastActiveEngine, trackChatStart, trackChatEnd } from '@/lib/backends';
import { readAppSettings } from '@/lib/app-settings';
import { logger, errText } from '@/lib/logger';
import { randomUUID } from 'node:crypto';

export async function POST(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof Response) return authd;
  const { session, userId } = authd;

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

  // Payload caps (same band as the /v1 API): without them one request can pile
  // unlimited text and image data into the DB and every provider call.
  const MAX_MESSAGE_CHARS = 20_000;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  // Only keep well-formed image data URLs, and cap the count to keep payloads sane.
  const cleanImages = Array.isArray(images)
    ? images.filter((u) => typeof u === 'string' && u.startsWith('data:image/')).slice(0, 4)
    : [];
  // Approximate decoded size of a base64 data URL: 3 bytes per 4 chars of payload.
  const imageTooBig = cleanImages.some((u) => Math.ceil((u.length - u.indexOf(',') - 1) * 0.75) > MAX_IMAGE_BYTES);
  if (imageTooBig) {
    return new Response(JSON.stringify({ error: 'image too large (max 5 MB each)' }), {
      status: 413, headers: { 'Content-Type': 'application/json' },
    });
  }
  const text = typeof message === 'string' ? message.trim() : '';
  const toolIds = Array.isArray(tools) ? tools.filter((t): t is string => typeof t === 'string') : [];

  if (text.length > MAX_MESSAGE_CHARS) {
    return new Response(JSON.stringify({ error: `message too long (max ${MAX_MESSAGE_CHARS} chars)` }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!text && cleanImages.length === 0) {
    return new Response(JSON.stringify({ error: 'message required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Resolve model. Non-admins are pinned to the server's default model whatever
  // id they send (they only ever see the synthetic "Chakor" entry), so a
  // hand-crafted request can't select or probe a specific real model.
  const admin = isAdminSession(session);
  const selectedModel = resolveChatModel(modelId, admin);
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
    // Store the masked id for non-admins so their own conversation list never
    // reveals which real model served the chat.
    createConversation(convId, userId, admin ? selectedModel.id : MASKED_MODEL_ID);
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

  let userMsgId: number;
  try {
    userMsgId = addMessage(convId, 'user', text, cleanImages.length ? cleanImages : undefined);
  } catch (e) {
    // The conversation was deleted between the ownership check and this insert
    // (FK constraint fails) — treat it as gone rather than a 500.
    if (e instanceof Error && e.message.includes('FOREIGN KEY constraint failed')) {
      return new Response(JSON.stringify({ error: 'conversation not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    throw e;
  }

  let systemPrompt = useDeepResearch ? buildResearchPrompt() : buildSystemPrompt();
  // Recall: fold the user's saved memories into the system prompt so the
  // assistant carries context across conversations.
  const mems = memoriesForPrompt(userId);
  if (mems.length) {
    systemPrompt += `\n\n## What you remember about ${session.user?.name ?? 'the user'}\n`
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

  const stream = sseStream(async (sink) => {
    sink.send({ userMsgId });
    if (searchSources.length > 0) sink.send({ sources: searchSources });
    for (const s of researchSteps) sink.send({ toolEvent: s });

    try {
      const deltaStream = useTools
        ? runAgent({
            model: selectedModel,
            messages: chatMessages,
            toolIds,
            userId,
            signal: req.signal,
            onStats: (stats) => sink.send({ stats }),
            onTool: (e) => sink.send({ toolEvent: e }),
          })
        : streamForModel({
            modelId: selectedModel.id,
            messages: chatMessages,
            system: systemPrompt,
            contextSize: ctxSize,
            // Research briefings should be factual, not creative.
            temperature: useDeepResearch ? 0.4 : undefined,
            signal: req.signal,
            onStats: (stats) => sink.send({ stats }),
          });

      for await (const delta of deltaStream) {
        fullResponse += delta;
        // Best-effort backpressure: if the client reads slower than the model
        // produces, yield a tick before piling more into the queue.
        if (sink.desiredSize !== null && sink.desiredSize <= 0) {
          await new Promise<void>((r) => setImmediate(r));
        }
        if (!sink.send({ delta })) break; // client disconnected mid-stream
      }
    } catch (err: unknown) {
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
      if (!isAbort) {
        // The real error can contain internals — log it server-side, send a
        // generic message to the browser.
        logger.error('chat stream failed', { model: selectedModel.id, provider: selectedModel.provider, err: errText(err) });
        sink.send({ error: 'The model failed to respond. Please try again or switch models.' });
      }
    } finally {
      endTracking();
      if (fullResponse) {
        try {
          // Persist the sources alongside the reply so reloads and shared
          // conversations can render the same source cards that were streamed.
          const assistantMsgId = addMessage(
            finalConvId, 'assistant', fullResponse, undefined,
            searchSources.length ? searchSources : undefined,
          );
          sink.send({ assistantMsgId });
        } catch (e) {
          // Conversation deleted mid-stream: the reply still reached the user,
          // there is just nothing left to save it to.
          if (!(e instanceof Error && e.message.includes('FOREIGN KEY constraint failed'))) throw e;
        }
        if (isFirstMessage) {
          generateTitle(llamaEndpoint(), text || 'Image')
            .then((title) => updateConversationTitle(finalConvId, userId, title))
            .catch(() => {});
        }
      }
    }
  }, endTracking);

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
