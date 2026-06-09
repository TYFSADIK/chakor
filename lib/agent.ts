import type { ChatMessage, LlamaStats } from './llama';
import { type ModelConfig, OLLAMA_BASE_URL, LMSTUDIO_BASE_URL, llamaEndpoint } from './models';
import { TOOLS, toolDefs } from './tools';

/**
 * The tool-calling loop. For models that speak the OpenAI function-calling
 * dialect (OpenAI, OpenRouter, Ollama, llama.cpp), we run rounds of:
 *   ask the model -> it requests tool calls -> we run them -> feed results back
 * until it answers in plain text. Anthropic and Google use different tool
 * schemas, so they are not wired up here yet (the chat route falls back to a
 * normal stream for them).
 */

const MAX_ROUNDS = 5;

export interface ToolEvent { name: string; args: string; result: string }

export interface AgentOptions {
  model: ModelConfig;
  messages: ChatMessage[];
  toolIds: string[];
  userId?: number;
  signal?: AbortSignal;
  onTool?: (e: ToolEvent) => void;
  onStats?: (s: LlamaStats) => void;
}

/** Which providers we can run the tool loop against. */
export function supportsTools(model: ModelConfig): boolean {
  return ['openai', 'openrouter', 'ollama', 'lmstudio', 'llama'].includes(model.provider);
}

function endpointFor(model: ModelConfig): { url: string; headers: Record<string, string>; model: string } | null {
  switch (model.provider) {
    case 'openai': {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI_API_KEY not configured');
      return { url: 'https://api.openai.com/v1/chat/completions', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, model: model.id };
    }
    case 'openrouter': {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error('OPENROUTER_API_KEY not configured');
      return {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': process.env.APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:3001',
          'X-Title': process.env.APP_NAME ?? 'Chakor',
        },
        model: model.id,
      };
    }
    case 'ollama':
      return { url: `${OLLAMA_BASE_URL}/v1/chat/completions`, headers: { 'Content-Type': 'application/json' }, model: model.id.replace(/^ollama:/, '') };
    case 'lmstudio':
      return { url: `${LMSTUDIO_BASE_URL}/chat/completions`, headers: { 'Content-Type': 'application/json' }, model: model.id.replace(/^lmstudio:/, '') };
    case 'llama': {
      const e = llamaEndpoint();
      return { url: `${e.url}/v1/chat/completions`, headers: { 'Content-Type': 'application/json' }, model: e.label };
    }
    default:
      return null;
  }
}

interface ToolCall { id: string; function: { name: string; arguments: string } }

export async function* runAgent(opts: AgentOptions): AsyncGenerator<string> {
  const cfg = endpointFor(opts.model);
  if (!cfg) throw new Error('Tools are only supported on OpenAI-compatible models right now.');
  const tools = toolDefs(opts.toolIds);

  // Mutable working copy of the conversation we extend with tool results.
  const msgs: Record<string, unknown>[] = opts.messages.map((m) => ({ role: m.role, content: m.content }));

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // On the last allowed round, drop tools so the model is forced to answer.
    const offerTools = tools.length > 0 && round < MAX_ROUNDS - 1;

    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: cfg.headers,
      signal: opts.signal,
      body: JSON.stringify({
        model: cfg.model,
        messages: msgs,
        stream: false,
        ...(offerTools ? { tools, tool_choice: 'auto' } : {}),
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`${opts.model.provider} ${res.status}: ${t.slice(0, 300)}`);
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message ?? {};
    const toolCalls = message.tool_calls as ToolCall[] | undefined;

    if (offerTools && Array.isArray(toolCalls) && toolCalls.length > 0) {
      // Record the assistant turn that asked for tools, then run each one.
      msgs.push({ role: 'assistant', content: message.content ?? '', tool_calls: toolCalls });
      for (const tc of toolCalls) {
        const name = tc.function?.name ?? '';
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* malformed args */ }
        const spec = TOOLS[name];
        let result: string;
        if (!spec) result = `Unknown tool: ${name}`;
        else { try { result = await spec.run(args, { userId: opts.userId }); } catch (e) { result = `Error: ${e instanceof Error ? e.message : 'tool failed'}`; } }
        result = result.slice(0, 6000);
        opts.onTool?.({ name: name || 'tool', args: tc.function?.arguments || '', result });
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
      continue;
    }

    // Plain answer: emit usage as stats and yield the text.
    if (opts.onStats && data.usage) {
      opts.onStats({
        promptTokens: data.usage.prompt_tokens ?? 0,
        generationTokens: data.usage.completion_tokens ?? 0,
        generationMs: 0,
        tokensPerSecond: 0,
      });
    }
    const content = typeof message.content === 'string' ? message.content : '';
    if (content) yield content;
    return;
  }
}
