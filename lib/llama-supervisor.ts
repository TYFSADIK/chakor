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

export interface SupervisorStatus {
  enabled: boolean;
  /** We spawned and own the child process. */
  managing: boolean;
  running: boolean;
  pid: number | null;
  restarts: number;
  lastError: string | null;
  model: string | null;
  ctx: number | null;
  /** We gave up relaunching after the model kept crashing (likely too big). */
  crashed: boolean;
}

export interface SwitchConfig {
  model?: string;
  ctx?: number;
  mmproj?: string;
}

class LlamaSupervisor {
  private child: ChildProcess | null = null;
  private owns = false;            // did we launch it (vs. adopting an external one)
  private starting = false;
  private intentionalStop = false;
  private restarts = 0;
  private lastError: string | null = null;
  private model: string | null = null;
  private ctx: number | null = null;
  private backoff = 1000;
  private crashed = false;          // gave up after too many fast crashes
  private fastCrashes = 0;          // consecutive crashes that died almost immediately
  private lastSpawnAt = 0;

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

      child.stdout?.on('data', (d) => process.stdout.write(`[llama] ${d}`));
      child.stderr?.on('data', (d) => process.stderr.write(`[llama] ${d}`));
      child.on('spawn', () => { this.restarts++; this.backoff = 1000; });
      child.on('error', (e) => { this.lastError = e.message; });
      child.on('exit', (code, signal) => {
        this.child = null;
        if (this.intentionalStop) { this.intentionalStop = false; return; }

        const uptime = Date.now() - this.lastSpawnAt;
        // Crashed almost immediately = it never got healthy. That's the OOM /
        // too-big-model signature. Count consecutive fast crashes; a launch that
        // actually ran for a while resets the counter (a one-off, worth retrying).
        this.fastCrashes = uptime < LlamaSupervisor.FAST_CRASH_MS ? this.fastCrashes + 1 : 0;

        if (this.fastCrashes >= this.maxFastCrashes) {
          // Stop the runaway loop and say something the user can act on.
          this.crashed = true;
          const name = this.model ? this.model.split('/').pop() : 'the model';
          this.lastError =
            `llama-server crashed ${this.fastCrashes} times in a row. ${name} is probably too large ` +
            `for this machine's memory. Pick a smaller model in Settings, or switch to Ollama or LM Studio.`;
          return;
        }

        // Otherwise back off and relaunch, like systemd Restart=always did.
        this.lastError = `llama-server exited (code=${code ?? '?'} signal=${signal ?? '-'})`;
        const wait = this.backoff;
        this.backoff = Math.min(this.backoff * 2, 30_000);
        setTimeout(() => { if (this.enabled && this.owns && !this.crashed && !this.child) void this.launch(); }, wait);
      });
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.owns = false;
    } finally {
      this.starting = false;
    }
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

  /** Switch model/context (or cold-start). Writes the choice and relaunches. */
  async restart(cfg?: SwitchConfig): Promise<{ ok: boolean; error?: string }> {
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
