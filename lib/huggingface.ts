/**
 * Hugging Face model browsing + download, the way LM Studio does it: search for
 * GGUF repos, list the quantized files in one, and pull the chosen file straight
 * to the local models directory so llama.cpp can run it. No terminal, no manual
 * wget, no copying files around.
 *
 * Server-only (used by the /api/models/hf/* routes). All inputs that become URLs
 * or file paths are validated here so a route can't be tricked into fetching or
 * writing somewhere it shouldn't.
 */
import path from 'node:path';

const HF_API = 'https://huggingface.co/api';
const HF_HOST = 'https://huggingface.co';

export interface HfRepo {
  id: string; // "org/name"
  downloads: number;
  likes: number;
  updatedAt: string | null;
}

export interface HfFile {
  /** Path within the repo, e.g. "Qwen3-4B-Q4_K_M.gguf" or "q4/model.gguf". */
  path: string;
  /** Total size in bytes (summed across parts for a sharded model). */
  size: number;
  /** Pretty name for the UI (the base name, without the -00001-of-000NN suffix). */
  label: string;
  /** Quant tier pulled from the name (Q4_K_M, Q8_0, …) when present. */
  quant: string | null;
  /** For a sharded model: every part path. Single-file models omit this. */
  parts?: string[];
  /** False when llama.cpp can't run this as a chat model — UI should disable it. */
  runnable: boolean;
  /** Why it's not runnable (plain language, for a tooltip). */
  notRunnableReason?: string;
}

// Files that aren't a runnable chat model on their own, matched by name. They
// stay in the listing (marked not-runnable) so the UI can show them disabled
// instead of silently hiding what the user searched for. mmproj files are
// handled separately (paired with their model), not listed.
// Name heuristics only: llama-server has no flag to enumerate the architectures
// a build supports, so we can't verify against the installed binary.
const NOT_RUNNABLE: Array<[RegExp, string]> = [
  [/dflash/i, "A speculative-decoding drafter — llama.cpp can't run it as a chat model."],
  [/draft/i, 'A speculative-decoding draft model, not a standalone chat model.'],
  [/embed/i, "An embedding model — it turns text into vectors, it doesn't chat."],
  [/rerank/i, "A reranker — it scores documents, it doesn't chat."],
  [/vocab|tokenizer/i, 'A tokenizer/vocabulary file, not a model.'],
];
const MMPROJ_RE = /mmproj/i;
// Sharded GGUF parts: "name-00001-of-00003.gguf".
const SHARD_RE = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;
const QUANT_RE = /\b(IQ\d[\w]*|Q\d[\w]*|F16|FP16|BF16|F32)\b/i;
// Trailing quant/precision suffix on a GGUF basename, e.g. "-Q4_K_M" or ".f16".
const QUANT_SUFFIX_RE = /[-_.]?(iq\d[\w]*|q\d[\w]*|f16|fp16|bf16|f32)$/i;

/** Why a file can't run as a chat model, or null when it looks runnable. */
function notRunnableReason(name: string): string | null {
  for (const [re, reason] of NOT_RUNNABLE) if (re.test(name)) return reason;
  return null;
}

