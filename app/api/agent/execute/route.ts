/**
 * POST /api/agent/execute
 * SSE streaming endpoint for the ReAct agent loop.
 *
 * Auth: next-auth session. Ownership: the conversation must belong to the
 * caller. If no conversationId is given we create a fresh conversation so the
 * workspace always maps 1:1 to a conversation the user owns.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser, isAdminSession } from "@/lib/guard";
import { sseStream } from "@/lib/sse";
import { getConversation, createConversation } from "@/lib/db";
import { runAgent } from "@/lib/agent-executor";
import { streamForModel } from "@/lib/dispatch";
import { resolveChatModel } from "@/lib/models";
import { trackChatStart, trackChatEnd } from "@/lib/backends";
import { logger, errText } from "@/lib/logger";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().max(100).optional(),
  message: z.string().min(1).max(20_000),
  model: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { session, userId } = authd;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "conversationId (optional) and message (required) expected" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { message, model: modelId } = parsed.data;

  // Resolve or create the conversation, verifying ownership when it exists.
  let convId = parsed.data.conversationId;
  let isNew = false;
  if (convId) {
    const conv = getConversation(convId, userId);
    if (!conv) {
      return new Response(JSON.stringify({ error: "conversation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    convId = randomUUID();
    createConversation(convId, userId, "chakor");
    isNew = true;
  }

  // Non-admins are pinned to the server's default model whatever id they send.
  const model = resolveChatModel(modelId, isAdminSession(session));

  const workspaceDir = path.join(process.cwd(), "data", "workspaces", convId);
  fs.mkdirSync(workspaceDir, { recursive: true });

  // Adapter from the agent's simple dispatch signature to streamForModel.
  // The agent's message list always starts with its system prompt, which the
  // Anthropic/Google providers need separately.
  const dispatchAdapter = (
    messages: Array<{ role: string; content: string }>,
    m: typeof model,
    opts?: { temperature?: number }
  ): AsyncIterable<string> =>
    streamForModel({
      modelId: m.id,
      messages: messages as import("@/lib/llama").ChatMessage[],
      system: messages.find((x) => x.role === "system")?.content ?? "",
      temperature: opts?.temperature ?? 0.3,
      signal: req.signal,
    });

  // Register this run so engine switching never evicts the backend mid-run
  // (the agent streams through the same engines as chat).
  trackChatStart();
  let trackEnded = false;
  const endTracking = () => {
    if (trackEnded) return;
    trackEnded = true;
    trackChatEnd();
  };

  const stream = sseStream(async (sink) => {
    try {
      for await (const event of runAgent(
        { workspaceDir, model, dispatch: dispatchAdapter },
        message
      )) {
        if (!sink.send(event as Record<string, unknown>)) break;
      }
    } catch (e) {
      logger.error("agent execute failed", { convId, err: errText(e) });
      sink.send({ type: "error", message: "The agent stopped unexpectedly. Please try again." });
    } finally {
      endTracking();
    }
  }, endTracking);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Conversation-Id": convId,
      "X-New-Conversation": isNew ? "1" : "0",
    },
  });
}
