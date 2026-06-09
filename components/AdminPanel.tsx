'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ChakorWordmark } from './LoginForm';

type Stats = { users: number; conversations: number; messages: number; documents: number; dbBytes: number; topUsers: { username: string; is_admin: number; conv_count: number; msg_count: number }[]; dailyStats?: { day: string; count: number }[] };
type SystemStatus = { llamaOnline: boolean; llamaUrl: string; modelName: string; gpuStats: { utilization: number; memUsed: number; memTotal: number }[] | null };
type User = { id: number; username: string; email: string | null; created_at: number; is_admin: number; conv_count: number; msg_count: number; last_active: number | null };
type Conv = { id: string; title: string; created_at: number; updated_at: number; msg_count: number };
type Message = { id: number; role: 'user' | 'assistant' | 'system'; content: string; created_at: number };

const rel = (ts: number) => { const d=Math.floor(Date.now()/1000)-ts; if(d<60)return'just now'; if(d<3600)return`${Math.floor(d/60)}m ago`; if(d<86400)return`${Math.floor(d/3600)}h ago`; if(d<86400*7)return`${Math.floor(d/86400)}d ago`; return new Date(ts*1000).toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
const fmtBytes = (b: number) => { if(b<1024)return`${b} B`; if(b<1024*1024)return`${(b/1024).toFixed(1)} KB`; return`${(b/1024/1024).toFixed(2)} MB`; };
const isOnline = (t: number|null) => t!=null && Date.now()/1000-t < 300;

function Ico(p: {children: React.ReactNode; onClick?: ()=>void; title?: string}) {
  return <button onClick={p.onClick} title={p.title} style={{background:'none',border:'none',cursor:'pointer',color:'var(--fg-3)',padding:'5px 6px',borderRadius:6,display:'inline-flex',alignItems:'center',gap:5,fontSize:12,fontFamily:'Inter,sans-serif',transition:'background .1s, color .1s'}}
    onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='var(--bg-3)';(e.currentTarget as HTMLElement).style.color='var(--fg-2)';}}
    onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='none';(e.currentTarget as HTMLElement).style.color='var(--fg-3)';}}>
    {p.children}
  </button>;
}

