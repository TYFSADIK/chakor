/**
 * Workspace tool definitions and handlers for the Chakor Agent.
 * All filesystem operations are scoped to a single conversation workspace.
 *
 * Security model:
 * - Every path goes through resolveWorkspacePath, which throws on traversal.
 * - Python runs through scripts/sandbox-runner.py, which applies RLIMIT
 *   memory/CPU/process limits in the child. Never bypass it.
 * - Sizes and counts are capped so a runaway agent cannot fill the disk.
 */

import { z } from "zod";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export const TOOLS = {
  write_file: z.object({
    path: z.string().min(1).max(256),
    content: z.string().max(10_000_000), // 10MB max
  }),
  read_file: z.object({
    path: z.string().min(1).max(256),
  }),
  execute_python: z.object({
    code: z.string().min(1).max(5_000_000), // 5MB max
    description: z.string().max(500).optional(),
  }),
  list_files: z.object({}),
  web_search: z.object({
    query: z.string().min(1).max(1000),
  }),
  generate_docx: z.object({
    title: z.string().min(1).max(500),
    sections: z.array(
      z.object({
        heading: z.string().max(500),
        body: z.string().max(100_000).optional(),
        // Models sometimes write "content" instead of "body"; both accepted.
        content: z.string().max(100_000).optional(),
      })
    ).max(100),
    filename: z.string().min(1).max(256),
  }),
  generate_pptx: z.object({
    title: z.string().min(1).max(500),
    slides: z.array(
      z.object({
        title: z.string().max(500),
        bullets: z.array(z.string().max(2000)).max(50).optional(),
        // Models sometimes write "content" instead of "bullets"; both accepted.
        content: z.array(z.string().max(2000)).max(50).optional(),
      })
    ).max(60),
    filename: z.string().min(1).max(256),
  }),
} as const;

export type ToolName = keyof typeof TOOLS;
export type ToolCall = { tool: ToolName; arguments: unknown };

export interface WorkspaceContext {
  workspaceDir: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 100;
const SANDBOX_TIMEOUT = 30; // seconds
const SANDBOX_MEMORY_MB = 512;

// Root that every workspace must live under; the sandbox runner re-checks this.
const WORKSPACES_ROOT =
  process.env.CHAKOR_WORKSPACE ?? path.join(process.cwd(), "data", "workspaces");

// The venv with python-docx/pptx etc. Fall back to system python3 if missing.
function pythonBin(): string {
  if (process.env.CHAKOR_PYTHON) return process.env.CHAKOR_PYTHON;
  const venv = path.join(process.cwd(), ".venv", "bin", "python3");
  return fs.existsSync(venv) ? venv : "python3";
}

const SANDBOX_RUNNER = path.join(process.cwd(), "scripts", "sandbox-runner.py");

/**
 * Resolve a user/agent supplied path inside the workspace.
 * Throws on ANY escape: ../, absolute paths, backslash tricks. No rewriting,
 * no silent fixups; a suspicious path is an error, full stop.
 */
export function resolveWorkspacePath(filePath: string, workspaceDir: string): string {
  const root = path.resolve(workspaceDir);
  const resolved = path.resolve(root, filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Path traversal attempt blocked");
  }
  return resolved;
}

function enforceFileLimit(workspaceDir: string) {
  const files = fs.readdirSync(workspaceDir).filter((f) => {
    const p = path.join(workspaceDir, f);
    return fs.statSync(p).isFile();
  });
  if (files.length >= MAX_FILES) {
    throw new Error(`Workspace file limit reached (${MAX_FILES}). Delete files before creating new ones.`);
  }
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  returncode: number;
  files: Array<{ name: string; size: number }>;
  error?: string;
}

/**
 * Run Python code inside the sandbox runner. The runner sets RLIMIT_AS
 * (512MB), RLIMIT_CPU (30s) and RLIMIT_NPROC on the child, revalidates the
 * workspace containment, and cleans up the script file itself. We add a hard
 * outer timeout as belt and braces in case the runner wedges.
 *
 * The child gets a minimal allowlisted environment, never process.env:
 * sandboxed code must not be able to read server secrets (OPENAI_API_KEY,
 * AUTH_SECRET, HF_TOKEN, …) out of its environment.
 */
function sandboxEnv(allowedRoot: string): NodeJS.ProcessEnv {
  const env: Record<string, string> = {
    CHAKOR_WORKSPACE: allowedRoot,
    CHAKOR_TIMEOUT: String(SANDBOX_TIMEOUT),
    CHAKOR_MEMORY_MB: String(SANDBOX_MEMORY_MB),
    PYTHONDONTWRITEBYTECODE: "1",
  };
  // Only pass-throughs the sandbox genuinely needs to run python correctly.
  for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "CHAKOR_NPROC_HEADROOM"]) {
    if (process.env[key]) env[key] = process.env[key] as string;
  }
  return env as NodeJS.ProcessEnv;
}

