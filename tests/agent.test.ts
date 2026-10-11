import { describe, it, expect } from 'vitest';
import { parseToolCalls } from '@/lib/agent-executor';
import { resolveWorkspacePath, runTool } from '@/lib/workspace-tools';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('parseToolCalls', () => {
  it('parses a single tool call', () => {
    const text = `<tool><name>write_file</name><argument>{"path":"test.txt","content":"hello"}</argument></tool>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe('write_file');
    expect(calls[0].arguments).toEqual({ path: 'test.txt', content: 'hello' });
  });

  it('parses multiple tool calls in one reply', () => {
    const text = `
      <thought>checking first</thought>
      <tool><name>list_files</name><argument>{}</argument></tool>
      some prose in between
      <tool><name>read_file</name><argument>{"path":"a.txt"}</argument></tool>
    `;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[0].tool).toBe('list_files');
    expect(calls[1].tool).toBe('read_file');
  });

  it('returns an empty array when there are no tool calls', () => {
    expect(parseToolCalls('Just a plain answer, nothing to run.')).toHaveLength(0);
  });

  it('keeps calls with malformed JSON as __malformed markers for retry', () => {
    const text = `<tool><name>write_file</name><argument>{not json}</argument></tool>
      <tool><name>list_files</name><argument>{}</argument></tool>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[0].tool).toBe('write_file');
    expect('__malformed' in (calls[0].arguments as Record<string, unknown>)).toBe(true);
    expect(calls[1].tool).toBe('list_files');
  });

  it('salvages truncated JSON with unclosed brackets', () => {
    const text = `<tool><name>generate_pptx</name><argument>{"title":"Q3","slides":[{"title":"Rev","bullets":["a","b"]}</argument></tool>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    const args = calls[0].arguments as { title: string; slides: unknown[] };
    expect(args.title).toBe('Q3');
    expect(args.slides).toHaveLength(1);
  });

  it('salvages trailing commas', () => {
    const text = `<tool><name>write_file</name><argument>{"path":"a.txt","content":"x",}</argument></tool>`;
    const calls = parseToolCalls(text);
    expect((calls[0].arguments as { path: string }).path).toBe('a.txt');
  });

  it('tolerates missing <name> tags (small-model output)', () => {
    const text = `<tool>generate_pptx</tool><argument>{"title":"Q3","slides":[],"filename":"q3.pptx"}</argument>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe('generate_pptx');
    expect((calls[0].arguments as { title: string }).title).toBe('Q3');
  });

  it('tolerates zero-arg shorthand and does not double-count', () => {
    const text = `<tool>generate_pptx</tool><argument>{"title":"Q3","slides":[],"filename":"q3.pptx"}</argument>
      <tool>list_files</tool>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[0].tool).toBe('generate_pptx');
    expect(calls[1].tool).toBe('list_files');
    expect(calls[1].arguments).toEqual({});
  });
});

describe('resolveWorkspacePath', () => {
  const root = path.join(os.tmpdir(), 'chakor-ws-test');

  it('blocks ../ traversal', () => {
    expect(() => resolveWorkspacePath('../../../../etc/passwd', root)).toThrow('Path traversal attempt blocked');
    expect(() => resolveWorkspacePath('../secret.txt', root)).toThrow('Path traversal attempt blocked');
  });

  it('blocks absolute paths outside the workspace', () => {
    expect(() => resolveWorkspacePath('/etc/passwd', root)).toThrow('Path traversal attempt blocked');
  });

  it('allows plain and nested relative paths', () => {
    expect(resolveWorkspacePath('report.docx', root)).toBe(path.join(root, 'report.docx'));
    expect(resolveWorkspacePath('out/data.csv', root)).toBe(path.join(root, 'out', 'data.csv'));
  });
});

describe('workspace tools', () => {
  it('write_file then read_file round-trips content', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-ws-'));
    try {
      const w = (await runTool('write_file', { path: 'note.txt', content: 'hello agent' }, { workspaceDir: dir })) as { success: boolean };
      expect(w.success).toBe(true);
      const r = (await runTool('read_file', { path: 'note.txt' }, { workspaceDir: dir })) as { content: string };
      expect(r.content).toBe('hello agent');
      const files = (await runTool('list_files', {}, { workspaceDir: dir })) as Array<{ name: string }>;
      expect(files.map((f) => f.name)).toContain('note.txt');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write_file rejects traversal', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-ws-'));
    try {
      await expect(runTool('write_file', { path: '../evil.txt', content: 'x' }, { workspaceDir: dir }))
        .rejects.toThrow('Path traversal attempt blocked');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('execute_python runs code and reports created files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-ws-'));
    try {
      const r = (await runTool('execute_python', {
        code: 'print("hi from sandbox")\nopen("made.txt","w").write("data")',
      }, { workspaceDir: dir })) as { stdout: string; returncode: number; files: Array<{ name: string }> };
      expect(r.returncode).toBe(0);
      expect(r.stdout).toContain('hi from sandbox');
      expect(r.files.map((f) => f.name)).toContain('made.txt');
      // The sandbox script must not be left behind.
      expect(fs.existsSync(path.join(dir, '.sandbox_script.py'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it('execute_python kills infinite loops at the timeout', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-ws-'));
    try {
      const start = Date.now();
      const r = (await runTool('execute_python', { code: 'while True: pass' }, { workspaceDir: dir })) as {
        returncode: number; error?: string; stderr: string;
      };
      expect(Date.now() - start).toBeLessThan(45_000);
      expect(r.returncode).not.toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('execute_python enforces the memory limit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-ws-'));
    try {
      const r = (await runTool('execute_python', {
        code: 'x = " " * (1024 * 1024 * 1024)',
      }, { workspaceDir: dir })) as { returncode: number; stderr: string };
      expect(r.returncode).not.toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it('generate_docx creates a real .docx file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-ws-'));
    try {
      const r = (await runTool('generate_docx', {
        title: 'Test Doc',
        sections: [{ heading: 'Intro', body: 'Hello world' }],
        filename: 'test.docx',
      }, { workspaceDir: dir })) as { returncode: number; stderr: string };
      expect(r.returncode).toBe(0);
      const p = path.join(dir, 'test.docx');
      expect(fs.existsSync(p)).toBe(true);
      // A .docx is a zip archive; check the magic bytes.
      const magic = fs.readFileSync(p).subarray(0, 2).toString('latin1');
      expect(magic).toBe('PK');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it('generate_pptx creates a real .pptx file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-ws-'));
    try {
      const r = (await runTool('generate_pptx', {
        title: 'Test Deck',
        slides: [{ title: 'Slide One', bullets: ['point a', 'point b'] }],
        filename: 'test.pptx',
      }, { workspaceDir: dir })) as { returncode: number; stderr: string };
      expect(r.returncode).toBe(0);
      const p = path.join(dir, 'test.pptx');
      expect(fs.existsSync(p)).toBe(true);
      const magic = fs.readFileSync(p).subarray(0, 2).toString('latin1');
      expect(magic).toBe('PK');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);
});
