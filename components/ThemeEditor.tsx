'use client';

import { useState, useEffect } from 'react';
import { ACCENTS, DEFAULT_ACCENT, applyAccent, saveAccent, loadAccent } from '@/lib/theme';

export default function ThemeEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  useEffect(() => { if (open) setAccent(loadAccent() ?? DEFAULT_ACCENT); }, [open]);
  if (!open) return null;

  const pick = (hex: string) => { setAccent(hex); applyAccent(hex); saveAccent(hex); };
  const reset = () => { setAccent(DEFAULT_ACCENT); applyAccent(null); saveAccent(null); };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} onClick={onClose} />
      <div className="anim-scale-in" style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 430, background: 'var(--bg-1)', border: '1px solid var(--bd-2)', borderRadius: 14, boxShadow: 'var(--sh-lg)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--bd)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>Appearance</span>
          <button onClick={onClose} className="btn-ghost-sm" style={{ padding: '4px 6px', color: 'var(--fg-3)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div style={{ padding: 18 }}>
          <p style={{ fontSize: 11.5, color: 'var(--fg-4)', marginBottom: 14, lineHeight: 1.5 }}>Pick an accent. It recolors the whole app live and is saved on this device.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
            {ACCENTS.map((a) => (
              <button key={a.hex} onClick={() => pick(a.hex)} title={a.name}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '11px 4px', borderRadius: 10, border: `1px solid ${accent.toLowerCase() === a.hex ? 'var(--fg-3)' : 'var(--bd-2)'}`, background: accent.toLowerCase() === a.hex ? 'var(--bg-3)' : 'transparent', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: a.hex }} />
                <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>{a.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-2)', cursor: 'pointer' }}>
              <input type="color" value={accent} onChange={(e) => pick(e.target.value)} style={{ width: 34, height: 28, border: '1px solid var(--bd-2)', borderRadius: 6, background: 'transparent', cursor: 'pointer', padding: 0 }} />
              Custom
            </label>
            <span style={{ fontSize: 12, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono,monospace' }}>{accent}</span>
            <button onClick={reset} className="btn-ghost-sm" style={{ marginLeft: 'auto', fontSize: 12.5, padding: '6px 10px', color: 'var(--fg-3)' }}>Reset</button>
          </div>
        </div>
      </div>
    </div>
  );
}
