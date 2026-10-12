/**
 * GET /api/workspace/[convId]
 * List the files in a conversation's agent workspace.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { getConversation } from "@/lib/db";
import * as fs from "node:fs";
import * as path from "node:path";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ convId: string }> }
) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;

  const { convId } = await params;
  if (!/^[a-zA-Z0-9-]+$/.test(convId)) {
    return NextResponse.json({ error: "invalid conversation id" }, { status: 400 });
  }
  if (!getConversation(convId, userId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const workspaceDir = path.join(process.cwd(), "data", "workspaces", convId);
  if (!fs.existsSync(workspaceDir)) {
    return NextResponse.json({ files: [] });
  }

  const files: Array<{ name: string; size: number; createdAt: string }> = [];
  for (const f of fs.readdirSync(workspaceDir)) {
    if (f.startsWith(".")) continue;
    const fp = path.join(workspaceDir, f);
    const stat = fs.statSync(fp);
    if (stat.isFile()) {
      files.push({ name: f, size: stat.size, createdAt: stat.birthtime.toISOString() });
    }
  }
  files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ files });
}
