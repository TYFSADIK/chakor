import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { NextRequest } from 'next/server';

// Fresh DB BEFORE importing lib/db or any module that touches it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-images-'));
process.env.CHAKOR_DB_PATH = path.join(tmp, 'test.db');

// A fake stable-diffusion.cpp checkout with a model zoo: two diffusion GGUFs
// plus the Qwen3-VL text encoder (which must never appear as a choice).
const sdTmp = path.join(tmp, 'sdcpp');
fs.mkdirSync(path.join(sdTmp, 'models'), { recursive: true });
const SAKURA = 'Sakura-Iris-3B-Q4_K_M-3.14GiB.gguf';
for (const f of [SAKURA, 'model-b.gguf', 'model-c.gguf', 'Qwen3VL-4B-Instruct-Q4_K_M.gguf']) {
  fs.writeFileSync(path.join(sdTmp, 'models', f), Buffer.alloc(1024));
}
process.env.SDCPP_DIR = sdTmp;

// Stub the session the guard will see; each test sets it explicitly.
const mockAuth = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('@/lib/auth', () => ({ auth: async () => mockAuth.session }));

// Swap-mode choreography is asserted through this ordered log: llama stops,
// sd-server starts (lowvram), the job runs, sd-server stops, llama returns.
const order = vi.hoisted(() => [] as string[]);
const sdCalls = vi.hoisted(() => [] as Array<{ lowvram: boolean; modelPath: string }>);
vi.mock('@/lib/sd-supervisor', () => ({
  sdSupervisor: {
    ensureRunning: async (opts: { lowvram: boolean; modelPath: string }) => {
      sdCalls.push(opts);
      order.push(opts.lowvram ? 'sd-start-lowvram' : 'sd-start');
      return { ok: true };
    },
    stop: async () => { order.push('sd-stop'); },
    isRunning: async () => true,
    status: () => ({ running: true, managed: true, pid: 1, lastError: null }),
  },
}));
vi.mock('@/lib/llama-supervisor', () => ({
  llamaSupervisor: {
    enabled: true,
    stop: async () => { order.push('llama-stop'); },
    restart: async () => { order.push('llama-restart'); return { ok: true }; },
  },
}));
// The swap flag is real state inside the mock so runImageJob's set/clear and
// the chat route's check observe the same value.
vi.mock('@/lib/backends', () => {
  let swap = false;
  return {
    chatInflightCount: () => 0,
    trackChatStart: () => {},
    trackChatEnd: () => {},
    lastActiveEngine: () => 'llama' as const,
    engineForProvider: (p: string) => (p === 'llama' || p === 'ollama' || p === 'lmstudio' ? p : null),
    activateEngine: async (t: string) => { order.push(`activate-${t}`); return { freed: [], llamaStarted: false }; },
    ensureLlamaActive: async () => { order.push('llama-restore'); },
    setImageSwapActive: (v: boolean) => { swap = v; },
    isImageSwapActive: () => swap,
    ImageSwapBusyError: class ImageSwapBusyError extends Error {},
    IMAGE_SWAP_BUSY_MESSAGE:
      'An image is being generated — the chat model will be back when it finishes. Ask again in a moment.',
  };
});
// The VRAM-release wait probes nvidia-smi via exec; report an instantly-free
// GPU and record the probe so the swap order can assert it happens.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  exec: (cmd: string, opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    order.push('vram-probe');
    cb(null, '100, 8192\n', '');
  },
}));
// The chat route must never reach the model stream while a swap is active —
// if it does, this throws and the test fails.
vi.mock('@/lib/dispatch', () => ({
  streamForModel: () => { throw new Error('streamForModel must not run during an image swap'); },
}));
vi.mock('@/lib/agent', () => ({ runAgent: vi.fn(), supportsTools: () => false }));
vi.mock('@/lib/llama', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llama')>()),
  generateTitle: async () => 'Test title',
}));

// Hardware probing is machine-dependent; the route test pins a 4 GB GPU so
// decideImageMode picks swap.
vi.mock('@/lib/hardware', () => ({
  detectHardware: async () => ({
    totalRamGb: 16, availableRamGb: 8, cpuName: 'x', cpuCores: 8,
    hasGpu: true, gpuName: 'RTX 3050', gpuVramGb: 4, gpuCount: 1,
    backend: 'cuda', unifiedMemory: false, gpuError: null,
  }),
}));

const { detectImageIntent, stripImagePrefix } = await import('@/lib/image-intent');
const dbm = await import('@/lib/db');
const imggen = await import('@/lib/image-gen');
const sd = await import('@/lib/sd-server');
const backends = await import('@/lib/backends');
const { GET: imagesGET } = await import('@/app/api/images/route');
const { POST: generatePOST } = await import('@/app/api/images/generate/route');
const { POST: cancelPOST } = await import('@/app/api/images/cancel/route');
const { POST: chatPOST } = await import('@/app/api/chat/route');
const { GET: adminGET, PUT: adminPUT } = await import('@/app/api/admin/images/route');
const imagemodels = await import('@/app/api/admin/imagemodels/route');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

