/**
 * In-process supervisor for the local llama.cpp server.
 *
 * Chakor runs llama-server as a child process instead of a separate systemd
 * unit, so the whole stack is one service. This module owns that child: it
 * launches it on boot (from instrumentation.ts), restarts it on crash, swaps the
 * model/context on request, and kills it cleanly on shutdown.
 *
 * If something is already serving on the llama port (e.g. a separate server you
 * run yourself, or Ollama-only setups), we adopt it instead of spawning — no
 * conflict. A singleton on globalThis keeps one instance across the app.
 */
import { spawn, exec, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import {
  llamaUrl,
  readRuntimeEnv,
  writeRuntimeEnv,
  findMmproj,
  resolveLlamaBin,
  resolveModelPath,
  buildLlamaArgs,
} from './local-llama';

const execAsync = promisify(exec);

export type SupervisorMode = 'managed' | 'external' | 'down' | 'off';

/** Why the model failed to launch, classified from llama-server's own stderr. */
export type FailureKind = 'unknown_arch' | 'out_of_memory' | 'corrupt_model' | 'spawn_error' | 'unknown';

export interface SupervisorStatus {
  enabled: boolean;
  /** We spawned and own the child process. */
  managing: boolean;
  running: boolean;
  pid: number | null;
  restarts: number;
  lastError: string | null;
  /** Typed reason for lastError, so the UI can show targeted advice. */
  failureKind: FailureKind | null;
  model: string | null;
  ctx: number | null;
  /** We gave up relaunching after the model kept crashing. */
  crashed: boolean;
}

export interface SwitchConfig {
  model?: string;
  ctx?: number;
  mmproj?: string;
}

/**
 * Diagnose a crash from llama-server's stderr output. The exit code alone says
 * nothing; the actual cause (unsupported architecture, OOM, corrupt file) is
 * only ever printed to stderr before the process dies. Exported (pure) so the
 * classification can be unit-tested against sample stderr tails.
 */
export function classifyFailureText(text: string): FailureKind {
  const t = text.toLowerCase();
  if (/unknown model architecture|unsupported.*architecture|architecture.*not supported/.test(t)) return 'unknown_arch';
  if (/out of memory|failed to alloc|cannot allocate|insufficient memory|std::bad_alloc|\boom\b/.test(t)) return 'out_of_memory';
  if (/corrupt|truncat|bad magic|invalid magic|not a valid|incomplete file|unexpected end of file/.test(t)) return 'corrupt_model';
  return 'unknown';
}

class LlamaSupervisor {
  private child: ChildProcess | null = null;
  private owns = false;            // did we launch it (vs. adopting an external one)
  private starting = false;
  private intentionalStop = false;
  private restarts = 0;
  private lastError: string | null = null;
  private failureKind: FailureKind | null = null;
  private model: string | null = null;
  private ctx: number | null = null;
  private backoff = 1000;
  private crashed = false;          // gave up after too many fast crashes
  private fastCrashes = 0;          // consecutive crashes that died almost immediately
  private lastSpawnAt = 0;
  // Ring buffer of llama-server's last stderr lines. Crash exit codes alone are
  // useless ("code=1"); the real reason (unknown architecture, OOM, corrupt
  // file) is only ever printed to stderr, so keep it for diagnosis.
  private stderrTail: string[] = [];
  private static readonly STDERR_TAIL_LINES = 50;

  // A model that's too big for the machine makes llama-server die within a second
  // or two of launch, every time. Without a cap the supervisor would respawn it
  // forever, pinning the CPU and never recovering. After this many back-to-back
  // fast crashes we stop and surface an actionable message instead.
  private get maxFastCrashes(): number {
    return Number(process.env.CHAKOR_LLAMA_MAX_CRASHES ?? 4) || 4;
  }
  private static readonly FAST_CRASH_MS = 20_000;

  get enabled(): boolean {
    return process.env.CHAKOR_SUPERVISE_LLAMA !== 'false';
  }

  /** Called once on server boot. Adopts an existing server or launches one. */
  async start(): Promise<void> {
    if (!this.enabled || this.child || this.starting) return;
    this.installShutdownHooks();
    if (await this.healthy()) {
      // Something already serves this port — leave it alone.
      this.owns = false;
      return;
    }
    await this.launch();
  }

  private async healthy(): Promise<boolean> {
    try {
      const r = await fetch(`${llamaUrl()}/health`, { signal: AbortSignal.timeout(1500) });
      return r.ok;
    } catch {
      return false;
    }
  }

  private async gpuPrep(): Promise<void> {
    // nvidia-modprobe is setuid root, so a normal user can create the UVM device
    // files / load the driver before llama-server touches CUDA. No-op without one.
    try { await execAsync('nvidia-modprobe -u -c=0', { timeout: 8000 }); } catch { /* not nvidia */ }
  }

  private async launch(): Promise<void> {
    if (this.starting || this.child) return;
    this.starting = true;
    this.lastError = null;
    this.failureKind = null;
    try {
      const bin = resolveLlamaBin();
      const cfg = await readRuntimeEnv();
      const model = await resolveModelPath(cfg);
      if (!model) { this.lastError = 'No .gguf model found to launch.'; this.owns = false; return; }
      const ctx = cfg.ctx ?? (Number(process.env.LLAMA_CONTEXT ?? process.env.LLAMA_CTX ?? 8192) || 8192);
      const mmproj = cfg.mmproj || (await findMmproj(model)) || '';

      await this.gpuPrep();

      const args = buildLlamaArgs({ model, ctx, mmproj });
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      this.owns = true;
      this.model = model;
      this.ctx = ctx;
      this.lastSpawnAt = Date.now();
      this.stderrTail = [];

      child.stdout?.on('data', (d) => process.stdout.write(`[llama] ${d}`));
      child.stderr?.on('data', (d) => {
        process.stderr.write(`[llama] ${d}`);
        this.pushStderr(String(d));
      });
      child.on('spawn', () => { this.restarts++; });
      child.on('error', (e) => {
        // Spawn failure (binary missing, not executable). No 'exit' event follows
        // a failed spawn, so without this the supervisor would keep reporting
        // running:true forever. Treat it like an instant crash.
        this.child = null;
        this.fastCrashes++;
        this.failureKind = 'spawn_error';
        this.handleUnexpectedDeath(`llama-server failed to start (${e.message})`);
      });
      child.on('exit', (code, signal) => {
        this.child = null;
        if (this.intentionalStop) { this.intentionalStop = false; return; }

        const uptime = Date.now() - this.lastSpawnAt;
        // Crashed almost immediately = it never got healthy. That's the OOM /
        // too-big-model signature. Count consecutive fast crashes; a launch that
        // actually ran for a while resets the counter AND the backoff (a one-off,
        // worth retrying quickly).
        if (uptime < LlamaSupervisor.FAST_CRASH_MS) {
          this.fastCrashes++;
        } else {
          this.fastCrashes = 0;
          this.backoff = 1000;
        }

        this.handleUnexpectedDeath(`llama-server exited (code=${code ?? '?'} signal=${signal ?? '-'})`);
      });
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.owns = false;
    } finally {
      this.starting = false;
    }
  }

  /** Append a chunk of child stderr to the ring buffer (last ~50 lines kept). */
  private pushStderr(chunk: string): void {
    for (const line of chunk.split('\n')) {
      const t = line.trim();
      if (t) this.stderrTail.push(t);
    }
    const overflow = this.stderrTail.length - LlamaSupervisor.STDERR_TAIL_LINES;
    if (overflow > 0) this.stderrTail.splice(0, overflow);
  }

  /**
   * Diagnose a crash from llama-server's stderr tail. The exit code alone says
   * nothing; the actual cause (unsupported architecture, OOM, corrupt file) is
   * only ever printed to stderr before the process dies.
   */
  private classifyFailure(detail: string): FailureKind {
    if (this.failureKind === 'spawn_error') return 'spawn_error';
    return classifyFailureText(`${detail}\n${this.stderrTail.join('\n')}`);
  }

  /** Crash accounting shared by the exit and spawn-error paths. */
  private handleUnexpectedDeath(detail: string): void {
    this.failureKind = this.classifyFailure(detail);
    if (this.fastCrashes >= this.maxFastCrashes) {
      // Stop the runaway loop and say something the user can act on — the real
      // reason, not the blanket "model is probably too large".
      this.crashed = true;
      const name = this.model ? this.model.split('/').pop() : 'the model';
      const why: Record<FailureKind, string> = {
        unknown_arch:
          `This llama.cpp build can't run ${name} — it reports an unknown model architecture. ` +
          'The file may be too new for this build or not a chat model at all ' +
          '(e.g. a speculative-decoding drafter). Update llama.cpp or pick a different model.',
        out_of_memory:
          `${name} is too large for this machine's memory. ` +
          'Pick a smaller model in Settings, or switch to Ollama or LM Studio.',
        corrupt_model:
          `${name} looks corrupt or truncated — llama-server rejected the file itself. ` +
          'Delete it and download it again (a re-download now verifies size and checksum).',
        spawn_error:
          'llama-server failed to start at all. Check that the binary exists and is executable.',
        unknown:
          `${name} keeps crashing. Pick a smaller model in Settings, or switch to Ollama or LM Studio.`,
      };
      this.lastError =
        `llama-server crashed ${this.fastCrashes} times in a row. ${why[this.failureKind]} ` +
        `(last error: ${detail})`;
      return;
    }

    // Otherwise back off and relaunch, like systemd Restart=always did.
    this.lastError = detail;
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30_000);
    setTimeout(() => { if (this.enabled && this.owns && !this.crashed && !this.child) void this.launch(); }, wait);
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.intentionalStop = true;
    const exited = new Promise<void>((res) => {
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } res(); }, 6000);
      child.once('exit', () => { clearTimeout(t); res(); });
    });
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    await exited;
    this.child = null;
  }

  /** Switch model/context (or cold-start). Writes the choice and relaunches.
   *  Serialized: a second switch while one is in flight waits its turn instead
   *  of racing stop/launch and reporting a spurious failure. */
  private restartChain: Promise<unknown> = Promise.resolve();

  restart(cfg?: SwitchConfig): Promise<{ ok: boolean; error?: string }> {
    const run = this.restartChain.then(() => this.doRestart(cfg));
    this.restartChain = run.catch(() => { /* keep the chain alive */ });
    return run;
  }

  private async doRestart(cfg?: SwitchConfig): Promise<{ ok: boolean; error?: string }> {
    if (!this.enabled) return { ok: false, error: 'Local model supervision is turned off.' };
    // An explicit switch is a fresh start: clear the gave-up state and the crash
    // counter so a newly chosen (smaller) model gets a clean chance to launch.
    this.crashed = false;
    this.fastCrashes = 0;
    this.backoff = 1000;
    if (cfg?.model || cfg?.ctx) {
      const model = cfg.model ?? this.model ?? (await resolveModelPath(await readRuntimeEnv()));
      const ctx = cfg.ctx ?? this.ctx ?? (Number(process.env.LLAMA_CONTEXT ?? 8192) || 8192);
      if (model) {
        const mmproj = cfg.mmproj ?? (await findMmproj(model)) ?? '';
        await writeRuntimeEnv({ model, ctx, mmproj });
      }
    }
    await this.stopChild();
    // If something we didn't launch is still serving this port (e.g. an external
    // llama-server adopted at boot), spawning would collide on the port and the
    // instant exit would be misreported as a too-big-model crash loop.
    if (!this.child && (await this.healthy())) {
      return {
        ok: false,
        error:
          'Another llama-server we did not launch is already serving this port. ' +
          'Stop it first, or set CHAKOR_SUPERVISE_LLAMA=false to use it as-is.',
      };
    }
    await this.launch();
    return this.child ? { ok: true } : { ok: false, error: this.lastError ?? 'Failed to start llama-server.' };
  }

  async stop(): Promise<void> {
    this.owns = false;
    await this.stopChild();
  }

  status(): SupervisorStatus {
    return {
      enabled: this.enabled,
      managing: this.owns && !!this.child,
      running: !!this.child,
      pid: this.child?.pid ?? null,
      restarts: this.restarts,
      lastError: this.lastError,
      failureKind: this.failureKind,
      model: this.model,
      ctx: this.ctx,
      crashed: this.crashed,
    };
  }

  private hooked = false;
  private installShutdownHooks(): void {
    if (this.hooked) return;
    this.hooked = true;
    // Don't orphan the model if the app goes down. systemd's cgroup kill is the
    // backstop; this makes dev (Ctrl-C) and graceful stops tidy too.
    const bye = () => { void this.stopChild(); };
    process.once('SIGTERM', bye);
    process.once('SIGINT', bye);
    process.once('exit', () => { try { this.child?.kill('SIGKILL'); } catch { /* noop */ } });
  }
}

function getSupervisor(): LlamaSupervisor {
  const g = globalThis as typeof globalThis & { __chakorLlama?: LlamaSupervisor };
  if (!g.__chakorLlama) g.__chakorLlama = new LlamaSupervisor();
  return g.__chakorLlama;
}

export const llamaSupervisor = getSupervisor();
