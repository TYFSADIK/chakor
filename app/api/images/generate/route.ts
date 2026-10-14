/**
 * POST /api/images/generate — turn a chat message into an image.
 *
 * Streams the same SSE frame shapes as /api/chat ({userMsgId}, {delta},
 * {assistantMsgId}) plus one extra: {image:{name,url,prompt}} when the file
 * lands in the conversation workspace. Both messages are persisted exactly
 * like chat messages, so reloads, exports, and shared links all work.
 *
 * The engine is stable-diffusion.cpp's sd-server, which Chakor spawns on
 * demand. In swap mode the chat model is stopped while the image generates
 * and brought back afterwards; in parallel mode both stay resident
 * (see runImageJob in lib/image-gen.ts).
 *
 * Gate order (cheapest first): auth → feature enabled → allowlist → daily
 * rate limit → hardware has any accelerator → model installed. Failures
 * before the stream starts are plain JSON errors; failures during
 * generation are sent as streamed text so the user always gets a readable
 * answer in the bubble.
 *
 * The job is decoupled from the HTTP connection (a full-quality image can
 * take ~30 minutes and people refresh): it always runs to completion and
 * persists, the SSE stream is only a live view, and cancellation is an
 * explicit POST /api/images/cancel, never a side effect of disconnecting.
 *
 * Non-admin masking: streamed/persisted text never names model files,
 * directories, or the engine binary — the engine is just "the image model".
 */
import { NextRequest } from 'next/server';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireUser, isAdminSession } from '@/lib/guard';
import { sseStream } from '@/lib/sse';
import {
  getConversation,
  createConversation,
  addMessage,
  updateConversationTitle,
  recordImageGeneration,
} from '@/lib/db';
import { generateTitle } from '@/lib/llama';
import { llamaEndpoint, MASKED_MODEL_ID } from '@/lib/models';
import { stripImagePrefix } from '@/lib/image-intent';
import {
  preflight,
  decideImageMode,
  hardwareCanAttemptImageGen,
  defaultImageSize,
  defaultImageSteps,
  getActiveImageModel,
  imageModelPath,
  imageQuality,
  estimateImageSeconds,
  runImageJob,
  trackImageJob,
  clearImageJob,
  ImageGenError,
  logImageGenError,
} from '@/lib/image-gen';
import { buildImgGenRequest, submitImgGen, pollJob } from '@/lib/sd-server';
import { detectHardware } from '@/lib/hardware';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PROMPT_CHARS = 4000;

function workspaceDirFor(convId: string): string {
  return path.join(process.cwd(), 'data', 'workspaces', convId);
}

