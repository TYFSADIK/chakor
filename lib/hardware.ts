/**
 * Hardware auto-detection: how much RAM, what CPU, and which GPU (with how much
 * VRAM) this machine has. This is what lets Chakor tell a user up front "that
 * model is too big for your laptop" instead of letting llama.cpp load it, run
 * out of memory, and crash.
 *
 * Server-only. Uses node:child_process / node:fs / node:os, so never import it
 * into a client component. Route handlers call detectHardware() and ship the
 * plain result to the browser.
 *
 * A focused TypeScript port of the detection in odysseus' services/hwfit, kept
 * to the parts a self-hoster actually needs: NVIDIA (nvidia-smi), AMD (sysfs),
 * Apple Silicon (sysctl), and a CPU-only fallback.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';

export type GpuBackend = 'cuda' | 'rocm' | 'metal' | 'cpu_x86' | 'cpu_arm';

export interface Hardware {
  totalRamGb: number;
  availableRamGb: number;
  cpuName: string;
  cpuCores: number;
  hasGpu: boolean;
  gpuName: string | null;
  gpuVramGb: number | null;
  gpuCount: number;
  backend: GpuBackend;
  /** Apple Silicon / AMD APUs share system RAM with the GPU (no discrete VRAM). */
  unifiedMemory: boolean;
  /** Set when a GPU tool exists but failed (e.g. driver mismatch) so the UI can
   *  say "GPU driver error" instead of the misleading "no GPU". */
  gpuError: string | null;
}

const exec = (cmd: string, args: string[], timeoutMs = 4000): Promise<string | null> =>
  new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
        resolve(err ? null : String(stdout).trim());
      });
    } catch {
      resolve(null);
    }
  });

// nvidia-smi often is not on a service process's minimal PATH, so try the common
// absolute locations too (covers WSL, CUDA installs, and bare Linux).
const NVIDIA_SMI_CANDIDATES = [
  'nvidia-smi',
  '/usr/bin/nvidia-smi',
  '/usr/local/bin/nvidia-smi',
  '/usr/lib/wsl/lib/nvidia-smi',
  'C:\\Windows\\System32\\nvidia-smi.exe',
];

const GPU_ERROR_HINTS = [
  'nvml',
  'driver/library version mismatch',
  "couldn't communicate",
  'no devices were found',
  'failed to initialize',
];

async function detectNvidia(): Promise<Partial<Hardware> | null> {
  let out: string | null = null;
  for (const bin of NVIDIA_SMI_CANDIDATES) {
    out = await exec(bin, ['--query-gpu=memory.total,name', '--format=csv,noheader,nounits']);
    if (out) break;
  }
  if (!out) return null;

  const low = out.toLowerCase();
  if (GPU_ERROR_HINTS.some((h) => low.includes(h))) {
    return { gpuError: out.split('\n')[0].slice(0, 140) || 'NVIDIA driver error' };
  }

  const gpus: { name: string; vramGb: number }[] = [];
  for (const line of out.split('\n')) {
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 2) continue;
    const vramMb = Number(parts[0]);
    if (Number.isFinite(vramMb) && vramMb > 0) gpus.push({ name: parts[1], vramGb: vramMb / 1024 });
  }
  if (!gpus.length) return null;
  const totalVram = gpus.reduce((n, g) => n + g.vramGb, 0);
  return {
    hasGpu: true,
    gpuName: gpus[0].name,
    gpuVramGb: round1(totalVram),
    gpuCount: gpus.length,
    backend: 'cuda',
    unifiedMemory: false,
  };
}

async function detectAmd(): Promise<Partial<Hardware> | null> {
  // AMD GPUs report VRAM in sysfs. vendor 0x1002 is AMD; mem_info_vram_total is
  // discrete VRAM, mem_info_vis_vram_total covers APUs that carve it from RAM.
  let cards: string[];
  try {
    cards = (await fs.readdir('/sys/class/drm')).filter((e) => /^card\d+$/.test(e));
  } catch {
    return null;
  }
  const read = async (p: string) => {
    try {
      return (await fs.readFile(p, 'utf8')).trim();
    } catch {
      return null;
    }
  };
  const gpus: { name: string; vramGb: number }[] = [];
  let isApu = false;
  for (const card of cards) {
    const base = `/sys/class/drm/${card}/device`;
    if ((await read(`${base}/vendor`)) !== '0x1002') continue;
    const vram = Number((await read(`${base}/mem_info_vram_total`)) || 0);
    const vis = Number((await read(`${base}/mem_info_vis_vram_total`)) || 0);
    const gtt = Number((await read(`${base}/mem_info_gtt_total`)) || 0);
    let bytes = Math.max(vram, vis);
    if (bytes <= 0) bytes = gtt;
    if (vis && vis >= vram) isApu = true;
    if (bytes <= 0) continue;
    const name = (await read(`${base}/product_name`)) || 'AMD GPU';
    gpus.push({ name, vramGb: bytes / 1024 ** 3 });
  }
  if (!gpus.length) return null;
  return {
    hasGpu: true,
    gpuName: gpus[0].name,
    gpuVramGb: round1(gpus.reduce((n, g) => n + g.vramGb, 0)),
    gpuCount: gpus.length,
    backend: 'rocm',
    unifiedMemory: isApu,
  };
}

