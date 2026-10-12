/**
 * ReAct agent loop for the Chakor Agent Workspace.
 *
 * The model writes XML tool calls in its reply; we parse them, run the tools
 * against the conversation workspace, feed the observations back, and repeat
 * until the model answers in plain text or the step budget runs out.
 *
 * Generation goes through the injected dispatch function (lib/dispatch.ts's
 * streamForModel behind an adapter in the API route), so this module stays
 * provider-agnostic and testable.
 */

import type { ModelConfig } from "./models";
import {
  TOOLS,
  type ToolName,
  type ToolCall,
  runTool,
  type WorkspaceContext,
} from "./workspace-tools";

export interface AgentOptions {
  workspaceDir: string;
  model: ModelConfig;
  dispatch: (
    messages: Array<{ role: string; content: string }>,
    model: ModelConfig,
    opts?: { temperature?: number }
  ) => AsyncIterable<string>;
  maxIterations?: number;
  systemPrompt?: string;
}

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "thought"; content: string }
  | { type: "tool_call"; tool: ToolName; arguments: unknown }
  | { type: "tool_result"; tool: ToolName; result: unknown; elapsedMs: number }
  | { type: "error"; message: string }
  | { type: "final_answer"; content: string };

const DEFAULT_SYSTEM = `You are Chakor Agent, an autonomous assistant with access to a workspace filesystem and sandboxed Python execution.

Available tools (call them with XML exactly like this):
<tool><name>TOOL_NAME</name><argument>{"key":"value"}</argument></tool>

Tools:
- write_file: {"path": "name.txt", "content": "..."} - create or overwrite a file
- read_file: {"path": "name.txt"} - read a file back
- execute_python: {"code": "...", "description": "what it does"} - run Python (30s limit, 512MB RAM). pandas, numpy, matplotlib, openpyxl and Pillow are installed.
- list_files: {} - list workspace files
- web_search: {"query": "..."} - search the web for current information
- generate_docx: {"title": "...", "sections": [{"heading": "...", "body": "..."}], "filename": "report.docx"} - create a Word document
- generate_pptx: {"title": "...", "slides": [{"title": "...", "bullets": ["..."]}], "filename": "deck.pptx"} - create a PowerPoint

Rules:
- When the user wants a document or presentation, use generate_docx or generate_pptx instead of raw Python.
- When you need current facts before acting, use web_search first.
- After creating a file, verify with list_files or read_file before declaring success.
- Put your reasoning in <thought>...</thought> tags, then emit exactly the tool calls you want to run.
- Tool calls MUST use this exact shape, with the <name> tags included:

<thought>I need to make a text file.</thought>
<tool><name>write_file</name><argument>{"path":"notes.txt","content":"hello"}</argument></tool>

- When the task is fully done, reply with the final answer in plain text and NO tool calls.
- Keep each reply focused: at most 3 tool calls per step.`;

/** Concrete argument examples shown to the model when it must retry a call. */
const TOOL_ARG_EXAMPLES: Partial<Record<ToolName, string>> = {
  write_file: '{"path":"notes.txt","content":"file text here"}',
  read_file: '{"path":"notes.txt"}',
  execute_python: '{"code":"print(2+2)","description":"quick math check"}',
  list_files: '{}',
  web_search: '{"query":"latest news about X"}',
  generate_docx: '{"title":"My Report","sections":[{"heading":"Intro","body":"First paragraph."}],"filename":"report.docx"}',
  generate_pptx: '{"title":"My Deck","slides":[{"title":"Overview","bullets":["Point one","Point two"]}],"filename":"deck.pptx"}',
};

/**
 * Parse JSON the model emitted, salvaging the two most common small-model
 * mistakes: trailing commas and a truncated tail with unclosed brackets.
 * Returns undefined when the text is genuinely unrecoverable.
 */
function tryParseLenient(raw: string): { value?: unknown; error?: string } {
  const attempt = (s: string): { value?: unknown; error?: string } => {
    try { return { value: JSON.parse(s) }; }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  };

  const trimmed = raw.trim();
  let r = attempt(trimmed);
  if (r.value !== undefined) return r;

  // Strip trailing commas before } or ].
  const noTrailing = trimmed.replace(/,\s*([}\]])/g, "$1");
  r = attempt(noTrailing);
  if (r.value !== undefined) return r;

  // Append missing closers for an unbalanced tail (models often drop it).
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of noTrailing) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] === ch) stack.pop();
    }
  }
  if (!inStr && stack.length > 0 && stack.length < 10) {
    r = attempt(noTrailing + stack.reverse().join(""));
    if (r.value !== undefined) return r;
  }
  return { error: r.error ?? "invalid JSON" };
}

