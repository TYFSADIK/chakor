'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { APP } from '@/lib/config';

// Logo mark: a raised fist. Self hosting is a small act of resistance, so the
// mark says so. Built from simple shapes so it stays crisp from favicon to hero.
export function ChakorMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="#22c55e" className={className} aria-hidden="true">
      <rect x="14" y="33" width="20" height="11" rx="4.5" />
      <rect x="10.5" y="17" width="27" height="18" rx="6" />
      <rect x="11" y="10" width="5.6" height="12" rx="2.8" />
      <rect x="17.8" y="8.5" width="5.6" height="13.5" rx="2.8" />
      <rect x="24.6" y="8.5" width="5.6" height="13.5" rx="2.8" />
      <rect x="31.4" y="10" width="5.6" height="12" rx="2.8" />
      <rect x="8" y="22" width="15" height="7.5" rx="3.75" transform="rotate(-18 15 26)" />
    </svg>
  );
}

export function ChakorWordmark({ size = 28 }: { size?: number }) {
  const s = size / 28;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(8 * s) }}>
      <ChakorMark size={size} className="chakor-mark" />
      <span style={{
        fontWeight: 800,
        fontSize: Math.round(17 * s),
        letterSpacing: '0.08em',
        color: '#fafafa',
        fontFamily: 'Inter, sans-serif',
        userSelect: 'none',
      }}>{APP.name.toUpperCase()}</span>
    </div>
  );
}

// ─── Feature rows ────────────────────────────────────────────
const FEATURES = [
  { label: 'Runs on your hardware', desc: 'Local models with llama.cpp or Ollama. GPU or CPU, your call.' },
  { label: 'Nobody is watching', desc: 'Chats stay on your server. No telemetry, no data harvesting.' },
  { label: 'Run any model', desc: 'Local, or your own keys for OpenAI, Anthropic, Google, OpenRouter.' },
  { label: 'Actually useful', desc: 'Web search, chat with your files, and real multi source research.' },
];

const STATS = [
  { value: '0', label: 'Cloud data' },
  { value: '100%', label: 'Private' },
  { value: '∞', label: 'Questions' },
];

function GreenCheck() {
  return (
    <div className="feat-icon">
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <polyline points="2,6 5,9 10,3" stroke="#22c55e" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────
export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true); setError('');
    const res = await signIn('credentials', { username: username.trim(), password, redirect: false });
    setLoading(false);
    if (res?.error) setError('Invalid credentials. Please try again.');
    else { router.push('/'); router.refresh(); }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'Inter, sans-serif', position: 'relative', overflow: 'hidden' }}>

      {/* Background elements */}
      <div className="mkt-bg" />
      <div className="mkt-grid" />

      {/* Top navigation */}
      <nav style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', borderBottom: '1px solid var(--bd)' }}>
        <ChakorWordmark size={26} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link href="/register" className="btn btn-outline" style={{ padding: '7px 16px', fontSize: '13px' }}>
            Create account
          </Link>
        </div>
      </nav>

      {/* Main content */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', minHeight: 'calc(100vh - 73px)' }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 64, alignItems: 'center', maxWidth: 1100, width: '100%' }}>

          {/* Left: Marketing copy */}
          <div style={{ flex: 1, maxWidth: 520 }} className="anim-fade-up mkt-left">

            <div className="version-badge" style={{ marginBottom: 28 }}>
              <div className="status-dot" style={{ width: 7, height: 7 }} />
              v2.0 · Online · Private
            </div>

            <h1 style={{
              fontSize: 'clamp(42px, 6vw, 72px)',
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
              color: 'var(--fg)',
              marginBottom: 8,
            }}>
              Your AI.<br />
              <span className="text-shimmer">Your machine.</span>
            </h1>

            <p style={{ fontSize: 16, color: 'var(--fg-3)', lineHeight: 1.75, marginBottom: 36, maxWidth: 440 }}>
              Big tech wants your chats. {APP.name} keeps them on your own box. Run open models locally, or plug in your own API keys. Web search, your documents, and real research all live here, on hardware you control.
            </p>

            {/* Features */}
            <div style={{ marginBottom: 36 }}>
              {FEATURES.map(f => (
                <div key={f.label} className="feat-row">
                  <GreenCheck />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 2 }}>{f.label}</div>
                    <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 10 }}>
              {STATS.map(s => (
                <div key={s.label} className="stat-block">
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--g)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '-0.03em', lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Sign in form */}
          <div style={{ width: '100%', maxWidth: 400 }} className="anim-fade-up">
            <div style={{
              background: 'var(--bg-1)',
              border: '1px solid var(--bd-2)',
              borderRadius: 16,
              padding: 36,
              boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
            }}>
              <div style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <ChakorMark size={22} className="chakor-mark" />
                  <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)', letterSpacing: '-0.015em' }}>Sign in</h2>
                </div>
                <p style={{ fontSize: 13, color: 'var(--fg-3)' }}>Access your private AI workspace</p>
              </div>

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Username</label>
                  <input
                    type="text" value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="inp" placeholder="your_username"
                    autoComplete="username" autoFocus required minLength={3} spellCheck={false}
                  />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPw ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="inp" placeholder="••••••••"
                      autoComplete="current-password" required
                      style={{ paddingRight: 60 }}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 600, color: 'var(--fg-4)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.04em' }}>
                      {showPw ? 'HIDE' : 'SHOW'}
                    </button>
                  </div>
                </div>

                {error && (
                  <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--err)' }}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading || !username.trim() || !password}
                  className="btn btn-green" style={{ width: '100%' }}>
                  {loading
                    ? <><Spinner /> Authenticating…</>
                    : 'Sign in →'}
                </button>
              </form>

              <div style={{ margin: '24px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
                <span style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>SECURE</span>
                <div style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 20 }}>
                {['bcrypt password hashing + signed JWT sessions', 'Self-hosted · zero telemetry', 'Local inference stays on your server'].map(t => (
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono, monospace' }}>
                    <span style={{ color: 'var(--g)', opacity: 0.5 }}>·</span> {t}
                  </div>
                ))}
              </div>

              <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 20, textAlign: 'center' }}>
                <Link href="/register" style={{ fontSize: 13, color: 'var(--fg-3)', textDecoration: 'none' }}>
                  No account? <span style={{ color: 'var(--g-text)', fontWeight: 500 }}>Create one free →</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 768px) {
          .mkt-left { display: none !important; }
        }
      `}</style>
    </div>
  );
}

function Spinner() {
  return <div style={{ width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />;
}
