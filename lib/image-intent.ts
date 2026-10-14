/**
 * Image-generation intent detection — pure and dependency-free so both the
 * server (policy checks) and the client (composer routing) share one
 * implementation and can never drift apart.
 *
 * Two ways a message becomes an image prompt:
 *  1. Explicit prefix: "/image a fox in the snow" (also /img, /draw).
 *  2. Natural phrasing: "generate an image of …", "draw a …", "make me a
 *     picture of …".
 */

// Explicit command prefix. The rest of the message is the prompt verbatim.
const PREFIX_RE = /^\/(image|img|draw)\s+/i;

const LEADIN = String.raw`(?:(?:please\s+)?(?:can|could|would)\s+you\s+|please\s+)?`;

// "generate/create/make/draw/show (me) (a/an/some) image/picture/… (of|:) X"
const INTENT_NOUN_RE = new RegExp(
  LEADIN + String.raw`(?:generate|create|make|draw|paint|render|produce|show)\s+(?:me\s+)?(?:an?\s+|some\s+)?(?:image|picture|pic|photo|illustration|drawing|artwork|logo|wallpaper|poster|portrait)\b\s*(?:of|showing|:)?\s*`,
  'i',
);

// "draw/paint/sketch (me) (a) X" — these verbs imply an image on their own.
const INTENT_DRAW_RE = new RegExp(
  LEADIN + String.raw`(?:draw|paint|sketch)\s+(?:me\s+)?(?:an?\s+|some\s+)?`,
  'i',
);

/** Strip an explicit "/image …" prefix. Returns null when there is none. */
export function stripImagePrefix(message: string): string | null {
  const t = message.trim();
  const m = PREFIX_RE.exec(t);
  if (!m) return null;
  const rest = t.slice(m[0].length).trim();
  return rest.length > 0 ? rest : null;
}

/**
 * Detect a natural-language image request. Returns the prompt to send to the
 * image model (the text after the intent phrase when it is substantial,
 * otherwise the whole message), or null when the message is not an image
 * request. Explicit "/image …" prefixes are honored here too.
 */
export function detectImageIntent(message: string): string | null {
  const t = message.trim();
  if (!t) return null;

  const explicit = stripImagePrefix(t);
  if (explicit !== null) return explicit;

  const m = INTENT_NOUN_RE.exec(t) ?? INTENT_DRAW_RE.exec(t);
  if (!m) return null;
  const rest = t.slice(m[0].length).trim();
  // "make an image" with nothing after it is not a usable prompt.
  if (rest.length < 3) return null;
  return rest;
}