async function runSandbox(code: string, workspaceDir: string): Promise<SandboxResult> {
  const wsAbs = path.resolve(workspaceDir);
  // The runner re-validates containment against CHAKOR_WORKSPACE. Use the
  // configured root when the workspace lives under it (the normal case); for
  // tests pointing at a temp dir, fall back to the workspace's parent so the
  // containment check still holds one level up.
  const rootAbs = path.resolve(WORKSPACES_ROOT);
  const allowedRoot = wsAbs === rootAbs || wsAbs.startsWith(rootAbs + path.sep) ? rootAbs : path.dirname(wsAbs);
  const payload = JSON.stringify({ code, workspace: wsAbs });

  // execFile's promisified form has no stdin input option, so drive the child
  // by hand: write the JSON payload, close stdin, collect output.
  const run = () =>
    new Promise<{ stdout: string; stderr: string; error: Error | null }>((resolve) => {
      const child = execFile(
        pythonBin(),
        [SANDBOX_RUNNER],
        {
          timeout: (SANDBOX_TIMEOUT + 10) * 1000,
          maxBuffer: 10 * 1024 * 1024,
          env: sandboxEnv(allowedRoot),
        },
        (error, stdout, stderr) => resolve({ stdout: stdout ?? "", stderr: stderr ?? "", error })
      );
      child.stdin?.on("error", () => { /* child already gone; the callback reports it */ });
      child.stdin?.write(payload);
      child.stdin?.end();
    });

  const { stdout, error } = await run();
  if (error) {
    const err = error as Error & { killed?: boolean };
    if (err.killed) {
      return { stdout: "", stderr: "Execution timed out", returncode: 124, files: [], error: "Execution timed out" };
    }
    return { stdout: "", stderr: err.message, returncode: 1, files: [], error: err.message };
  }

  try {
    // The runner prints one JSON document; take the last line in case the
    // child leaked anything else onto stdout.
    const line = stdout.trim().split("\n").pop() ?? "";
    const parsed = JSON.parse(line) as SandboxResult;
    return {
      stdout: parsed.stdout ?? "",
      stderr: parsed.stderr ?? "",
      returncode: parsed.returncode ?? 1,
      files: parsed.files ?? [],
      error: parsed.error,
    };
  } catch (e) {
    return { stdout: "", stderr: `sandbox returned invalid output: ${stdout.slice(0, 300)}`, returncode: 1, files: [], error: String(e) };
  }
}

async function handleWriteFile(
  args: z.infer<typeof TOOLS.write_file>,
  ctx: WorkspaceContext
) {
  const target = resolveWorkspacePath(args.path, ctx.workspaceDir);
  enforceFileLimit(ctx.workspaceDir);
  if (Buffer.byteLength(args.content, "utf-8") > MAX_FILE_SIZE) {
    throw new Error("File content exceeds 10MB limit");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, args.content, "utf-8");
  return { success: true, path: args.path, bytes: Buffer.byteLength(args.content, "utf-8") };
}

async function handleReadFile(
  args: z.infer<typeof TOOLS.read_file>,
  ctx: WorkspaceContext
) {
  const target = resolveWorkspacePath(args.path, ctx.workspaceDir);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`File not found: ${args.path}`);
  }
  const stat = fs.statSync(target);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error("File too large to read (>10MB)");
  }
  const content = fs.readFileSync(target, "utf-8");
  return { path: args.path, content, bytes: stat.size };
}

async function handleExecutePython(
  args: z.infer<typeof TOOLS.execute_python>,
  ctx: WorkspaceContext
) {
  return runSandbox(args.code, ctx.workspaceDir);
}

async function handleListFiles(_args: z.infer<typeof TOOLS.list_files>, ctx: WorkspaceContext) {
  if (!fs.existsSync(ctx.workspaceDir)) return [];
  const entries = fs.readdirSync(ctx.workspaceDir);
  const files: Array<{ name: string; size: number; createdAt: string }> = [];
  for (const f of entries) {
    if (f.startsWith(".")) continue;
    const fp = path.join(ctx.workspaceDir, f);
    const stat = fs.statSync(fp);
    if (stat.isFile()) {
      files.push({
        name: f,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
      });
    }
  }
  return files;
}