const ADMIN = { user: { id: 1, name: 'admin', isAdmin: true } };
const MEMBER = { user: { id: 2, name: 'bob', isAdmin: false } };

function req(body: unknown): NextRequest {
  return { json: async () => body, signal: new AbortController().signal } as unknown as NextRequest;
}

function hw(over: Partial<import('@/lib/hardware').Hardware>): import('@/lib/hardware').Hardware {
  return {
    totalRamGb: 32, availableRamGb: 16, cpuName: 'x', cpuCores: 8,
    hasGpu: true, gpuName: 'RTX 4070', gpuVramGb: 12, gpuCount: 1,
    backend: 'cuda', unifiedMemory: false, gpuError: null, ...over,
  };
}

describe('stripImagePrefix', () => {
  it('strips explicit command prefixes', () => {
    expect(stripImagePrefix('/image a fox in the snow')).toBe('a fox in the snow');
    expect(stripImagePrefix('/img  neon city')).toBe('neon city');
    expect(stripImagePrefix('/draw a tree')).toBe('a tree');
  });
  it('returns null without a prefix or with an empty prompt', () => {
    expect(stripImagePrefix('hello there')).toBeNull();
    expect(stripImagePrefix('/image')).toBeNull();
    expect(stripImagePrefix('/image   ')).toBeNull();
  });
});

describe('detectImageIntent', () => {
  it('detects natural image requests and extracts the subject', () => {
    expect(detectImageIntent('generate an image of a lighthouse at dusk')).toBe('a lighthouse at dusk');
    expect(detectImageIntent('can you draw a cat wearing sunglasses?')).toBe('cat wearing sunglasses?');
    expect(detectImageIntent('make me a picture of the alps')).toBe('the alps');
    expect(detectImageIntent('please create a logo for my bakery')).toBe('for my bakery');
    expect(detectImageIntent('paint me a sunset')).toBe('sunset');
    expect(detectImageIntent('draw a red balloon')).toBe('red balloon');
  });
  it('honors the explicit prefix', () => {
    expect(detectImageIntent('/image a fox')).toBe('a fox');
  });
  it('ignores ordinary chat messages', () => {
    expect(detectImageIntent('what is the capital of France?')).toBeNull();
    expect(detectImageIntent('show me the code for a debounce function')).toBeNull();
    expect(detectImageIntent('image compression is interesting')).toBeNull();
    expect(detectImageIntent('make an image')).toBeNull(); // no subject
    expect(detectImageIntent('')).toBeNull();
  });
});

describe('buildImgGenRequest', () => {
  it('produces the sd-server Iris request shape', () => {
    const b = sd.buildImgGenRequest({ prompt: 'a fox', width: 512, height: 512 });
    expect(b).toEqual({
      prompt: 'a fox',
      negative_prompt: '',
      width: 512,
      height: 512,
      seed: -1,
      batch_count: 1,
      sample_params: { sample_method: 'dpm++2m', sample_steps: 20, guidance: { txt_cfg: 3 } },
      preview: 'none',
      output_format: 'png',
    });
  });
  it('floors dimensions to multiples of 16 and clamps to 1024', () => {
    const b = sd.buildImgGenRequest({ prompt: 'x', width: 500, height: 2000 });
    expect(b.width).toBe(496);
    expect(b.height).toBe(1024);
    expect(sd.buildImgGenRequest({ prompt: 'x', width: 4, height: 4 }).width).toBe(16);
  });
  it('clamps steps and honors an explicit seed', () => {
    expect(sd.buildImgGenRequest({ prompt: 'x', width: 512, height: 512, steps: 0 }).sample_params.sample_steps).toBe(1);
    expect(sd.buildImgGenRequest({ prompt: 'x', width: 512, height: 512, steps: 999 }).sample_params.sample_steps).toBe(50);
    expect(sd.buildImgGenRequest({ prompt: 'x', width: 512, height: 512, seed: 42 }).seed).toBe(42);
    expect(sd.buildImgGenRequest({ prompt: 'x', width: 512, height: 512, seed: Number.NaN }).seed).toBe(-1);
  });
});

