import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Session } from 'next-auth';

const execAsync = promisify(exec);

function requireAdmin(session: Session | null) {
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(session.user as unknown as { isAdmin?: boolean }).isAdmin)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

export async function GET() {
  const session = await auth();
  const deny = requireAdmin(session);
  if (deny) return deny;

  // Check llama-server health
  const llamaUrl = process.env.LLAMA_BASE_URL ?? process.env.CHAKOR_MODEL_URL ?? 'http://127.0.0.1:4546';
  let llamaOnline = false;
  try {
    const res = await fetch(`${llamaUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    llamaOnline = res.ok;
  } catch { /* offline */ }

  // GPU stats via nvidia-smi
  type GpuStat = { utilization: number; memUsed: number; memTotal: number };
  let gpuStats: GpuStat[] | null = null;
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits',
      { timeout: 5000 },
    );
    gpuStats = stdout.trim().split('\n').map((line) => {
      const [util, memUsed, memTotal] = line.split(',').map((s) => parseInt(s.trim(), 10));
      return { utilization: util || 0, memUsed: memUsed || 0, memTotal: memTotal || 0 };
    });
  } catch { /* no nvidia-smi */ }

  return NextResponse.json({
    llamaOnline,
    llamaUrl,
    modelName: process.env.LLAMA_MODEL ?? process.env.CHAKOR_MODEL_ALIAS ?? 'Chakor',
    gpuStats,
  });
}