export async function POST(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof Response) return authd;
  const { session, userId } = authd;
  const isAdmin = isAdminSession(session);

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return Response.json({ error: 'message required' }, { status: 400 });
  }
  if (message.length > MAX_PROMPT_CHARS) {
    return Response.json({ error: `prompt too long (max ${MAX_PROMPT_CHARS} chars)` }, { status: 400 });
  }

  const gate = await preflight(userId, isAdmin);
  if (!gate.ok) {
    return Response.json({ error: gate.error }, { status: gate.status });
  }

  // Resolve or create the conversation (same rules as /api/chat).
  let convId = typeof body?.conversationId === 'string' ? body.conversationId : undefined;
  let isNewConv = false;
  if (convId) {
    if (!getConversation(convId, userId)) {
      return Response.json({ error: 'conversation not found' }, { status: 404 });
    }
  } else {
    convId = randomUUID();
    createConversation(convId, userId, MASKED_MODEL_ID);
    isNewConv = true;
  }
  const finalConvId = convId;

  // The prompt is the message minus an explicit "/image " prefix.
  const prompt = stripImagePrefix(message) ?? message;

  let userMsgId: number;
  try {
    userMsgId = addMessage(finalConvId, 'user', message);
  } catch (e) {
    if (e instanceof Error && e.message.includes('FOREIGN KEY constraint failed')) {
      return Response.json({ error: 'conversation not found' }, { status: 404 });
    }
    throw e;
  }

  // Count the attempt against the daily allowance up front: the GPU does the
  // work whether or not the final image pleases the user.
  recordImageGeneration(userId);

  // The generation is decoupled from the HTTP connection: a full-quality
  // image can take ~30 minutes and users refresh or close the tab. The job
  // always runs to completion and persists its result; the SSE stream is
  // just a live view (sink sends become no-ops once the client is gone).
  // Only an explicit POST /api/images/cancel stops the sd-server job.
  const stream = sseStream(async (sink) => {
    sink.send({ userMsgId });

    // Every soft failure lands here as readable text in the bubble (and is
    // what gets persisted), so the user is never left with a silent empty reply.
    let reply = '';
    const finish = async () => {
      if (!reply) return;
      try {
        const assistantMsgId = addMessage(finalConvId, 'assistant', reply);
        sink.send({ assistantMsgId });
      } catch (e) {
        if (!(e instanceof Error && e.message.includes('FOREIGN KEY constraint failed'))) throw e;
      }
      if (isNewConv) {
        generateTitle(llamaEndpoint(), message)
          .then((title) => updateConversationTitle(finalConvId, userId, title))
          .catch(() => {});
      }
    };

    try {
      const hw = await detectHardware();
      if (!hardwareCanAttemptImageGen(hw)) {
        reply = 'Image generation needs a GPU on this machine, and none was detected.';
        sink.send({ delta: reply });
        return;
      }

      const model = await getActiveImageModel();
      if (!model) {
        reply = 'No image model is installed yet. An admin can install one from the admin panel (Image Generation).';
        sink.send({ delta: reply });
        return;
      }

      const mode = decideImageMode(hw);
      const quality = imageQuality();
      const { width, height } = defaultImageSize(mode);
      const steps = defaultImageSteps();
      // The client runs a live elapsed/remaining timer off this estimate.
      const eta = estimateImageSeconds(mode, quality);
      sink.send({ eta, width, height, steps });
      const etaText = eta >= 90 ? `~${Math.round(eta / 60)} min` : `~${eta} s`;

      const bytes = await runImageJob(mode, imageModelPath(model), async () => {
        sink.send({ delta: `_Generating image (${width}×${height}, ${steps} steps)… estimated ${etaText} on this machine. You can leave this page — it will appear here when it's done._\n\n` });
        const jobId = await submitImgGen(
          buildImgGenRequest({ prompt, width, height, steps, seed: -1 }),
        );
        trackImageJob(finalConvId, jobId);
        try {
          // No abort signal on purpose: disconnecting must not kill the job.
          // A server-side 'cancelled' status (from /api/images/cancel) ends
          // the poll with ImageGenError('cancelled'), handled below.
          const out = await pollJob(jobId, undefined, (step, total, previewB64) => {
            sink.send({
              preview: {
                step,
                total,
                image: previewB64 ? `data:image/png;base64,${previewB64}` : null,
              },
            });
          });
          return out.bytes;
        } finally {
          clearImageJob(finalConvId, jobId);
        }
      }, (phase) => {
        sink.send({ delta: phase === 'preparing'
          ? '_Preparing the image model — the chat model will be back in a moment…_\n\n'
          : '_Restoring the chat model…_\n\n' });
      });

      const dir = workspaceDirFor(finalConvId);
      await fs.mkdir(dir, { recursive: true });
      const name = `img-${Date.now()}.png`;
      await fs.writeFile(path.join(dir, name), bytes);

      const url = `/api/workspace/${finalConvId}/files/${encodeURIComponent(name)}`;
      const alt = prompt.slice(0, 80).replace(/[[\]()]/g, '');
      sink.send({ image: { name, url, prompt } });

      // The client appends the markdown image from the `image` frame; here we
      // stream only the caption. The persisted reply keeps the progress lines
      // out — history shows the image and its caption only.
      reply = `![${alt}](${url})\n\n_${prompt.slice(0, 200)}_`;
      sink.send({ delta: `\n\n_${prompt.slice(0, 200)}_` });
    } catch (e) {
      // Cancelled via /api/images/cancel still gets a persisted note — the
      // history must never show a prompt with no reply at all.
      if (e instanceof ImageGenError && e.message === 'cancelled') {
        reply = '_Image generation cancelled._';
        return;
      }
      let msg = e instanceof ImageGenError ? e.message : 'Please try again.';
      // Engine/startup errors can carry absolute paths and model file names —
      // only admins get those; everyone else gets the generic line.
      if (!isAdmin && (/[\\/]/.test(msg) || /\.gguf/i.test(msg))) {
        logImageGenError('image generation failed (masked)', e);
        msg = 'the image engine failed to start. An admin can check the server logs for details.';
      } else if (!(e instanceof ImageGenError)) {
        logImageGenError('image generation failed', e);
      }
      reply = `_Image generation failed: ${msg}_`;
      sink.send({ delta: reply });
    } finally {
      // Roll the streamed text back out of the saved reply: the bubble shows
      // progress + result, history shows the result only.
      await finish();
    }
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
