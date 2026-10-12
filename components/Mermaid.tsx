'use client';

import { useEffect, useState, Component } from 'react';

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
    // A failed chunk load (e.g. stale tab after a redeploy) must not poison
    // every later diagram — let the next attempt retry the import.
    mermaidPromise.catch(() => { mermaidPromise = null; });
  }
  return mermaidPromise;
}

// mermaid.render is NOT concurrency-safe: overlapping renders share global
// parser/DOM state and can throw in ways that reject BOTH calls. Chain every
// render through one queue so only one diagram renders at a time.
let renderQueue: Promise<unknown> = Promise.resolve();

function queuedRender(mermaid: Mermaid, id: string, code: string): Promise<{ svg: string }> {
  const run = renderQueue.then(() => mermaid.render(id, code));
  renderQueue = run.catch(() => { /* keep the queue alive after a failure */ });
  return run;
}

/**
 * Small models constantly emit unquoted flowchart labels containing
 * parentheses/braces/semicolons, which mermaid's parser rejects ("Parse error
 * ... got 'PS'"). Quote those labels before rendering; already-quoted labels
 * and non-flowchart diagram types pass through untouched. If the result still
 * doesn't parse, the caller's error path falls back to the code block.
 */
export function sanitizeMermaid(code: string): string {
  return code.replace(/\[([^\]"]*[(){};][^\]"]*)\]/g, (_, lbl: string) => `["${lbl.replace(/"/g, "'")}"]`);
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

// While an answer is streaming, the mermaid block re-renders on every token
// flush with half-written, invalid code. Only attempt a render once the code
// has been stable for a moment — the finished diagram is the one that matters.
const SETTLE_MS = 500;

export function MermaidDiagram({ code, onError }: { code: string; onError: () => void }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const timer = setTimeout(() => {
      const id = `chakor-mmd-${++diagramCounter}`;
      loadMermaid()
        .then((mermaid) => queuedRender(mermaid, id, sanitizeMermaid(code)))
        .then(({ svg: rendered }) => {
          if (cancelled) return;
          let out = rendered;
          if (reducedMotion) {
            // No autoplaying motion: drop SMIL animation and CSS transitions
            // from the rendered SVG.
            out = out
              .replace(/<animate[\s\S]*?<\/animate(?:Transform|Motion)?>/g, '')
              .replace(/<animate(Transform|Motion)?[^>]*\/>/g, '')
              .replace(/<style[\s\S]*?<\/style>/g, (s) =>
                s.replace(/animation[^;}]*[;}]/g, '').replace(/transition[^;}]*[;}]/g, ''));
          }
          setSvg(out);
        })
        .catch((err) => {
          // mermaid.render leaves its temp error element in the DOM on failure.
          try { document.getElementById(`d${id}`)?.remove(); } catch { /* noop */ }
          console.warn('[chakor] mermaid render failed:', err);
          if (!cancelled) onError();
        });
    }, SETTLE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [code, onError]);

  // The SVG goes through React state + dangerouslySetInnerHTML, never direct
  // DOM mutation — writing innerHTML into a React-managed node crashes React's
  // reconciler on the next streaming update ("removeChild: not a child").
  // Mermaid's strict securityLevel sanitizes the SVG output.
  if (svg !== null) {
    return <div className="mermaid-diagram" aria-label="Diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  return (
    <div className="mermaid-diagram" aria-label="Diagram" style={{ minHeight: 60 }}>
      <span className="mermaid-loading">Rendering diagram…</span>
    </div>
  );
}

/**
 * Last line of defense: mermaid failures (parse errors, chunk load failures,
 * browser quirks) must NEVER take down the chat. Anything that escapes the
 * effect's catch — including synchronous render errors — lands here and shows
 * the plain code block instead.
 */
export class MermaidBoundary extends Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* swallow — the fallback is the code block */ }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
