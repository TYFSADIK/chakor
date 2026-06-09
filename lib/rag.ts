const MAX_CHUNK_CHARS = 900;
const OVERLAP_CHARS = 120;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

export async function extractText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    // pdf-parse v2 uses a class-based API: new PDFParse({ data }).getText()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PDFParse } = (await import('pdf-parse')) as any;
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text ?? '';
  }
  return buffer.toString('utf-8');
}

export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (!current) {
      current = para;
      continue;
    }
    if (current.length + 2 + para.length <= MAX_CHUNK_CHARS) {
      current += '\n\n' + para;
    } else {
      chunks.push(current);
      const tail = current.slice(-OVERLAP_CHARS).trimStart();
      current = tail ? tail + '\n\n' + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Hard-split any chunk that still exceeds limit
  const result: string[] = [];
  for (const c of chunks) {
    if (c.length <= MAX_CHUNK_CHARS) {
      result.push(c);
    } else {
      for (let i = 0; i < c.length; i += MAX_CHUNK_CHARS - OVERLAP_CHARS) {
        const slice = c.slice(i, i + MAX_CHUNK_CHARS).trim();
        if (slice.length >= 20) result.push(slice);
      }
    }
  }

  return result.filter(c => c.trim().length >= 20);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3);
}

export interface ScoredChunk {
  id: number;
  document_id: number;
  filename: string;
  content: string;
  score: number;
}

export function bm25Search(
  query: string,
  chunks: Array<{ id: number; document_id: number; filename: string; content: string }>,
  limit = 6,
): ScoredChunk[] {
  if (chunks.length === 0) return [];

  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) return [];

  const tokenized = chunks.map(c => ({ ...c, tokens: tokenize(c.content) }));
  const N = tokenized.length;
  const avgdl = tokenized.reduce((s, c) => s + c.tokens.length, 0) / N;

  const idf = new Map<string, number>();
  for (const qt of queryTokens) {
    const df = tokenized.filter(c => c.tokens.includes(qt)).length;
    idf.set(qt, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }

  const scored = tokenized.map(c => {
    const dl = c.tokens.length;
    const freq = new Map<string, number>();
    for (const t of c.tokens) freq.set(t, (freq.get(t) ?? 0) + 1);

    let score = 0;
    for (const qt of queryTokens) {
      const f = freq.get(qt) ?? 0;
      if (f === 0) continue;
      score += (idf.get(qt) ?? 0) * (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgdl));
    }
    return { ...c, score };
  });

  return scored
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function formatRagContext(chunks: ScoredChunk[]): string {
  if (chunks.length === 0) return '';

  const grouped = new Map<string, string[]>();
  for (const c of chunks) {
    if (!grouped.has(c.filename)) grouped.set(c.filename, []);
    grouped.get(c.filename)!.push(c.content);
  }

  let ctx = '=== DOCUMENT CONTEXT ===\n';
  for (const [filename, contents] of grouped) {
    ctx += `\n[Source: ${filename}]\n`;
    ctx += contents.join('\n[...]\n') + '\n';
  }
  ctx += '=== END DOCUMENT CONTEXT ===\n\nUsing the above document context where relevant, answer the following:\n\n';
  return ctx;
}
