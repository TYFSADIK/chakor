'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Markdown } from './Markdown';
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
  // The prompt is snapshotted at send time so editing mid-run can't change what
  // the models were actually asked (and what a vote records).
  const [lockedPrompt, setLockedPrompt] = useState('');
  const abortRef = useRef<AbortController[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current.forEach((c) => c.abort());
    };
  }, []);

  const nameOf = useCallback((id: string) => models.find((m) => m.id === id)?.name ?? id, [models]);

  const loadBoard = useCallback(() => {
    fetch('/api/compare/leaderboard').then((r) => r.json()).then((d: Board[]) => { if (mountedRef.current) setBoard(Array.isArray(d) ? d : []); }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/models').then((r) => r.json()).then((ms: Model[]) => {
      if (!Array.isArray(ms) || !mountedRef.current) return;
      setModels(ms);
      setSelected(ms.slice(0, 2).map((m) => m.id));
    }).catch(() => {});
    loadBoard();
  }, [loadBoard]);

  function toggle(id: string) {
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id]);
  }

  async function streamOne(modelId: string, promptText: string, signal: AbortSignal) {
    const setRes = (fn: (p: Record<string, Result>) => Record<string, Result>) => { if (mountedRef.current) setResults(fn); };
    try {
      const r = await fetch('/api/compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText, modelId }), signal,
      });
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => null) as { error?: string } | null;
        setRes((p) => ({ ...p, [modelId]: { ...p[modelId], error: d?.error ?? `HTTP ${r.status}`, done: true } }));
        return;
      }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const part of parts) {
          const data = part.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          if (!data || data === '[DONE]') continue;
          try {
            const obj = JSON.parse(data) as { delta?: string; stats?: Stats; error?: string };
            if (obj.delta) setRes((p) => ({ ...p, [modelId]: { ...p[modelId], content: (p[modelId]?.content ?? '') + obj.delta } }));
            if (obj.stats) setRes((p) => ({ ...p, [modelId]: { ...p[modelId], stats: obj.stats } }));
            if (obj.error) setRes((p) => ({ ...p, [modelId]: { ...p[modelId], error: obj.error, done: true } }));
          } catch { /* skip frame */ }
        }
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setRes((p) => ({ ...p, [modelId]: { ...p[modelId], error: 'connection error', done: true } }));
    } finally {
      setRes((p) => ({ ...p, [modelId]: { ...p[modelId], done: true } }));
    }
  }

  async function run() {
    if (selected.length < 2 || !prompt.trim() || running) return;
    const promptText = prompt.trim();
    setLockedPrompt(promptText);
    const order = blind ? shuffle(selected) : [...selected];
    setRunOrder(order);
    setResults(Object.fromEntries(order.map((id) => [id, { content: '', done: false } as Result])));
    setVoted(null); setRevealed(!blind); setRunning(true);
    const controllers = order.map(() => new AbortController());
    abortRef.current = controllers;
    await Promise.all(order.map((id, i) => streamOne(id, promptText, controllers[i].signal)));
    if (mountedRef.current) setRunning(false);
  }

  function stop() { abortRef.current.forEach((c) => c.abort()); setRunning(false); }

  async function vote(modelId: string) {
    setVoted(modelId); setRevealed(true);
    try {
      await fetch('/api/compare/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner: modelId, models: runOrder, prompt: lockedPrompt }),
      });
    } catch { /* non-fatal */ }
    loadBoard();
  }

  const hasRun = runOrder.length > 0;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', height: 54, borderBottom: '3px double var(--fg)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <Link href="/" className="byline" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
          Chat
        </Link>
        <span className="kicker" style={{ fontSize: 13 }}>The Arena</span>
        <span className="byline" style={{ marginLeft: 'auto', textTransform: 'none' }}>blind model A/B for {APP.name}</span>
      </header>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '22px 18px 60px' }}>
        {/* Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 22 }}>
          <div>
            <p className="kicker" style={{ marginBottom: 8 }}>Contenders ({selected.length}/{MAX})</p>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {models.map((m) => {
                const on = selected.includes(m.id);
                return (
                  <button key={m.id} onClick={() => toggle(m.id)} disabled={!on && selected.length >= MAX}
                    className="font-type"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 0, fontSize: 12, letterSpacing: '0.04em', cursor: (!on && selected.length >= MAX) ? 'not-allowed' : 'pointer', border: `1px solid ${on ? 'var(--g-bd)' : 'var(--bd-2)'}`, background: on ? 'var(--g-dim)' : 'transparent', color: on ? 'var(--g-text)' : 'var(--fg-3)', opacity: (!on && selected.length >= MAX) ? 0.4 : 1 }}>
                    {m.name}
                  </button>
                );
              })}
              {models.length === 0 && <span style={{ fontSize: 13, color: 'var(--fg-4)' }}>No models available.</span>}
            </div>
          </div>

          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
            placeholder="Ask the same thing of every model…"
            disabled={running}
            aria-label="Prompt for all models"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); } }}
            className="inp"
            style={{ lineHeight: 1.6, resize: 'vertical', minHeight: 70, opacity: running ? 0.6 : 1 }} />
          {running && <p className="byline" style={{ margin: '-6px 0 0', textTransform: 'none' }}>Prompt is locked while the models are answering.</p>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setBlind((b) => !b)}
              className="font-type"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 0, fontSize: 12, letterSpacing: '0.04em', cursor: 'pointer', border: `1px solid ${blind ? 'var(--g-bd)' : 'var(--bd-2)'}`, background: blind ? 'var(--g-dim)' : 'transparent', color: blind ? 'var(--g-text)' : 'var(--fg-3)' }}>
              <span style={{ width: 14, height: 14, borderRadius: 0, border: `1.5px solid ${blind ? 'var(--g)' : 'var(--bd-2)'}`, background: blind ? 'var(--g)' : 'transparent', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{blind && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}</span>
              Blind test
            </button>
            {running
              ? <button onClick={stop} className="btn btn-outline" style={{ padding: '8px 18px' }}>Stop</button>
              : <button onClick={run} disabled={selected.length < 2 || !prompt.trim()} className="btn btn-green" style={{ padding: '9px 22px' }}>
                  Run compare
                </button>}
            {blind && hasRun && !revealed && <button onClick={() => setRevealed(true)} className="btn btn-outline" style={{ padding: '8px 14px' }}>Reveal models</button>}
            <span className="byline" style={{ textTransform: 'none' }}>Cmd/Ctrl + Enter to run</span>
          </div>
        </div>

        {/* Columns: the versus broadsheet */}
        {hasRun && (
          <div style={{ display: 'flex', overflowX: 'auto', border: '1px solid var(--bd-2)', borderTop: '3px double var(--fg)', background: 'var(--bg-1)', boxShadow: 'var(--sh)' }}>
            {runOrder.map((id, i) => {
              const res = results[id] ?? { content: '', done: false };
              const isWinner = voted === id;
              const label = (blind && !revealed) ? `Model ${LABELS[i]}` : nameOf(id);
              return (
                <div key={id} style={{ flex: '1 1 0', minWidth: 300, display: 'flex', flexDirection: 'column', borderLeft: i > 0 ? '1px solid var(--bd-3)' : 'none', background: isWinner ? 'var(--g-dim)' : 'transparent' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--bd-2)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span className="font-type" style={{ width: 20, height: 20, borderRadius: 0, border: '1px solid var(--bd-3)', background: 'var(--bg-2)', color: 'var(--fg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{LABELS[i]}</span>
                      <span className="headline" style={{ fontSize: 14.5, color: isWinner ? 'var(--g-text)' : 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                    </span>
                    {isWinner && <span className="stamp" style={{ fontSize: 9, padding: '2px 7px' }}>Winner</span>}
                    {res.stats && <span className="byline" style={{ textTransform: 'none', flexShrink: 0 }}>{res.stats.tokensPerSecond.toFixed(1)} t/s</span>}
                  </div>
                  <div style={{ flex: 1, padding: '14px 16px', minHeight: 200, maxHeight: 540, overflowY: 'auto', fontSize: 14 }} className="prose-ai">
                    {res.error
                      ? <p style={{ color: 'var(--err)', fontSize: 13 }}>{res.error}</p>
                      : res.content
                        ? <Markdown>{res.done ? res.content : res.content + '▋'}</Markdown>
                        : <span className="font-fell" style={{ color: 'var(--fg-4)', fontSize: 14 }}>{res.done ? '(no output)' : 'Thinking…'}</span>}
                  </div>
                  <div style={{ padding: '10px 14px', borderTop: '1px solid var(--bd-2)' }}>
                    <button onClick={() => vote(id)} disabled={!!voted}
                      className={isWinner ? 'btn btn-green' : 'btn btn-outline'}
                      style={{ width: '100%', padding: '8px 0', cursor: voted ? 'default' : 'pointer', opacity: (voted && !isWinner) ? 0.5 : 1 }}>
                      {isWinner ? 'Winner ✓' : 'Pick this one'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {voted && (
          <p className="font-fell" style={{ marginTop: 14, fontSize: 14.5, color: 'var(--g-text)' }}>
            You picked <strong>{nameOf(voted)}</strong>. Recorded in the leaderboard below.
          </p>
        )}

        {/* Leaderboard */}
        <div style={{ marginTop: 34, maxWidth: 520 }}>
          <p className="kicker" style={{ marginBottom: 8 }}>Your Leaderboard</p>
          <hr className="rule-fat" style={{ marginBottom: 4 }} />
          {board.length === 0
            ? <p className="font-fell" style={{ fontSize: 14, color: 'var(--fg-4)', padding: '12px 0' }}>No votes yet. Run a comparison and pick a winner.</p>
            : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {board.map((b, i) => {
                  const max = board[0].wins || 1;
                  return (
                    <div key={b.model} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--bd)' }}>
                      <span className="font-type" style={{ width: 18, fontSize: 12, color: 'var(--fg-4)' }}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(b.model)}</span>
                      <div style={{ width: 140, height: 8, background: 'var(--bg-2)', border: '1px solid var(--bd-2)', borderRadius: 0, overflow: 'hidden' }}>
                        <div style={{ width: `${(b.wins / max) * 100}%`, height: '100%', background: 'var(--g)', opacity: 0.85 }} />
                      </div>
                      <span className="font-type" style={{ width: 28, textAlign: 'right', fontSize: 12, color: 'var(--fg-3)' }}>{b.wins}</span>
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
