'use client';

import { useState } from 'react';
import Link from 'next/link';
import { APP } from '@/lib/config';

type Mem = { id: string; content: string; pinned: number; source: string | null; created_at: number; updated_at: number };

const sortMems = (a: Mem[]) => [...a].sort((x, y) => (y.pinned - x.pinned) || (y.updated_at - x.updated_at));

const I = {
  Pin: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22" /><path d="M9 4v5l-2 3h10l-2-3V4" /><line x1="8" y1="4" x2="16" y2="4" /></svg>,
  Edit: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>,
  Trash: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6M9 6V4h6v2" /></svg>,
};

export default function Memory({ initialMemories }: { initialMemories: Mem[] }) {
  const [mems, setMems] = useState<Mem[]>(sortMems(initialMemories));
  const [text, setText] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  async function add() {
    const content = text.trim();
    if (!content) return;
    try {
      const r = await fetch('/api/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
      const m = await r.json();
      if (r.ok && m?.id) setMems((p) => sortMems([m, ...p]));
    } catch { /* non-fatal */ }
    setText('');
  }
  async function patch(id: string, fields: Record<string, unknown>) {
    try { await fetch(`/api/memories/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }); } catch { /* non-fatal */ }
  }
  function togglePin(m: Mem) {
    const pinned = m.pinned ? 0 : 1;
    setMems((p) => sortMems(p.map((x) => (x.id === m.id ? { ...x, pinned } : x))));
    patch(m.id, { pinned: !!pinned });
  }
  async function remove(id: string) {
    await fetch(`/api/memories/${id}`, { method: 'DELETE' }).catch(() => {});
    setMems((p) => p.filter((x) => x.id !== id));
  }
  function saveEdit() {
    if (!editId) return;
    const content = editText.trim();
    if (content) { setMems((p) => p.map((x) => (x.id === editId ? { ...x, content } : x))); patch(editId, { content }); }
    setEditId(null); setEditText('');
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'Inter,sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', height: 54, borderBottom: '1px solid var(--bd)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg-3)', textDecoration: 'none' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
          Chat
        </Link>
        <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: '0.04em' }}>MEMORY</span>
        <span style={{ fontSize: 12, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono,monospace' }}>what {APP.name} remembers about you</span>
      </header>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 18px 60px' }}>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--bd-2)', borderRadius: 12, padding: '12px 14px', marginBottom: 22 }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Teach it something durable: your name, your stack, how you like answers…" rows={2}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); add(); } }}
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'vertical', color: 'var(--fg)', fontFamily: 'Inter,sans-serif', fontSize: 14, lineHeight: 1.55, minHeight: 42 }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button onClick={add} disabled={!text.trim()} style={{ padding: '7px 18px', borderRadius: 8, background: text.trim() ? 'var(--g)' : 'var(--bg-3)', color: text.trim() ? '#04100a' : 'var(--fg-4)', border: 'none', fontSize: 13, fontWeight: 700, cursor: text.trim() ? 'pointer' : 'not-allowed', fontFamily: 'Inter,sans-serif' }}>Remember</button>
          </div>
        </div>

        <p style={{ fontSize: 11.5, color: 'var(--fg-4)', marginBottom: 14, lineHeight: 1.5 }}>
          These get quietly added to every chat so the assistant stays consistent. It can also save its own with the <strong>save_memory</strong> tool.
        </p>

        {mems.length === 0
          ? <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--fg-4)', padding: '40px 0' }}>No memories yet. Add one above.</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mems.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--bg-1)', border: `1px solid ${m.pinned ? 'var(--g-bd)' : 'var(--bd)'}`, borderRadius: 10, padding: '11px 13px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editId === m.id
                      ? <textarea value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus rows={2}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') { setEditId(null); setEditText(''); } }}
                          onBlur={saveEdit}
                          style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--bd-2)', borderRadius: 6, outline: 'none', resize: 'vertical', color: 'var(--fg)', fontFamily: 'Inter,sans-serif', fontSize: 13.5, lineHeight: 1.5, padding: '6px 8px' }} />
                      : <p style={{ fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.5, wordBreak: 'break-word' }}>{m.content}</p>}
                    {m.source === 'assistant' && editId !== m.id && (
                      <span style={{ display: 'inline-block', marginTop: 5, fontSize: 10, color: 'var(--g-text)', fontFamily: 'JetBrains Mono,monospace', opacity: 0.8 }}>saved by assistant</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                    <button onClick={() => togglePin(m)} title={m.pinned ? 'Unpin' : 'Pin'} className="btn-ghost-sm" style={{ padding: '4px 5px', color: m.pinned ? 'var(--g)' : 'var(--fg-4)' }}><I.Pin /></button>
                    <button onClick={() => { setEditId(m.id); setEditText(m.content); }} title="Edit" className="btn-ghost-sm" style={{ padding: '4px 5px', color: 'var(--fg-4)' }}><I.Edit /></button>
                    <button onClick={() => remove(m.id)} title="Delete" className="btn-ghost-sm" style={{ padding: '4px 5px', color: 'var(--err)' }}><I.Trash /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