/**
 * Extract XML tool calls from a model reply. Small local models are sloppy
 * with the format, so we accept the canonical form plus common variants:
 *   <tool><name>x</name><argument>{...}</argument></tool>   canonical
 *   <tool>x</tool><argument>{...}</argument>                missing name tags
 *   <tool>x>{ ... }</tool>                                  no argument tags
 *   <tool>list_files</tool>                                 zero-arg shorthand
 * When the JSON is unrecoverable we keep the call with a __malformed marker so
 * the loop can tell the model to retry instead of silently dropping it (a
 * dropped call looks like success to the model, which then hallucinates).
 */
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  let m: RegExpExecArray | null;

  const push = (name: string, raw: string) => {
    const { value, error } = tryParseLenient(raw);
    if (value !== undefined) {
      calls.push({ tool: name as ToolName, arguments: value });
    } else {
      calls.push({ tool: name as ToolName, arguments: { __malformed: raw.trim().slice(0, 400), __error: error } });
    }
  };

  // Argument-tagged forms (canonical and missing-name variants).
  const withArgs =
    /<tool>\s*(?:<name>)?\s*(\w+)\s*(?:<\/name>)?\s*(?:<\/tool>)?\s*<argument>([\s\S]*?)<\/argument>\s*(?:<\/tool>)?/g;
  while ((m = withArgs.exec(text)) !== null) push(m[1], m[2]);

  // Raw JSON straight after the name, no argument tags: <tool>name>{...}</tool>
  const rawJson = /<tool>\s*(?:<name>)?\s*(\w+)\s*(?:<\/name>)?\s*>?\s*(\{[\s\S]*\})\s*<\/tool>/g;
  while ((m = rawJson.exec(text)) !== null) push(m[1], m[2]);

  // Zero-argument shorthand, only for known tools and only when no argument
  // payload follows (those were already captured above).
  const bare = /<tool>\s*(?:<name>)?\s*(\w+)\s*(?:<\/name>)?\s*<\/tool>(?!\s*<argument>)(?!\s*\{)/g;
  while ((m = bare.exec(text)) !== null) {
    const name = m[1] as ToolName;
    if (name in TOOLS) calls.push({ tool: name, arguments: {} });
  }

  return calls;
}

/** Turn a raw tool result into an observation string the model can reason over. */
function buildObservation(result: unknown, tool: ToolName): string {
  const cap = (s: string, n = 4000) => (s.length > n ? s.slice(0, n) + `\n...[truncated, ${s.length - n} more chars]` : s);

  if (tool === "list_files") {
    const files = result as Array<{ name: string; size: number }>;
    if (!Array.isArray(files) || files.length === 0) return "Workspace is empty.";
    return "Files in workspace:\n" + files.map((f) => `- ${f.name} (${f.size} bytes)`).join("\n");
  }
  if (tool === "execute_python" || tool === "generate_docx" || tool === "generate_pptx") {
    const r = result as {
      stdout?: string;
      stderr?: string;
      returncode?: number;
      files?: Array<{ name: string; size: number }>;
      error?: string;
    };
    let out = "";
    if (r.stdout) out += `stdout:\n${cap(r.stdout)}\n`;
    if (r.stderr) out += `stderr:\n${cap(r.stderr, 1500)}\n`;
    if (r.returncode && r.returncode !== 0) out += `Process exited with code ${r.returncode}.\n`;
    if (Array.isArray(r.files) && r.files.length > 0) {
      out += "Files now in workspace:\n" + r.files.map((f) => `- ${f.name} (${f.size} bytes)`).join("\n");
    }
    return out || "Execution completed with no output.";
  }
  if (tool === "web_search") {
    const r = result as Array<{ title: string; url: string; snippet: string }>;
    if (!Array.isArray(r) || r.length === 0) return "No search results.";
    return (
      "Search results:\n" +
      r.map((s, i) => `${i + 1}. ${s.title}\n   ${s.url}\n   ${s.snippet}`).join("\n\n")
    );
  }
  return cap(JSON.stringify(result));
}