describe('decideImageMode', () => {
  it('swaps on small cards, runs parallel with 12+ GB VRAM', () => {
    expect(imggen.decideImageMode(hw({ gpuVramGb: 4 }), '')).toBe('swap');
    expect(imggen.decideImageMode(hw({ gpuVramGb: 12 }), '')).toBe('parallel');
  });
  it('runs parallel on unified-memory machines with 32+ GB RAM', () => {
    const mac = hw({ unifiedMemory: true, backend: 'metal', gpuVramGb: null, totalRamGb: 32 });
    expect(imggen.decideImageMode(mac, '')).toBe('parallel');
    expect(imggen.decideImageMode({ ...mac, totalRamGb: 16 }, '')).toBe('swap');
  });
  it('honors an explicit IMAGE_ENGINE_MODE override', () => {
    expect(imggen.decideImageMode(hw({ gpuVramGb: 4 }), 'parallel')).toBe('parallel');
    expect(imggen.decideImageMode(hw({ gpuVramGb: 24 }), 'swap')).toBe('swap');
    expect(imggen.decideImageMode(hw({ gpuVramGb: 24 }), 'AUTO')).toBe('parallel');
  });
});

describe('hardwareCanAttemptImageGen', () => {
  it('refuses only when there is no accelerator at all', () => {
    expect(imggen.hardwareCanAttemptImageGen(hw({ gpuVramGb: 4 }))).toBe(true);
    expect(imggen.hardwareCanAttemptImageGen(hw({ hasGpu: false, gpuVramGb: null }))).toBe(false);
    expect(imggen.hardwareCanAttemptImageGen(hw({ unifiedMemory: true, backend: 'metal', hasGpu: false, gpuVramGb: null }))).toBe(true);
  });
});

