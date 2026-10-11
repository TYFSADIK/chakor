'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChakorWordmark, ChakorMark } from './LoginForm';
import { APP } from '@/lib/config';

function Spinner() {
  return <div style={{ width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite', flexShrink: 0 }} />;
}

const PERKS = [
  { label: 'Free forever', desc: 'No subscription, no credit card, no paywalls.' },
  { label: 'Instant access', desc: 'Account is live the moment you create it.' },
  { label: 'Unlimited questions', desc: 'No daily limits or rate throttling.' },
  { label: 'Your data stays yours', desc: 'We collect nothing. Store nothing in the cloud.' },
];

export default function RegisterForm({ inviteRequired = false }: { inviteRequired?: boolean }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const pwStrength = password.length === 0 ? null
    : password.length < 8  ? { label: 'Weak',   color: 'var(--err)',  pct: 25 }
    : password.length < 12 ? { label: 'Fair',   color: 'var(--warn)', pct: 58 }
    :                        { label: 'Strong', color: 'var(--ok)',   pct: 100 };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim(), password, email: email || undefined, invite: invite || undefined }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setError(d?.error || 'Registration failed. Please try again.'); return; }
      const sr = await signIn('credentials', { username: username.trim(), password, redirect: false });
      if (sr?.error) setError('Account created. Please sign in.');
      else { router.push('/'); router.refresh(); }
    } catch {
      setError('Network error, please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>
      <div className="mkt-bg" />
      <div className="mkt-grid" />

      {/* Masthead */}
      <header style={{ position: 'relative', zIndex: 10, padding: '24px 32px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <ChakorWordmark size={26} />
          <Link href="/login" className="btn btn-outline" style={{ padding: '7px 16px', fontSize: '13px' }}>Sign in</Link>
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

      <div style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', minHeight: 'calc(100vh - 220px)' }}>
        <div style={{ display: 'flex', gap: 64, alignItems: 'center', maxWidth: 1100, width: '100%' }}>

          {/* Left: front page */}
          <div style={{ flex: 1, maxWidth: 480 }} className="anim-fade-up mkt-left">
            <div className="kicker" style={{ marginBottom: 10 }}>Special Offer · Circulation Desk</div>

            <h1 className="headline" style={{ fontSize: 'clamp(38px, 5.4vw, 60px)', marginBottom: 4 }}>
              Quit the cloud.<br />
              Run your own.
            </h1>
            <div className="byline" style={{ marginBottom: 14 }}>Dateline: this very server, right now</div>
            <hr className="rule-fat" style={{ marginBottom: 18 }} />

            <div className="col-2" style={{ fontSize: 14.5, color: 'var(--fg-2)', lineHeight: 1.7, marginBottom: 28 }}>
              <p className="dropcap" style={{ margin: 0 }}>
                Make an account on this server. Your chats stay here, on hardware you or someone you trust controls. Not in a big tech data center, and not training someone else&apos;s model.
              </p>
            </div>

            <div className="kicker" style={{ marginBottom: 4 }}>Terms of This Edition</div>
            <div>
              {PERKS.map(p => (
                <div key={p.label} className="feat-row">
                  <div className="feat-icon">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--g)' }}><polyline points="2,6 5,9 10,3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', marginBottom: 2 }}>{p.label}</div>
                    <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>{p.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: subscription desk */}
          <div style={{ width: '100%', maxWidth: 400 }} className="anim-fade-up">
            <div style={{ background: 'var(--bg-1)', border: '1px solid var(--bd-2)', borderRadius: 0, padding: 32, boxShadow: 'var(--sh-lg)' }}>

              <hr className="rule-fat" style={{ marginBottom: 14 }} />
              <div style={{ marginBottom: 24 }}>
                <div className="kicker" style={{ marginBottom: 8 }}>Subscription Desk</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ChakorMark size={22} className="chakor-mark" />
                  <h2 className="headline" style={{ fontSize: 26 }}>Create account</h2>
                </div>
                <p className="byline" style={{ marginTop: 6, textTransform: 'none', letterSpacing: '0.04em' }}>Set up your private AI workspace in seconds</p>
              </div>

              <form onSubmit={handleSubmit}>
                {/* Username */}
                <div style={{ marginBottom: 14 }}>
                  <label htmlFor="reg-username" className="kicker" style={{ display: 'block', marginBottom: 6 }}>Username</label>
                  <input id="reg-username" type="text" value={username}
                    onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                    className="inp" placeholder="your_username"
                    autoComplete="username" autoFocus required minLength={3} maxLength={32} spellCheck={false}
                    style={{ borderColor: username.length >= 3 ? 'var(--g-bd)' : undefined }}
                  />
                  {username.length > 0 && username.length < 3 && (
                    <p style={{ fontSize: 12, marginTop: 5, color: 'var(--fg-4)' }}>
                      {3 - username.length} more character{3 - username.length > 1 ? 's' : ''} needed
                    </p>
                  )}
                  {username.length === 0 && (
                    <p style={{ fontSize: 12, marginTop: 5, color: 'var(--fg-4)' }}>3–32 chars: a-z 0-9 _ -</p>
                  )}
                </div>

                {/* Email */}
                <div style={{ marginBottom: 14 }}>
                  <label htmlFor="reg-email" className="kicker" style={{ display: 'block', marginBottom: 6 }}>
                    Email <span style={{ color: 'var(--fg-4)', textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                  </label>
                  <input id="reg-email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="inp" placeholder="you@example.com" autoComplete="email" />
                </div>

                {/* Invite code (only when the server requires one) */}
                {inviteRequired && (
                  <div style={{ marginBottom: 14 }}>
                    <label htmlFor="reg-invite" className="kicker" style={{ display: 'block', marginBottom: 6 }}>Invite code</label>
                    <input id="reg-invite" type="text" value={invite} onChange={e => setInvite(e.target.value)} className="inp" placeholder="ask your admin" autoComplete="off" required={inviteRequired} />
                  </div>
                )}

                {/* Password */}
                <div style={{ marginBottom: 14 }}>
                  <label htmlFor="reg-password" className="kicker" style={{ display: 'block', marginBottom: 6 }}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input id="reg-password" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                      className="inp" placeholder="at least 8 characters"
                      autoComplete="new-password" required minLength={8} style={{ paddingRight: 60 }}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 600, color: 'var(--fg-4)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.04em', fontFamily: "'Special Elite', 'JetBrains Mono', monospace" }}>
                      {showPw ? 'HIDE' : 'SHOW'}
                    </button>
                  </div>
                  {pwStrength && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ height: 3, borderRadius: 0, background: 'var(--bg-3)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pwStrength.pct}%`, background: pwStrength.color, transition: 'width .3s, background .3s' }} />
                      </div>
                      <p className="byline" style={{ marginTop: 4, color: pwStrength.color }}>{pwStrength.label}</p>
                    </div>
                  )}
                </div>

                {/* Confirm */}
                <div style={{ marginBottom: 20 }}>
                  <label htmlFor="reg-confirm" className="kicker" style={{ display: 'block', marginBottom: 6 }}>Confirm Password</label>
                  <input id="reg-confirm" type={showPw ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)}
                    className="inp" placeholder="repeat password"
                    autoComplete="new-password" required
                    style={{ borderColor: confirm.length > 0 ? confirm === password ? 'var(--ok)' : 'var(--err)' : undefined }}
                  />
                  {confirm.length > 0 && (
                    <p style={{ fontSize: 12, marginTop: 5, color: confirm === password ? 'var(--ok)' : 'var(--err)' }}>
                      {confirm === password ? 'Passwords match' : 'Passwords do not match'}
                    </p>
                  )}
                </div>

                {error && (
                  <div style={{ background: 'var(--g-dim)', border: '1px solid var(--err)', borderRadius: 0, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--err)' }}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading || !username.trim() || !password || !confirm || username.length < 3 || (inviteRequired && !invite)}
                  className="btn btn-green" style={{ width: '100%' }}>
                  {loading ? <><Spinner /> Creating account…</> : 'Create account →'}
                </button>
              </form>

              <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 20, marginTop: 24, textAlign: 'center' }}>
                <Link href="/login" style={{ fontSize: 13, color: 'var(--fg-3)', textDecoration: 'none' }}>
                  Already have an account? <span style={{ color: 'var(--g-text)', fontWeight: 600 }}>Sign in →</span>
                </Link>
              </div>
            </div>

            <p className="byline" style={{ textAlign: 'center', marginTop: 16, textTransform: 'none', lineHeight: 1.7 }}>
              By creating an account you confirm that your data stays on this server.<br />We will never sell or share your information.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
