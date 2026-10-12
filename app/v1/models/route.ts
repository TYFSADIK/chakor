import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey } from '@/lib/apiauth';
import { getAvailableModels, discoverOllamaModels, maskedModel } from '@/lib/models';

/**
 * OpenAI-compatible model list: GET /v1/models
 * Lets other tools (the OpenAI SDK, LM Studio clients, scripts) discover what
 * this server can run. Same models the chat UI sees.
 *
 * Non-admin keys get the masked list: a single synthetic "chakor" entry, so the
 * real models the server runs never leak through the API.
 */
export async function GET(req: NextRequest) {
  const user = authenticateApiKey(req);
  if (!user) {
    return NextResponse.json({ error: { message: 'Invalid API key', type: 'invalid_request_error' } }, { status: 401 });
  }

  if (user.is_admin !== 1) {
    const m = maskedModel();
    return NextResponse.json({
      object: 'list',
      data: [{ id: m.id, object: 'model', created: 0, owned_by: m.provider }],
    });
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
