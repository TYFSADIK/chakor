/**
 * In-process supervisor for the local stable-diffusion.cpp server (sd-server),
 * mirroring lib/llama-supervisor.ts.
 *
 * Chakor spawns sd-server on demand rather than expecting it to run as a
 * separate service, because on machines without VRAM to spare the image
 * engine only runs while an image is being generated (swap mode) — the rest
 * of the time the GPU belongs to the chat model.
 *
 * If something already answers on the sd-server port (an sd-server you run
 * yourself), we adopt it instead of spawning — no conflict, and we never
 * kill a server we didn't start. A singleton on globalThis keeps one
 * instance across the app.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sdDir, sdPort, sdEncoderPath, sdCapabilities } from './sd-server';
import { logger } from './logger';

export interface SdStatus {
  /** Something (ours or external) answers on the sd-server port. */
  running: boolean;
  /** We spawned and own the child process. */
  managed: boolean;
  pid: number | null;
  /** Last crash/launch error, if any (includes the captured output tail). */
  lastError: string | null;
}

/** Model load on a small GPU is slow (weights swap through RAM). */
const STARTUP_TIMEOUT_MS = 3 * 60_000;

class SdSupervisor {
  private child: ChildProcess | null = null;
  private owns = false;
  private starting = false;
  private lastError: string | null = null;
  // Ring buffer of sd-server's last output lines — a crash's exit code says
  // nothing; the reason (missing model, OOM, bad flag) is only ever printed.
  private outputTail: string[] = [];
  private static readonly TAIL_LINES = 50;

  private async healthy(): Promise<boolean> {
    return (await sdCapabilities()) !== null;
  }

  private pushOutput(chunk: string): void {
    for (const line of chunk.split('\n')) {
      const t = line.trim();
      if (t) this.outputTail.push(t);
    }
    const overflow = this.outputTail.length - SdSupervisor.TAIL_LINES;
    if (overflow > 0) this.outputTail.splice(0, overflow);
  }

  /** True when anything (ours or adopted) answers on the sd-server port. */
  isRunning(): Promise<boolean> {
    return this.healthy();
  }

  status(): SdStatus {
    return { running: !!this.child, managed: this.owns && !!this.child, pid: this.child?.pid ?? null, lastError: this.lastError };
  }

  /**
   * Make sure sd-server is serving. Adopts an existing server on the port;
   * otherwise spawns one from SDCPP_DIR and waits for real health.
   * `lowvram` (swap mode) adds --clip-on-cpu to keep the text encoder off the
   * GPU; the caller must have freed the GPU first.
   */
  async ensureRunning(opts: { lowvram: boolean; modelPath: string }): Promise<{ ok: boolean; error?: string }> {
    if (await this.healthy()) {
      // Something already serves this port — leave it alone.
      this.owns = false;
      return { ok: true };
    }
    if (!this.child && !this.starting) {
      const err = this.spawn(opts);
      if (err) return { ok: false, error: err };
    }
    // Wait for real health: answering the socket is the only signal that the
    // model and encoder actually loaded.
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.healthy()) return { ok: true };
      if (!this.child) {
        return { ok: false, error: this.lastError ?? 'sd-server exited during startup.' };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return {
      ok: false,
      error: `The image engine did not become ready in ${STARTUP_TIMEOUT_MS / 60000} minutes. ${this.outputTail.slice(-3).join(' | ')}`.trim(),
    };
  }

  /** Returns an error string on failure, null on successful spawn. */
  private spawn(opts: { lowvram: boolean; modelPath: string }): string | null {
    if (this.starting || this.child) return null;
    const bin = path.join(sdDir(), 'build', 'bin', 'sd-server');
    if (!fs.existsSync(bin)) {
      this.lastError = `sd-server binary not found at ${bin}. Build stable-diffusion.cpp first, or set SDCPP_DIR.`;
      return this.lastError;
    }
    if (!fs.existsSync(opts.modelPath)) {
      this.lastError = `Image model not found at ${opts.modelPath}.`;
      return this.lastError;
    }
    const encoder = sdEncoderPath();
    if (!fs.existsSync(encoder)) {
      this.lastError = `Text encoder not found at ${encoder}. Set SDCPP_ENCODER.`;
      return this.lastError;
    }

    const args = [
      '--listen-ip', '127.0.0.1',
      '--listen-port', String(sdPort()),
      '--diffusion-model', opts.modelPath,
      '--llm', encoder,
      '--diffusion-fa',
    ];
    if (opts.lowvram) args.push('--clip-on-cpu');

    this.starting = true;
    this.lastError = null;
    this.outputTail = [];
    try {
      const child = spawn(bin, args, { cwd: sdDir(), stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      this.owns = true;
      child.stdout?.on('data', (d) => { process.stdout.write(`[sd] ${d}`); this.pushOutput(String(d)); });
      child.stderr?.on('data', (d) => { process.stderr.write(`[sd] ${d}`); this.pushOutput(String(d)); });
      child.on('error', (e) => {
        this.child = null;
        this.lastError = `sd-server failed to start (${e.message})`;
      });
      child.on('exit', (code, signal) => {
        this.child = null;
        const tail = this.outputTail.slice(-5).join(' | ');
        this.lastError = `sd-server exited (code=${code ?? '?'} signal=${signal ?? '-'})${tail ? ` — ${tail}` : ''}`;
        logger.warn('sd-server exited', { err: this.lastError });
      });
      return null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.owns = false;
      return this.lastError;
    } finally {
      this.starting = false;
    }
  }

  /** Stop sd-server — but only a server we spawned. An adopted external
   *  server is left running; it isn't ours to kill. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child || !this.owns) { this.child = null; return; }
    const exited = new Promise<void>((res) => {
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } res(); }, 6000);
      child.once('exit', () => { clearTimeout(t); res(); });
    });
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    await exited;
    this.child = null;
    this.owns = false;
  }
}

function getSupervisor(): SdSupervisor {
  const g = globalThis as typeof globalThis & { __chakorSd?: SdSupervisor };
  if (!g.__chakorSd) g.__chakorSd = new SdSupervisor();
  return g.__chakorSd;
}

export const sdSupervisor = getSupervisor();
