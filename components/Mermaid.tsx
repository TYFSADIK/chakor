'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Renders a ```mermaid fenced block as an SVG diagram.
 *
 * mermaid is ~1 MB of parser, so it's never in the initial bundle: the first
 * diagram on a page triggers a dynamic import, and every later diagram shares
 * that one promise. Everything happens in useEffect — this component renders
 * a placeholder during SSR (the public share page is a server component) and
 * only touches window/mermaid in the browser.
 *
 * If the diagram fails to parse, onError fires and the parent swaps back to
 * the plain code block — a bad diagram must never break the message.
 */

type Mermaid = typeof import('mermaid')['default'];

let mermaidPromise: Promise<Mermaid> | null = null;

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        ...themeConfig(),
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

/**
 * Theme from the app's own CSS variables (the "edition" tokens in
 * globals.css), so diagrams sit on the page like they belong to it. Falls
 * back to mermaid's built-in 'dark' when the variables aren't readable.
 */
function themeConfig(): { theme: 'base'; themeVariables: Record<string, string> } | { theme: 'dark' } {
  try {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const bg = v('--bg');
    const fg = v('--fg');
    if (!bg || !fg) return { theme: 'dark' };
    const panel = v('--bg-2') || bg;
    const accent = v('--g') || fg;
    return {
      theme: 'base',
      themeVariables: {
        background: bg,
        primaryColor: panel,
        primaryTextColor: fg,
        primaryBorderColor: fg,
        secondaryColor: bg,
        tertiaryColor: panel,
        lineColor: fg,
        textColor: fg,
        mainBkg: panel,
        nodeBorder: fg,
        clusterBkg: bg,
        edgeLabelBackground: bg,
        actorBkg: panel,
        actorBorder: fg,
        actorTextColor: fg,
        signalColor: fg,
        signalTextColor: fg,
        labelBoxBkgColor: panel,
        labelTextColor: fg,
        loopTextColor: fg,
        noteBkgColor: panel,
        noteTextColor: fg,
        activationBorderColor: accent,
        sequenceNumberColor: bg,
        fontFamily: 'inherit',
      },
    };
  } catch {
    return { theme: 'dark' };
  }
}

let diagramCounter = 0;

export function MermaidDiagram({ code, onError }: { code: string; onError: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = `chakor-mmd-${++diagramCounter}`;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    loadMermaid()
      .then((mermaid) => mermaid.render(id, code))
      .then(({ svg }) => {
        if (cancelled || !ref.current) return;
        if (reducedMotion) {
          // No autoplaying motion: drop SMIL animation and CSS transitions
          // from the rendered SVG.
          svg = svg
            .replace(/<animate[\s\S]*?<\/animate(?:Transform|Motion)?>/g, '')
            .replace(/<animate(Transform|Motion)?[^>]*\/>/g, '')
            .replace(/<style[\s\S]*?<\/style>/g, (s) =>
              s.replace(/animation[^;}]*[;}]/g, '').replace(/transition[^;}]*[;}]/g, ''));
        }
        ref.current.innerHTML = svg;
        setReady(true);
      })
      .catch(() => {
        // mermaid.render leaves its temp error element in the DOM on failure.
        try { document.getElementById(`d${id}`)?.remove(); } catch { /* noop */ }
        if (!cancelled) onError();
      });

    return () => { cancelled = true; };
  }, [code, onError]);

  return (
    <div
      ref={ref}
      className="mermaid-diagram"
      aria-label="Diagram"
      style={ready ? undefined : { minHeight: 60 }}
    >
      {!ready && <span className="mermaid-loading">Rendering diagram…</span>}
    </div>
  );
}
