import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', fontFamily: 'Newsreader, Georgia, serif', padding: 24 }}>
      <div style={{ maxWidth: 380, textAlign: 'center' }}>
        <hr className="rule-fat" />
        <p className="masthead-name" style={{ fontSize: 56, margin: '12px 0 2px' }}>404</p>
        <p className="kicker" style={{ marginBottom: 14 }}>Lost column</p>
        <h1 className="headline" style={{ fontSize: 20, marginBottom: 8 }}>Page not found</h1>
        <p style={{ fontSize: 13.5, color: 'var(--fg-3)', lineHeight: 1.6, marginBottom: 20, fontStyle: 'italic' }}>
          That link does not lead anywhere. It may have been moved, deleted, or never existed.
        </p>
        <Link href="/" className="btn btn-green" style={{ padding: '9px 22px', fontSize: 13, textDecoration: 'none' }}>
          Back to chat
        </Link>
        <hr className="rule-double" style={{ marginTop: 22 }} />
      </div>
    </div>
  );
}
