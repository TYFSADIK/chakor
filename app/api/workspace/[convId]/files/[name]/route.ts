/**
 * GET    /api/workspace/[convId]/files/[name]  - download a workspace file
 * DELETE /api/workspace/[convId]/files/[name]  - remove a workspace file
 *
 * Traversal defense: reject any name containing a separator or starting with
 * a dot, then re-verify the resolved path stays inside the workspace.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { getConversation } from "@/lib/db";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

const MAX_DOWNLOAD = 50 * 1024 * 1024; // 50MB

const MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".py": "text/plain",
};

/** Resolve the file or return null when the request is not allowed. */
function resolveFile(convId: string, name: string, userId: number): string | null {
  // Reject traversal up front: separators and hidden/dot names are not allowed.
  if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".") || name.includes("\0")) {
    return null;
  }
  if (!getConversation(convId, userId)) return null;

  const workspaceDir = path.resolve(process.cwd(), "data", "workspaces", convId);
  const filePath = path.resolve(workspaceDir, name);
  if (!filePath.startsWith(workspaceDir + path.sep)) return null;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return filePath;
}

async function authorize(
  params: Promise<{ convId: string; name: string }>
): Promise<{ userId: number; convId: string; name: string } | NextResponse> {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;
  const { convId, name } = await params;
  if (!/^[a-zA-Z0-9-]+$/.test(convId)) {
    return NextResponse.json({ error: "invalid conversation id" }, { status: 400 });
  }
  return { userId, convId, name: decodeURIComponent(name) };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ convId: string; name: string }> }
) {
  const authz = await authorize(params);
  if (authz instanceof NextResponse) return authz;

  const filePath = resolveFile(authz.convId, authz.name, authz.userId);
  if (!filePath) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  if (stat.size > MAX_DOWNLOAD) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  const ext = path.extname(authz.name).toLowerCase();
  const contentType = MIME[ext] ?? "application/octet-stream";
  const safeName = authz.name.replace(/["\r\n]/g, "_");

  const webStream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream;
  return new Response(webStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(authz.name)}`,
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ convId: string; name: string }> }
) {
  const authz = await authorize(params);
  if (authz instanceof NextResponse) return authz;

  const filePath = resolveFile(authz.convId, authz.name, authz.userId);
  if (!filePath) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  fs.unlinkSync(filePath);
  return NextResponse.json({ success: true });
}
