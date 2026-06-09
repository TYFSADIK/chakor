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
}

// Files that aren't a runnable chat model on their own.
const SKIP_RE = /ggml-vocab|tokenizer/i;
const MMPROJ_RE = /mmproj/i;
// Sharded GGUF parts: "name-00001-of-00003.gguf".
const SHARD_RE = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;
const QUANT_RE = /\b(IQ\d[\w]*|Q\d[\w]*|F16|FP16|BF16|F32)\b/i;

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
  // Allow a single optional subdirectory (HF quant folders), nothing exotic.
  if (!/^[\w.-]+(\/[\w.-]+)?$/.test(f)) return null;
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

interface TreeEntry { type: string; path: string; size: number }

async function repoTree(repo: string): Promise<TreeEntry[]> {
  const url = `${HF_API}/models/${repo}/tree/main?recursive=true`;
  const res = await fetch(url, { headers: hfHeaders(), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Hugging Face ${res.status}`);
  const data = (await res.json()) as Array<{ type?: string; path?: string; size?: number }>;
  return data
    .filter((e) => e.type === 'file' && typeof e.path === 'string')
    .map((e) => ({ type: 'file', path: e.path as string, size: e.size ?? 0 }));
}

/**
 * List the runnable GGUF files in a repo, sharded parts collapsed into one
 * entry. Throws on a network/HTTP error so the route can report it.
 */
export async function listGgufFiles(repo: string): Promise<HfFile[]> {
  const files = (await repoTree(repo)).filter(
    (e) => e.path.toLowerCase().endsWith('.gguf') && !SKIP_RE.test(e.path) && !MMPROJ_RE.test(e.path),
  );

  // Collapse sharded parts (name-00001-of-000NN.gguf) under their base name.
  const groups = new Map<string, HfFile>();
  for (const f of files) {
    const base = path.basename(f.path);
    const dir = path.dirname(f.path);
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
        });
      }
    } else {
      groups.set(f.path, { path: f.path, size: f.size, label: base, quant: quantFromName(base) });
    }
  }

  // Sort parts so part 1 is first, then sort the list smallest-first (smallest
  // quant usually = most likely to fit a modest machine).
  const out = [...groups.values()];
  for (const g of out) g.parts?.sort();
  out.sort((a, b) => a.size - b.size);
  return out;
}

/**
 * Given a chosen file path, return every file to actually download: the file
 * itself (or all shards), plus a sibling mmproj if the repo has one (so vision
 * models light up). Re-reads the tree server-side so the client can't ask us to
 * fetch arbitrary files.
 */
export async function resolveDownloadSet(repo: string, file: string): Promise<{ paths: string[]; totalBytes: number } | null> {
  const tree = await repoTree(repo);
  const byPath = new Map(tree.map((e) => [e.path, e.size]));
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

  // Add a sibling mmproj (vision projector) if present in the same directory.
  for (const e of tree) {
    if (path.dirname(e.path) === dir && MMPROJ_RE.test(path.basename(e.path)) && e.path.toLowerCase().endsWith('.gguf')) {
      if (!paths.includes(e.path)) paths.push(e.path);
    }
  }

  const totalBytes = paths.reduce((n, p) => n + (byPath.get(p) ?? 0), 0);
  return { paths, totalBytes };
}

/** The direct download URL for a repo file. */
export function resolveFileUrl(repo: string, file: string): string {
  return `${HF_HOST}/${repo}/resolve/main/${file.split('/').map(encodeURIComponent).join('/')}?download=true`;
}

/** A safe local subfolder name for a repo, e.g. "org/name" -> "org__name". */
export function repoFolderName(repo: string): string {
  return repo.replace(/\//g, '__').replace(/[^\w.-]/g, '_');
}
