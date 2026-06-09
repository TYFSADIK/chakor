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
import { bm25Search, formatRagContext } from '@/lib/rag';
import { getModel, llamaEndpoint, defaultModel } from '@/lib/models';
import { buildSystemPrompt, buildResearchPrompt } from '@/lib/system-prompt';
import { engineForProvider, activateEngine, lastActiveEngine } from '@/lib/backends';
import { readAppSettings } from '@/lib/app-settings';
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

  const priorMessages = listMessages(convId);
  const isFirstMessage = priorMessages.length === 0;

  // Build user content — RAG → Deep Research / Search → plain
  let userContent = text;
  let searchSources: { title: string; url: string; snippet?: string }[] = [];

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
      let queries = [text];

      if (useDeepResearch) {
        // Plan the research: ask the local model for distinct angles to search,
        // so we cover the topic from several directions instead of one query.
        try {
          const llama = llamaEndpoint();
          const relRes = await fetch(`${llama.url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: llama.label,
              messages: [{
                role: 'user',
                content:
                  `You are planning web research for this question:\n"${text.slice(0, 300)}"\n\n` +
                  `Write 3 distinct, specific search queries that together cover the most important angles ` +
                  `(definitions, current state, comparisons, evidence, criticism). ` +
                  `Return ONLY the queries, one per line, no numbering, no quotes.`,
              }],
              stream: false,
              temperature: 0.4,
              max_tokens: 120,
            }),
            signal: AbortSignal.timeout(8_000),
          });
          if (relRes.ok) {
            const rj = await relRes.json();
            const extra = (rj.choices?.[0]?.message?.content ?? '')
              .trim()
              .split('\n')
              .map((q: string) => q.replace(/^[-*\d.)\s"']+/, '').trim())
              .filter(Boolean)
              .slice(0, 3);
            queries = [text, ...extra];
          }
        } catch { /* use original query only */ }
      }

      const resultsArrays = await Promise.all(
        queries.map((q) => searxSearch(q, 10).catch(() => [])),
      );

      const seen = new Set<string>();
      const merged: typeof searchSources = [];
      for (const arr of resultsArrays) {
        for (const r of arr) {
          if (!seen.has(r.url)) {
            seen.add(r.url);
            merged.push({ title: r.title, url: r.url });
          }
        }
      }

      const allResults = resultsArrays.flat().filter((r, i, a) => {
        const first = a.findIndex((x) => x.url === r.url);
        return first === i;
      }).slice(0, 20);

      if (allResults.length > 0) {
        searchSources = allResults.map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
        userContent = formatSearchContext(text, allResults) + userContent;
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

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      send({ userMsgId });
      if (searchSources.length > 0) send({ sources: searchSources });

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
              signal: req.signal,
              onStats: (stats) => send({ stats }),
            });

        for await (const delta of deltaStream) {
          fullResponse += delta;
          send({ delta });
        }
      } catch (err: unknown) {
        const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
        if (!isAbort) {
          const msg = err instanceof Error ? err.message : String(err);
          send({ error: msg });
        }
      } finally {
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
