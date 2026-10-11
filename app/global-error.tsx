'use client';

// Root-level error boundary: replaces the whole document, so it must render its
// own <html>/<body>. Last-resort fallback when the layout itself throws.
// No CSS vars here (the stylesheet may not have loaded), so the press palette is inlined.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3ead9', color: '#221d15', fontFamily: 'Georgia, serif' }}>
        <div style={{ maxWidth: 380, textAlign: 'center', padding: 24 }}>
          <hr style={{ border: 'none', borderTop: '2px solid #221d15', margin: 0 }} />
          <p style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#a63a2e', margin: '14px 0 6px' }}>Correction</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 13.5, color: '#5d5544', lineHeight: 1.6, marginBottom: 20, fontStyle: 'italic' }}>
            The app hit an unexpected error. Your data is safe. Try again.
          </p>
          <button onClick={reset} style={{ padding: '9px 22px', fontSize: 13, borderRadius: 0, border: '1px solid #221d15', background: '#221d15', color: '#f3ead9', fontWeight: 600, cursor: 'pointer' }}>
            Try again
          </button>
          <hr style={{ border: 'none', borderTop: '3px double #221d15', marginTop: 22 }} />
        </div>
      </body>
    </html>
  );
}
