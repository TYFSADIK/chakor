/**
 * Shared SSE stream plumbing for the chat-style endpoints.
 *
 * controller.enqueue/close throw once the client has disconnected and the
 * stream is cancelled; without a guard, a slow model reply racing a browser
 * tab close crashes the route with an unhandled rejection. send/close here
 * swallow exactly that race and report liveness so loops can stop early.
 */

export interface SseSink {
  /** Enqueue one `data: <json>` frame. Returns false once the stream is dead. */
  send(obj: Record<string, unknown>): boolean;
  /** Backpressure signal from the underlying stream (null once closed). */
  readonly desiredSize: number | null;
  /** Emit the terminal [DONE] frame and close. Safe to call once, any time. */
  done(): void;
}

export function sseStream(
  run: (sink: SseSink) => Promise<void>,
  onCancel?: () => void,
): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let closed = false;
      const sink: SseSink = {
        send(obj) {
          if (closed) return false;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            return true;
          } catch {
            closed = true;
            return false;
          }
        },
        get desiredSize() {
          return closed ? null : controller.desiredSize;
        },
        done() {
          if (closed) return;
          closed = true;
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch { /* client already gone */ }
          try {
            controller.close();
          } catch { /* already closed */ }
        },
      };
      try {
        await run(sink);
      } finally {
        sink.done();
      }
    },
    cancel() {
      onCancel?.();
    },
  });
}
