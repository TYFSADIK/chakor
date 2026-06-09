import { randomBytes } from 'node:crypto';
import { getApiKeyByToken, touchApiKey, getUserById, type User } from './db';

/** Mint a new API token. Looks like "sk-chakor-<43 url-safe chars>". */
export function generateApiToken(): string {
  return 'sk-chakor-' + randomBytes(32).toString('base64url');
}

/** Show only the tail of a token, e.g. "sk-chakor-…a1b2". Never store/return the rest. */
export function maskToken(token: string): string {
  return 'sk-chakor-…' + token.slice(-4);
}

/**
 * Authenticate a request to the OpenAI-compatible API using its Bearer key.
 * Returns the owning user, or null if the key is missing/unknown. Also stamps
 * last_used so people can see which keys are live.
 */
export function authenticateApiKey(req: Request): User | null {
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const key = getApiKeyByToken(match[1].trim());
  if (!key) return null;

  touchApiKey(key.id);
  return getUserById(key.user_id) ?? null;
}