async function handleWebSearch(
  args: z.infer<typeof TOOLS.web_search>,
  _ctx: WorkspaceContext
) {
  // Dynamic import keeps this module free of startup side effects.
  const { searxSearch } = await import("./searxng");
  const results = await searxSearch(args.query, 10);
  return results.map((r) => ({
    title: r.title || "Untitled",
    url: r.url || "",
    snippet: r.content || "",
  }));
}

async function handleGenerateDocx(
  args: z.infer<typeof TOOLS.generate_docx>,
  ctx: WorkspaceContext
) {
  // Ensure the filename lands inside the workspace before generating.
  resolveWorkspacePath(args.filename, ctx.workspaceDir);
  const code = `
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()
title = doc.add_heading(${JSON.stringify(args.title)}, 0)
title.alignment = WD_ALIGN_PARAGRAPH.CENTER

${args.sections
  .map(
    (s) => `
doc.add_heading(${JSON.stringify(s.heading)}, level=1)
doc.add_paragraph(${JSON.stringify(s.body ?? s.content ?? "")})
`
  )
  .join("\n")}

output_path = ${JSON.stringify(args.filename)}
doc.save(output_path)
print(f"Document saved to {output_path}")
`;
  return runSandbox(code, ctx.workspaceDir);
}

async function handleGeneratePptx(
  args: z.infer<typeof TOOLS.generate_pptx>,
  ctx: WorkspaceContext
) {
  resolveWorkspacePath(args.filename, ctx.workspaceDir);
  const code = `
from pptx import Presentation
from pptx.util import Inches, Pt

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

blank_layout = prs.slide_layouts[6]  # blank

# Title slide
slide = prs.slides.add_slide(blank_layout)
title_box = slide.shapes.add_textbox(Inches(0.5), Inches(2.5), Inches(12.3), Inches(1.5))
tf = title_box.text_frame
tf.text = ${JSON.stringify(args.title)}
p = tf.paragraphs[0]
p.font.size = Pt(44)
p.font.bold = True

${args.slides
  .map(
    (s) => `
slide = prs.slides.add_slide(blank_layout)
title_box = slide.shapes.add_textbox(Inches(0.5), Inches(0.4), Inches(12.3), Inches(1.0))
tf = title_box.text_frame
tf.text = ${JSON.stringify(s.title)}
p = tf.paragraphs[0]
p.font.size = Pt(32)
p.font.bold = True

body_box = slide.shapes.add_textbox(Inches(0.5), Inches(1.6), Inches(12.3), Inches(5.5))
tf = body_box.text_frame
tf.word_wrap = True
${(s.bullets ?? s.content ?? [])
  .map((b, i) =>
    i === 0
      ? `tf.text = ${JSON.stringify("\u2022 " + b)}`
      : `p = tf.add_paragraph()
p.text = ${JSON.stringify("\u2022 " + b)}
p.level = 0`
  )
  .join("\n")}
`
  )
  .join("\n")}

output_path = ${JSON.stringify(args.filename)}
prs.save(output_path)
print(f"Presentation saved to {output_path}")
`;
  return runSandbox(code, ctx.workspaceDir);
}

export async function runTool(
  name: ToolName,
  args: unknown,
  ctx: WorkspaceContext
): Promise<unknown> {
  // Validate against the zod schema first; bad arguments never reach a handler.
  const schema = TOOLS[name];
  if (!schema) throw new Error(`Unknown tool: ${name}`);
  const parsed = schema.parse(args);

  switch (name) {
    case "write_file":
      return handleWriteFile(parsed as z.infer<typeof TOOLS.write_file>, ctx);
    case "read_file":
      return handleReadFile(parsed as z.infer<typeof TOOLS.read_file>, ctx);
    case "execute_python":
      return handleExecutePython(parsed as z.infer<typeof TOOLS.execute_python>, ctx);
    case "list_files":
      return handleListFiles(parsed as z.infer<typeof TOOLS.list_files>, ctx);
    case "web_search":
      return handleWebSearch(parsed as z.infer<typeof TOOLS.web_search>, ctx);
    case "generate_docx":
      return handleGenerateDocx(parsed as z.infer<typeof TOOLS.generate_docx>, ctx);
    case "generate_pptx":
      return handleGeneratePptx(parsed as z.infer<typeof TOOLS.generate_pptx>, ctx);
    default:
      throw new Error(`Tool ${name} not implemented`);
  }
}