export function hfHeaders(): Record<string, string> {
  // A token lifts rate limits and reaches gated repos. Optional.
  const token = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Validate "org/name". Returns the clean id or null. No traversal, no spaces. */
export function sanitizeRepo(repo: string): string | null {
  const r = (repo ?? '').trim();
  if (!/^[A-Za-z0-9][\w.-]*\/[\w.-]+$/.test(r)) return null;
  if (r.includes('..')) return null;
  return r;
}

/** Validate a repo-relative file path: must be a .gguf, no absolute/traversal. */
export function sanitizeRepoFile(file: string): string | null {
  const f = (file ?? '').trim().replace(/^\/+/, '');
  if (!f.toLowerCase().endsWith('.gguf')) return null;
  if (f.includes('..') || path.isAbsolute(f)) return null;
  // Allow up to 3 subdirectory levels (HF quant/shard folders), nothing exotic.
  if (!/^[\w.-]+(\/[\w.-]+){0,3}$/.test(f)) return null;
  return f;
}

export function quantFromName(name: string): string | null {
  const m = QUANT_RE.exec(name);
  return m ? m[1].toUpperCase() : null;
}

/** Search Hugging Face for repos that ship GGUF files, most-downloaded first. */
export async function searchGgufRepos(query: string, limit = 24): Promise<HfRepo[]> {
  const q = (query ?? '').trim();
  const url = new URL(`${HF_API}/models`);
  url.searchParams.set('filter', 'gguf');
  if (q) url.searchParams.set('search', q);
  url.searchParams.set('sort', 'downloads');
  url.searchParams.set('direction', '-1');
  url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 50)));
  try {
    const res = await fetch(url, { headers: hfHeaders(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ id?: string; modelId?: string; downloads?: number; likes?: number; lastModified?: string }>;
    return data
      .map((m) => ({
        id: m.id ?? m.modelId ?? '',
        downloads: m.downloads ?? 0,
        likes: m.likes ?? 0,
        updatedAt: m.lastModified ?? null,
      }))
      .filter((m) => m.id);
  } catch {
    return [];
  }
}

interface TreeEntry { type: string; path: string; size: number; sha256: string | null }

async function repoTree(repo: string): Promise<TreeEntry[]> {
  const url = `${HF_API}/models/${repo}/tree/main?recursive=true`;
  const res = await fetch(url, { headers: hfHeaders(), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Hugging Face ${res.status}`);
  const data = (await res.json()) as Array<{ type?: string; path?: string; size?: number; lfs?: { oid?: string } }>;
  return data
    .filter((e) => e.type === 'file' && typeof e.path === 'string')
    // The LFS oid is the file's sha256 — keep it for post-download verification.
    .map((e) => ({ type: 'file', path: e.path as string, size: e.size ?? 0, sha256: e.lfs?.oid ?? null }));
}

/**
 * List the GGUF files in a repo, sharded parts collapsed into one entry. Files
 * that can't run as chat models (drafters, embedders, rerankers, vocabs) are
 * included but flagged `runnable: false` so the UI can disable them. Throws on
 * a network/HTTP error so the route can report it.
 */
export async function listGgufFiles(repo: string): Promise<HfFile[]> {
  const files = (await repoTree(repo)).filter(
    (e) => e.path.toLowerCase().endsWith('.gguf') && !MMPROJ_RE.test(e.path),
  );

  // Collapse sharded parts (name-00001-of-000NN.gguf) under their base name.
  const groups = new Map<string, HfFile>();
  for (const f of files) {
    const base = path.basename(f.path);
    const dir = path.dirname(f.path);
    const reason = notRunnableReason(base);
    const flags = reason ? { runnable: false, notRunnableReason: reason } : { runnable: true };
    const shard = SHARD_RE.exec(base);
    if (shard) {
      const key = `${dir}/${shard[1]}`;
      const existing = groups.get(key);
      if (existing) {
        existing.size += f.size;
        existing.parts!.push(f.path);
      } else {
        groups.set(key, {
          path: f.path, // the first part; the route re-expands the set
          size: f.size,
          label: `${shard[1]}.gguf`,
          quant: quantFromName(shard[1]),
          parts: [f.path],
          ...flags,
        });
      }
    } else {
      groups.set(f.path, { path: f.path, size: f.size, label: base, quant: quantFromName(base), ...flags });
    }
  }

  // Sort parts so part 1 is first, then sort the list smallest-first (smallest
  // quant usually = most likely to fit a modest machine).
  const out = [...groups.values()];
  for (const g of out) g.parts?.sort();
  out.sort((a, b) => a.size - b.size);
  return out;
}

/** Lowercased basename minus the .gguf extension and any trailing quant tag. */
function fileStem(name: string): string {
  return path.basename(name).toLowerCase().replace(/\.gguf$/i, '').replace(QUANT_SUFFIX_RE, '');
}

/**
 * Pick the mmproj (vision projector) that belongs to a model file, by filename
 * stem: gemma-4-E2B-it.mmproj.gguf pairs with gemma-4-E2B-it-Q4_K_M.gguf, not
 * with an unrelated model sharing the folder (~/Downloads holds many). Falls
 * back to the folder's mmproj only when it's the only candidate.
 */
export function matchingMmproj(modelFile: string, candidates: string[]): string | null {
  if (!candidates.length) return null;
  const mstem = fileStem(modelFile);
  const scored = candidates
    .map((c) => ({
      c,
      stem: fileStem(c)
        .replace(/[-_.]?mmproj[-_.]?/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(QUANT_SUFFIX_RE, ''),
    }))
    .filter(({ stem }) => stem.length >= 3 && (mstem.startsWith(stem) || stem.startsWith(mstem)))
    // Longest stem = most specific match.
    .sort((a, b) => b.stem.length - a.stem.length);
  if (scored.length) return scored[0].c;
  // No stem match: a lone mmproj in the folder almost certainly belongs to it
  // (e.g. bartowski-style "mmproj-model-f16.gguf" repos).
  return candidates.length === 1 ? candidates[0] : null;
}

/** One file to pull, with the integrity data the HF tree provides for it. */
export interface HfDownloadFile {
  path: string;
  /** Expected size in bytes (0 when the tree didn't say). */
  size: number;
  /** Expected sha256 (the HF LFS oid), null when not available. */
  sha256: string | null;
}

/**
 * Given a chosen file path, return every file to actually download: the file
 * itself (or all shards), plus the mmproj sibling that matches this model's
 * name stem (so vision models light up — and only that one, not every mmproj
 * in the directory). Re-reads the tree server-side so the client can't ask us
 * to fetch arbitrary files, and carries expected sizes + sha256s through so the
 * download manager can verify what it pulled.
 */
export async function resolveDownloadSet(repo: string, file: string): Promise<{ paths: string[]; totalBytes: number; files: HfDownloadFile[] } | null> {
  const tree = await repoTree(repo);
  const byPath = new Map(tree.map((e) => [e.path, e]));
  if (!byPath.has(file)) return null;

  const paths: string[] = [];
  const base = path.basename(file);
  const dir = path.dirname(file);
  const shard = SHARD_RE.exec(base);
  if (shard) {
    // Pull the whole shard set in this directory.
    const stem = shard[1];
    for (const e of tree) {
      const b = path.basename(e.path);
      if (path.dirname(e.path) === dir && SHARD_RE.test(b) && b.startsWith(stem + '-')) paths.push(e.path);
    }
    paths.sort();
  } else {
    paths.push(file);
  }

  // Add the matching mmproj (vision projector) if this repo dir has one.
  const mmprojs = tree
    .filter((e) => path.dirname(e.path) === dir && MMPROJ_RE.test(path.basename(e.path)) && e.path.toLowerCase().endsWith('.gguf'))
    .map((e) => e.path);
  const mm = matchingMmproj(base, mmprojs);
  if (mm && !paths.includes(mm)) paths.push(mm);

  const files = paths.map((p) => {
    const e = byPath.get(p);
    return { path: p, size: e?.size ?? 0, sha256: e?.sha256 ?? null };
  });
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  return { paths, totalBytes, files };
}

/** The direct download URL for a repo file. */
export function resolveFileUrl(repo: string, file: string): string {
  return `${HF_HOST}/${repo}/resolve/main/${file.split('/').map(encodeURIComponent).join('/')}?download=true`;
}

/** A safe local subfolder name for a repo, e.g. "org/name" -> "org__name". */
export function repoFolderName(repo: string): string {
  return repo.replace(/\//g, '__').replace(/[^\w.-]/g, '_');
}
