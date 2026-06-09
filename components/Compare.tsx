'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { APP } from '@/lib/config';

type Model = { id: string; name: string; provider: string };
type Stats = { generationTokens: number; generationMs: number; tokensPerSecond: number };
type Result = { content: string; done: boolean; error?: string; stats?: Stats };
type Board = { model: string; wins: number };

const LABELS = ['A', 'B', 'C', 'D'];
const MAX = 4;

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

export default function Compare() {
  const [models, setModels] = useState<Model[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [blind, setBlind] = useState(true);
  const [running, setRunning] = useState(false);
  const [runOrder, setRunOrder] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [revealed, setRevealed] = useState(false);
  const [voted, setVoted] = useState<string | null>(null);
  const [board, setBoard] = useState<Board[]>([]);
  const abortRef = useRef<AbortController[]>([]);

  const nameOf = useCallback((id: string) => models.find((m) => m.id === id)?.name ?? id, [models]);

  const loadBoard = useCallback(() => {
    fetch('/api/compare/leaderboard').then((r) => r.json()).then((d: Board[]) => setBoard(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/models').then((r) => r.json()).then((ms: Model[]) => {
      if (!Array.isArray(ms)) return;
      setModels(ms);
      setSelected(ms.slice(0, 2).map((m) => m.id));
    }).catch(() => {});
    loadBoard();
  }, [loadBoard]);

  function toggle(id: string) {
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id]);
  }

  async function streamOne(modelId: string, signal: AbortSignal) {
    try {
      const r = await fetch('/api/compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), modelId }), signal,
      });
      if (!r.ok || !r.body) { setResults((p) => ({ ...p, [modelId]: { ...p[modelId], error: `HTTP ${r.status}`, done: true } })); return; }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim(); if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim(); if (data === '[DONE]') continue;
          try {
            const obj = JSON.parse(data) as { delta?: string; stats?: Stats; error?: string };
            if (obj.delta) setResults((p) => ({ ...p, [modelId]: { ...p[modelId], content: (p[modelId]?.content ?? '') + obj.delta } }));
            if (obj.stats) setResults((p) => ({ ...p, [modelId]: { ...p[modelId], stats: obj.stats } }));
            if (obj.error) setResults((p) => ({ ...p, [modelId]: { ...p[modelId], error: obj.error, done: true } }));
          } catch { /* skip frame */ }
        }
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setResults((p) => ({ ...p, [modelId]: { ...p[modelId], error: 'connection error', done: true } }));
    } finally {
      setResults((p) => ({ ...p, [modelId]: { ...p[modelId], done: true } }));
    }
  }

  async function run() {
    if (selected.length < 2 || !prompt.trim() || running) return;
    const order = blind ? shuffle(selected) : [...selected];
    setRunOrder(order);
    setResults(Object.fromEntries(order.map((id) => [id, { content: '', done: false } as Result])));
    setVoted(null); setRevealed(!blind); setRunning(true);
    const controllers = order.map(() => new AbortController());
    abortRef.current = controllers;
    await Promise.all(order.map((id, i) => streamOne(id, controllers[i].signal)));
    setRunning(false);
  }

  function stop() { abortRef.current.forEach((c) => c.abort()); setRunning(false); }

  async function vote(modelId: string) {
    setVoted(modelId); setRevealed(true);
    try {
      await fetch('/api/compare/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner: modelId, models: runOrder, prompt: prompt.trim() }),
      });
    } catch { /* non-fatal */ }
    loadBoard();
  }

  const hasRun = runOrder.length > 0;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'Inter,sans-serif' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', height: 54, borderBottom: '1px solid var(--bd)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg-3)', textDecoration: 'none' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
          Chat
        </Link>
        <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: '0.04em' }}>COMPARE</span>
        <span style={{ fontSize: 12, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono,monospace' }}>blind model A/B for {APP.name}</span>
      </header>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '22px 18px 60px' }}>
        {/* Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 22 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'JetBrains Mono,monospace', marginBottom: 8 }}>Models ({selected.length}/{MAX})</p>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {models.map((m) => {
                const on = selected.includes(m.id);
                return (
                  <button key={m.id} onClick={() => toggle(m.id)} disabled={!on && selected.length >= MAX}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, fontSize: 12.5, fontWeight: 500, cursor: (!on && selected.length >= MAX) ? 'not-allowed' : 'pointer', border: `1px solid ${on ? 'var(--g-bd)' : 'var(--bd-2)'}`, background: on ? 'var(--g-dim)' : 'transparent', color: on ? 'var(--g-text)' : 'var(--fg-3)', opacity: (!on && selected.length >= MAX) ? 0.4 : 1, fontFamily: 'Inter,sans-serif' }}>
                    {m.name}
                  </button>
                );
              })}
              {models.length === 0 && <span style={{ fontSize: 13, color: 'var(--fg-4)' }}>No models available.</span>}
            </div>
          </div>

          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
            placeholder="Ask the same thing of every model…"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); } }}
            style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--bd-2)', borderRadius: 10, color: 'var(--fg)', fontFamily: 'Inter,sans-serif', fontSize: 14.5, lineHeight: 1.6, padding: '12px 14px', outline: 'none', resize: 'vertical', minHeight: 70 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setBlind((b) => !b)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: `1px solid ${blind ? 'var(--g-bd)' : 'var(--bd-2)'}`, background: blind ? 'var(--g-dim)' : 'transparent', color: blind ? 'var(--g-text)' : 'var(--fg-3)', fontFamily: 'Inter,sans-serif' }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${blind ? 'var(--g)' : 'var(--bd-2)'}`, background: blind ? 'var(--g)' : 'transparent', color: '#04100a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{blind && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}</span>
              Blind test
            </button>
            {running
              ? <button onClick={stop} style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--bg-3)', border: '1px solid var(--bd-2)', color: 'var(--fg-2)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Stop</button>
              : <button onClick={run} disabled={selected.length < 2 || !prompt.trim()}
                  style={{ padding: '8px 22px', borderRadius: 8, background: (selected.length >= 2 && prompt.trim()) ? 'var(--g)' : 'var(--bg-3)', color: (selected.length >= 2 && prompt.trim()) ? '#04100a' : 'var(--fg-4)', border: 'none', fontSize: 13.5, fontWeight: 700, cursor: (selected.length >= 2 && prompt.trim()) ? 'pointer' : 'not-allowed', fontFamily: 'Inter,sans-serif' }}>
                  Run compare
                </button>}
            {blind && hasRun && !revealed && <button onClick={() => setRevealed(true)} style={{ padding: '8px 14px', borderRadius: 8, background: 'transparent', border: '1px solid var(--bd-2)', color: 'var(--fg-3)', fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Reveal models</button>}
            <span style={{ fontSize: 11.5, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono,monospace' }}>Cmd/Ctrl + Enter to run</span>
          </div>
        </div>

        {/* Columns */}
        {hasRun && (
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
            {runOrder.map((id, i) => {
              const res = results[id] ?? { content: '', done: false };
              const isWinner = voted === id;
              const label = (blind && !revealed) ? `Model ${LABELS[i]}` : nameOf(id);
              return (
                <div key={id} style={{ flex: '1 1 0', minWidth: 300, display: 'flex', flexDirection: 'column', background: 'var(--bg-1)', border: `1px solid ${isWinner ? 'var(--g)' : 'var(--bd)'}`, borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--bd)', background: isWinner ? 'var(--g-dim)' : 'transparent' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: isWinner ? 'var(--g-text)' : 'var(--fg)' }}>
                      <span style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--bg-3)', color: 'var(--fg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'JetBrains Mono,monospace' }}>{LABELS[i]}</span>
                      {label}
                    </span>
                    {res.stats && <span style={{ fontSize: 10.5, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono,monospace' }}>{res.stats.tokensPerSecond.toFixed(1)} t/s</span>}
                  </div>
                  <div style={{ flex: 1, padding: '14px 16px', minHeight: 200, maxHeight: 540, overflowY: 'auto', fontSize: 14 }} className="prose-ai">
                    {res.error
                      ? <p style={{ color: 'var(--err)', fontSize: 13 }}>{res.error}</p>
                      : res.content
                        ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{res.done ? res.content : res.content + '▋'}</ReactMarkdown>
                        : <span style={{ color: 'var(--fg-4)', fontSize: 13 }}>{res.done ? '(no output)' : 'Thinking…'}</span>}
                  </div>
                  <div style={{ padding: '10px 14px', borderTop: '1px solid var(--bd)' }}>
                    <button onClick={() => vote(id)} disabled={!!voted}
                      style={{ width: '100%', padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: voted ? 'default' : 'pointer', border: `1px solid ${isWinner ? 'var(--g)' : 'var(--bd-2)'}`, background: isWinner ? 'var(--g)' : 'transparent', color: isWinner ? '#04100a' : 'var(--fg-2)', fontFamily: 'Inter,sans-serif', opacity: (voted && !isWinner) ? 0.5 : 1 }}>
                      {isWinner ? 'Winner ✓' : 'Pick this one'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {voted && (
          <p style={{ marginTop: 14, fontSize: 13.5, color: 'var(--g-text)' }}>
            You picked <strong>{nameOf(voted)}</strong>. Recorded in the leaderboard below.
          </p>
        )}

        {/* Leaderboard */}
        <div style={{ marginTop: 34 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'JetBrains Mono,monospace', marginBottom: 10 }}>Your leaderboard</p>
          {board.length === 0
            ? <p style={{ fontSize: 13, color: 'var(--fg-4)' }}>No votes yet. Run a comparison and pick a winner.</p>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 460 }}>
                {board.map((b, i) => {
                  const max = board[0].wins || 1;
                  return (
                    <div key={b.model} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 18, fontSize: 12, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono,monospace' }}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(b.model)}</span>
                      <div style={{ width: 140, height: 7, background: 'var(--bg-3)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${(b.wins / max) * 100}%`, height: '100%', background: 'var(--g)', opacity: 0.8 }} />
                      </div>
                      <span style={{ width: 28, textAlign: 'right', fontSize: 12, color: 'var(--fg-3)', fontFamily: 'JetBrains Mono,monospace' }}>{b.wins}</span>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
