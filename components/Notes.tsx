'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFocusTrap } from '@/hooks/useFocusTrap';

type Item = { text: string; done: boolean };
type Note = {
  id: string; title: string; body: string; color: string | null;
  pinned: number; archived: number; items?: Item[]; created_at: number; updated_at: number;
};

/* Index-card stocks. Tints derive from the edition inks so both the
   morning and midnight editions stay legible. Keys are stored in the
   database, so they must not change. */
const tint = (v: string, pct: number) => `color-mix(in srgb, ${v} ${pct}%, transparent)`;
const COLORS = [
  { key: '', bg: 'var(--bg-1)', bd: 'var(--bd)', dot: 'var(--bg-4)' },
  { key: 'green', bg: tint('var(--ok)', 10), bd: tint('var(--ok)', 32), dot: 'var(--ok)' },
  { key: 'blue', bg: tint('var(--cyan)', 10), bd: tint('var(--cyan)', 32), dot: 'var(--cyan)' },
  { key: 'amber', bg: tint('var(--warn)', 12), bd: tint('var(--warn)', 34), dot: 'var(--warn)' },
  { key: 'rose', bg: 'var(--g-dim)', bd: 'var(--g-bd)', dot: 'var(--g)' },
  { key: 'violet', bg: tint('var(--fg-3)', 10), bd: tint('var(--fg-3)', 30), dot: 'var(--fg-3)' },
];
const colorOf = (k: string | null) => COLORS.find((c) => c.key === (k ?? '')) ?? COLORS[0];

const I = {
  Pin: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22" /><path d="M9 4v5l-2 3h10l-2-3V4" /><line x1="8" y1="4" x2="16" y2="4" /></svg>,
  Trash: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6M9 6V4h6v2" /></svg>,
  Archive: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>,
  X: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  Plus: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  Check: () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>,
  List: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>,
};

