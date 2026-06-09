import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAvailableModels, discoverOllamaModels, discoverLmStudioModels } from '@/lib/models';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Static models (local llama + any configured cloud keys) plus whatever models
  // Ollama and LM Studio currently have available, discovered live. Both probes
  // return [] fast when their server isn't running, so this stays snappy.
  const [ollama, lmstudio] = await Promise.all([discoverOllamaModels(), discoverLmStudioModels()]);
  return NextResponse.json([...getAvailableModels(), ...ollama, ...lmstudio]);
}
