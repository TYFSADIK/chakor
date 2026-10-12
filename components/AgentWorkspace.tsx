'use client';

import { useState, useEffect, useCallback, useRef, useImperativeHandle } from 'react';

/**
 * Agent Workspace panel: file list, activity log, and the Agent Mode toggle.
 *
 * The parent (ChatShell) owns message submission. When Agent Mode is on it
 * calls ref.runAgent(message, onFinal); events stream into the activity log
 * here and the final answer is handed back to the chat as a normal message.
 */

export interface AgentWorkspaceHandle {
  /** Run the agent on a message. Resolves when the run ends; onFinal receives the final answer text. */
  runAgent: (message: string, onFinal?: (answer: string) => void, signal?: AbortSignal) => Promise<void>;
  isRunning: () => boolean;
}

interface WorkspaceFile {
  name: string;
  size: number;
  createdAt: string;
}

interface LogEntry {
  id: string;
  kind: 'status' | 'thought' | 'tool_call' | 'tool_result' | 'error' | 'final_answer';
  message: string;
  detail?: string;
  ok?: boolean;
  ts: number;
}

interface AgentWorkspaceProps {
  conversationId: string | null;
  agentMode: boolean;
  onToggleAgentMode: () => void;
  /** Called when the agent endpoint created a new conversation for us. */
  onNewConversation?: (id: string) => void;
  ref?: React.Ref<AgentWorkspaceHandle>;
}

// Plain language for every tool, so nobody has to read tool names.
const TOOL_LABELS: Record<string, string> = {
  write_file: 'Creating file',
  read_file: 'Reading file',
  execute_python: 'Running Python code',
  list_files: 'Checking files',
  web_search: 'Searching the web',
  generate_docx: 'Making Word document',
  generate_pptx: 'Making presentation',
};

let logSeq = 0;