function Dots({ value, onPick }: { value: string; onPick: (k: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {COLORS.map((c) => (
        <button key={c.key} onClick={() => onPick(c.key)} title={c.key || 'default'}
          style={{ width: 16, height: 16, borderRadius: 0, background: c.dot, border: value === c.key ? '2px solid var(--fg)' : '1px solid var(--bd-2)', cursor: 'pointer', padding: 0 }} />
      ))}
    </div>
  );
}

export default function Notes({ initialNotes }: { initialNotes: Note[] }) {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr] = useState('');

  // Composer
  const [cTitle, setCTitle] = useState('');
  const [cBody, setCBody] = useState('');
  const [cItems, setCItems] = useState<Item[]>([]);
  const [cNewItem, setCNewItem] = useState('');
  const [cChecklist, setCChecklist] = useState(false);
  const [cColor, setCColor] = useState('');

  // Edit modal
  const [editing, setEditing] = useState<Note | null>(null);
  const [buf, setBuf] = useState<{ title: string; body: string; items: Item[] | null; color: string }>({ title: '', body: '', items: null, color: '' });

  async function create() {
    const items = cItems.filter((i) => i.text.trim());
    const hasContent = cTitle.trim() || cBody.trim() || (cChecklist && items.length);
    if (!hasContent) { resetComposer(); return; }
    const payload = cChecklist
      ? { title: cTitle.trim(), color: cColor || null, items }
      : { title: cTitle.trim(), body: cBody.trim(), color: cColor || null };
    try {
      const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const note = await r.json().catch(() => null);
      if (r.ok && note?.id) { setNotes((p) => [note, ...p]); setErr(''); resetComposer(); }
      else setErr('Could not save note, your text is still here, try again');
    } catch { setErr('Could not save note, your text is still here, try again'); }
  }
  function resetComposer() { setCTitle(''); setCBody(''); setCItems([]); setCNewItem(''); setCChecklist(false); setCColor(''); }

  async function patch(id: string, fields: Record<string, unknown>): Promise<boolean> {
    try {
      const r = await fetch(`/api/notes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
      const note = await r.json().catch(() => null);
      if (r.ok && note?.id) { setNotes((p) => p.map((n) => (n.id === id ? note : n))); setErr(''); return true; }
    } catch { /* fall through */ }
    setErr('Could not save changes, please try again');
    return false;
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    try {
      const r = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      setNotes((p) => p.filter((n) => n.id !== id));
      if (editing?.id === id) setEditing(null);
      setErr('');
    } catch { setErr('Could not delete note, please try again'); }
  }
  async function toggleItem(n: Note, idx: number) {
    const items = (n.items ?? []).map((it, i) => (i === idx ? { ...it, done: !it.done } : it));
    setNotes((p) => p.map((x) => (x.id === n.id ? { ...x, items } : x)));
    if (!await patch(n.id, { items })) setNotes((p) => p.map((x) => (x.id === n.id ? { ...x, items: n.items } : x)));
  }

  function openEdit(n: Note) {
    setEditing(n);
    setBuf({ title: n.title, body: n.body, items: n.items ? n.items.map((i) => ({ ...i })) : null, color: n.color ?? '' });
  }
  async function saveEdit() {
    if (!editing) return;
    const fields: Record<string, unknown> = { title: buf.title.trim(), color: buf.color || null };
    if (buf.items) fields.items = buf.items.filter((i) => i.text.trim());
    else fields.body = buf.body.trim();
    if (await patch(editing.id, fields)) setEditing(null);
  }
  // Focus trap + Escape-to-save for the edit dialog.
  const editTrapRef = useFocusTrap<HTMLDivElement>(!!editing, () => { void saveEdit(); });

  const visible = notes.filter((n) => (showArchived ? n.archived : !n.archived));
  const pinned = visible.filter((n) => n.pinned);
  const others = visible.filter((n) => !n.pinned);

  const card = (n: Note) => {
    const c = colorOf(n.color);
    return (
      <div key={n.id} className="note-card" style={{ breakInside: 'avoid', marginBottom: 14, background: c.bg, border: `1px solid ${c.bd}`, borderTop: '3px double var(--fg)', borderRadius: 0, padding: '13px 15px', cursor: 'pointer', position: 'relative', boxShadow: 'var(--sh)' }}
        onClick={() => openEdit(n)}>
        {n.title && <p className="font-display" style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--fg)', marginBottom: n.body || n.items ? 7 : 0, paddingBottom: n.body || n.items ? 6 : 0, borderBottom: n.body || n.items ? '1px solid var(--bd)' : 'none', wordBreak: 'break-word' }}>{n.title}</p>}
        {n.items
          ? <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {n.items.slice(0, 12).map((it, i) => (
                <div key={i} onClick={(e) => { e.stopPropagation(); toggleItem(n, i); }} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                  <span style={{ marginTop: 1, width: 15, height: 15, borderRadius: 0, flexShrink: 0, border: `1.5px solid ${it.done ? 'var(--g)' : 'var(--bd-2)'}`, background: it.done ? 'var(--g)' : 'transparent', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{it.done && <I.Check />}</span>
                  <span style={{ fontSize: 13.5, color: it.done ? 'var(--fg-4)' : 'var(--fg-2)', textDecoration: it.done ? 'line-through' : 'none', wordBreak: 'break-word' }}>{it.text}</span>
                </div>
              ))}
            </div>
          : n.body && <p style={{ fontSize: 13.5, color: 'var(--fg-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55 }}>{n.body.slice(0, 600)}</p>}

        <div className="note-tools" style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 10, borderTop: '1px solid var(--bd)', paddingTop: 6 }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => patch(n.id, { pinned: !n.pinned })} title={n.pinned ? 'Unpin' : 'Pin'} className="btn-ghost-sm" style={{ padding: '4px 5px', color: n.pinned ? 'var(--g)' : 'var(--fg-4)' }}><I.Pin /></button>
          <button onClick={() => patch(n.id, { archived: !n.archived })} title={n.archived ? 'Unarchive' : 'Archive'} className="btn-ghost-sm" style={{ padding: '4px 5px', color: 'var(--fg-4)' }}><I.Archive /></button>
          <button onClick={() => remove(n.id)} title="Delete" className="btn-ghost-sm" style={{ padding: '4px 5px', color: 'var(--err)', marginLeft: 'auto' }}><I.Trash /></button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)' }}>
      <style>{`.note-card .note-tools{opacity:0;transition:opacity .15s}.note-card:hover .note-tools{opacity:1}@media(hover:none){.note-card .note-tools{opacity:1}}`}</style>

      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', height: 54, borderBottom: '3px double var(--fg)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <Link href="/" className="byline" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
          Chat
        </Link>
        <span className="kicker" style={{ fontSize: 13 }}>Notes Desk</span>
        <button onClick={() => setShowArchived((s) => !s)} className="btn-ghost-sm" style={{ marginLeft: 'auto', fontSize: 12.5, padding: '6px 10px', color: showArchived ? 'var(--g-text)' : 'var(--fg-3)' }}>
          {showArchived ? 'Active notes' : 'Archived'}
        </button>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '22px 18px 60px' }}>
        {err && <p style={{ maxWidth: 560, margin: '0 auto 14px', fontSize: 13, color: 'var(--err)' }}>{err}</p>}
        {/* Composer */}
        {!showArchived && (
          <div style={{ maxWidth: 560, margin: '0 auto 26px', background: colorOf(cColor).bg, border: `1px solid ${colorOf(cColor).bd}`, borderTop: '3px double var(--fg)', borderRadius: 0, padding: '12px 14px', boxShadow: 'var(--sh)' }}>
            <input value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="Headline"
              className="font-display"
              style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--bd)', outline: 'none', color: 'var(--fg)', fontSize: 16, fontWeight: 700, marginBottom: 8, paddingBottom: 6 }} />
            {cChecklist ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {cItems.map((it, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 15, height: 15, borderRadius: 0, border: '1.5px solid var(--bd-2)', flexShrink: 0 }} />
                    <input value={it.text} onChange={(e) => setCItems((p) => p.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                      style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--fg-2)', fontSize: 13.5 }} />
                    <button onClick={() => setCItems((p) => p.filter((_, j) => j !== i))} className="btn-ghost-sm" style={{ padding: '2px 4px', color: 'var(--fg-4)' }}><I.X /></button>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--fg-4)', display: 'inline-flex' }}><I.Plus /></span>
                  <input value={cNewItem} onChange={(e) => setCNewItem(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && cNewItem.trim()) { setCItems((p) => [...p, { text: cNewItem.trim(), done: false }]); setCNewItem(''); } }}
                    placeholder="List item, Enter to add"
                    style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--fg-2)', fontSize: 13.5 }} />
                </div>
              </div>
            ) : (
              <textarea value={cBody} onChange={(e) => setCBody(e.target.value)} placeholder="Take a note…" rows={2}
                style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'vertical', color: 'var(--fg-2)', fontSize: 14, lineHeight: 1.55, marginBottom: 10, minHeight: 38 }} />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
              <button onClick={() => setCChecklist((v) => !v)} title="Checklist" className="btn-ghost-sm" style={{ padding: '5px 7px', color: cChecklist ? 'var(--g)' : 'var(--fg-4)' }}><I.List /></button>
              <Dots value={cColor} onPick={setCColor} />
              <button onClick={create} className="btn btn-green" style={{ marginLeft: 'auto', padding: '8px 18px' }}>Add note</button>
            </div>
          </div>
        )}

        {/* Pinned */}
        {pinned.length > 0 && (
          <>
            <p className="kicker" style={{ marginBottom: 10 }}>Pinned</p>
            <hr className="rule-thin" style={{ marginBottom: 14 }} />
            <div style={{ columnWidth: 240, columnGap: 14, marginBottom: 24 }}>{pinned.map(card)}</div>
          </>
        )}
        {pinned.length > 0 && others.length > 0 && (
          <>
            <p className="kicker" style={{ marginBottom: 10 }}>Others</p>
            <hr className="rule-thin" style={{ marginBottom: 14 }} />
          </>
        )}
        <div style={{ columnWidth: 240, columnGap: 14 }}>{others.map(card)}</div>

        {visible.length === 0 && (
          <p className="font-fell" style={{ textAlign: 'center', fontSize: 16, color: 'var(--fg-4)', padding: '50px 0' }}>
            {showArchived ? 'No archived notes.' : 'No notes yet. Jot one down above.'}
          </p>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} onClick={saveEdit} />
          <div ref={editTrapRef} role="dialog" aria-modal="true" aria-label="Edit note" className="anim-scale-in" style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 540, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: colorOf(buf.color).bg, border: `1px solid ${colorOf(buf.color).bd}`, borderTop: '3px double var(--fg)', borderRadius: 0, boxShadow: 'var(--sh-lg)' }}>
            <div style={{ padding: '16px 18px 10px', overflowY: 'auto' }}>
              <input value={buf.title} onChange={(e) => setBuf((b) => ({ ...b, title: e.target.value }))} placeholder="Headline"
                className="font-display"
                style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--bd)', outline: 'none', color: 'var(--fg)', fontSize: 18, fontWeight: 700, marginBottom: 10, paddingBottom: 8 }} autoFocus />
              {buf.items ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {buf.items.map((it, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <button onClick={() => setBuf((b) => ({ ...b, items: b.items!.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) }))}
                        style={{ width: 17, height: 17, borderRadius: 0, flexShrink: 0, border: `1.5px solid ${it.done ? 'var(--g)' : 'var(--bd-2)'}`, background: it.done ? 'var(--g)' : 'transparent', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>{it.done && <I.Check />}</button>
                      <input value={it.text} onChange={(e) => setBuf((b) => ({ ...b, items: b.items!.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) }))}
                        style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: it.done ? 'var(--fg-4)' : 'var(--fg-2)', textDecoration: it.done ? 'line-through' : 'none', fontSize: 14 }} />
                      <button onClick={() => setBuf((b) => ({ ...b, items: b.items!.filter((_, j) => j !== i) }))} className="btn-ghost-sm" style={{ padding: '3px 5px', color: 'var(--fg-4)' }}><I.X /></button>
                    </div>
                  ))}
                  <button onClick={() => setBuf((b) => ({ ...b, items: [...b.items!, { text: '', done: false }] }))} className="btn-ghost-sm" style={{ alignSelf: 'flex-start', fontSize: 12.5, padding: '5px 8px', color: 'var(--fg-3)', gap: 6 }}><I.Plus /> Add item</button>
                </div>
              ) : (
                <textarea value={buf.body} onChange={(e) => setBuf((b) => ({ ...b, body: e.target.value }))} placeholder="Note…"
                  style={{ width: '100%', minHeight: 160, background: 'transparent', border: 'none', outline: 'none', resize: 'vertical', color: 'var(--fg-2)', fontSize: 14.5, lineHeight: 1.6 }} />
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderTop: '1px solid var(--bd)', flexWrap: 'wrap' }}>
              <Dots value={buf.color} onPick={(k) => setBuf((b) => ({ ...b, color: k }))} />
              <button onClick={() => remove(editing.id)} className="btn-ghost-sm" style={{ fontSize: 12.5, padding: '6px 8px', color: 'var(--err)', gap: 6 }}><I.Trash /> Delete</button>
              <button onClick={saveEdit} className="btn btn-green" style={{ marginLeft: 'auto', padding: '8px 20px' }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
