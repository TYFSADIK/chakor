import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isAdminSession } from '@/lib/guard';
import { getAvailableModels, discoverOllamaModels, discoverLmStudioModels, maskedModel } from '@/lib/models';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Non-admins must never see which real models the server runs: they get one
  // synthetic "Chakor" entry, and chat requests force-resolve to the default.
  if (!isAdminSession(session)) return NextResponse.json([maskedModel()]);

  // Static models (local llama + any configured cloud keys) plus whatever models
  // Ollama and LM Studio currently have available, discovered live. Both probes
  // return [] fast when their server isn't running, so this stays snappy.
  const [ollama, lmstudio] = await Promise.all([discoverOllamaModels(), discoverLmStudioModels()]);
  return NextResponse.json([...getAvailableModels(), ...ollama, ...lmstudio]);
}
