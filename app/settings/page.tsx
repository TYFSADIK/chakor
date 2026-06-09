'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChakorWordmark } from '@/components/LoginForm';
import { APP } from '@/lib/config';

type Tab = 'profile' | 'preferences' | 'appearance' | 'developer' | 'models';
type Model = { id: string; name: string; provider: string; contextWindow: number; badge?: string };
type ApiKey = { id: number; name: string; masked: string; created_at: number; last_used: number | null };
type Installed = { name: string; size: number; modified_at: string | null };
type LocalModel = { path: string; name: string; size: number; vision: boolean };
type LocalLive = { online: boolean; modelName: string | null; nCtx: number | null; vision?: boolean; modelPath?: string | null };
type LocalStatus = { live: LocalLive; available?: LocalModel[]; managed?: boolean; mode?: string; supervisor?: { running: boolean; lastError: string | null; restarts: number }; runtime?: { model?: string; ctx?: number }; isAdmin?: boolean };

const fmtSize = (b: number) => {
  if (!b) return '';
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(0)} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
};

const CTX_PRESETS = [2048, 4096, 8192, 16384, 32768];
const fmtCtx = (n: number) => (n >= 1024 ? `${Math.round(n / 1024)}K` : String(n));

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on}>
      <div className="toggle-knob" />
    </button>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '14px 0', borderBottom: '1px solid var(--bd)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg)', margin: 0 }}>{label}</p>
        {desc && <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3, lineHeight: 1.5, marginBottom: 0 }}>{desc}</p>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, fontFamily: 'JetBrains Mono, monospace' }}>
      {children}
    </p>
  );
}

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('profile');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [autoRead, setAutoRead] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable');

  // Developer: API keys
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copiedFresh, setCopiedFresh] = useState(false);

  // Models: Ollama management
  const [installed, setInstalled] = useState<Installed[]>([]);
  const [ollamaReachable, setOllamaReachable] = useState(true);
  const [pullName, setPullName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState('');
  const [pullPct, setPullPct] = useState<number | null>(null);

  // Models: local llama.cpp manager
  const [local, setLocal] = useState<LocalStatus | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchMsg, setSwitchMsg] = useState('');

  const isAdmin = !!(session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;

  useEffect(() => { if (status === 'unauthenticated') router.replace('/login'); }, [status, router]);

  useEffect(() => {
    if (!session) return;
    fetch('/api/user/keys').then(r => r.json()).then(d => { if (Array.isArray(d)) setKeys(d); }).catch(() => {});
  }, [session]);

  useEffect(() => {
    if (tab !== 'models') return;
    fetch('/api/models/installed').then(r => r.json()).then(d => {
      setInstalled(Array.isArray(d.models) ? d.models : []);
      setOllamaReachable(d.reachable !== false);
    }).catch(() => setOllamaReachable(false));
    loadLocal();
  }, [tab]);

  useEffect(() => {
    if (!session) return;
    setDisplayName(session?.user?.name ?? '');
    setAutoRead(localStorage.getItem('chakor-auto-read') === 'true');
    const tc = localStorage.getItem('chakor-show-token-count');
    setShowStats(tc === null ? true : tc === 'true');
    setFontSize((localStorage.getItem('chakor-font-size') as 'small' | 'medium' | 'large') || 'medium');
    setDensity((localStorage.getItem('chakor-density') as 'compact' | 'comfortable') || 'comfortable');
    setDefaultModel(localStorage.getItem('chakor-selected-model') ?? '');
    fetch('/api/models').then(r => r.json()).then((ms: Model[]) => { if (Array.isArray(ms)) setAvailableModels(ms); }).catch(() => {});
  }, [session]);

  useEffect(() => {
    const s = { small: '13px', medium: '15px', large: '17px' };
    document.documentElement.style.setProperty('--chat-font', s[fontSize]);
    localStorage.setItem('chakor-font-size', fontSize);
  }, [fontSize]);

  useEffect(() => { localStorage.setItem('chakor-density', density); }, [density]);

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--fg-3)', fontFamily: 'Inter, sans-serif', fontSize: 14 }}>
          <div style={{ width: 16, height: 16, border: '2px solid var(--bd-2)', borderTopColor: 'var(--g)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
          Loading…
        </div>
      </div>
    );
  }
  if (!session) return null;

  function notify(msg: string, ok = true) { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); }

  async function saveName() {
    if (!displayName.trim()) return;
    setSavingName(true);
    try {
      const r = await fetch('/api/user/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: displayName.trim() }) });
      const d = await r.json();
      r.ok ? notify('Display name updated') : notify(d.error, false);
    } catch { notify('Network error', false); }
    finally { setSavingName(false); }
  }

  async function changePw() {
    if (newPw !== confirmPw) { notify('Passwords do not match', false); return; }
    if (newPw.length < 8) { notify('Password must be at least 8 characters', false); return; }
    setSavingPw(true);
    try {
      const r = await fetch('/api/user/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }) });
      const d = await r.json();
      if (r.ok) { notify('Password changed'); setCurrentPw(''); setNewPw(''); setConfirmPw(''); }
      else notify(d.error, false);
    } catch { notify('Network error', false); }
    finally { setSavingPw(false); }
  }

  async function createKey() {
    setCreatingKey(true);
    try {
      const r = await fetch('/api/user/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newKeyName.trim() || 'API key' }) });
      const d = await r.json();
      if (r.ok) {
        setFreshKey(d.token);
        setCopiedFresh(false);
        setKeys(k => [{ id: d.id, name: d.name, masked: 'sk-chakor-…' + String(d.token).slice(-4), created_at: d.created_at, last_used: null }, ...k]);
        setNewKeyName('');
        notify('API key created');
      } else notify(d.error ?? 'Failed to create key', false);
    } catch { notify('Network error', false); }
    finally { setCreatingKey(false); }
  }

  async function deleteKey(id: number) {
    try {
      await fetch(`/api/user/keys/${id}`, { method: 'DELETE' });
      setKeys(k => k.filter(x => x.id !== id));
      notify('API key revoked');
    } catch { notify('Network error', false); }
  }

  async function deleteModel(name: string) {
    try {
      const r = await fetch('/api/models/installed', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (r.ok) { setInstalled(m => m.filter(x => x.name !== name)); notify('Model removed'); }
      else { const d = await r.json().catch(() => ({})); notify(d.error ?? 'Failed to remove model', false); }
    } catch { notify('Network error', false); }
  }

  async function pullModel() {
    const name = pullName.trim();
    if (!name || pulling) return;
    setPulling(true); setPullStatus('Starting…'); setPullPct(null);
    try {
      const r = await fetch('/api/models/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (!r.ok || !r.body) { const d = await r.json().catch(() => ({})); notify(d.error ?? 'Pull failed', false); return; }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let failed = false;
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') break outer;
          try {
            const p = JSON.parse(data) as { status?: string; total?: number; completed?: number; error?: string };
            if (p.error) { notify(p.error, false); failed = true; break outer; }
            if (p.status) setPullStatus(p.status);
            if (typeof p.total === 'number' && p.total > 0 && typeof p.completed === 'number') setPullPct(Math.round((p.completed / p.total) * 100));
            else setPullPct(null);
          } catch { /* skip partial frame */ }
        }
      }
      if (!failed) {
        notify(`${name} is ready`);
        setPullName('');
        const list = await (await fetch('/api/models/installed')).json().catch(() => ({ models: [] }));
        setInstalled(Array.isArray(list.models) ? list.models : []);
      }
    } catch { notify('Pull failed', false); }
    finally { setPulling(false); setPullStatus(''); setPullPct(null); }
  }

  async function loadLocal() {
    try {
      const r = await fetch('/api/models/local');
      if (r.ok) setLocal(await r.json());
    } catch { /* offline */ }
  }

  // Switch the local model and/or its context size. The server restarts, so we
  // poll until it's back up running what we asked for, showing progress meanwhile.
  async function switchLocal(opts: { model?: string; ctx?: number }) {
    if (switching) return;
    const targetName = opts.model
      ? (local?.available?.find(m => m.path === opts.model)?.name ?? 'model')
      : (local?.live.modelName ?? 'model');
    setSwitching(true);
    setSwitchMsg(`Loading ${targetName} into memory…`);
    try {
      const r = await fetch('/api/models/local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { notify(d.error ?? 'Switch failed', false); return; }
      if (!d.managed) { notify('Saved. Consolidate to one service to apply it.', false); await loadLocal(); return; }

      // Give the server a beat to go down, then poll /props until it's back.
      await new Promise(res => setTimeout(res, 1500));
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await new Promise(res => setTimeout(res, 2000));
        try {
          const sr = await fetch('/api/models/local');
          if (!sr.ok) continue;
          const s: LocalStatus = await sr.json();
          setLocal(s);
          const okModel = !opts.model || (s.live.modelPath ?? '') === opts.model;
          const okCtx = !opts.ctx || s.live.nCtx === opts.ctx;
          if (s.live.online && okModel && okCtx) { notify('Local model updated'); return; }
        } catch { /* still restarting */ }
      }
      notify('Server is taking a while to come back — check status above.', false);
    } catch { notify('Network error', false); }
    finally { setSwitching(false); setSwitchMsg(''); }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'developer', label: 'Developer' },
    ...(isAdmin ? [{ id: 'models' as Tab, label: 'Models' }] : []),
    { id: 'appearance', label: 'Appearance' },
  ];

  const initials = (session?.user?.name ?? session?.user?.email ?? 'U')[0].toUpperCase();
  const baseUrl = (typeof window !== 'undefined' ? window.location.origin : APP.url) + '/v1';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'Inter, sans-serif' }}>

      {/* Toast */}
      {toast && (
        <div className="toast" style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '11px 16px', borderRadius: 'var(--r-md)',
          background: 'var(--bg-2)', border: `1px solid ${toast.ok ? 'var(--g-bd)' : 'rgba(248,113,113,0.2)'}`,
          boxShadow: 'var(--sh)', fontSize: 13, color: 'var(--fg)', minWidth: 220,
          fontFamily: 'Inter, sans-serif',
        }}>
          <span style={{ color: toast.ok ? 'var(--ok)' : 'var(--err)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
            {toast.ok ? '✓' : '✕'}
          </span>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 56,
        borderBottom: '1px solid var(--bd)',
        background: 'rgba(9,9,11,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/" style={{ fontSize: 13, color: 'var(--fg-3)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, transition: 'color .15s' }}
            onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = 'var(--fg)')}
            onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = 'var(--fg-3)')}>
            ← Back
          </Link>
          <span style={{ width: 1, height: 14, background: 'var(--bd-2)' }} />
          <ChakorWordmark size={22} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-3)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.05em' }}>
          SETTINGS
        </span>
      </header>

      <div style={{ maxWidth: 660, margin: '0 auto', padding: '36px 24px' }}>

        {/* User card */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '18px 20px', marginBottom: 28,
          background: 'var(--bg-1)', border: '1px solid var(--bd)',
          borderRadius: 'var(--r-lg)',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'var(--g-dim)', border: '1px solid var(--g-bd)',
            color: 'var(--g-text)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 16, flexShrink: 0, fontFamily: 'JetBrains Mono, monospace',
          }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 600, fontSize: 15, color: 'var(--fg)', margin: 0 }}>{session?.user?.name ?? 'User'}</p>
            <p style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 3, margin: 0 }}>{session?.user?.email ?? 'No email set'}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 'var(--r-xl)', background: 'var(--g-dim)', border: '1px solid var(--g-bd)' }}>
            <div className="status-dot" style={{ width: 5, height: 5 }} />
            <span style={{ fontSize: 11, color: 'var(--g-text)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 500 }}>online</span>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 28, padding: 4, background: 'var(--bg-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--bd)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: '8px 12px', borderRadius: 'var(--r)',
              fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
              border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              transition: 'all .15s',
              background: tab === t.id ? 'var(--bg-3)' : 'transparent',
              color: tab === t.id ? 'var(--fg)' : 'var(--fg-3)',
              boxShadow: tab === t.id ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Profile tab */}
        {tab === 'profile' && (
          <div className="anim-fade-in">
            <div style={{ marginBottom: 28 }}>
              <SectionLabel>Display name</SectionLabel>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                  placeholder="Your display name" className="inp"
                  style={{ flex: 1 }}
                  onKeyDown={e => e.key === 'Enter' && saveName()} />
                <button onClick={saveName} disabled={savingName || !displayName.trim()}
                  className="btn btn-green" style={{ padding: '0 18px', fontSize: 13 }}>
                  {savingName ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <div>
              <SectionLabel>Change password</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ position: 'relative' }}>
                  <input type={showPw ? 'text' : 'password'} value={currentPw}
                    onChange={e => setCurrentPw(e.target.value)}
                    placeholder="Current password" className="inp"
                    style={{ paddingRight: 60 }} />
                  <button type="button" onClick={() => setShowPw(v => !v)} style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 11, fontWeight: 600, color: 'var(--fg-4)', background: 'none', border: 'none',
                    cursor: 'pointer', letterSpacing: '0.04em',
                  }}>{showPw ? 'HIDE' : 'SHOW'}</button>
                </div>
                <input type={showPw ? 'text' : 'password'} value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder="New password (min 8 characters)" className="inp" />
                <input type={showPw ? 'text' : 'password'} value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder="Confirm new password" className="inp"
                  style={{ borderColor: confirmPw.length > 0 ? (confirmPw === newPw ? 'rgba(74,222,128,0.4)' : 'rgba(248,113,113,0.4)') : undefined }}
                  onKeyDown={e => e.key === 'Enter' && changePw()} />
                {confirmPw.length > 0 && (
                  <p style={{ fontSize: 12, color: confirmPw === newPw ? 'var(--ok)' : 'var(--err)', margin: 0 }}>
                    {confirmPw === newPw ? 'Passwords match' : 'Passwords do not match'}
                  </p>
                )}
                <button onClick={changePw} disabled={savingPw || !currentPw || !newPw || !confirmPw}
                  className="btn btn-outline" style={{ width: 'fit-content', fontSize: 13, padding: '9px 18px' }}>
                  {savingPw ? 'Changing…' : 'Change password'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Preferences tab */}
        {tab === 'preferences' && (
          <div className="anim-fade-in">
            {availableModels.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel>Default model</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {availableModels.map(m => {
                    const active = defaultModel === m.id;
                    return (
                      <button key={m.id} onClick={() => { setDefaultModel(m.id); localStorage.setItem('chakor-selected-model', m.id); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                          borderRadius: 'var(--r-md)', textAlign: 'left',
                          border: `1px solid ${active ? 'var(--g-bd)' : 'var(--bd)'}`,
                          background: active ? 'var(--g-dim)' : 'var(--bg-1)',
                          cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all .15s',
                        }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: active ? 'var(--g)' : 'var(--fg-4)', flexShrink: 0, transition: 'background .15s' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', margin: 0 }}>{m.name}</p>
                          <p style={{ fontSize: 11, color: 'var(--fg-3)', margin: 0, marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
                            {m.provider} · {(m.contextWindow / 1000).toFixed(0)}K ctx
                          </p>
                        </div>
                        {active && <span style={{ fontSize: 11, color: 'var(--g-text)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>ACTIVE</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <SectionLabel>Chat</SectionLabel>
            <div style={{ border: '1px solid var(--bd)', borderRadius: 'var(--r-md)', padding: '0 16px', background: 'var(--bg-1)' }}>
              <Row label="Auto-read responses" desc="Speak each AI response with text-to-speech when complete">
                <Toggle on={autoRead} onChange={v => { setAutoRead(v); localStorage.setItem('chakor-auto-read', String(v)); }} />
              </Row>
              <Row label="Show token counts" desc="Display generation speed and token usage below messages">
                <Toggle on={showStats} onChange={v => { setShowStats(v); localStorage.setItem('chakor-show-token-count', String(v)); }} />
              </Row>
            </div>
          </div>
        )}

        {/* Developer tab */}
        {tab === 'developer' && (
          <div className="anim-fade-in">
            <SectionLabel>OpenAI-compatible API</SectionLabel>
            <p style={{ fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.6, margin: '0 0 16px' }}>
              Use {APP.name} as a drop-in OpenAI backend. Point any OpenAI client at the base URL below with one of your keys, and it talks to whatever model you name, local or cloud.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-1)', border: '1px solid var(--bd)', borderRadius: 'var(--r-md)', marginBottom: 24 }}>
              <span style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0, letterSpacing: '0.06em' }}>BASE URL</span>
              <code style={{ flex: 1, fontSize: 13, color: 'var(--fg)', fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{baseUrl}</code>
              <button onClick={() => navigator.clipboard.writeText(baseUrl).then(() => notify('Base URL copied')).catch(() => {})} className="btn-ghost-sm" style={{ fontSize: 12, padding: '4px 8px', flexShrink: 0 }}>Copy</button>
            </div>

            <SectionLabel>Create a key</SectionLabel>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="Key name (e.g. my-laptop)" className="inp" style={{ flex: 1 }} onKeyDown={e => e.key === 'Enter' && createKey()} />
              <button onClick={createKey} disabled={creatingKey} className="btn btn-green" style={{ padding: '0 18px', fontSize: 13 }}>{creatingKey ? 'Creating…' : 'Create'}</button>
            </div>

            {freshKey && (
              <div style={{ padding: '14px 16px', marginBottom: 18, background: 'var(--g-dim)', border: '1px solid var(--g-bd)', borderRadius: 'var(--r-md)' }}>
                <p style={{ fontSize: 12, color: 'var(--g-text)', fontWeight: 600, margin: '0 0 8px' }}>Copy this key now. You will not be able to see it again.</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, fontSize: 12.5, color: 'var(--fg)', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>{freshKey}</code>
                  <button onClick={() => navigator.clipboard.writeText(freshKey).then(() => setCopiedFresh(true)).catch(() => {})} className="btn btn-outline" style={{ fontSize: 12, padding: '6px 12px', flexShrink: 0 }}>{copiedFresh ? 'Copied' : 'Copy'}</button>
                  <button onClick={() => setFreshKey(null)} className="btn-ghost-sm" style={{ padding: '6px 8px', flexShrink: 0 }}>Done</button>
                </div>
              </div>
            )}

            {keys.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <SectionLabel>Your keys</SectionLabel>
                <div style={{ border: '1px solid var(--bd)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                  {keys.map(k => (
                    <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--bd)', background: 'var(--bg-1)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', margin: 0 }}>{k.name}</p>
                        <p style={{ fontSize: 11, color: 'var(--fg-4)', margin: '2px 0 0', fontFamily: 'JetBrains Mono, monospace' }}>
                          {k.masked} · {k.last_used ? `used ${new Date(k.last_used * 1000).toLocaleDateString()}` : 'never used'}
                        </p>
                      </div>
                      <button onClick={() => deleteKey(k.id)} className="btn-ghost-sm" style={{ fontSize: 12, padding: '5px 10px', color: 'var(--err)', flexShrink: 0 }}>Revoke</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <SectionLabel>Example</SectionLabel>
            <pre style={{ fontSize: 12, color: 'var(--fg-2)', background: 'var(--bg-1)', border: '1px solid var(--bd)', borderRadius: 'var(--r-md)', padding: '14px 16px', overflowX: 'auto', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6, margin: 0 }}>
{`curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'`}
            </pre>
          </div>
        )}

        {/* Models tab (admin) */}
        {tab === 'models' && (
          <div className="anim-fade-in">
            {/* Local model (llama.cpp) — switch the running model + context size */}
            <SectionLabel>Local model</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--bg-1)', border: '1px solid var(--bd)', borderRadius: 'var(--r-md)', marginBottom: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: local?.live.online ? 'var(--g)' : 'var(--err)', boxShadow: local?.live.online ? '0 0 6px rgba(34,197,94,.5)' : 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {local ? (local.live.online ? (local.live.modelName ?? 'Running') : 'Offline') : 'Checking…'}
                </p>
                <p style={{ fontSize: 11, color: 'var(--fg-4)', margin: '2px 0 0', fontFamily: 'JetBrains Mono, monospace' }}>
                  llama.cpp{local?.live.nCtx ? ` · ${fmtCtx(local.live.nCtx)} context` : ''}{local?.live.vision ? ' · vision' : ''}
                </p>
              </div>
              {switching && <div style={{ width: 14, height: 14, border: '2px solid var(--g)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />}
            </div>

            {local && local.mode === 'external' && (
              <div style={{ padding: '12px 14px', background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.2)', borderRadius: 'var(--r-md)', marginBottom: 14 }}>
                <p style={{ fontSize: 12.5, color: 'var(--fg-2)', margin: '0 0 8px', lineHeight: 1.55 }}>The model is running as a separate service, so Chakor can&apos;t switch it live yet. Fold it into one service (run once, then it just works):</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, fontSize: 12, color: 'var(--g-text)', fontFamily: 'JetBrains Mono, monospace', background: 'var(--bg-2)', padding: '8px 10px', borderRadius: 6, overflowX: 'auto', whiteSpace: 'nowrap' }}>sudo bash scripts/use-single-service.sh</code>
                  <button onClick={() => navigator.clipboard.writeText('sudo bash scripts/use-single-service.sh').then(() => notify('Command copied')).catch(() => {})} className="btn-ghost-sm" style={{ fontSize: 12, flexShrink: 0 }}>Copy</button>
                </div>
              </div>
            )}
            {local && local.mode === 'off' && (
              <div style={{ padding: '12px 14px', background: 'var(--bg-1)', border: '1px solid var(--bd)', borderRadius: 'var(--r-md)', marginBottom: 14 }}>
                <p style={{ fontSize: 12.5, color: 'var(--fg-3)', margin: 0, lineHeight: 1.55 }}>Local model supervision is off (<code style={{ fontFamily: 'JetBrains Mono, monospace' }}>CHAKOR_SUPERVISE_LLAMA=false</code>). Chakor is using an external server, Ollama, or cloud models.</p>
              </div>
            )}
            {local && local.mode === 'down' && local.supervisor?.lastError && (
              <div style={{ padding: '12px 14px', background: 'rgba(248,113,113,.07)', border: '1px solid rgba(248,113,113,.2)', borderRadius: 'var(--r-md)', marginBottom: 14 }}>
                <p style={{ fontSize: 12.5, color: 'var(--fg-2)', margin: 0, lineHeight: 1.55 }}>Local model isn&apos;t running: <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--err)' }}>{local.supervisor.lastError}</span></p>
              </div>
            )}

            <p style={{ fontSize: 12.5, color: 'var(--fg-3)', margin: '0 0 8px', lineHeight: 1.5 }}>Context length — how much the model remembers at once. Bigger uses more memory (VRAM) and runs a little slower.</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 22 }}>
              {CTX_PRESETS.map(c => {
                const active = local?.live.nCtx === c;
                return (
                  <button key={c} disabled={switching || !local} onClick={() => switchLocal({ ctx: c })}
                    style={{ padding: '8px 16px', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'JetBrains Mono, monospace', cursor: switching ? 'default' : 'pointer', border: `1px solid ${active ? 'var(--g-bd)' : 'var(--bd)'}`, background: active ? 'var(--g-dim)' : 'var(--bg-1)', color: active ? 'var(--g-text)' : 'var(--fg-2)', opacity: switching ? 0.5 : 1, transition: 'all .15s' }}>
                    {fmtCtx(c)}
                  </button>
                );
              })}
            </div>

            <p style={{ fontSize: 12.5, color: 'var(--fg-3)', margin: '0 0 8px', lineHeight: 1.5 }}>Installed model files — click <strong style={{ color: 'var(--fg-2)' }}>Use</strong> to switch the running model.</p>
            {!local?.available || local.available.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--fg-4)', padding: '8px 0' }}>No .gguf files found. Put models in <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>~/Downloads</code> or set <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>CHAKOR_MODELS_DIR</code>.</p>
            ) : (
              <div style={{ border: '1px solid var(--bd)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                {local.available.map(m => {
                  const current = (local.live.modelPath ?? '') === m.path || local.live.modelName === m.name;
                  return (
                    <div key={m.path} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--bd)', background: current ? 'var(--g-dim)' : 'var(--bg-1)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.name}
                          {m.vision && <span style={{ marginLeft: 8, fontSize: 9, padding: '1px 6px', borderRadius: 20, background: 'var(--bg-3)', color: 'var(--fg-3)', fontFamily: 'JetBrains Mono, monospace', verticalAlign: 'middle' }}>VISION</span>}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--fg-4)', margin: '2px 0 0', fontFamily: 'JetBrains Mono, monospace' }}>{fmtSize(m.size)}</p>
                      </div>
                      {current
                        ? <span style={{ fontSize: 11, color: 'var(--g-text)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, flexShrink: 0 }}>RUNNING</span>
                        : <button disabled={switching} onClick={() => switchLocal({ model: m.path })} className="btn btn-outline" style={{ fontSize: 12, padding: '6px 14px', flexShrink: 0, opacity: switching ? 0.5 : 1 }}>Use</button>}
                    </div>
                  );
                })}
              </div>
            )}
            {switching && (
              <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 12, height: 12, border: '2px solid var(--g)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite', display: 'inline-block' }} />
                {switchMsg || 'Working…'} <span style={{ color: 'var(--fg-4)' }}>this can take a moment on first load</span>
              </p>
            )}

            <div style={{ height: 1, background: 'var(--bd)', margin: '30px 0' }} />

            <SectionLabel>Pull a model</SectionLabel>
            <p style={{ fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.6, margin: '0 0 14px' }}>
              Download a model from the Ollama library onto this server. Browse names at{' '}
              <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--g-text)' }}>ollama.com/library</a>.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={pullName} onChange={e => setPullName(e.target.value)} placeholder="e.g. llama3.2 or qwen2.5:7b" className="inp" style={{ flex: 1 }} disabled={pulling} onKeyDown={e => e.key === 'Enter' && pullModel()} />
              <button onClick={pullModel} disabled={pulling || !pullName.trim()} className="btn btn-green" style={{ padding: '0 18px', fontSize: 13 }}>{pulling ? 'Pulling…' : 'Pull'}</button>
            </div>

            {pulling && (
              <div style={{ marginTop: 14, padding: '12px 16px', background: 'var(--bg-1)', border: '1px solid var(--bd)', borderRadius: 'var(--r-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--fg-3)', marginBottom: pullPct !== null ? 8 : 0, fontFamily: 'JetBrains Mono, monospace' }}>
                  <span>{pullStatus || 'Working…'}</span>
                  {pullPct !== null && <span>{pullPct}%</span>}
                </div>
                {pullPct !== null && (
                  <div style={{ height: 5, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pullPct}%`, background: 'var(--g)', transition: 'width .3s' }} />
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 28 }}>
              <SectionLabel>Installed</SectionLabel>
              {!ollamaReachable ? (
                <p style={{ fontSize: 13, color: 'var(--fg-4)', padding: '14px 0' }}>Ollama is not reachable. Start it, or set <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>OLLAMA_BASE_URL</code>.</p>
              ) : installed.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--fg-4)', padding: '14px 0' }}>No models installed yet. Pull one above.</p>
              ) : (
                <div style={{ border: '1px solid var(--bd)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                  {installed.map(m => (
                    <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--bd)', background: 'var(--bg-1)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', margin: 0 }}>{m.name}</p>
                        <p style={{ fontSize: 11, color: 'var(--fg-4)', margin: '2px 0 0', fontFamily: 'JetBrains Mono, monospace' }}>{fmtSize(m.size)}</p>
                      </div>
                      <button onClick={() => deleteModel(m.name)} className="btn-ghost-sm" style={{ fontSize: 12, padding: '5px 10px', color: 'var(--err)', flexShrink: 0 }}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Appearance tab */}
        {tab === 'appearance' && (
          <div className="anim-fade-in">
            <div style={{ marginBottom: 28 }}>
              <SectionLabel>Text size</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {(['small', 'medium', 'large'] as const).map(s => (
                  <button key={s} onClick={() => setFontSize(s)} style={{
                    padding: '16px 8px', borderRadius: 'var(--r-md)', cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif', textAlign: 'center', transition: 'all .15s',
                    border: `1px solid ${fontSize === s ? 'var(--g-bd)' : 'var(--bd)'}`,
                    background: fontSize === s ? 'var(--g-dim)' : 'var(--bg-1)',
                  }}>
                    <div style={{ fontSize: s === 'small' ? 14 : s === 'large' ? 20 : 17, color: fontSize === s ? 'var(--fg)' : 'var(--fg-3)', marginBottom: 6, fontWeight: 400 }}>Aa</div>
                    <div style={{ fontSize: 11, color: fontSize === s ? 'var(--g-text)' : 'var(--fg-4)', fontWeight: fontSize === s ? 600 : 400, textTransform: 'capitalize', fontFamily: 'JetBrains Mono, monospace' }}>{s}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 28 }}>
              <SectionLabel>Message density</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {([['compact', 'Dense layout, more on screen'], ['comfortable', 'Spacious, easier to read']] as const).map(([val, desc]) => (
                  <button key={val} onClick={() => setDensity(val)} style={{
                    padding: 14, borderRadius: 'var(--r-md)', cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif', textAlign: 'left', transition: 'all .15s',
                    border: `1px solid ${density === val ? 'var(--g-bd)' : 'var(--bd)'}`,
                    background: density === val ? 'var(--g-dim)' : 'var(--bg-1)',
                  }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: density === val ? 'var(--fg)' : 'var(--fg-3)', marginBottom: 4, textTransform: 'capitalize', margin: 0 }}>{val}</p>
                    <p style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 4, margin: 0 }}>{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding: '16px 20px', background: 'var(--bg-1)', border: '1px solid var(--bd)', borderRadius: 'var(--r-md)' }}>
              <SectionLabel>About</SectionLabel>
              {[['Version', '2.1.0'], ['Stack', 'Next.js · SQLite · llama.cpp'], ['Privacy', 'Self-hosted · no telemetry'], ['Inference', 'Local by default · optional API keys']].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono, monospace' }}>{k}</span>
                  <span style={{ fontSize: 12, color: k === 'Privacy' || k === 'Inference' ? 'var(--ok)' : 'var(--fg-2)', fontFamily: 'JetBrains Mono, monospace', fontWeight: k === 'Privacy' || k === 'Inference' ? 600 : 400 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