describe('pollJob', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');

  it('resolves with the PNG bytes when the job completes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(String(url)).toContain('/sdcpp/v1/jobs/job_1');
      return new Response(JSON.stringify({ id: 'job_1', status: 'completed', result: { images: [{ b64_json: png.toString('base64') }] } }), { status: 200 });
    }));
    const out = await sd.pollJob('job_1');
    expect(out.bytes.equals(png)).toBe(true);
  });

  it('reports step progress before completing', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      const body = calls === 1
        ? { id: 'job_1', status: 'generating', preview: { step: 5, total_steps: 20 } }
        : { id: 'job_1', status: 'completed', result: { images: [{ b64_json: png.toString('base64') }] } };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const seen: Array<[number, number]> = [];
    const out = await sd.pollJob('job_1', undefined, (s, t) => seen.push([s, t]));
    expect(seen).toEqual([[5, 20]]);
    expect(out.steps).toEqual({ step: 5, total: 20 });
  });

  it('throws the engine error message when the job fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id: 'j', status: 'failed', error: { message: 'out of VRAM' } }), { status: 200 })));
    await expect(sd.pollJob('j')).rejects.toThrow('out of VRAM');
  });

  it('throws when the job vanished from the engine (404)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(sd.pollJob('j')).rejects.toThrow(/vanished/);
  });

  it('cancels the job server-side when the caller aborts', async () => {
    const ac = new AbortController();
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response('{}', { status: 200 });
    }));
    ac.abort();
    await expect(sd.pollJob('j', ac.signal)).rejects.toThrow('cancelled');
    await new Promise((r) => setTimeout(r, 20)); // cancelJob fires from a finally
    expect(calls.some((c) => c.startsWith('POST') && c.includes('/sdcpp/v1/jobs/j/cancel'))).toBe(true);
  });

  it('fails fast when the engine stops making progress (stall watchdog)', async () => {
    vi.useFakeTimers();
    try {
      // The job is alive but the step counter never moves — the 5-minute
      // watchdog must fire long before the 45-minute hard cap.
      vi.stubGlobal('fetch', vi.fn(async () =>
        new Response(JSON.stringify({ id: 'j', status: 'generating', preview: { step: 3, total_steps: 30 } }), { status: 200 })));
      const p = sd.pollJob('j');
      const assertion = expect(p).rejects.toThrow(/stopped making progress/);
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a slow-but-progressing job run past the old 10-minute cap', async () => {
    vi.useFakeTimers();
    try {
      const png = Buffer.from('89504e470d0a1a0a', 'hex');
      let step = 0;
      vi.stubGlobal('fetch', vi.fn(async () => {
        step++;
        const body = step >= 300
          ? { id: 'j', status: 'completed', result: { images: [{ b64_json: png.toString('base64') }] } }
          : { id: 'j', status: 'generating', preview: { step, total_steps: 300 } };
        return new Response(JSON.stringify(body), { status: 200 });
      }));
      const p = sd.pollJob('j');
      await vi.advanceTimersByTimeAsync(15 * 60_000); // 15 min of steady progress
      const out = await p;
      expect(out.bytes.equals(png)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never stall-kills a job whose engine reports no step preview (our default)', async () => {
    // sd-server with preview:'none' never sends step data; the watchdog must
    // stay disarmed or every slow low-VRAM job would die at 5 minutes.
    vi.useFakeTimers();
    try {
      const png = Buffer.from('89504e470d0a1a0a', 'hex');
      let polls = 0;
      vi.stubGlobal('fetch', vi.fn(async () => {
        polls++;
        const body = polls >= 400 // 400 × 2s poll interval ≈ 13 minutes
          ? { id: 'j', status: 'completed', result: { images: [{ b64_json: png.toString('base64') }] } }
          : { id: 'j', status: 'generating' };
        return new Response(JSON.stringify(body), { status: 200 });
      }));
      const p = sd.pollJob('j');
      await vi.advanceTimersByTimeAsync(14 * 60_000);
      const out = await p;
      expect(out.bytes.equals(png)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('image generation daily limit', () => {
  it('counts only today, per user', () => {
    // FK: the ledger references real users.
    dbm.createUser('imgadmin', 'x'); // id 1
    dbm.createUser('imgbob', 'x');   // id 2
    expect(dbm.imageGenerationsToday(2)).toBe(0);
    for (let i = 0; i < 3; i++) dbm.recordImageGeneration(2);
    expect(dbm.imageGenerationsToday(2)).toBe(3);
    expect(dbm.imageGenerationsToday(1)).toBe(0); // other users unaffected
  });

  it('blocks a member at the limit but never an admin', async () => {
    // Burn user 2's remaining allowance.
    while (dbm.imageGenerationsToday(2) < dbm.IMAGE_GEN_DAILY_LIMIT) dbm.recordImageGeneration(2);
    expect(imggen.imageGenRemaining(2, false)).toBe(0);
    expect(await imggen.preflight(2, false)).toMatchObject({ ok: false, status: 403 }); // not allowlisted
    // Admins run the hardware: infinite headroom, preflight only gates on the
    // feature being enabled (it is still off in this db, so 403 — not 429).
    expect(imggen.imageGenRemaining(1, true)).toBe(Number.POSITIVE_INFINITY);
    const pre = await imggen.preflight(1, true);
    expect(pre).toMatchObject({ ok: false, status: 403 });
  });
});

describe('image gen settings + allowlist', () => {
  it('is disabled with an empty allowlist by default', () => {
    const s = imggen.readImageGenSettings();
    expect(s.enabled).toBe(false);
    expect(s.allowlist).toEqual([]);
    expect(imggen.isImageGenAllowed(1, true)).toBe(false); // off for everyone until enabled
  });
});

describe('GET /api/images', () => {
  it('rejects unauthenticated requests with 401', async () => {
    mockAuth.session = null;
    expect((await imagesGET()).status).toBe(401);
  });
  it('reports the feature as disabled by default', async () => {
    mockAuth.session = MEMBER;
    const r = await imagesGET();
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.enabled).toBe(false);
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
  });
});

describe('POST /api/images/generate gates', () => {
  it('rejects unauthenticated requests with 401', async () => {
    mockAuth.session = null;
    expect((await generatePOST(req({ message: 'a fox' }))).status).toBe(401);
  });
  it('rejects a missing or overlong prompt with 400', async () => {
    mockAuth.session = ADMIN;
    expect((await generatePOST(req({}))).status).toBe(400);
    expect((await generatePOST(req({ message: 'x'.repeat(4001) }))).status).toBe(400);
  });
  it('refuses with 403 while the feature is disabled (before any engine work)', async () => {
    mockAuth.session = ADMIN;
    const r = await generatePOST(req({ message: 'a fox' }));
    expect(r.status).toBe(403);
    const d = await r.json();
    expect(String(d.error)).toMatch(/turned off/i);
  });
});

describe('admin images route', () => {
  it('rejects non-admins with 403', async () => {
    mockAuth.session = MEMBER;
    expect((await adminGET()).status).toBe(403);
    expect((await adminPUT(req({ enabled: true }))).status).toBe(403);
  });

  it('round-trips the enable flag and validates input', async () => {
    mockAuth.session = ADMIN;
    // Users 1 and 2 exist (created in the daily-limit test above), so the
    // allowlist filter has something to keep.

    expect((await adminPUT(req({ enabled: 'yes' }))).status).toBe(400);
    expect((await adminPUT(req({ allowlist: 'everyone' }))).status).toBe(400);
    expect((await adminPUT(req({ nope: 1 }))).status).toBe(400);

    const r = await adminPUT(req({ enabled: true }));
    expect(r.status).toBe(200);
    expect((await r.json()).enabled).toBe(true);

    const a = await adminPUT(req({ allowlist: [1, 2, 999999] }));
    expect(a.status).toBe(200);
    expect((await a.json()).allowlist).toEqual([1, 2]); // unknown ids dropped
  });

  it('reports the stable-diffusion.cpp engine, mode, and models', async () => {
    mockAuth.session = ADMIN;
    // Point at a closed port so `online` is deterministic (a real sd-server
    // may be running on the default port on the dev machine).
    const saved = process.env.SDCPP_URL;
    process.env.SDCPP_URL = 'http://127.0.0.1:9';
    try {
      const d = await (await adminGET()).json();
      expect(d.engine).toBe('stable-diffusion.cpp');
      expect(d.mode).toBe('swap'); // mocked hardware: 4 GB card
      expect(d.online).toBe(false);
      expect(d.activeModel).toBe(SAKURA);
      expect(d.models.map((m: { name: string }) => m.name)).toContain(SAKURA);
    } finally {
      if (saved === undefined) delete process.env.SDCPP_URL; else process.env.SDCPP_URL = saved;
    }
  });

  it('admins are always allowed once enabled; members need the allowlist', async () => {
    expect(imggen.isImageGenAllowed(1, true)).toBe(true);
    expect(imggen.isImageGenAllowed(2, false)).toBe(true);  // allowlisted above
    expect(imggen.isImageGenAllowed(3, false)).toBe(false);
  });
});

describe('admin imagemodels route', () => {
  it('rejects non-admins with 403', async () => {
    mockAuth.session = MEMBER;
    expect((await imagemodels.GET()).status).toBe(403);
    expect((await imagemodels.POST(req({ name: 'model-b.gguf' }))).status).toBe(403);
    expect((await imagemodels.DELETE(req({ name: 'model-b.gguf' }))).status).toBe(403);
  });

  it('lists diffusion GGUFs and never the text encoder', async () => {
    mockAuth.session = ADMIN;
    const d = await (await imagemodels.GET()).json();
    const names = d.models.map((m: { name: string }) => m.name);
    expect(names).toEqual(expect.arrayContaining([SAKURA, 'model-b.gguf', 'model-c.gguf']));
    expect(names).not.toContain('Qwen3VL-4B-Instruct-Q4_K_M.gguf');
    expect(d.models.find((m: { name: string }) => m.name === SAKURA).active).toBe(true);
  });

  it('sets the active model and validates names', async () => {
    mockAuth.session = ADMIN;
    expect((await imagemodels.POST(req({ name: '../secret.gguf' }))).status).toBe(400);
    expect((await imagemodels.POST(req({ name: 'not-a-gguf.safetensors' }))).status).toBe(400);
    expect((await imagemodels.POST(req({ name: 'missing.gguf' }))).status).toBe(404);

    const r = await imagemodels.POST(req({ name: 'model-b.gguf' }));
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.models.find((m: { name: string }) => m.name === 'model-b.gguf').active).toBe(true);
    expect(await imggen.getActiveImageModel()).toBe('model-b.gguf');
  });

  it('refuses to delete the active model; deletes other files from disk', async () => {
    mockAuth.session = ADMIN;
    expect((await imagemodels.DELETE(req({ name: 'model-b.gguf' }))).status).toBe(409); // active
    expect((await imagemodels.DELETE(req({ name: 'missing.gguf' }))).status).toBe(404);

    const r = await imagemodels.DELETE(req({ name: 'model-c.gguf' }));
    expect(r.status).toBe(200);
    expect(fs.existsSync(path.join(sdTmp, 'models', 'model-c.gguf'))).toBe(false);
    expect((await r.json()).models.map((m: { name: string }) => m.name)).not.toContain('model-c.gguf');

    // Restore the default for the flow test below.
    await imagemodels.POST(req({ name: SAKURA }));
    expect(await imggen.getActiveImageModel()).toBe(SAKURA);
  });
});

describe('POST /api/images/generate full flow (stub sd-server, swap mode)', () => {
  const convId = 'testconv-img-flow';
  const dir = path.join(process.cwd(), 'data', 'workspaces', convId);

  it('streams the image frame, swaps the GPU in order, and persists everything', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const got: { body?: Record<string, unknown> } = {};
    const server = http.createServer((rq, rs) => {
      const url = new URL(rq.url ?? '/', 'http://x');
      const json = (o: unknown, code = 200) => { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(o)); };
      if (url.pathname === '/sdcpp/v1/capabilities') return json({});
      if (rq.method === 'POST' && url.pathname === '/sdcpp/v1/img_gen') {
        let body = '';
        rq.on('data', (c) => (body += c));
        rq.on('end', () => {
          order.push('generate');
          got.body = JSON.parse(body);
          json({ id: 'job_1', poll_url: '/sdcpp/v1/jobs/job_1' }, 202);
        });
        return;
      }
      if (url.pathname === '/sdcpp/v1/jobs/job_1') {
        return json({ id: 'job_1', status: 'completed', result: { images: [{ b64_json: png.toString('base64') }] } });
      }
      rs.writeHead(404); rs.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.SDCPP_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    try {
      // Feature was enabled by the admin-route test above (same db).
      dbm.createConversation(convId, 1, 'chakor', 'flow test');
      mockAuth.session = ADMIN;
      const before = dbm.imageGenerationsToday(1);
      order.length = 0;
      sdCalls.length = 0;

      const res = await generatePOST(req({ conversationId: convId, message: '/image a fox in the snow' }));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');

      const text = await new Response(res.body).text();
      const frames = text.split('\n\n')
        .map((p) => p.replace(/^data: /m, '').trim())
        .filter((p) => p && p !== '[DONE]')
        .map((p) => { try { return JSON.parse(p); } catch { return null; } })
        .filter(Boolean) as Array<Record<string, unknown>>;

      const imgFrame = frames.find((f) => f.image) as { image: { name: string; url: string; prompt: string } } | undefined;
      expect(imgFrame).toBeTruthy();
      expect(imgFrame!.image.prompt).toBe('a fox in the snow'); // prefix stripped
      expect(imgFrame!.image.url).toBe(`/api/workspace/${convId}/files/${imgFrame!.image.name}`);
      expect(frames.some((f) => f.userMsgId)).toBe(true);
      expect(frames.some((f) => f.assistantMsgId)).toBe(true);

      // Masking: no model file names or paths in anything the client saw.
      expect(text).not.toMatch(/\.gguf/);
      expect(text).not.toContain(sdTmp);

      // Swap choreography: llama stops → sd-server starts (lowvram) → the job
      // runs → sd-server stops → VRAM is confirmed free → llama is restored.
      expect(order).toEqual(['llama-stop', 'sd-start-lowvram', 'generate', 'sd-stop', 'vram-probe', 'llama-restore']);
      expect(sdCalls[0].modelPath).toBe(path.join(sdTmp, 'models', SAKURA));

      // The submitted request is the Iris shape at the default size.
      expect(got.body?.prompt).toBe('a fox in the snow');
      expect(got.body?.width).toBe(1024);
      expect((got.body?.sample_params as { sample_method?: string })?.sample_method).toBe('dpm++2m');

      // Persisted assistant reply embeds the image markdown.
      const msgs = dbm.listMessages(convId);
      const assistant = msgs.find((m) => m.role === 'assistant');
      expect(assistant?.content).toContain(`![a fox in the snow](${imgFrame!.image.url})`);

      // The file landed in the conversation workspace and the daily ledger moved.
      expect(fs.existsSync(path.join(dir, imgFrame!.image.name))).toBe(true);
      expect(dbm.imageGenerationsToday(1)).toBe(before + 1);
    } finally {
      delete process.env.SDCPP_URL;
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseNvidiaSmiMem', () => {
  it('parses used,total MB from nvidia-smi csv output', () => {
    expect(imggen.parseNvidiaSmiMem('1234, 8192\n')).toEqual({ usedMb: 1234, totalMb: 8192 });
    // Multi-GPU machines print one line per card; the first is what we run on.
    expect(imggen.parseNvidiaSmiMem('512, 4096\n1024, 8192\n')).toEqual({ usedMb: 512, totalMb: 4096 });
  });
  it('throws on unparseable output (caller falls back to a grace sleep)', () => {
    expect(() => imggen.parseNvidiaSmiMem('nvidia-smi: command not found')).toThrow();
    expect(() => imggen.parseNvidiaSmiMem('')).toThrow();
  });
});

describe('system prompt image rule', () => {
  it('forbids invented image markdown and points at the Create image button', async () => {
    const { buildSystemPrompt } = await import('@/lib/system-prompt');
    const p = buildSystemPrompt();
    expect(p).toContain('cannot create, draw, or generate images');
    expect(p).toContain('![...](...)');
    expect(p).toContain('/api/workspace/');
    expect(p).toContain('Create image button');
  });
});

describe('runImageJob swap flag', () => {
  it('holds the flag for the whole swap critical section', async () => {
    let flagDuring: boolean | null = null;
    await imggen.runImageJob('swap', '/models/x.gguf', async () => {
      flagDuring = backends.isImageSwapActive();
    });
    expect(flagDuring).toBe(true);
    expect(backends.isImageSwapActive()).toBe(false);
  });

  it('never touches the flag (or llama) in parallel mode', async () => {
    order.length = 0;
    let flagDuring: boolean | null = null;
    await imggen.runImageJob('parallel', '/models/x.gguf', async () => {
      flagDuring = backends.isImageSwapActive();
    });
    expect(flagDuring).toBe(false);
    expect(backends.isImageSwapActive()).toBe(false);
    expect(order).toEqual(['sd-start']); // llama was never stopped or restored
  });
});

describe('ensureLlamaActive swap guard (real backends module)', () => {
  it('refuses to restart llama while an image swap is active', async () => {
    const real = await vi.importActual<typeof import('@/lib/backends')>('@/lib/backends');
    const saved = process.env.LLAMA_BASE_URL;
    process.env.LLAMA_BASE_URL = 'http://127.0.0.1:9'; // nothing there → llama reads as down
    order.length = 0;
    try {
      real.setImageSwapActive(true);
      await expect(real.ensureLlamaActive()).rejects.toBeInstanceOf(real.ImageSwapBusyError);
      expect(order).not.toContain('llama-restart'); // no relaunch was attempted
    } finally {
      real.setImageSwapActive(false);
      if (saved === undefined) delete process.env.LLAMA_BASE_URL; else process.env.LLAMA_BASE_URL = saved;
    }
  });
});

describe('chat during an image swap', () => {
  const convId = 'testconv-swap-chat';

  it('streams the friendly holding message and never touches the engine', async () => {
    dbm.createConversation(convId, 1, 'chakor', 'swap chat');
    mockAuth.session = ADMIN;
    order.length = 0;
    backends.setImageSwapActive(true);
    try {
      const res = await chatPOST(req({ conversationId: convId, message: 'hello there' }));
      expect(res.status).toBe(200); // a normal SSE answer, not a 500
      const text = await new Response(res.body).text();
      expect(text).toContain(backends.IMAGE_SWAP_BUSY_MESSAGE);
      // No engine switch, no llama restart — streamForModel is mocked to throw
      // if it is ever reached, so getting here already proves it was not.
      expect(order).toEqual([]);
      // Persisted like a normal assistant reply.
      const assistant = dbm.listMessages(convId).find((m) => m.role === 'assistant');
      expect(assistant?.content).toBe(backends.IMAGE_SWAP_BUSY_MESSAGE);
    } finally {
      backends.setImageSwapActive(false);
    }
  });
});

describe('POST /api/images/generate failure persistence', () => {
  function stubServer(handler: (url: URL, rq: http.IncomingMessage, rs: http.ServerResponse) => void) {
    return http.createServer((rq, rs) => handler(new URL(rq.url ?? '/', 'http://x'), rq, rs));
  }
  const json = (rs: http.ServerResponse, o: unknown, code = 200) => {
    rs.writeHead(code, { 'Content-Type': 'application/json' });
    rs.end(JSON.stringify(o));
  };

  it('persists an assistant message when the engine job fails', async () => {
    const convId = 'testconv-img-fail';
    const server = stubServer((url, rq, rs) => {
      if (url.pathname === '/sdcpp/v1/capabilities') return json(rs, {});
      if (rq.method === 'POST' && url.pathname === '/sdcpp/v1/img_gen') return json(rs, { id: 'job_f', poll_url: '/sdcpp/v1/jobs/job_f' }, 202);
      if (url.pathname === '/sdcpp/v1/jobs/job_f') return json(rs, { id: 'job_f', status: 'failed', error: { message: 'sampling exploded' } });
      rs.writeHead(404); rs.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.SDCPP_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      dbm.createConversation(convId, 1, 'chakor', 'fail test');
      mockAuth.session = ADMIN;
      const res = await generatePOST(req({ conversationId: convId, message: '/image a fox' }));
      expect(res.status).toBe(200);
      const text = await new Response(res.body).text();
      expect(text).toContain('Image generation failed');
      // The failure is persisted — history never shows an unanswered prompt.
      const assistant = dbm.listMessages(convId).find((m) => m.role === 'assistant');
      expect(assistant?.content).toContain('Image generation failed');
      expect(assistant?.content).toContain('sampling exploded'); // admin sees the engine reason
    } finally {
      delete process.env.SDCPP_URL;
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('client disconnect does NOT cancel: the job completes and persists', async () => {
    const convId = 'testconv-img-disconnect';
    const dir = path.join(process.cwd(), 'data', 'workspaces', convId);
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    let complete = false;
    let cancelCalls = 0;
    const server = stubServer((url, rq, rs) => {
      if (url.pathname === '/sdcpp/v1/capabilities') return json(rs, {});
      if (rq.method === 'POST' && url.pathname === '/sdcpp/v1/img_gen') return json(rs, { id: 'job_d', poll_url: '/sdcpp/v1/jobs/job_d' }, 202);
      if (url.pathname === '/sdcpp/v1/jobs/job_d/cancel') { cancelCalls++; return json(rs, {}); }
      if (url.pathname === '/sdcpp/v1/jobs/job_d') {
        return json(rs, complete
          ? { id: 'job_d', status: 'completed', result: { images: [{ b64_json: png.toString('base64') }] } }
          : { id: 'job_d', status: 'generating' });
      }
      rs.writeHead(404); rs.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.SDCPP_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      dbm.createConversation(convId, 1, 'chakor', 'disconnect test');
      mockAuth.session = ADMIN;
      const res = await generatePOST(req({ conversationId: convId, message: '/image a fox' }));
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      await reader.read(); // first frames arrived → generation is under way
      await reader.cancel(); // the user refreshed/closed the tab mid-generation
      complete = true;
      // The job runs to completion anyway and the reply + file are persisted.
      await vi.waitFor(() => {
        const assistant = dbm.listMessages(convId).find((m) => m.role === 'assistant');
        expect(assistant?.content).toContain('![');
      }, { timeout: 15000 });
      expect(cancelCalls).toBe(0); // disconnect never hit the engine's cancel
      expect(fs.readdirSync(dir).some((f) => f.endsWith('.png'))).toBe(true);
    } finally {
      delete process.env.SDCPP_URL;
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/images/cancel', () => {
  it('cancels the job server-side for the owner; non-owner gets 403; no job gets 404', async () => {
    const convId = 'testconv-img-cancel2';
    let cancelled = false;
    const server = http.createServer((rq, rs) => {
      const url = new URL(rq.url ?? '/', 'http://x');
      const json = (o: unknown, code = 200) => { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(o)); };
      if (url.pathname === '/sdcpp/v1/capabilities') return json({});
      if (rq.method === 'POST' && url.pathname === '/sdcpp/v1/img_gen') return json({ id: 'job_e', poll_url: '/sdcpp/v1/jobs/job_e' }, 202);
      if (url.pathname === '/sdcpp/v1/jobs/job_e/cancel') { cancelled = true; return json({}); }
      if (url.pathname === '/sdcpp/v1/jobs/job_e') return json({ id: 'job_e', status: cancelled ? 'cancelled' : 'generating' });
      rs.writeHead(404); rs.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.SDCPP_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      dbm.createConversation(convId, 1, 'chakor', 'cancel endpoint test');
      mockAuth.session = null;
      expect((await cancelPOST(req({ conversationId: convId }))).status).toBe(401);

      mockAuth.session = ADMIN;
      const res = await generatePOST(req({ conversationId: convId, message: '/image a fox' }));
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      // Wait until the job is submitted and tracked.
      await vi.waitFor(() => expect(imggen.getActiveImageJob(convId)).not.toBeNull(), { timeout: 10000 });

      // A non-owner (member, conversation belongs to admin user 1) cannot cancel.
      mockAuth.session = MEMBER;
      expect((await cancelPOST(req({ conversationId: convId }))).status).toBe(403);
      expect(cancelled).toBe(false);

      // The owner can: sd-server gets the cancel, the poll ends as 'cancelled'.
      mockAuth.session = ADMIN;
      expect((await cancelPOST(req({ conversationId: convId }))).status).toBe(200);
      expect(cancelled).toBe(true);
      try { while (!(await reader.read()).done) { /* drain */ } } catch { /* stream may close abruptly */ }
      await vi.waitFor(() => {
        const assistant = dbm.listMessages(convId).find((m) => m.role === 'assistant');
        expect(assistant?.content).toBe('_Image generation cancelled._');
      }, { timeout: 15000 });

      // The job is over — a second cancel finds nothing to stop.
      expect((await cancelPOST(req({ conversationId: convId }))).status).toBe(404);
    } finally {
      delete process.env.SDCPP_URL;
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('workspace file route: inline images + share access', () => {
  // The route resolves files under <cwd>/data/workspaces/<convId>.
  const convId = 'testconv-img-1';
  const dir = path.join(process.cwd(), 'data', 'workspaces', convId);
  const fname = 'img-test.png';

  async function callGET(asSession: unknown, shared: boolean) {
    if (shared) dbm.setShareSlug(convId, 'someslug');
    else dbm.clearShareSlug(convId, 1);
    mockAuth.session = asSession;
    const { GET } = await import('@/app/api/workspace/[convId]/files/[name]/route');
    return GET({} as NextRequest, { params: Promise.resolve({ convId, name: fname }) });
  }

  it('serves images inline to the owner and to share-link viewers, hides them otherwise', async () => {
    dbm.createConversation(convId, 1, 'chakor', 'img test');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fname), Buffer.from('89504e47', 'hex'));
    try {
      const own = await callGET(MEMBER, false); // user 2 doesn't own conv 1's conversation
      expect(own.status).toBe(404);

      const owner = await callGET(ADMIN, false); // admin user 1 owns it
      expect(owner.status).toBe(200);
      expect(owner.headers.get('Content-Type')).toBe('image/png');
      expect(owner.headers.get('Content-Disposition')).toMatch(/^inline/);

      const anon = await callGET(null, false);
      expect(anon.status).toBe(404);

      const sharedAnon = await callGET(null, true);
      expect(sharedAnon.status).toBe(200);
      expect(sharedAnon.headers.get('Content-Disposition')).toMatch(/^inline/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
