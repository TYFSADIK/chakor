/**
 * POST /api/agent/execute
 * SSE streaming endpoint for the ReAct agent loop.
 *
 * Auth: next-auth session. Ownership: the conversation must belong to the
 * caller. If no conversationId is given we create a fresh conversation so the
 * workspace always maps 1:1 to a conversation the user owns.
 */

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getConversation, createConversation } from "@/lib/db";
import { runAgent } from "@/lib/agent-executor";
import { streamForModel } from "@/lib/dispatch";
import { getModel, defaultModel } from "@/lib/models";
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
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const userId = (session.user as unknown as { id: number }).id;

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

  const model = (modelId ? getModel(modelId) : null) ?? defaultModel();

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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode("data: " + JSON.stringify(data) + "\n\n"));
      };
      try {
        for await (const event of runAgent(
          { workspaceDir, model, dispatch: dispatchAdapter },
          message
        )) {
          send(event);
        }
      } catch (e) {
        logger.error("agent execute failed", { convId, err: errText(e) });
        send({ type: "error", message: "The agent stopped unexpectedly. Please try again." });
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

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
