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
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ fill: 'var(--g)' }} className={className} aria-hidden="true">
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

// Gothic nameplate. Used on the auth pages and in settings, so it reads like
// the paper's masthead wherever it appears.
export function ChakorWordmark({ size = 28 }: { size?: number }) {
  const s = size / 28;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(8 * s) }}>
      <ChakorMark size={size} className="chakor-mark" />
      <span className="masthead-name" style={{
        fontSize: Math.round(22 * s),
        userSelect: 'none',
      }}>{APP.name}</span>
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

function PressCheck() {
  return (
    <div className="feat-icon">
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--g)' }}>
        <polyline points="2,6 5,9 10,3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
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
    try {
      const res = await signIn('credentials', { username: username.trim(), password, redirect: false });
      if (res?.error) setError('Invalid credentials. Please try again.');
      else { router.push('/'); router.refresh(); }
    } catch {
      setError('Network error, please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>

      {/* Background elements */}
      <div className="mkt-bg" />
      <div className="mkt-grid" />

      {/* Masthead */}
      <header style={{ position: 'relative', zIndex: 10, padding: '24px 32px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <ChakorWordmark size={26} />
          <Link href="/register" className="btn btn-outline" style={{ padding: '7px 16px', fontSize: '13px' }}>
            Create account
          </Link>
        </div>
        <div style={{ textAlign: 'center', padding: '8px 0 14px' }}>
          <div className="masthead-name" style={{ fontSize: 'clamp(52px, 8vw, 88px)' }}>{APP.name}</div>
        </div>
        <hr className="rule-double" />
        <div className="byline" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '8px 2px' }}>
          <span>Morning Edition · Vol. II, No. 1</span>
          <span>The Private Intelligence Gazette</span>
          <span>Price: Free Forever</span>
        </div>
        <hr className="rule-thin" />
      </header>

      {/* Main content */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', minHeight: 'calc(100vh - 220px)' }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 64, alignItems: 'center', maxWidth: 1100, width: '100%' }}>

          {/* Left: front page */}
          <div style={{ flex: 1, maxWidth: 520 }} className="anim-fade-up mkt-left">

            <div className="kicker" style={{ marginBottom: 10 }}>Special Report · Self-Hosting Desk</div>

            <h1 className="headline" style={{
              fontSize: 'clamp(40px, 5.6vw, 64px)',
              marginBottom: 4,
            }}>
              Your AI.<br />
              Your machine.
            </h1>
            <div className="byline" style={{ marginBottom: 14 }}>Dateline: your own server, this morning</div>
            <hr className="rule-fat" style={{ marginBottom: 18 }} />

            <div className="col-2" style={{ fontSize: 14.5, color: 'var(--fg-2)', lineHeight: 1.7, marginBottom: 32 }}>
              <p className="dropcap" style={{ marginBottom: 12 }}>
                Big tech wants your chats. {APP.name} keeps them on your own box, behind your own lock, on hardware you control.
              </p>
              <p style={{ margin: 0 }}>
                Run open models locally, or plug in your own API keys. Web search, your documents, and real research all live here, printed fresh on every visit.
              </p>
            </div>

            {/* Features */}
            <div className="kicker" style={{ marginBottom: 4 }}>From the Specification Desk</div>
            <div style={{ marginBottom: 32 }}>
              {FEATURES.map(f => (
                <div key={f.label} className="feat-row">
                  <PressCheck />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', marginBottom: 2 }}>{f.label}</div>
                    <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 10 }}>
              {STATS.map(s => (
                <div key={s.label} className="stat-block">
                  <div className="headline" style={{ fontSize: 30, color: 'var(--g)', lineHeight: 1 }}>{s.value}</div>
                  <div className="byline" style={{ marginTop: 6 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: subscription desk */}
          <div style={{ width: '100%', maxWidth: 400 }} className="anim-fade-up">
            <div style={{
              background: 'var(--bg-1)',
              border: '1px solid var(--bd-2)',
              borderRadius: 0,
              padding: 32,
              boxShadow: 'var(--sh-lg)',
            }}>
              <hr className="rule-fat" style={{ marginBottom: 14 }} />
              <div style={{ marginBottom: 24 }}>
                <div className="kicker" style={{ marginBottom: 8 }}>Subscription Desk</div>
                <h2 className="headline" style={{ fontSize: 26 }}>Sign in</h2>
                <p className="byline" style={{ marginTop: 6, textTransform: 'none', letterSpacing: '0.04em' }}>Access your private AI workspace</p>
              </div>

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 14 }}>
                  <label htmlFor="login-username" className="kicker" style={{ display: 'block', marginBottom: 6 }}>Username</label>
                  <input
                    id="login-username"
                    type="text" value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="inp" placeholder="your_username"
                    autoComplete="username" autoFocus required minLength={3} spellCheck={false}
                  />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label htmlFor="login-password" className="kicker" style={{ display: 'block', marginBottom: 6 }}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="login-password"
                      type={showPw ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="inp" placeholder="••••••••"
                      autoComplete="current-password" required
                      style={{ paddingRight: 60 }}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 600, color: 'var(--fg-4)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.04em', fontFamily: "'Special Elite', 'JetBrains Mono', monospace" }}>
                      {showPw ? 'HIDE' : 'SHOW'}
                    </button>
                  </div>
                </div>

                {error && (
                  <div style={{ background: 'var(--g-dim)', border: '1px solid var(--err)', borderRadius: 0, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--err)' }}>
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
                <hr className="rule-thin" style={{ flex: 1 }} />
                <span className="byline">Secure Dispatch</span>
                <hr className="rule-thin" style={{ flex: 1 }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 20 }}>
                {['bcrypt password hashing + signed JWT sessions', 'Self-hosted · zero telemetry', 'Local inference stays on your server'].map(t => (
                  <div key={t} className="byline" style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: '0.03em', fontSize: 11 }}>
                    <span style={{ color: 'var(--g)' }}>·</span> {t}
                  </div>
                ))}
              </div>

              <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 20, textAlign: 'center' }}>
                <Link href="/register" style={{ fontSize: 13, color: 'var(--fg-3)', textDecoration: 'none' }}>
                  No account? <span style={{ color: 'var(--g-text)', fontWeight: 600 }}>Create one free →</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
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