function StatCard({ label, value, accent }: { label: string; value: string|number; accent: string }) {
  return (
    <div style={{background:'var(--bg-1)',border:'1px solid var(--bd)',borderRadius:10,padding:'18px 20px',position:'relative',overflow:'hidden',transition:'border-color .15s'}}
      onMouseEnter={e=>(e.currentTarget as HTMLElement).style.borderColor='var(--bd-2)'}
      onMouseLeave={e=>(e.currentTarget as HTMLElement).style.borderColor='var(--bd)'}>
      <div style={{position:'absolute',top:-20,right:-20,width:80,height:80,borderRadius:'50%',background:accent,opacity:.08,filter:'blur(20px)'}}/>
      <div style={{fontSize:10,fontWeight:700,color:'var(--fg-4)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8,fontFamily:'JetBrains Mono,monospace'}}>{label}</div>
      <div style={{fontSize:28,fontWeight:800,color:accent,letterSpacing:'-0.025em',fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>{typeof value==='number'?value.toLocaleString():value}</div>
    </div>
  );
}

function ActivityChart({ data }: { data: {day:string;count:number}[] }) {
  const max = Math.max(...data.map(d=>d.count), 1);
  const H=72; const bW=28; const gap=8; const W=data.length*(bW+gap)-gap; const total=data.reduce((a,b)=>a+b.count,0);
  const pts = data.map((d,i)=>`${i*(bW+gap)+bW/2},${H-Math.max(3,Math.round(d.count/max*H))+16}`).join(' ');
  const [fx] = pts.split(' ')[0].split(','); const lx = pts.split(' ').at(-1)?.split(',')[0]??'0';
  return (
    <div style={{background:'var(--bg-1)',border:'1px solid var(--bd)',borderRadius:10,padding:'18px 20px'}}>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:16}}>
        <div><p style={{fontSize:13,fontWeight:600,color:'var(--fg)',marginBottom:2}}>Message Activity</p><p style={{fontSize:11,color:'var(--fg-3)',fontFamily:'JetBrains Mono,monospace'}}>last 7 days</p></div>
        <div style={{textAlign:'right'}}><p style={{fontSize:24,fontWeight:800,color:'var(--g)',fontFamily:'JetBrains Mono,monospace',letterSpacing:'-0.03em'}}>{total}</p><p style={{fontSize:10,color:'var(--fg-4)',textTransform:'uppercase',letterSpacing:'0.06em'}}>total msgs</p></div>
      </div>
      <div style={{overflowX:'auto',scrollbarWidth:'none'}}>
        <svg viewBox={`0 0 ${W} ${H+34}`} style={{width:'100%',minWidth:W}}>
          <defs>
            <linearGradient id="barG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--g)" stopOpacity=".7"/><stop offset="100%" stopColor="var(--g)" stopOpacity=".15"/></linearGradient>
            <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--g)" stopOpacity=".1"/><stop offset="100%" stopColor="var(--g)" stopOpacity="0"/></linearGradient>
          </defs>
          {[0,25,50,75,100].map(p=><line key={p} x1={0} y1={H-Math.round(p/100*H)+16} x2={W} y2={H-Math.round(p/100*H)+16} stroke="rgba(255,255,255,.04)" strokeWidth="1"/>)}
          {data.length>1&&<polygon points={`${fx},${H+16} ${pts} ${lx},${H+16}`} fill="url(#areaG)"/>}
          {data.length>1&&<polyline points={pts} fill="none" stroke="rgba(34,197,94,.5)" strokeWidth="1.5" strokeLinejoin="round"/>}
          {data.map((d,i)=>{const bH=Math.max(4,Math.round(d.count/max*H));const x=i*(bW+gap);const y=H-bH+16;return(
            <g key={d.day}>
              <rect x={x} y={y} width={bW} height={bH} rx="4" fill="url(#barG)"/>
              <text x={x+bW/2} y={H+30} textAnchor="middle" fill="var(--fg-4)" style={{fontSize:9,fontFamily:'JetBrains Mono,monospace'}}>{d.day.slice(5)}</text>
              {d.count>0&&<text x={x+bW/2} y={y-4} textAnchor="middle" fill="var(--g)" style={{fontSize:9,fontFamily:'JetBrains Mono,monospace'}}>{d.count}</text>}
            </g>
          );})}
        </svg>
      </div>
    </div>
  );
}

function GpuRing({ value, color, label }: { value: number; color: string; label: string }) {
  const s=64; const r=(s-8)/2; const c=2*Math.PI*r; const pct=Math.min(100,Math.max(0,value));
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:5}}>
      <div style={{position:'relative',width:s,height:s}}>
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
          <circle cx={s/2} cy={s/2} r={r} fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="7"/>
          <circle cx={s/2} cy={s/2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c-(pct/100)*c} transform={`rotate(-90 ${s/2} ${s/2})`}
            style={{transition:'stroke-dashoffset .8s ease',filter:`drop-shadow(0 0 4px ${color}60)`}}/>
        </svg>
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color,fontFamily:'JetBrains Mono,monospace'}}>{pct}%</div>
      </div>
      <span style={{fontSize:10,color:'var(--fg-4)',fontFamily:'JetBrains Mono,monospace',textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}</span>
    </div>
  );
}

