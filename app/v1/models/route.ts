import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey } from '@/lib/apiauth';
import { getAvailableModels, discoverOllamaModels } from '@/lib/models';

/**
 * OpenAI-compatible model list: GET /v1/models
 * Lets other tools (the OpenAI SDK, LM Studio clients, scripts) discover what
 * this server can run. Same models the chat UI sees.
 */
export async function GET(req: NextRequest) {
  if (!authenticateApiKey(req)) {
    return NextResponse.json({ error: { message: 'Invalid API key', type: 'invalid_request_error' } }, { status: 401 });
  }

  const ollama = await discoverOllamaModels();
  const models = [...getAvailableModels(), ...ollama];

  return NextResponse.json({
    object: 'list',
    data: models.map((m) => ({
      id: m.id,
      object: 'model',
      created: 0,
      owned_by: m.provider,
    })),
  });
}
