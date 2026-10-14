/**
 * GET    /api/workspace/[convId]/files/[name]  - download a workspace file
 * DELETE /api/workspace/[convId]/files/[name]  - remove a workspace file
 *
 * Traversal defense: reject any name containing a separator or starting with
 * a dot, then re-verify the resolved path stays inside the workspace.
 *
 * Images are served inline (so generated pictures render in chat bubbles and
 * on shared conversation pages); everything else stays an attachment.
 * Anonymous reads are allowed only when the conversation has a live share
 * link — sharing a conversation shares its workspace images with it.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { getConversation, isConversationShared } from "@/lib/db";
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
  ".webp": "image/webp",
  ".py": "text/plain",
};

// Served with Content-Disposition: inline so <img> tags render them. SVG is
// deliberately excluded: inline SVG can execute scripts when opened top-level.
const INLINE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Validate the file name and resolve it inside the conversation workspace. */
function resolveFilePath(convId: string, name: string): string | null {
  // Reject traversal up front: separators and hidden/dot names are not allowed.
  if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".") || name.includes("\0")) {
    return null;
  }
  const workspaceDir = path.resolve(process.cwd(), "data", "workspaces", convId);
  const filePath = path.resolve(workspaceDir, name);
  if (!filePath.startsWith(workspaceDir + path.sep)) return null;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return filePath;
}

/** Owner, or anyone when the conversation is currently shared. */
async function canRead(convId: string): Promise<boolean> {
  const authd = await requireUser();
  if (!(authd instanceof NextResponse) && getConversation(convId, authd.userId)) return true;
  return isConversationShared(convId);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ convId: string; name: string }> }
) {
  const { convId, name: rawName } = await params;
  if (!/^[a-zA-Z0-9-]+$/.test(convId)) {
    return NextResponse.json({ error: "invalid conversation id" }, { status: 400 });
  }
  if (!(await canRead(convId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const name = decodeURIComponent(rawName);
  const filePath = resolveFilePath(convId, name);
  if (!filePath) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  if (stat.size > MAX_DOWNLOAD) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  const ext = path.extname(name).toLowerCase();
  const contentType = MIME[ext] ?? "application/octet-stream";
  const safeName = name.replace(/["\r\n]/g, "_");
  const disposition = INLINE_MIME.has(contentType) ? "inline" : "attachment";

  const webStream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream;
  return new Response(webStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Content-Disposition": `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ convId: string; name: string }> }
) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { convId, name: rawName } = await params;
  if (!/^[a-zA-Z0-9-]+$/.test(convId)) {
    return NextResponse.json({ error: "invalid conversation id" }, { status: 400 });
  }
  // Deletes are owner-only — a share link grants read access, nothing more.
  if (!getConversation(convId, authd.userId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const filePath = resolveFilePath(convId, decodeURIComponent(rawName));
  if (!filePath) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  fs.unlinkSync(filePath);
  return NextResponse.json({ success: true });
}