export default function AdminPanel({ selfId }: { selfId: number }) {
  const [tab, setTab] = useState<'dashboard'|'users'|'chats'>('dashboard');
  const [stats, setStats] = useState<Stats|null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{user:User}|null>(null);
  const [resetModal, setResetModal] = useState<{user:User;tempPassword?:string}|null>(null);
  const [system, setSystem] = useState<SystemStatus|null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [sortCol, setSortCol] = useState<'username'|'conv_count'|'msg_count'|'last_active'>('msg_count');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [copiedPw, setCopiedPw] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User|null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conv|null>(null);
  const [chatMsgs, setChatMsgs] = useState<Message[]>([]);
  const [loadingConv, setLoadingConv] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date|null>(null);
  const timer = useRef<ReturnType<typeof setInterval>|null>(null);

  const loadStats = useCallback(async()=>{ setLoading(true); setError(''); try{const r=await fetch('/api/admin/stats');if(!r.ok)throw new Error(await r.text());setStats(await r.json());setLastRefresh(new Date());}catch(e){setError(String(e));}finally{setLoading(false);}}, []);
  const loadUsers = useCallback(async()=>{ setLoading(true); setError(''); try{const r=await fetch('/api/admin/users');if(!r.ok)throw new Error(await r.text());setUsers(await r.json());setLastRefresh(new Date());}catch(e){setError(String(e));}finally{setLoading(false);}}, []);
  const loadSystem = useCallback(async()=>{ try{const r=await fetch('/api/admin/system');if(r.ok)setSystem(await r.json());}catch{} }, []);

  useEffect(()=>{ if(tab==='dashboard'){loadStats();loadSystem();}else loadUsers(); },[tab,loadStats,loadUsers,loadSystem]);
  useEffect(()=>{ if(timer.current) clearInterval(timer.current); timer.current=setInterval(()=>{if(tab==='dashboard'){loadStats();loadSystem();}},30000); return()=>{if(timer.current)clearInterval(timer.current);}; },[tab,loadStats,loadSystem]);

  async function selectUser(u: User) { setSelectedUser(u);setSelectedConv(null);setChatMsgs([]);setLoadingConv(true); try{const r=await fetch(`/api/admin/users/${u.id}/conversations`);if(r.ok)setConvs(await r.json());}finally{setLoadingConv(false);} }
  async function selectConv(c: Conv) { setSelectedConv(c);setLoadingMsgs(true); try{const r=await fetch(`/api/admin/conversations/${c.id}/messages`);if(r.ok)setChatMsgs(await r.json());}finally{setLoadingMsgs(false);} }
  async function deleteUser(u: User) { const r=await fetch(`/api/admin/users/${u.id}`,{method:'DELETE'}); const d=await r.json(); if(!r.ok){setError(d.error);return;} setUsers(p=>p.filter(x=>x.id!==u.id));setConfirm(null); if(selectedUser?.id===u.id){setSelectedUser(null);setConvs([]);setSelectedConv(null);setChatMsgs([]);} }
  async function resetPw(u: User) { const r=await fetch(`/api/admin/users/${u.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reset_password'})}); const d=await r.json(); if(!r.ok){setError(d.error);return;} setResetModal({user:u,tempPassword:d.tempPassword}); }
  async function toggleAdmin(u: User) { const val=u.is_admin===1?0:1; const r=await fetch(`/api/admin/users/${u.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_admin:val})}); const d=await r.json(); if(!r.ok){setError(d.error);return;} setUsers(p=>p.map(x=>x.id===u.id?{...x,is_admin:val}:x)); }
  function handleSort(col: typeof sortCol) { if(sortCol===col)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortCol(col);setSortDir('desc');} }

  const filteredUsers = users
    .filter(u=>!userSearch||u.username.toLowerCase().includes(userSearch.toLowerCase())||(u.email??'').toLowerCase().includes(userSearch.toLowerCase()))
    .sort((a,b)=>{const av=sortCol==='last_active'?a.last_active??0:a[sortCol] as number; const bv=sortCol==='last_active'?b.last_active??0:b[sortCol] as number; return sortDir==='asc'?(av as number)-(bv as number):(bv as number)-(av as number);});

  const onlineCount = users.filter(u=>isOnline(u.last_active)).length;

  const cell: React.CSSProperties = {padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,.04)', color:'var(--fg-2)', fontSize:13};
  const thead: React.CSSProperties = {padding:'9px 14px', borderBottom:'1px solid var(--bd-2)', color:'var(--fg-4)', fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', fontFamily:'JetBrains Mono,monospace'};

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',color:'var(--fg)',fontFamily:'Inter,sans-serif'}}>
      {/* Header */}
      <header style={{position:'sticky',top:0,zIndex:10,display:'flex',alignItems:'center',gap:14,padding:'0 24px',height:54,borderBottom:'1px solid var(--bd)',background:'var(--bg)'}}>
        <ChakorWordmark size={24}/>
        <div style={{width:1,height:18,background:'var(--bd-2)'}}/>
        <span style={{fontSize:11,fontWeight:600,color:'var(--fg-4)',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:'JetBrains Mono,monospace'}}>Admin Console</span>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:16}}>
          {lastRefresh&&<span style={{fontSize:11,color:'var(--fg-4)',fontFamily:'JetBrains Mono,monospace'}}>Updated {lastRefresh.toLocaleTimeString()}</span>}
          {onlineCount>0&&(
            <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12,fontWeight:500,color:'var(--g)',fontFamily:'JetBrains Mono,monospace'}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:'var(--g)',boxShadow:'0 0 6px rgba(34,197,94,.6)',animation:'pulse 2s infinite'}}/>
              {onlineCount} online
            </div>
          )}
          <Link href="/" style={{fontSize:13,color:'var(--fg-3)',textDecoration:'none',transition:'color .15s'}}
            onMouseEnter={e=>((e.target as HTMLAnchorElement).style.color='var(--fg-2)')}
            onMouseLeave={e=>((e.target as HTMLAnchorElement).style.color='var(--fg-3)')}>
            ← Chat
          </Link>
        </div>
      </header>

      <div style={{maxWidth:1100,margin:'0 auto',padding:'24px 20px'}}>
        {/* Tabs */}
        <div style={{display:'flex',gap:4,marginBottom:24,padding:4,background:'var(--bg-1)',borderRadius:10,border:'1px solid var(--bd)',width:'fit-content'}}>
          {(['dashboard','users','chats'] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{padding:'7px 18px',borderRadius:7,fontSize:13,fontWeight:500,border:'none',cursor:'pointer',fontFamily:'Inter,sans-serif',transition:'all .15s',background:tab===t?'var(--bg-3)':'transparent',color:tab===t?'var(--fg)':'var(--fg-3)'}}>
              {t.charAt(0).toUpperCase()+t.slice(1)}
              {t==='users'&&users.length>0&&<span style={{marginLeft:6,fontSize:10,padding:'1px 6px',borderRadius:20,background:'var(--bg-4)',color:'var(--fg-3)',fontFamily:'JetBrains Mono,monospace'}}>{users.length}</span>}
            </button>
          ))}
          <div style={{marginLeft:8,display:'flex',alignItems:'center'}}>
            <button onClick={()=>{if(tab==='dashboard'){loadStats();loadSystem();}else loadUsers();}}
              style={{background:'none',border:'none',cursor:'pointer',color:'var(--fg-3)',fontSize:13,fontFamily:'Inter,sans-serif',display:'flex',alignItems:'center',gap:5,padding:'5px 8px',borderRadius:6,transition:'background .1s,color .1s'}}
              onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='var(--bg-3)';(e.currentTarget as HTMLElement).style.color='var(--fg-2)';}}
              onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='none';(e.currentTarget as HTMLElement).style.color='var(--fg-3)';}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Refresh
            </button>
          </div>
        </div>

        {error&&<div style={{background:'rgba(248,113,113,.08)',border:'1px solid rgba(248,113,113,.2)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13,color:'var(--err)',display:'flex',alignItems:'center',gap:10}}>{error}<button onClick={()=>setError('')} style={{marginLeft:'auto',background:'none',border:'none',color:'var(--fg-3)',cursor:'pointer',fontSize:11}}>dismiss</button></div>}
        {loading&&!stats&&!users.length&&<div style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:'var(--fg-3)',padding:'16px 0'}}><div style={{width:13,height:13,border:'2px solid var(--g)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>Loading…</div>}

        {/* Dashboard */}
        {tab==='dashboard'&&stats&&(
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12}}>
              <StatCard label="Total Users" value={stats.users} accent="var(--g)"/>
              <StatCard label="Conversations" value={stats.conversations} accent="#60a5fa"/>
              <StatCard label="Total Messages" value={stats.messages} accent="#fbbf24"/>
              <StatCard label="Database Size" value={fmtBytes(stats.dbBytes)} accent="#a78bfa"/>
            </div>

            <div style={{background:'var(--bg-1)',border:'1px solid var(--bd)',borderRadius:10,padding:'18px 20px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                <p style={{fontSize:13,fontWeight:600,color:'var(--fg)'}}>System Status</p>
                {system&&<span style={{fontSize:11,fontWeight:600,padding:'4px 10px',borderRadius:20,background:system.llamaOnline?'rgba(34,197,94,.1)':'rgba(248,113,113,.1)',color:system.llamaOnline?'var(--ok)':'var(--err)',border:`1px solid ${system.llamaOnline?'rgba(34,197,94,.2)':'rgba(248,113,113,.2)'}`,fontFamily:'JetBrains Mono,monospace'}}>{system.llamaOnline?'Operational':'Degraded'}</span>}
              </div>
              {system?(
                <div style={{display:'flex',flexDirection:'column',gap:12}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <div style={{width:8,height:8,borderRadius:'50%',background:system.llamaOnline?'var(--g)':'var(--err)',boxShadow:system.llamaOnline?'0 0 6px rgba(34,197,94,.6)':'none',animation:system.llamaOnline?'pulse 2s infinite':'none'}}/>
                    <span style={{fontSize:13,color:'var(--fg)'}}>{system.llamaOnline?'LLM Server Online':'LLM Server Offline'}</span>
                    {system.modelName&&<span style={{fontSize:12,color:'var(--fg-3)',fontFamily:'JetBrains Mono,monospace'}}>· {system.modelName}</span>}
                  </div>
                  {system.gpuStats&&system.gpuStats.length>0&&(
                    <div style={{display:'flex',gap:24,marginTop:4}}>
                      {system.gpuStats.map((g,i)=>(
                        <div key={i} style={{display:'flex',gap:20,alignItems:'center'}}>
                          <GpuRing value={g.utilization} color="#fbbf24" label={`GPU ${i}`}/>
                          <GpuRing value={Math.round(g.memUsed/Math.max(g.memTotal,1)*100)} color="#60a5fa" label="VRAM"/>
                          <div style={{fontSize:12,fontFamily:'JetBrains Mono,monospace'}}>
                            <p style={{color:'var(--fg-4)',marginBottom:3,fontSize:10,textTransform:'uppercase',letterSpacing:'0.06em'}}>Memory</p>
                            <p style={{color:'#60a5fa'}}>{g.memUsed.toLocaleString()} <span style={{color:'var(--fg-4)'}}>/ {g.memTotal.toLocaleString()} MiB</span></p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!system.gpuStats&&<p style={{fontSize:13,color:'var(--fg-3)'}}>No GPU detected</p>}
                </div>
              ):<p style={{fontSize:13,color:'var(--fg-3)'}}>Checking system status…</p>}
            </div>

            {stats.dailyStats&&stats.dailyStats.length>0&&<ActivityChart data={stats.dailyStats}/>}

            {stats.topUsers.length>0&&(
              <div style={{background:'var(--bg-1)',border:'1px solid var(--bd)',borderRadius:10,overflow:'hidden'}}>
                <div style={{padding:'14px 20px',borderBottom:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <p style={{fontSize:13,fontWeight:600,color:'var(--fg)'}}>Top Users</p>
                  <p style={{fontSize:11,color:'var(--fg-4)',fontFamily:'JetBrains Mono,monospace'}}>{stats.topUsers.length} users</p>
                </div>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['User','Convs','Msgs','Role'].map(h=><th key={h} style={{...thead,textAlign:h==='User'?'left':'right',paddingLeft:h==='User'?20:14,paddingRight:14}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {stats.topUsers.map((u,i)=>(
                      <tr key={u.username} className="arow">
                        <td style={{...cell,paddingLeft:20}}>
                          <div style={{display:'flex',alignItems:'center',gap:10}}>
                            <span style={{fontSize:10,color:'var(--fg-4)',fontFamily:'JetBrains Mono,monospace',width:16}}>#{i+1}</span>
                            <span style={{color:'var(--fg)'}}>{u.username}</span>
                          </div>
                        </td>
                        <td style={{...cell,textAlign:'right',color:'#60a5fa',fontFamily:'JetBrains Mono,monospace'}}>{u.conv_count}</td>
                        <td style={{...cell,textAlign:'right',color:'#fbbf24',fontFamily:'JetBrains Mono,monospace'}}>{u.msg_count}</td>
                        <td style={{...cell,textAlign:'right'}}>{u.is_admin===1&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:20,background:'rgba(34,197,94,.1)',color:'var(--g)',border:'1px solid rgba(34,197,94,.2)',fontFamily:'JetBrains Mono,monospace'}}>admin</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Users */}
        {tab==='users'&&!loading&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{position:'relative',flex:1,maxWidth:300}}>
                <svg style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--fg-4)',pointerEvents:'none'}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input value={userSearch} onChange={e=>setUserSearch(e.target.value)} placeholder="Search users…"
                  style={{width:'100%',background:'var(--bg-1)',border:'1px solid var(--bd-2)',borderRadius:7,color:'var(--fg)',fontFamily:'Inter,sans-serif',fontSize:13,padding:'8px 10px 8px 30px',outline:'none',transition:'border-color .15s'}}
                  onFocus={e=>(e.target.style.borderColor='rgba(34,197,94,.35)')} onBlur={e=>(e.target.style.borderColor='var(--bd-2)')}/>
              </div>
              <span style={{fontSize:12,color:'var(--fg-4)',fontFamily:'JetBrains Mono,monospace'}}>{filteredUsers.length}/{users.length}</span>
            </div>
            <div style={{background:'var(--bg-1)',border:'1px solid var(--bd)',borderRadius:10,overflow:'hidden'}}>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>
                    {[{l:'User',col:'username'},{l:'Email',col:null,hide:true},{l:'Convs',col:'conv_count'},{l:'Msgs',col:'msg_count'},{l:'Last Seen',col:'last_active',hide:true},{l:'Actions',col:null}].map(h=>(
                      <th key={h.l} style={{...thead,textAlign:h.l==='User'||h.l==='Email'||h.l==='Last Seen'?'left':'center',cursor:h.col?'pointer':'default',display:h.hide?'none':'table-cell'}} onClick={h.col?()=>handleSort(h.col as typeof sortCol):undefined}>
                        {h.l}{h.col&&sortCol===h.col&&(sortDir==='asc'?' ↑':' ↓')}
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {filteredUsers.map(u=>(
                      <tr key={u.id} className="arow">
                        <td style={{...cell}}>
                          <div style={{display:'flex',alignItems:'center',gap:9}}>
                            <div style={{position:'relative',flexShrink:0}}>
                              <div style={{width:26,height:26,borderRadius:'50%',background:isOnline(u.last_active)?'rgba(34,197,94,.12)':'var(--bg-3)',border:`1px solid ${isOnline(u.last_active)?'rgba(34,197,94,.25)':'var(--bd-2)'}`,color:isOnline(u.last_active)?'var(--g)':'var(--fg-3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:600}}>{u.username[0].toUpperCase()}</div>
                              {isOnline(u.last_active)&&<span style={{position:'absolute',bottom:-1,right:-1,width:7,height:7,borderRadius:'50%',background:'var(--g)',border:'1.5px solid var(--bg-1)'}}/>}
                            </div>
                            <div>
                              <div style={{display:'flex',alignItems:'center',gap:6,color:'var(--fg)',fontSize:13}}>{u.username}
                                {u.is_admin===1&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:20,background:'rgba(34,197,94,.1)',color:'var(--g)',border:'1px solid rgba(34,197,94,.2)',fontFamily:'JetBrains Mono,monospace'}}>admin</span>}
                                {u.id===selfId&&<span style={{fontSize:10,color:'var(--fg-4)'}}>(you)</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{...cell,display:'none'}}>{u.email??'—'}</td>
                        <td style={{...cell,textAlign:'center',color:'#60a5fa',fontFamily:'JetBrains Mono,monospace'}}>{u.conv_count}</td>
                        <td style={{...cell,textAlign:'center',color:'#fbbf24',fontFamily:'JetBrains Mono,monospace'}}>{u.msg_count}</td>
                        <td style={{...cell,textAlign:'center',display:'none'}}>{u.last_active?rel(u.last_active):'—'}</td>
                        <td style={{...cell,textAlign:'center'}}>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
                            <Ico onClick={()=>toggleAdmin(u)} title={u.is_admin?'Remove admin':'Make admin'}><span style={{color:'#60a5fa',fontSize:12}}>{u.is_admin?'Demote':'Promote'}</span></Ico>
                            <Ico onClick={()=>setResetModal({user:u})} title="Reset password"><span style={{color:'#fbbf24',fontSize:12}}>Reset PW</span></Ico>
                            {u.id!==selfId&&<Ico onClick={()=>setConfirm({user:u})} title="Delete user"><span style={{color:'var(--err)',fontSize:12}}>Delete</span></Ico>}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length===0&&<tr><td colSpan={6} style={{padding:'24px',textAlign:'center',color:'var(--fg-3)',fontSize:13}}>No users match</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Chats */}
        {tab==='chats'&&!loading&&(
          <div style={{display:'flex',gap:10,height:'70vh'}}>
            {[
              {items:users.map(u=>({key:u.id,label:u.username,sub:`${u.conv_count} chats`,active:selectedUser?.id===u.id,online:isOnline(u.last_active),onClick:()=>selectUser(u)})),header:'Users',w:168},
              {items:convs.map(c=>({key:c.id,label:c.title,sub:`${c.msg_count} msgs · ${rel(c.updated_at)}`,active:selectedConv?.id===c.id,online:false,onClick:()=>selectConv(c)})),header:selectedUser?`${selectedUser.username}'s chats`:'Select a user',w:200},
            ].map((panel,pi)=>(
              <div key={pi} style={{width:panel.w,flexShrink:0,display:'flex',flexDirection:'column',background:'var(--bg-1)',border:'1px solid var(--bd)',borderRadius:10,overflow:'hidden'}}>
                <div style={{padding:'10px 12px',borderBottom:'1px solid var(--bd)'}}>
                  <p style={{fontSize:10,fontWeight:700,color:'var(--fg-4)',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:'JetBrains Mono,monospace'}}>{panel.header}</p>
                </div>
                <div style={{overflowY:'auto',flex:1}}>
                  {(pi===1&&loadingConv)&&<div style={{padding:'12px',fontSize:12,color:'var(--fg-3)'}}>Loading…</div>}
                  {panel.items.map(item=>(
                    <button key={String(item.key)} onClick={item.onClick}
                      style={{display:'block',width:'100%',padding:'9px 12px',textAlign:'left',border:'none',borderBottom:'1px solid rgba(255,255,255,.04)',background:item.active?'var(--bg-3)':'transparent',cursor:'pointer',fontFamily:'Inter,sans-serif',transition:'background .1s',borderLeft:item.active?'2px solid var(--g)':'2px solid transparent'}}>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        {item.online&&<div style={{width:5,height:5,borderRadius:'50%',background:'var(--g)',flexShrink:0}}/>}
                        <span style={{fontSize:13,color:item.active?'var(--fg)':'var(--fg-2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'block'}}>{item.label}</span>
                      </div>
                      <p style={{fontSize:10,color:'var(--fg-4)',marginTop:2,fontFamily:'JetBrains Mono,monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.sub}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',background:'var(--bg-1)',border:'1px solid var(--bd)',borderRadius:10,overflow:'hidden'}}>
              <div style={{padding:'10px 14px',borderBottom:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                <p style={{fontSize:10,fontWeight:700,color:'var(--fg-4)',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:'JetBrains Mono,monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selectedConv?selectedConv.title:'Select a conversation'}</p>
                {selectedConv&&<span style={{fontSize:10,color:'var(--fg-4)',flexShrink:0,marginLeft:8,fontFamily:'JetBrains Mono,monospace'}}>{chatMsgs.filter(m=>m.role!=='system').length} msgs</span>}
              </div>
              <div style={{overflowY:'auto',flex:1,padding:14,display:'flex',flexDirection:'column',gap:12}}>
                {loadingMsgs&&<div style={{fontSize:13,color:'var(--fg-3)'}}>Loading…</div>}
                {chatMsgs.filter(m=>m.role!=='system').map(m=>(
                  <div key={m.id} style={{display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start'}}>
                    <div style={{maxWidth:'88%',fontSize:13,lineHeight:1.6,padding:'9px 13px',borderRadius:m.role==='user'?'12px 12px 3px 12px':'0 12px 12px 12px',background:m.role==='user'?'var(--bg-3)':'transparent',border:m.role==='user'?'1px solid var(--bd-2)':'none',borderLeft:m.role!=='user'?'2px solid var(--g-bd)':undefined,paddingLeft:m.role!=='user'?12:undefined}}>
                      <p style={{fontSize:10,color:'var(--fg-4)',marginBottom:5,fontFamily:'JetBrains Mono,monospace'}}>{m.role} · {rel(m.created_at)}</p>
                      <p style={{color:'var(--fg)',whiteSpace:'pre-wrap'}}>{m.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Reset PW modal */}
      {resetModal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:50,padding:16}}>
          <div className="modal" style={{width:'100%',maxWidth:400,background:'var(--bg-1)',border:'1px solid var(--bd-2)',borderRadius:14,padding:28,boxShadow:'var(--sh-lg)'}}>
            <h3 style={{fontSize:17,fontWeight:700,color:'var(--fg)',marginBottom:6}}>Reset Password</h3>
            {!resetModal.tempPassword?(
              <>
                <p style={{fontSize:13,color:'var(--fg-3)',marginBottom:20}}>Generate a temporary password for <strong style={{color:'var(--fg)'}}>{resetModal.user.username}</strong>?</p>
                <div style={{display:'flex',gap:10}}>
                  <button onClick={()=>resetPw(resetModal.user)} className="btn btn-green" style={{flex:1}}>Generate</button>
                  <button onClick={()=>setResetModal(null)} className="btn btn-outline" style={{flex:1}}>Cancel</button>
                </div>
              </>
            ):(
              <>
                <p style={{fontSize:13,color:'var(--fg-3)',marginBottom:12}}>Temporary password for <strong style={{color:'var(--fg)'}}>{resetModal.user.username}</strong>:</p>
                <div style={{position:'relative',background:'var(--bg-2)',border:'1px solid var(--bd-2)',borderRadius:8,padding:'14px 44px 14px 16px',marginBottom:8}}>
                  <code style={{fontSize:16,fontFamily:'JetBrains Mono,monospace',color:'var(--g)',letterSpacing:'0.15em',userSelect:'all'}}>{resetModal.tempPassword}</code>
                  <button onClick={async()=>{await navigator.clipboard.writeText(resetModal.tempPassword!);setCopiedPw(true);setTimeout(()=>setCopiedPw(false),2000);}}
                    style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:copiedPw?'var(--g)':'var(--fg-3)',fontSize:11}}>
                    {copiedPw?'Copied!':'Copy'}
                  </button>
                </div>
                <p style={{fontSize:11,color:'var(--fg-4)',marginBottom:18,fontFamily:'JetBrains Mono,monospace'}}>This will not be shown again.</p>
                <button onClick={()=>setResetModal(null)} className="btn btn-outline" style={{width:'100%'}}>Done</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {confirm&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:50,padding:16}}>
          <div className="modal" style={{width:'100%',maxWidth:400,background:'var(--bg-1)',border:'1px solid rgba(248,113,113,.2)',borderRadius:14,padding:28,boxShadow:'var(--sh-lg)'}}>
            <h3 style={{fontSize:17,fontWeight:700,color:'var(--fg)',marginBottom:6}}>Delete User</h3>
            <p style={{fontSize:13,color:'var(--fg-3)',marginBottom:12}}>This will permanently delete <strong style={{color:'var(--fg)'}}>{confirm.user.username}</strong>.</p>
            <div style={{background:'rgba(248,113,113,.07)',border:'1px solid rgba(248,113,113,.15)',borderRadius:8,padding:'10px 14px',marginBottom:20,fontSize:12,color:'var(--fg-3)',fontFamily:'JetBrains Mono,monospace'}}>
              {confirm.user.conv_count} conversations · {confirm.user.msg_count} messages, all permanently deleted. This cannot be undone.
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>deleteUser(confirm.user)}
                style={{flex:1,padding:'10px',borderRadius:8,background:'var(--err)',color:'#fff',fontFamily:'Inter,sans-serif',fontSize:13,fontWeight:600,border:'none',cursor:'pointer',transition:'opacity .15s'}}
                onMouseEnter={e=>(e.currentTarget as HTMLElement).style.opacity='.85'}
                onMouseLeave={e=>(e.currentTarget as HTMLElement).style.opacity='1'}>Delete User</button>
              <button onClick={()=>setConfirm(null)} className="btn btn-outline" style={{flex:1}}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}
