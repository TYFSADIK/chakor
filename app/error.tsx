'use client';

// Route-segment error boundary: a render throw anywhere under app/ lands here
// instead of blanking the whole app. Keeps technical detail out of the UI; the
// real stack is in the server log.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', fontFamily: 'Newsreader, Georgia, serif', padding: 24 }}>
      <div style={{ maxWidth: 380, textAlign: 'center' }}>
        <hr className="rule-fat" />
        <p className="kicker" style={{ margin: '14px 0 6px' }}>Correction</p>
        <span className="stamp">Errata</span>
        <h1 className="headline" style={{ fontSize: 22, margin: '16px 0 8px' }}>Something went wrong</h1>
        <p style={{ fontSize: 13.5, color: 'var(--fg-3)', lineHeight: 1.6, marginBottom: 20, fontStyle: 'italic' }}>
          This page hit an unexpected error. Your conversations are safe. Try again, or reload the app.
        </p>
        <button onClick={reset} className="btn btn-green" style={{ padding: '9px 22px', fontSize: 13 }}>
          Try again
        </button>
        <hr className="rule-double" style={{ marginTop: 22 }} />
      </div>
    </div>
  );
}