export async function* runAgent(
  options: AgentOptions,
  userQuery: string
): AsyncGenerator<AgentEvent> {
  const {
    workspaceDir,
    model,
    dispatch,
    maxIterations = 15,
    systemPrompt = DEFAULT_SYSTEM,
  } = options;

  yield { type: "status", message: "Agent started" };

  const ctx: WorkspaceContext = { workspaceDir };

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userQuery },
  ];

  for (let step = 0; step < maxIterations; step++) {
    yield { type: "status", message: `Thinking (step ${step + 1} of ${maxIterations})` };

    let fullReply = "";
    try {
      for await (const chunk of dispatch(
        messages.map((m) => ({ role: m.role, content: m.content })),
        model,
        { temperature: 0.3 }
      )) {
        fullReply += chunk;
      }
    } catch (e) {
      yield { type: "error", message: `The model failed to respond: ${e instanceof Error ? e.message : String(e)}` };
      return;
    }

    const thoughtMatch = fullReply.match(/<thought>([\s\S]*?)<\/thought>/);
    if (thoughtMatch) {
      yield { type: "thought", content: thoughtMatch[1].trim() };
    }

    const toolCalls = parseToolCalls(fullReply);

    if (toolCalls.length === 0) {
      // Plain text with no tool calls means the agent is done. Strip any
      // markup the model left behind so the user only sees the answer.
      const answer = fullReply
        .replace(/<\/?thought>/g, "")
        .replace(/<tool>[\s\S]*?<\/tool>/g, "")
        .replace(/<tool>[\s\S]*?<\/argument>/g, "")
        .trim();
      yield { type: "final_answer", content: answer };
      return;
    }

    let replied = false;
    for (const call of toolCalls) {
      // A call whose JSON did not parse was never run; tell the model so it
      // retries instead of assuming success.
      if (call.arguments && typeof call.arguments === 'object' && '__malformed' in (call.arguments as Record<string, unknown>)) {
        const marker = call.arguments as { __malformed: string; __error?: string };
        yield { type: 'error', message: `The ${call.tool} call had invalid JSON; asking the agent to retry.` };
        if (!replied) { messages.push({ role: 'assistant', content: fullReply }); replied = true; }
        messages.push({
          role: 'user',
          content: `[Observation] Your ${call.tool} call was NOT run because its argument was not valid JSON` +
            (marker.__error ? ` (${marker.__error.slice(0, 120)})` : '') +
            `. Emit the same tool call again with balanced brackets and valid JSON, exactly in this shape: ` +
            `<tool><name>${call.tool}</name><argument>${TOOL_ARG_EXAMPLES[call.tool] ?? '{...}'}</argument></tool>` +
            ` (replace the example values with your real ones).`,
        });
        continue;
      }

      yield { type: "tool_call", tool: call.tool, arguments: call.arguments };

      if (!TOOLS[call.tool]) {
        yield { type: "error", message: `Unknown tool: ${call.tool}` };
        if (!replied) { messages.push({ role: "assistant", content: fullReply }); replied = true; }
        messages.push({ role: "user", content: `[Observation] Unknown tool "${call.tool}". Use only the listed tools.` });
        continue;
      }

      const start = Date.now();
      let result: unknown;
      try {
        result = await runTool(call.tool, call.arguments, ctx);
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) };
      }
      const elapsed = Date.now() - start;

      yield { type: "tool_result", tool: call.tool, result, elapsedMs: elapsed };

      // A validation failure (zod schema, missing required field) comes back as
      // { error: ... } INSIDE the result, not as a thrown exception. Fed back
      // neutrally, small models read it as a completed step and bluff success,
      // so turn it into an explicit retry instruction, like the malformed-JSON
      // path above.
      const toolError =
        result && typeof result === "object" && "error" in (result as Record<string, unknown>)
          ? String((result as Record<string, unknown>).error).slice(0, 300)
          : null;

      if (!replied) {
        messages.push({ role: "assistant", content: fullReply });
        replied = true;
      }
      messages.push({
        role: "user",
        content: toolError
          ? `[Observation] Your ${call.tool} call FAILED and nothing was created or run. ` +
            `Error: ${toolError}. Emit the same tool call again with corrected arguments: ` +
            `every required field from the tool description must be present.`
          : `[Observation from ${call.tool}]\n${buildObservation(result, call.tool)}`,
      });
    }
  }

  yield {
    type: "error",
    message: "Reached the step limit without finishing. Try a smaller task or ask the agent to continue.",
  };
}
