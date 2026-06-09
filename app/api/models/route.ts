import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAvailableModels, discoverOllamaModels } from '@/lib/models';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Static models (local llama + any configured cloud keys) plus whatever
  // models Ollama currently has installed, discovered live.
  const [ollama] = await Promise.all([discoverOllamaModels()]);
  return NextResponse.json([...getAvailableModels(), ...ollama]);
}
