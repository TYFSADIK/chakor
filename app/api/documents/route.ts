import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { addDocument, listDocuments, addChunks, countUserDocuments } from '@/lib/db';
import { extractText, chunkText } from '@/lib/rag';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_DOCS_PER_USER = 20;
const ALLOWED_MIME = new Set(['application/pdf', 'text/plain', 'text/markdown', 'text/x-markdown']);
const ALLOWED_EXT = new Set(['pdf', 'txt', 'md']);

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  return NextResponse.json(listDocuments(userId));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;

  if (countUserDocuments(userId) >= MAX_DOCS_PER_USER) {
    return NextResponse.json(
      { error: `Document limit reached (max ${MAX_DOCS_PER_USER}). Delete some to upload more.` },
      { status: 429 },
    );
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: 'invalid request' }, { status: 400 });

  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'no file provided' }, { status: 400 });

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File too large. Maximum size is 10 MB.' }, { status: 400 });
  }

  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.has(ext)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload PDF, TXT, or MD files.' },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const text = await extractText(buffer, file.type, file.name);
    if (!text.trim()) {
      return NextResponse.json({ error: 'Could not extract any text from this file.' }, { status: 422 });
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return NextResponse.json({ error: 'No usable text content found in this file.' }, { status: 422 });
    }

    const docId = addDocument(userId, file.name, file.type || 'text/plain', file.size);
    addChunks(docId, chunks);

    return NextResponse.json({ id: docId, filename: file.name, chunks: chunks.length, size: file.size });
  } catch (err) {
    console.error('Document processing error:', err);
    const msg = err instanceof Error ? err.message : 'Failed to process file';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
