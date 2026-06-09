// Accent theming. We recolor the app by overriding the green --g CSS variables
// at runtime from a single hex. Persisted per-device in localStorage, and applied
// before paint by a tiny inline script in app/layout.tsx (kept in sync with this).

export const STORAGE_KEY = 'chakor-accent';
export const DEFAULT_ACCENT = '#22c55e';

export const ACCENTS: { name: string; hex: string }[] = [
  { name: 'Activist green', hex: '#22c55e' },
  { name: 'Ember', hex: '#f97316' },
  { name: 'Ocean', hex: '#3b82f6' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Gold', hex: '#eab308' },
  { name: 'Slate', hex: '#64748b' },
];

function norm(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  return m ? '#' + m[1].toLowerCase() : null;
}

const VARS = ['--g', '--g-dim', '--g-bd', '--g-glow', '--g-text'];

export function applyAccent(hex: string | null): void {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  if (!hex) { VARS.forEach((p) => s.removeProperty(p)); return; }
  const c = norm(hex);
  if (!c) return;
  const n = parseInt(c.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  s.setProperty('--g', c);
  s.setProperty('--g-dim', `rgba(${r},${g},${b},0.08)`);
  s.setProperty('--g-bd', `rgba(${r},${g},${b},0.2)`);
  s.setProperty('--g-glow', `0 0 20px rgba(${r},${g},${b},0.25)`);
  const lr = Math.round(r + (255 - r) * 0.45), lg = Math.round(g + (255 - g) * 0.45), lb = Math.round(b + (255 - b) * 0.45);
  s.setProperty('--g-text', `rgb(${lr},${lg},${lb})`);
}

export function saveAccent(hex: string | null): void {
  try { if (hex) localStorage.setItem(STORAGE_KEY, hex); else localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function loadAccent(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
