'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChakorWordmark, ChakorMark } from './LoginForm';

function Spinner() {
  return <div style={{ width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite', flexShrink: 0 }} />;
}

const PERKS = [
  { label: 'Free forever', desc: 'No subscription, no credit card, no paywalls.' },
  { label: 'Instant access', desc: 'Account is live the moment you create it.' },
  { label: 'Unlimited questions', desc: 'No daily limits or rate throttling.' },
  { label: 'Your data stays yours', desc: 'We collect nothing. Store nothing in the cloud.' },
];

export default function RegisterForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const pwStrength = password.length === 0 ? null
    : password.length < 6  ? { label: 'Weak',   color: 'var(--err)',  pct: 25 }
    : password.length < 10 ? { label: 'Fair',   color: 'var(--warn)', pct: 58 }
    :                        { label: 'Strong', color: 'var(--ok)',   pct: 100 };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true); setError('');
    const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim(), password, email: email || undefined }) });
    const d = await r.json();
    if (!r.ok) { setError(d.error || 'Registration failed. Please try again.'); setLoading(false); return; }
    const sr = await signIn('credentials', { username: username.trim(), password, redirect: false });
    setLoading(false);
    if (sr?.error) setError('Account created. Please sign in.');
    else { router.push('/'); router.refresh(); }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'Inter, sans-serif', position: 'relative', overflow: 'hidden' }}>
      <div className="mkt-bg" />
      <div className="mkt-grid" />

      {/* Nav */}
      <nav style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', borderBottom: '1px solid var(--bd)' }}>
        <ChakorWordmark size={26} />
        <Link href="/login" className="btn btn-outline" style={{ padding: '7px 16px', fontSize: '13px' }}>Sign in</Link>
      </nav>

      <div style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', minHeight: 'calc(100vh - 73px)' }}>
        <div style={{ display: 'flex', gap: 64, alignItems: 'center', maxWidth: 1100, width: '100%' }}>

          {/* Left: Marketing */}
          <div style={{ flex: 1, maxWidth: 480 }} className="anim-fade-up mkt-left">
            <div className="version-badge" style={{ marginBottom: 28 }}>
              <div className="status-dot" style={{ width: 7, height: 7 }} />
              Free · Unlimited · Private
            </div>

            <h1 style={{ fontSize: 'clamp(38px, 5.5vw, 66px)', fontWeight: 800, lineHeight: 1.06, letterSpacing: '-0.03em', color: 'var(--fg)', marginBottom: 8 }}>
              Quit the cloud.<br />
              <span className="text-shimmer">Run your own.</span>
            </h1>

            <p style={{ fontSize: 16, color: 'var(--fg-3)', lineHeight: 1.75, marginBottom: 36, maxWidth: 420 }}>
              Make an account on this server. Your chats stay here, on hardware you or someone you trust controls. Not in a big tech data center, and not training someone else's model.
            </p>

            <div>
              {PERKS.map(p => (
                <div key={p.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 0', borderTop: '1px solid var(--bd)' }}>
                  <div style={{ width: 20, height: 20, borderRadius: 5, border: '1px solid var(--g-bd)', background: 'var(--g-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="#22c55e" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 2 }}>{p.label}</div>
                    <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>{p.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Form */}
          <div style={{ width: '100%', maxWidth: 400 }} className="anim-fade-up">
            <div style={{ background: 'var(--bg-1)', border: '1px solid var(--bd-2)', borderRadius: 16, padding: 36, boxShadow: '0 32px 80px rgba(0,0,0,0.5)' }}>

              <div style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <ChakorMark size={22} className="chakor-mark" />
                  <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)', letterSpacing: '-0.015em' }}>Create account</h2>
                </div>
                <p style={{ fontSize: 13, color: 'var(--fg-3)' }}>Set up your private AI workspace in seconds</p>
              </div>

              <form onSubmit={handleSubmit}>
                {/* Username */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Username</label>
                  <input type="text" value={username}
                    onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                    className="inp" placeholder="your_username"
                    autoComplete="username" autoFocus required minLength={3} spellCheck={false}
                    style={{ borderColor: username.length >= 3 ? 'rgba(34,197,94,0.3)' : undefined }}
                  />
                  {username.length > 0 && (
                    <p style={{ fontSize: 12, marginTop: 5, color: username.length >= 3 ? 'var(--ok)' : 'var(--fg-4)' }}>
                      {username.length < 3 ? `${3 - username.length} more character${3 - username.length > 1 ? 's' : ''} needed` : `Username available`}
                    </p>
                  )}
                </div>

                {/* Email */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Email <span style={{ color: 'var(--fg-4)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="inp" placeholder="you@example.com" autoComplete="email" />
                </div>

                {/* Password */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                      className="inp" placeholder="at least 6 characters"
                      autoComplete="new-password" required minLength={6} style={{ paddingRight: 60 }}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 600, color: 'var(--fg-4)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.04em' }}>
                      {showPw ? 'HIDE' : 'SHOW'}
                    </button>
                  </div>
                  {pwStrength && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ height: 3, borderRadius: 2, background: 'var(--bg-3)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pwStrength.pct}%`, background: pwStrength.color, transition: 'width .3s, background .3s' }} />
                      </div>
                      <p style={{ fontSize: 11, marginTop: 4, fontWeight: 600, color: pwStrength.color, fontFamily: 'JetBrains Mono, monospace' }}>{pwStrength.label}</p>
                    </div>
                  )}
                </div>

                {/* Confirm */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Confirm Password</label>
                  <input type={showPw ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)}
                    className="inp" placeholder="repeat password"
                    autoComplete="new-password" required
                    style={{ borderColor: confirm.length > 0 ? confirm === password ? 'rgba(74,222,128,0.4)' : 'rgba(248,113,113,0.35)' : undefined }}
                  />
                  {confirm.length > 0 && (
                    <p style={{ fontSize: 12, marginTop: 5, color: confirm === password ? 'var(--ok)' : 'var(--err)' }}>
                      {confirm === password ? 'Passwords match' : 'Passwords do not match'}
                    </p>
                  )}
                </div>

                {error && (
                  <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--err)' }}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading || !username.trim() || !password || !confirm || username.length < 3}
                  className="btn btn-green" style={{ width: '100%' }}>
                  {loading ? <><Spinner /> Creating account…</> : 'Create account →'}
                </button>
              </form>

              <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 20, marginTop: 24, textAlign: 'center' }}>
                <Link href="/login" style={{ fontSize: 13, color: 'var(--fg-3)', textDecoration: 'none' }}>
                  Already have an account? <span style={{ color: 'var(--g-text)', fontWeight: 500 }}>Sign in →</span>
                </Link>
              </div>
            </div>

            <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--fg-4)', lineHeight: 1.6 }}>
              By creating an account you confirm that your data stays on this server.<br />We will never sell or share your information.
            </p>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