export default function AgentWorkspace({
  conversationId,
  agentMode,
  onToggleAgentMode,
  onNewConversation,
  ref,
}: AgentWorkspaceProps) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [isOpen, setIsOpen] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);

  // Persist the open/collapsed choice. On narrower windows (sidebar + this
  // panel would leave the chat under ~500px), start collapsed unless the
  // user has already chosen.
  useEffect(() => {
    try {
      const v = localStorage.getItem('chakor-workspace-open');
      if (v !== null) setIsOpen(v === '1');
      else if (window.innerWidth < 1100) setIsOpen(false);
    } catch { /* storage unavailable */ }
  }, []);
  const toggleOpen = useCallback(() => {
    setIsOpen((p) => {
      try { localStorage.setItem('chakor-workspace-open', p ? '0' : '1'); } catch { /* ignore */ }
      return !p;
    });
  }, []);

  const fetchFiles = useCallback(async () => {
    if (!conversationId) { setFiles([]); return; }
    try {
      const res = await fetch(`/api/workspace/${conversationId}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch { /* panel stays as-is */ }
  }, [conversationId]);

  useEffect(() => {
    fetchFiles();
    const interval = setInterval(fetchFiles, 3000);
    return () => clearInterval(interval);
  }, [fetchFiles]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = useCallback((entry: Omit<LogEntry, 'id' | 'ts'>) => {
    setLogs((prev) => [...prev, { ...entry, id: `log-${++logSeq}`, ts: Date.now() }]);
  }, []);

  const runAgent = useCallback(async (message: string, onFinal?: (answer: string) => void, signal?: AbortSignal) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsRunning(true);
    setStep(0);
    addLog({ kind: 'status', message: 'Starting the agent...' });

    try {
      const res = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversationId ?? undefined, message }),
        signal: signal ?? null,
      });

      const newConv = res.headers.get('X-New-Conversation') === '1'
        ? res.headers.get('X-Conversation-Id')
        : null;
      if (newConv) onNewConversation?.(newConv);

      if (!res.ok || !res.body) {
        addLog({ kind: 'error', message: `Could not reach the agent (error ${res.status}). Try again in a moment.` });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Stop reading the moment the caller aborts instead of waiting for the
      // server to notice the closed socket.
      const cancelOnAbort = () => { reader.cancel().catch(() => {}); };
      if (signal) {
        if (signal.aborted) cancelOnAbort();
        else signal.addEventListener('abort', cancelOnAbort, { once: true });
      }

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';

          for (const evt of events) {
            const line = evt.trim();
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const event = JSON.parse(data);
              switch (event.type) {
                case 'status': {
                  const m = /step (\d+)/.exec(event.message ?? '');
                  if (m) setStep(Number(m[1]));
                  break; // status is shown in the status bar, not the log
                }
                case 'thought':
                  addLog({ kind: 'thought', message: String(event.content).slice(0, 300) });
                  break;
                case 'tool_call':
                  addLog({
                    kind: 'tool_call',
                    message: `${TOOL_LABELS[event.tool] ?? event.tool}...`,
                    detail: JSON.stringify(event.arguments, null, 2).slice(0, 1500),
                  });
                  break;
                case 'tool_result': {
                  const failed = event.result && typeof event.result === 'object'
                    && ('error' in event.result || (typeof event.result.returncode === 'number' && event.result.returncode !== 0));
                  addLog({
                    kind: failed ? 'error' : 'tool_result',
                    ok: !failed,
                    message: failed
                      ? `${TOOL_LABELS[event.tool] ?? event.tool} hit a problem. The agent will try to recover.`
                      : `${TOOL_LABELS[event.tool] ?? event.tool} finished.`,
                    detail: JSON.stringify(event.result, null, 2).slice(0, 2000),
                  });
                  break;
                }
                case 'error':
                  addLog({ kind: 'error', message: `${event.message}` });
                  break;
                case 'final_answer':
                  addLog({ kind: 'final_answer', message: 'Done! The answer is in the chat.' });
                  onFinal?.(String(event.content ?? ''));
                  break;
              }
            } catch { /* malformed SSE line; skip */ }
          }
        }
      } finally {
        signal?.removeEventListener('abort', cancelOnAbort);
      }
      if (signal?.aborted) addLog({ kind: 'status', message: 'Stopped by you.' });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        addLog({ kind: 'status', message: 'Stopped by you.' });
      } else {
        addLog({ kind: 'error', message: 'The connection to the agent was lost. Check that the app is still running, then try again.' });
      }
    } finally {
      runningRef.current = false;
      setIsRunning(false);
      fetchFiles();
    }
  }, [conversationId, addLog, fetchFiles, onNewConversation]);

  useImperativeHandle(ref, () => ({
    runAgent: (message: string, onFinal?: (answer: string) => void, signal?: AbortSignal) => runAgent(message, onFinal, signal),
    isRunning: () => runningRef.current,
  }), [runAgent]);

  const deleteFile = async (name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/workspace/${conversationId}/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (res.ok) fetchFiles();
    } catch { /* list refreshes on next poll anyway */ }
  };

  const downloadFile = (name: string) => {
    window.open(`/api/workspace/${conversationId}/files/${encodeURIComponent(name)}`, '_blank');
  };

  const fmtBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };
  const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const collapsed = !isOpen;

  return (
    <aside
      aria-label="Agent workspace"
      aria-busy={isRunning}
      className={`agent-workspace-panel${isOpen ? ' agent-workspace-open' : ''}`}
      style={{
        width: collapsed ? 44 : 320,
        minWidth: collapsed ? 44 : 320,
        background: 'var(--bg-1)',
        borderLeft: '1px solid var(--bd)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        transition: 'width .18s ease',
      }}
    >
      <button
        onClick={toggleOpen}
        aria-label={isOpen ? 'Hide workspace panel' : 'Show workspace panel'}
        title={isOpen ? 'Hide workspace panel' : 'Show workspace panel'}
        style={{
          minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', borderBottom: '1px solid var(--bd)',
          color: 'var(--fg-3)', cursor: 'pointer', fontSize: 13,
        }}
      >
        {isOpen ? '\u25B6' : '\u25C0'}
      </button>

      {isOpen && (
        <div
          style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          onKeyDown={(e) => { if (e.key === 'Escape') toggleOpen(); }}
        >
          {/* Agent mode toggle */}
          <div style={{ padding: 12, borderBottom: '1px solid var(--bd)' }}>
            <button
              onClick={onToggleAgentMode}
              aria-pressed={agentMode}
              aria-label={agentMode ? 'Turn Agent Mode off' : 'Turn Agent Mode on'}
              title={agentMode ? 'Turn Agent Mode off' : 'Turn Agent Mode on'}
              style={{
                width: '100%', minHeight: 44, borderRadius: 0, fontSize: 13, fontWeight: 700,
                fontFamily: "'Special Elite', monospace", letterSpacing: '0.14em', textTransform: 'uppercase',
                cursor: 'pointer', transition: 'background .15s',
                border: agentMode ? '2px solid var(--g)' : '1px solid var(--bd-2)',
                background: agentMode ? 'var(--g-dim)' : 'var(--bg-2)',
                color: agentMode ? 'var(--g-text)' : 'var(--fg-2)',
              }}
            >
              Agent Mode: {agentMode ? 'On' : 'Off'}
            </button>
            <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: '8px 2px 0', lineHeight: 1.5, fontStyle: 'italic' }}>
              {agentMode
                ? 'Messages go to the agent. It can research, write code, and create files.'
                : 'Turn on to let the AI create files, run code, and work in steps.'}
            </p>
          </div>

          {/* Status bar */}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--bd)', fontSize: 12.5 }}
            role="status"
          >
            <span
              aria-hidden
              className={isRunning ? 'agent-pulse' : undefined}
              style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: isRunning ? 'var(--warn)' : 'var(--fg-4)',
              }}
            />
            <span style={{ color: isRunning ? 'var(--fg)' : 'var(--fg-3)' }}>
              {isRunning ? `Agent is working${step > 0 ? ` (Step ${step} of 15)` : '...'}` : 'Agent is resting'}
            </span>
          </div>

          {/* Files */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
            <h3 className="kicker" style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              From the Desk
              {files.length > 0 && (
                <span style={{ fontSize: 10.5, background: 'var(--bg-3)', borderRadius: 0, padding: '1px 7px', color: 'var(--fg-3)' }}>
                  {files.length}
                </span>
              )}
            </h3>
            {files.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--fg-3)', lineHeight: 1.6, margin: '6px 2px' }}>
                No files yet. Ask the agent to create one!
              </p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {files.map((f) => (
                  <li
                    key={f.name}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                      borderRadius: 0, background: 'var(--bg-2)', border: '1px solid var(--bd)', borderLeft: '2px solid var(--fg-3)',
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--g-text)" strokeWidth="1.75" aria-hidden>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span
                      style={{ flex: 1, fontSize: 12.5, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={f.name}
                    >
                      {f.name}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--fg-3)', flexShrink: 0 }}>{fmtBytes(f.size)}</span>
                    <button
                      onClick={() => downloadFile(f.name)}
                      aria-label={`Download ${f.name}`}
                      title={`Download ${f.name}`}
                      style={{
                        minWidth: 44, minHeight: 44, padding: '0 8px', background: 'transparent', border: 'none',
                        color: 'var(--cyan)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      Get
                    </button>
                    <button
                      onClick={() => deleteFile(f.name)}
                      aria-label={`Delete ${f.name}`}
                      title={`Delete ${f.name}`}
                      style={{
                        minWidth: 44, minHeight: 44, padding: '0 4px', background: 'transparent', border: 'none',
                        color: 'var(--err)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      Del
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Activity log: the wire desk */}
          <div style={{ height: '42%', borderTop: '3px double var(--fg)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px 4px' }}>
              <h3 className="kicker" style={{ margin: 0 }}>The Wire Desk</h3>
              {logs.length > 0 && !isRunning && (
                <button
                  onClick={() => setLogs([])}
                  aria-label="Clear activity log"
                  title="Clear activity log"
                  style={{ minHeight: 44, padding: '0 8px', background: 'transparent', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 11.5 }}
                >
                  Clear
                </button>
              )}
            </div>
            <div
              role="log"
              aria-live="polite"
              aria-label="Agent activity"
              style={{ flex: 1, overflowY: 'auto', padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              {logs.length === 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--fg-3)', margin: '4px 2px', fontStyle: 'italic' }}>
                  Nothing on the wire yet. The agent&apos;s dispatches will be filed here.
                </p>
              )}
              {(() => {
                const dispatchNo = new Map<string, number>();
                let n = 0;
                for (const l of logs) if (l.kind === 'tool_call') dispatchNo.set(l.id, ++n);
                return logs.map((log, i) => {
                  const hasDetail = Boolean(log.detail);
                  const isExpanded = expanded === log.id || (!expanded && i >= logs.length - 3 && hasDetail);
                  const time = fmtTime(log.ts);
                  const detailBtn = hasDetail ? (
                    <button
                      onClick={() => setExpanded(isExpanded ? null : log.id)}
                      aria-label={isExpanded ? 'Hide technical details' : 'Show technical details'}
                      aria-expanded={isExpanded}
                      style={{ minWidth: 44, minHeight: 44, padding: '0 4px', background: 'transparent', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 11 }}
                    >
                      {isExpanded ? 'Less' : 'More'}
                    </button>
                  ) : null;
                  const detail = hasDetail && isExpanded ? (
                    <pre style={{
                      margin: '6px 0 0', padding: '8px 10px', background: 'var(--bg-2)',
                      borderLeft: '2px solid var(--bd-3)',
                      fontSize: 10.5, color: 'var(--fg-3)', whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word', maxHeight: 160, overflowY: 'auto', fontFamily: 'JetBrains Mono,monospace',
                    }}>
                      {log.detail}
                    </pre>
                  ) : null;

                  if (log.kind === 'tool_call') {
                    return (
                      <div key={log.id} className="wire-dispatch">
                        <div className="wire-dispatch-head">
                          <span>Dispatch No. {dispatchNo.get(log.id)}</span>
                          <span>{time}</span>
                        </div>
                        <div style={{ padding: '7px 12px', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.45 }}>{log.message}</span>
                          {detailBtn}
                        </div>
                        {detail && <div style={{ padding: '0 12px 8px' }}>{detail}</div>}
                      </div>
                    );
                  }
                  if (log.kind === 'error') {
                    return (
                      <div key={log.id} className="wire-errata" style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <span className="stamp" style={{ fontSize: 9, padding: '2px 7px', flexShrink: 0 }}>Errata</span>
                          <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.45 }}>{log.message}</span>
                          {detailBtn}
                        </div>
                        <p className="wire-status" style={{ margin: '4px 0 0', textTransform: 'none', letterSpacing: '0.05em', color: 'var(--err)' }}>{time}</p>
                        {detail}
                      </div>
                    );
                  }
                  if (log.kind === 'thought') {
                    return (
                      <div key={log.id} className="wire-thought" style={{ fontSize: 13, lineHeight: 1.5 }}>
                        {log.message}
                        <span className="wire-status" style={{ marginLeft: 8, textTransform: 'none', letterSpacing: '0.05em', fontSize: 9.5 }}>{time}</span>
                      </div>
                    );
                  }
                  if (log.kind === 'final_answer') {
                    return (
                      <div key={log.id} style={{ borderTop: '3px double var(--fg)', borderBottom: '3px double var(--fg)', padding: '7px 2px', textAlign: 'center' }}>
                        <p className="headline" style={{ fontSize: 15, margin: 0 }}>{log.message}</p>
                        <p className="wire-status" style={{ margin: '3px 0 0', textTransform: 'none', letterSpacing: '0.05em' }}>{time}</p>
                      </div>
                    );
                  }
                  if (log.kind === 'tool_result') {
                    return (
                      <div key={log.id} className="wire-report" style={{ padding: '6px 10px' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          <span className="wire-status" style={{ textTransform: 'none', letterSpacing: '0.05em', flexShrink: 0 }}>{time}</span>
                          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.45 }}>{log.message}</span>
                          {detailBtn}
                        </div>
                        {detail}
                      </div>
                    );
                  }
                  return (
                    <p key={log.id} className="wire-status" style={{ margin: 0, display: 'flex', gap: 8 }}>
                      <span style={{ flex: 1, textTransform: 'none', letterSpacing: '0.08em' }}>{log.message}</span>
                      <span>{time}</span>
                    </p>
                  );
                });
              })()}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* Screen reader announcements for status changes */}
      <span className="sr-only" role="status" aria-live="polite">
        {isRunning ? `The agent is working, step ${step}` : 'The agent is resting'}
      </span>

      <style jsx>{`
        .agent-pulse { animation: agentPulse 1.1s ease-in-out infinite; }
        @keyframes agentPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(1.35); } }
        @media (prefers-reduced-motion: reduce) { .agent-pulse { animation: none; } }
        .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); whiteSpace: nowrap; }
        @media (max-width: 767px) {
          .agent-workspace-panel {
            position: fixed !important;
            left: 0; right: 0; bottom: 0;
            width: 100% !important;
            min-width: 0 !important;
            height: auto !important;
            max-height: 55vh;
            z-index: 25;
            border-left: none !important;
            border-top: 1px solid var(--bd-2);
            box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
          }
          /* Collapsed: shrink to just the toggle bar so the composer stays usable. */
          .agent-workspace-panel:not(.agent-workspace-open) { max-height: 44px; }
        }
      `}</style>
    </aside>
  );
}