async function detectAppleSilicon(): Promise<Partial<Hardware> | null> {
  if (process.platform !== 'darwin') return null;
  if (!os.arch().includes('arm')) return null; // Intel Macs fall through to CPU
  const brand = (await exec('sysctl', ['-n', 'machdep.cpu.brand_string'])) || 'Apple Silicon';
  const memOut = await exec('sysctl', ['-n', 'hw.memsize']);
  const totalGb = memOut ? Number(memOut) / 1024 ** 3 : 0;
  if (totalGb <= 0) return null;
  // macOS lets Metal use most of unified memory; the working-set fraction scales
  // with RAM (small machines must keep more back for the OS).
  const frac = totalGb <= 16 ? 0.67 : totalGb <= 64 ? 0.75 : 0.8;
  return {
    hasGpu: true,
    gpuName: brand,
    gpuVramGb: round1(totalGb * frac),
    gpuCount: 1,
    backend: 'metal',
    unifiedMemory: true,
  };
}

async function ramGb(): Promise<{ total: number; available: number }> {
  // Linux /proc/meminfo has the truest "available" figure; fall back to os.* on
  // macOS/Windows where it doesn't exist.
  try {
    const text = await fs.readFile('/proc/meminfo', 'utf8');
    const get = (key: string) => {
      const m = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text);
      return m ? Number(m[1]) / 1024 ** 2 : 0; // kB -> GB
    };
    const total = get('MemTotal');
    const avail = get('MemAvailable');
    if (total > 0) return { total, available: avail > 0 ? avail : total * 0.7 };
  } catch {
    /* not linux */
  }
  const total = os.totalmem() / 1024 ** 3;
  const free = os.freemem() / 1024 ** 3;
  return { total, available: free > 0 ? free : total * 0.7 };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

let cache: { at: number; hw: Hardware } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // hardware barely changes; the Rescan button forces fresh

/** Detect this machine's RAM/CPU/GPU. Cached; pass fresh=true to re-probe. */
export async function detectHardware(fresh = false): Promise<Hardware> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL) return cache.hw;

  const { total, available } = await ramGb();
  const cpus = os.cpus();
  const cpuName = cpus[0]?.model?.trim() || 'Unknown CPU';
  const cpuCores = cpus.length || 1;

  const gpu = (await detectAppleSilicon()) || (await detectNvidia()) || (await detectAmd());

  const arch = os.arch();
  const cpuBackend: GpuBackend = arch === 'arm64' || arch === 'arm' ? 'cpu_arm' : 'cpu_x86';

  const hw: Hardware = {
    totalRamGb: round1(total),
    availableRamGb: round1(available),
    cpuName,
    cpuCores,
    hasGpu: Boolean(gpu?.hasGpu),
    gpuName: gpu?.gpuName ?? null,
    gpuVramGb: gpu?.gpuVramGb ?? null,
    gpuCount: gpu?.gpuCount ?? 0,
    backend: gpu?.backend ?? cpuBackend,
    unifiedMemory: gpu?.unifiedMemory ?? false,
    gpuError: gpu?.gpuError ?? null,
  };

  cache = { at: Date.now(), hw };
  return hw;
}

/** A short, human label for the picker: "16 GB RAM · GTX 1650 Ti 4 GB". */
export function hardwareSummary(hw: Hardware): string {
  const parts = [`${Math.round(hw.totalRamGb)} GB RAM`];
  if (hw.hasGpu && hw.gpuName) {
    const vram = hw.gpuVramGb ? ` ${Math.round(hw.gpuVramGb)} GB` : '';
    parts.push(`${hw.gpuName}${vram}`);
  } else if (hw.gpuError) {
    parts.push('GPU driver error');
  } else {
    parts.push('CPU only');
  }
  return parts.join(' · ');
}
