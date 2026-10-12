'use client';

import { useEffect, useRef } from 'react';

/**
 * Focus trap for modals: moves focus into the dialog on open, keeps Tab /
 * Shift+Tab cycling inside it, calls onEscape on Escape, and restores focus
 * to whatever was focused before when the dialog closes.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const ref = useRef<T>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        el.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'),
      ).filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null);
    (focusables()[0] ?? el).focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', h, true);
    return () => { document.removeEventListener('keydown', h, true); prev?.focus?.(); };
  }, [active]);

  return ref;
}
