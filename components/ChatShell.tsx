'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { signOut } from 'next-auth/react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useTextToSpeech } from '@/hooks/useTextToSpeech';
import { ChakorMark } from './LoginForm';
import ThemeEditor from './ThemeEditor';
import { APP } from '@/lib/config';

// ─── Types ────────────────────────────────────────────────────
type Conv   = { id: string; title: string; model: string; created_at: number; updated_at: number; folder_id?: number|null; pinned?: number; archived?: number; tags?: string[] };
type Folder = { id: number; name: string; position: number };
type Source = { title: string; url: string; snippet?: string };
type Stats  = { promptTokens: number; generationTokens: number; generationMs: number; tokensPerSecond: number };
type Msg    = { role: 'user' | 'assistant'; content: string; streaming?: boolean; sources?: Source[]; stats?: Stats; dbId?: number; images?: string[]; toolEvents?: ToolEvt[] };
type User   = { id: number; name?: string | null; email?: string | null; isAdmin?: boolean };
type Doc    = { id: number; filename: string; mime_type: string | null; size_bytes: number | null; created_at: number };
type Model  = { id: string; name: string; provider: string; contextWindow: number; badge?: string; vision?: boolean };
type Engine = { id: string; label: string; running: boolean; modelCount: number; detail: string; crashed?: boolean };
type Toast  = { id: number; msg: string; ok: boolean };
type Prompt = { id: number; title: string; body: string; created_at: number };
type ToolInfo = { name: string; description: string };
type ToolEvt  = { name: string; args: string; result: string };

// ─── Helpers ──────────────────────────────────────────────────
const rel = (ts: number) => { const d = Math.floor(Date.now()/1000)-ts; if(d<60)return'now'; if(d<3600)return`${Math.floor(d/60)}m`; if(d<86400)return`${Math.floor(d/3600)}h`; return`${Math.floor(d/86400)}d`; };
const fmtBytes = (b: number|null) => { if(!b)return''; if(b<1024)return`${b}B`; if(b<1048576)return`${(b/1024).toFixed(1)}KB`; return`${(b/1048576).toFixed(1)}MB`; };
const inits = (n: string|null|undefined) => (n??'U').split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);
const toMd = (msgs: Msg[]) => msgs.map(m=>`**${m.role==='user'?'You':APP.name}:**\n\n${m.content}`).join('\n\n---\n\n');

function groupConvs(convs: Conv[]) {
  const d=new Date(); d.setHours(0,0,0,0); const t=d.getTime()/1000;
  const g=[{l:'Today',i:[]},{l:'Yesterday',i:[]},{l:'Last 7 days',i:[]},{l:'Older',i:[]}] as {l:string;i:Conv[]}[];
  for(const c of convs){ if(c.updated_at>=t)g[0].i.push(c); else if(c.updated_at>=t-86400)g[1].i.push(c); else if(c.updated_at>=t-7*86400)g[2].i.push(c); else g[3].i.push(c); }
  return g.filter(x=>x.i.length>0);
}

// ─── Icons ────────────────────────────────────────────────────
const Ico = {
  Menu:    ()=><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></svg>,
  Edit:    ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  Dots:    ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>,
  Trash:   ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9 6V4h6v2"/></svg>,
  X:       ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Send:    ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  Stop:    ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="1.5"/></svg>,
  Copy:    ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  Check:   ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Retry:   ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  Globe:   ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Flask:   ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M9 3h6l1 9H8L9 3z"/><path d="M6 21h12a1 1 0 0 0 .9-1.45L15.14 12h-6.3L5.1 19.55A1 1 0 0 0 6 21z"/></svg>,
  File:    ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  Share:   ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  Dl:      ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Mic:     ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  Vol:     ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>,
  Down:    ()=><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>,
  Logout:  ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  Clip:    ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>,
  Book:    ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  Up:      ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Image:   ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  Pin:     ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M9 4v5l-2 3h10l-2-3V4"/><line x1="8" y1="4" x2="16" y2="4"/></svg>,
  Folder:  ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  FolderPlus: ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>,
  Archive: ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
  Tool:    ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  Compare: ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/></svg>,
  Note:    ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9l7-7V5a2 2 0 0 0-2-2z"/><polyline points="14 21 14 14 21 14"/></svg>,
  Memory:  ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>,
  Palette: ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>,
};

// ─── Code block ───────────────────────────────────────────────
function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  let lang = '';
  try { const m = ((children as {props?:{className?:string}})?.props?.className??'').match(/language-(\w+)/); if(m) lang=m[1]; } catch {}
  const copy = async () => { try { await navigator.clipboard.writeText(ref.current?.textContent??''); setCopied(true); setTimeout(()=>setCopied(false),2000); } catch {} };
  return (
    <div className="codeblock">
      <div className="codeblock-header">
        <span className="codeblock-lang">{lang||'code'}</span>
        <button onClick={copy} className={`codeblock-copy ${copied?'copied':''}`}>
          {copied ? <><Ico.Check /> Copied</> : <><Ico.Copy /> Copy</>}
        </button>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

// ─── Typing indicator ─────────────────────────────────────────
function Typing() {
  return <div style={{display:'flex',alignItems:'center',gap:5,padding:'4px 0'}}><div className="dot dot-1"/><div className="dot dot-2"/><div className="dot dot-3"/></div>;
}

// ─── Source cards ─────────────────────────────────────────────
function SourceCards({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <div style={{display:'flex',gap:8,overflowX:'auto',paddingBottom:8,marginBottom:14,scrollbarWidth:'none'}}>
      {sources.slice(0,6).map((s,i)=>{
        let domain=''; try{domain=new URL(s.url).hostname.replace(/^www\./,'');}catch{}
        return (
          <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="src" style={{flexShrink:0,width:176,padding:12,display:'block',textDecoration:'none'}}>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://www.google.com/s2/favicons?sz=16&domain=${domain}`} alt="" style={{width:12,height:12,borderRadius:2,opacity:.7,flexShrink:0}}/>
              <span style={{fontSize:11,color:'var(--fg-4)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:'JetBrains Mono,monospace'}}>{domain}</span>
              <span style={{marginLeft:'auto',fontSize:10,color:'var(--fg-4)',flexShrink:0,fontFamily:'JetBrains Mono,monospace'}}>[{i+1}]</span>
            </div>
            <p style={{fontSize:12,color:'var(--fg-2)',lineHeight:1.4,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{s.title.slice(0,70)}</p>
          </a>
        );
      })}
    </div>
  );
}

// ─── Tool-use chips ───────────────────────────────────────────
function ToolChips({ events }: { events: ToolEvt[] }) {
  const [open, setOpen] = useState<number|null>(null);
  if(!events.length) return null;
  return (
    <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        {events.map((e,i)=>(
          <button key={i} onClick={()=>setOpen(open===i?null:i)}
            style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 9px',borderRadius:20,fontSize:11.5,fontFamily:'JetBrains Mono,monospace',cursor:'pointer',border:`1px solid ${open===i?'var(--g)':'var(--g-bd)'}`,background:'var(--g-dim)',color:'var(--g-text)'}}>
            <Ico.Tool/> {e.name}
          </button>
        ))}
      </div>
      {open!==null && events[open] && (
        <div style={{background:'var(--bg-2)',border:'1px solid var(--bd-2)',borderRadius:8,padding:'8px 11px',fontSize:11.5,fontFamily:'JetBrains Mono,monospace',color:'var(--fg-3)',whiteSpace:'pre-wrap',maxHeight:170,overflowY:'auto'}}>
          <div style={{color:'var(--fg-4)',marginBottom:4}}>args: {events[open].args||'{}'}</div>
          {events[open].result.slice(0,1000)}
        </div>
      )}
    </div>
  );
}

// ─── Model dropdown ───────────────────────────────────────────
type ModelDetail = { parameterSize?: string|null; quantization?: string|null };
const ENGINE_LABEL: Record<string,string> = { llama:'llama.cpp', ollama:'Ollama', lmstudio:'LM Studio' };

function ModelSelect({ models, selected, onChange, loadedNames, details, isAdmin, onToggleLoad, onOpenChange, localName, engines }: {
  models: Model[]; selected: string; onChange: (id: string) => void;
  loadedNames: Set<string>; details: Record<string, ModelDetail>; isAdmin: boolean;
  onToggleLoad: (name: string, loaded: boolean) => void; onOpenChange: (open: boolean) => void;
  localName?: string | null; engines: Engine[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cur = models.find(m=>m.id===selected)??models[0];
  // The fix for "llama.cpp crashed, now what": if the engine behind the selected
  // model is down, offer the running engines (with models) as one-click switches
  // right at the top of the picker, so nobody gets stuck on a dead backend.
  const curEngine = engines.find(e=>e.id===cur?.provider);
  const engineDown = !!curEngine && !curEngine.running;
  const alts = engineDown ? engines.filter(e=>e.running && e.modelCount>0) : [];
  const firstModelOf = (id:string) => models.find(m=>m.provider===id)?.id;
  useEffect(()=>{
    if(!open) return;
    const h=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false);};
    document.addEventListener('mousedown',h); return()=>document.removeEventListener('mousedown',h);
  },[open]);
  useEffect(()=>{ onOpenChange(open); // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open]);
  if (!models.length) return null;
  return (
    <div ref={ref} style={{position:'relative'}}>
      <button onClick={()=>setOpen(o=>!o)} className="btn-ghost-sm"
        style={{gap:6, background: open ? 'var(--bg-2)' : 'transparent'}}>
        <span style={{fontSize:13,fontWeight:500,color:'var(--fg-2)'}}>{cur?.name??'Model'}</span>
        <Ico.Down/>
      </button>
      {open && (
        <div className="anim-scale-in" style={{position:'absolute',top:'calc(100% + 6px)',left:0,zIndex:50,background:'var(--bg-2)',border:'1px solid var(--bd-2)',borderRadius:10,boxShadow:'var(--sh-lg)',minWidth:252,maxWidth:300,overflow:'hidden'}}>
          {engineDown && (
            <div style={{padding:'10px 12px',background:'rgba(251,191,36,.08)',borderBottom:'1px solid var(--bd-2)'}}>
              <p style={{fontSize:11.5,color:'var(--fg-2)',margin:'0 0 7px',lineHeight:1.5}}>
                <strong style={{color:'#f5b73d'}}>{ENGINE_LABEL[curEngine!.id]??curEngine!.id} isn&apos;t running.</strong> {curEngine!.crashed?'It kept crashing - the model is likely too big for this machine.':''}
              </p>
              {alts.length>0 ? (
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {alts.map(e=>{ const mid=firstModelOf(e.id); if(!mid) return null; return (
                    <button key={e.id} onClick={()=>{onChange(mid);setOpen(false);}}
                      style={{fontSize:11.5,padding:'5px 10px',borderRadius:'var(--r)',border:'1px solid var(--g-bd)',background:'var(--g-dim)',color:'var(--g-text)',cursor:'pointer',fontFamily:'Inter,sans-serif'}}>
                      Use {e.label} ({e.modelCount})
                    </button>
                  );})}
                </div>
              ) : (
                <p style={{fontSize:11,color:'var(--fg-4)',margin:0}}>No other local engine is running. Start Ollama or LM Studio, or pick a cloud model.</p>
              )}
            </div>
          )}
          {['llama','ollama','lmstudio','openai','anthropic','google','openrouter'].map(p=>{
            const grp=models.filter(m=>m.provider===p); if(!grp.length) return null;
            return (
              <div key={p}>
                <div style={{padding:'8px 12px 4px',fontSize:10,fontWeight:600,color:'var(--fg-4)',textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:'JetBrains Mono,monospace'}}>{ENGINE_LABEL[p]??p}</div>
                {grp.map(m=>{
                  const isOllama=m.provider==='ollama';
                  const loaded=isOllama&&loadedNames.has(m.name);
                  const det=details[m.name];
                  return (
                    <div key={m.id} style={{display:'flex',alignItems:'center',background:m.id===selected?'var(--bg-3)':'transparent'}}>
                      <button onClick={()=>{onChange(m.id);setOpen(false);}}
                        style={{flex:1,minWidth:0,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 14px',fontSize:13,color:m.id===selected?'var(--fg)':'var(--fg-2)',background:'transparent',border:'none',cursor:'pointer',fontFamily:'Inter,sans-serif',gap:8,textAlign:'left',transition:'background .1s'}}
                        onMouseEnter={e=>{if(m.id!==selected)(e.currentTarget as HTMLElement).style.background='var(--bg-3)';}}
                        onMouseLeave={e=>{if(m.id!==selected)(e.currentTarget as HTMLElement).style.background='transparent';}}>
                        <span style={{display:'flex',alignItems:'center',gap:7,minWidth:0}}>
                          {isOllama&&<span title={loaded?'Loaded in memory':'Not loaded'} style={{width:6,height:6,borderRadius:'50%',background:loaded?'var(--g)':'var(--bd-2)',flexShrink:0}}/>}
                          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name}</span>
                        </span>
                        <span style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                          {det&&(det.parameterSize||det.quantization)&&<span style={{fontSize:10,color:'var(--fg-4)',fontFamily:'JetBrains Mono,monospace'}}>{[det.parameterSize,det.quantization].filter(Boolean).join(' · ')}</span>}
                          {m.provider==='llama'&&localName&&<span title={`Running ${localName}`} style={{fontSize:10,color:'var(--fg-4)',fontFamily:'JetBrains Mono,monospace',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{localName.replace(/\.gguf$/i,'')}</span>}
                          {m.id===selected&&<Ico.Check/>}
                        </span>
                      </button>
                      {isOllama&&isAdmin&&(
                        <button onClick={(e)=>{e.stopPropagation();onToggleLoad(m.name,loaded);}} title={loaded?'Unload from memory':'Load into memory'}
                          className="btn-ghost-sm" style={{padding:'6px 9px',marginRight:5,color:loaded?'var(--g)':'var(--fg-4)',flexShrink:0}}>
                          {loaded?<Ico.Stop/>:<Ico.Down/>}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Context length control ───────────────────────────────────
const fmtCtx = (n: number) => (n >= 1024 ? `${Math.round(n / 1024)}K` : String(n));
const CTX_PRESETS = [2048, 4096, 8192, 16384, 32768];
type LocalLive = { online: boolean; modelName: string|null; nCtx: number|null; vision?: boolean };

// A small, friendly "how much does it remember" control next to the model picker.
// For the local model it shows the server's context (changed in Settings → Models,
// since that restarts inference); for Ollama and cloud models it sets a per-chat
// budget that the chat route honours.
function ContextControl({ model, localLive, isAdmin, ctxChoice, onChoose }: {
  model?: Model; localLive: LocalLive|null; isAdmin: boolean;
  ctxChoice: number|null; onChoose: (n: number|null)=>void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open) return;
    const h=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false);};
    document.addEventListener('mousedown',h); return()=>document.removeEventListener('mousedown',h);
  },[open]);
  if (!model) return null;
  const isLocal = model.provider === 'llama';
  const maxWin = model.contextWindow > 0 ? model.contextWindow : 0;
  const effective = isLocal ? (localLive?.nCtx ?? maxWin) : (ctxChoice ?? maxWin);
  const label = effective ? fmtCtx(effective) : 'Auto';
  const presets = (maxWin ? [...CTX_PRESETS.filter(c=>c<maxWin), maxWin] : CTX_PRESETS);

  return (
    <div ref={ref} style={{position:'relative'}}>
      <button onClick={()=>setOpen(o=>!o)} className="btn-ghost-sm" title="Context length — how much the model remembers"
        style={{gap:5, background: open ? 'var(--bg-2)' : 'transparent'}}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h7"/></svg>
        <span style={{fontSize:12.5,fontWeight:500,color:'var(--fg-3)',fontFamily:'JetBrains Mono,monospace'}}>{label}</span>
      </button>
      {open && (
        <div className="anim-scale-in" style={{position:'absolute',top:'calc(100% + 6px)',right:0,zIndex:50,background:'var(--bg-2)',border:'1px solid var(--bd-2)',borderRadius:10,boxShadow:'var(--sh-lg)',width:248,overflow:'hidden'}}>
          <div style={{padding:'10px 14px 8px'}}>
            <p style={{fontSize:12,fontWeight:600,color:'var(--fg)',margin:0}}>Context length</p>
            <p style={{fontSize:11,color:'var(--fg-4)',margin:'3px 0 0',lineHeight:1.5}}>How much of the chat the model keeps in mind. Bigger remembers more but is slower.</p>
          </div>
          {isLocal ? (
            <div style={{padding:'4px 14px 12px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0'}}>
                <span style={{fontSize:12.5,color:'var(--fg-2)'}}>Running at</span>
                <span style={{fontSize:12.5,color:'var(--g-text)',fontFamily:'JetBrains Mono,monospace',fontWeight:600}}>{localLive?.nCtx?fmtCtx(localLive.nCtx):'—'}</span>
              </div>
              <p style={{fontSize:11,color:'var(--fg-4)',margin:'4px 0 8px',lineHeight:1.5}}>The local model&apos;s context is set where it loads.</p>
              {isAdmin
                ? <a href="/settings" style={{display:'block',textAlign:'center',fontSize:12,color:'var(--g-text)',textDecoration:'none',padding:'7px 0',border:'1px solid var(--g-bd)',borderRadius:'var(--r)',background:'var(--g-dim)'}}>Change in Settings → Models</a>
                : <p style={{fontSize:11.5,color:'var(--fg-3)',margin:0,textAlign:'center',padding:'6px 0'}}>Set by your admin</p>}
            </div>
          ) : (
            <div style={{padding:'2px 8px 8px'}}>
              {[...presets.map(p=>({v:p,label:fmtCtx(p)})), {v:null as number|null,label:'Auto (model default)'}].map(opt=>{
                const active = (ctxChoice ?? null) === opt.v;
                return (
                  <button key={String(opt.v)} onClick={()=>{onChoose(opt.v);setOpen(false);}}
                    style={{display:'flex',width:'100%',alignItems:'center',justifyContent:'space-between',padding:'8px 10px',borderRadius:'var(--r)',fontSize:12.5,color:active?'var(--fg)':'var(--fg-2)',background:active?'var(--bg-3)':'transparent',border:'none',cursor:'pointer',fontFamily:'Inter,sans-serif',transition:'background .1s'}}
                    onMouseEnter={e=>{if(!active)(e.currentTarget as HTMLElement).style.background='var(--bg-3)';}}
                    onMouseLeave={e=>{if(!active)(e.currentTarget as HTMLElement).style.background='transparent';}}>
                    <span style={typeof opt.v==='number'?{fontFamily:'JetBrains Mono,monospace'}:undefined}>{opt.label}</span>
                    {active && <Ico.Check/>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Conversation item ────────────────────────────────────────
function ConvItem({ conv, active, folders, onClick, onDelete, onPin, onArchive, onMove }: {
  conv: Conv; active: boolean; folders: Folder[];
  onClick: ()=>void; onDelete: (e: React.MouseEvent)=>void;
  onPin: ()=>void; onArchive: ()=>void; onMove: (folderId: number|null)=>void;
}) {
  const [menu, setMenu] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!menu) return;
    const h=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node)){setMenu(false);setMoveOpen(false);}};
    document.addEventListener('mousedown',h); return()=>document.removeEventListener('mousedown',h);
  },[menu]);
  const row = (label: React.ReactNode, fn: (e: React.MouseEvent)=>void, danger=false)=>(
    <button onClick={fn} className="btn-ghost-sm" style={{width:'100%',padding:'8px 12px',justifyContent:'flex-start',color:danger?'var(--err)':'var(--fg-2)',borderRadius:0,fontSize:12.5,gap:8}}>{label}</button>
  );
  return (
    <div onClick={onClick} className={`conv-item ${active?'active':''}`}
      style={{color:active?'var(--fg)':'var(--fg-3)'}}
      onMouseEnter={e=>{if(!active)(e.currentTarget as HTMLElement).style.background='var(--bg-2)';}}
      onMouseLeave={e=>{if(!active)(e.currentTarget as HTMLElement).style.background='transparent';}}>
      {conv.pinned?<span style={{flexShrink:0,color:'var(--g)',opacity:.7,display:'inline-flex'}}><Ico.Pin/></span>:null}
      <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:13.5}}>{conv.title}</span>
      <div ref={ref} style={{position:'relative',flexShrink:0}} onClick={e=>e.stopPropagation()}>
        <button onClick={e=>{e.stopPropagation();setMenu(o=>!o);}} className="btn-ghost-sm"
          style={{padding:'3px 5px',opacity:menu?1:0}}
          onMouseEnter={e=>(e.currentTarget as HTMLElement).style.opacity='1'}
          onMouseLeave={e=>{if(!menu)(e.currentTarget as HTMLElement).style.opacity='0';}}
          onFocus={e=>(e.currentTarget as HTMLElement).style.opacity='1'}
          onBlur={e=>{if(!menu)(e.currentTarget as HTMLElement).style.opacity='0';}}>
          <Ico.Dots/>
        </button>
        {menu && (
          <div className="anim-scale-in" style={{position:'absolute',right:0,top:'100%',marginTop:4,zIndex:50,background:'var(--bg-2)',border:'1px solid var(--bd-2)',borderRadius:8,boxShadow:'var(--sh-lg)',overflow:'hidden',minWidth:172}}>
            {row(<><Ico.Pin/> {conv.pinned?'Unpin':'Pin to top'}</>, e=>{e.stopPropagation();onPin();setMenu(false);})}
            {row(<><Ico.Folder/> Move to folder</>, e=>{e.stopPropagation();setMoveOpen(o=>!o);})}
            {moveOpen && (
              <div style={{borderTop:'1px solid var(--bd)',borderBottom:'1px solid var(--bd)',maxHeight:170,overflowY:'auto',background:'var(--bg-1)'}}>
                {conv.folder_id!=null && (
                  <button onClick={e=>{e.stopPropagation();onMove(null);setMenu(false);setMoveOpen(false);}} className="btn-ghost-sm" style={{width:'100%',padding:'7px 12px 7px 30px',justifyContent:'flex-start',color:'var(--fg-3)',borderRadius:0,fontSize:12.5}}>No folder</button>
                )}
                {folders.filter(f=>f.id!==conv.folder_id).map(f=>(
                  <button key={f.id} onClick={e=>{e.stopPropagation();onMove(f.id);setMenu(false);setMoveOpen(false);}} className="btn-ghost-sm" style={{width:'100%',padding:'7px 12px 7px 30px',justifyContent:'flex-start',color:'var(--fg-2)',borderRadius:0,fontSize:12.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'block',textAlign:'left'}}>{f.name}</button>
                ))}
                {folders.length===0 && <p style={{padding:'7px 12px 7px 30px',fontSize:11.5,color:'var(--fg-4)'}}>No folders yet</p>}
              </div>
            )}
            {row(<><Ico.Archive/> {conv.archived?'Unarchive':'Archive'}</>, e=>{e.stopPropagation();onArchive();setMenu(false);})}
            {row(<><Ico.Trash/> Delete</>, e=>{onDelete(e);setMenu(false);}, true)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────
function MsgBubble({ msg, onEdit, onRegen, tts, density, showStats, userInits }: {
  msg: Msg & {id?: string}; onEdit?: ()=>void; onRegen?: ()=>void;
  tts: ReturnType<typeof useTextToSpeech>; density: 'compact'|'comfortable'; showStats?: boolean; userInits?: string;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === 'user';
  const id = msg.id ?? msg.dbId?.toString() ?? '';
  const speaking = tts.speaking && tts.speakingId === id;
  const mb = density === 'compact' ? 16 : 28;
  const copy = async () => { try { await navigator.clipboard.writeText(msg.content); setCopied(true); setTimeout(()=>setCopied(false),2000); } catch {} };

  if (isUser) {
    return (
      <div className="anim-msg-in" style={{display:'flex',justifyContent:'flex-end',marginBottom:mb}}>
        <div style={{display:'flex',alignItems:'flex-end',gap:10,maxWidth:'78%'}}>
          <div>
            {msg.images&&msg.images.length>0&&(
              <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'flex-end',marginBottom:msg.content?6:0}}>
                {msg.images.map((src,i)=>(
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt="attachment" style={{maxWidth:200,maxHeight:200,borderRadius:10,border:'1px solid var(--bd-2)',objectFit:'cover'}}/>
                ))}
              </div>
            )}
            {msg.content&&<div style={{background:'var(--bg-2)',border:'1px solid var(--bd-2)',borderRadius:'12px 12px 3px 12px',padding:'11px 16px',fontSize:15,lineHeight:1.75,color:'var(--fg)',wordBreak:'break-word',whiteSpace:'pre-wrap'}}>{msg.content}</div>}
            <div style={{display:'flex',justifyContent:'flex-end',gap:4,marginTop:5,opacity:0,transition:'opacity .15s'}}
              onMouseEnter={e=>(e.currentTarget as HTMLElement).style.opacity='1'}
              onMouseLeave={e=>(e.currentTarget as HTMLElement).style.opacity='0'}>
              <button onClick={copy} className="btn-ghost-sm" style={{fontSize:12,padding:'3px 7px',color:copied?'var(--ok)':'var(--fg-3)'}}>
                {copied?<><Ico.Check/> Copied</>:<><Ico.Copy/> Copy</>}
              </button>
              {onEdit && <button onClick={onEdit} className="btn-ghost-sm" style={{fontSize:12,padding:'3px 7px'}}><Ico.Edit/> Edit</button>}
            </div>
          </div>
          <div style={{width:28,height:28,borderRadius:'50%',background:'var(--bg-3)',border:'1px solid var(--bd-2)',color:'var(--fg-3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,flexShrink:0,marginBottom:22}}>{userInits??'U'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="anim-msg-in" style={{display:'flex',gap:12,marginBottom:mb}}>
      <div style={{flexShrink:0,marginTop:3}} className="chakor-mark">
        <ChakorMark size={26}/>
      </div>
      <div style={{flex:1,minWidth:0,paddingTop:2}}>
        {msg.toolEvents && msg.toolEvents.length > 0 && <ToolChips events={msg.toolEvents}/>}
        {msg.sources && msg.sources.length > 0 && <SourceCards sources={msg.sources}/>}
        {msg.streaming && !msg.content
          ? <Typing/>
          : (
            <div className="prose-ai">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}
                components={{
                  pre:    ({children})=><CodeBlock>{children}</CodeBlock>,
                  code:   ({className,children,...p})=><code className={className} {...p}>{children}</code>,
                  a:      ({href,children})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
                  p:      ({children})=><p>{children}</p>,
                  ul:     ({children})=><ul>{children}</ul>,
                  ol:     ({children})=><ol>{children}</ol>,
                  li:     ({children})=><li>{children}</li>,
                  h1:     ({children})=><h1>{children}</h1>,
                  h2:     ({children})=><h2>{children}</h2>,
                  h3:     ({children})=><h3>{children}</h3>,
                  h4:     ({children})=><h4>{children}</h4>,
                  blockquote:({children})=><blockquote>{children}</blockquote>,
                  hr:     ()=><hr/>,
                  strong: ({children})=><strong>{children}</strong>,
                  em:     ({children})=><em>{children}</em>,
                  table:  ({children})=><div style={{overflowX:'auto'}}><table>{children}</table></div>,
                  th:     ({children})=><th>{children}</th>,
                  td:     ({children})=><td>{children}</td>,
                  tr:     ({children})=><tr>{children}</tr>,
                }}>
                {msg.streaming ? msg.content+'▋' : msg.content}
              </ReactMarkdown>
            </div>
          )
        }
        {msg.stats && showStats && (
          <div style={{display:'flex',gap:16,marginTop:10,fontSize:11,color:'var(--fg-4)',fontFamily:'JetBrains Mono,monospace'}}>
            <span>{msg.stats.generationTokens.toLocaleString()} tokens</span>
            <span>{(msg.stats.generationMs/1000).toFixed(1)}s</span>
            <span style={{color:'var(--g)',opacity:.6}}>{msg.stats.tokensPerSecond.toFixed(1)} t/s</span>
          </div>
        )}
        {!msg.streaming && (
          <div style={{display:'flex',alignItems:'center',gap:2,marginTop:8,opacity:0,transition:'opacity .15s'}}
            onMouseEnter={e=>(e.currentTarget as HTMLElement).style.opacity='1'}
            onMouseLeave={e=>(e.currentTarget as HTMLElement).style.opacity='0'}>
            {[
              {icon:<>{copied?<Ico.Check/>:<Ico.Copy/>}</>,label:copied?'Copied':'Copy',fn:copy,active:copied},
              ...(onRegen?[{icon:<Ico.Retry/>,label:'Retry',fn:onRegen,active:false}]:[]),
              ...(tts.supported?[{icon:<Ico.Vol/>,label:speaking?'Stop':'Read',fn:()=>speaking?tts.stop():tts.speak(msg.content,id),active:speaking}]:[]),
            ].map(({icon,label,fn,active})=>(
              <button key={label} onClick={fn} className="btn-ghost-sm"
                style={{fontSize:12,padding:'3px 8px',color:active?'var(--g)':'var(--fg-3)'}}>
                {icon} {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Welcome screen ───────────────────────────────────────────
const SUGGESTIONS = [
  { title: 'Write or debug code', sub: 'Working solutions, root-cause fixes', prompt: 'Help me with this code:\n\n' },
  { title: 'Explain something', sub: 'Clear answers, as deep as you need', prompt: 'Explain this clearly:\n\n' },
  { title: 'Research a topic', sub: 'Multi-source synthesis with citations', prompt: 'Research this for me:\n\n' },
  { title: 'Help me write', sub: 'Draft, edit, or sharpen any text', prompt: 'Help me write:\n\n' },
];

function Welcome({ name, onSelect, taRef }: { name?: string|null; onSelect: (p:string)=>void; taRef: React.RefObject<HTMLTextAreaElement> }) {
  const greet = (() => { const hr = new Date().getHours(); return hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; })();
  const h = name ? `${greet}, ${name.split(' ')[0]}.` : `${greet}.`;
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'64vh',padding:'0 16px'}}>
      <div className="anim-fade-up" style={{textAlign:'center',marginBottom:36}}>
        <div style={{display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:20}} className="chakor-mark-lg">
          <ChakorMark size={46}/>
        </div>
        <h1 style={{fontSize:34,fontWeight:800,letterSpacing:'-0.03em',color:'var(--fg)',marginBottom:10,lineHeight:1.05}}>{h}</h1>
        <p style={{fontSize:15.5,color:'var(--fg-3)',maxWidth:440,margin:'0 auto',lineHeight:1.5}}>
          Ask anything. I keep it short when it&apos;s simple, and go deep when it matters.
        </p>
      </div>
      <div className="anim-fade-up" style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10,width:'100%',maxWidth:660,animationDelay:'.08s'}}>
        {SUGGESTIONS.map(s=>(
          <button key={s.title} onClick={()=>{onSelect(s.prompt);taRef.current?.focus();}}
            style={{position:'relative',background:'var(--bg-2)',border:'1px solid var(--bd)',borderRadius:12,padding:'15px 16px',textAlign:'left',cursor:'pointer',transition:'background .14s, border-color .14s, transform .14s',fontFamily:'Inter,sans-serif',overflow:'hidden'}}
            onMouseEnter={e=>{const el=e.currentTarget as HTMLElement; el.style.background='var(--bg-3)'; el.style.borderColor='var(--g-bd)'; el.style.transform='translateY(-1px)';}}
            onMouseLeave={e=>{const el=e.currentTarget as HTMLElement; el.style.background='var(--bg-2)'; el.style.borderColor='var(--bd)'; el.style.transform='translateY(0)';}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4,gap:8}}>
              <p style={{fontSize:14,fontWeight:600,color:'var(--fg)'}}>{s.title}</p>
              <span style={{color:'var(--g)',opacity:.55,flexShrink:0,display:'inline-flex'}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></span>
            </div>
            <p style={{fontSize:12,color:'var(--fg-3)'}}>{s.sub}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Docs panel ───────────────────────────────────────────────
function DocsPanel({ docs, uploading, uploadError, onUpload, onDelete, onClose }: {
  docs: Doc[]; uploading: boolean; uploadError: string|null;
  onUpload: (f:File)=>void; onDelete: (id:number)=>void; onClose: ()=>void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div style={{position:'fixed',inset:0,zIndex:50,display:'flex',alignItems:'flex-start',justifyContent:'flex-end'}}>
      <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.45)'}} onClick={onClose}/>
      <div className="anim-scale-in" style={{position:'relative',zIndex:1,width:300,maxHeight:'85vh',marginTop:60,marginRight:12,display:'flex',flexDirection:'column',background:'var(--bg-1)',border:'1px solid var(--bd-2)',borderRadius:12,boxShadow:'var(--sh-lg)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px',borderBottom:'1px solid var(--bd)',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <Ico.File/><span style={{fontSize:14,fontWeight:600,color:'var(--fg)'}}>Documents</span>
            {docs.length>0&&<span style={{fontSize:11,padding:'2px 7px',borderRadius:20,background:'var(--bg-3)',color:'var(--fg-3)'}}>{docs.length}</span>}
          </div>
          <button onClick={onClose} className="btn-ghost-sm" style={{padding:'4px 5px'}}><Ico.X/></button>
        </div>
        <div style={{padding:'12px 14px',borderBottom:'1px solid var(--bd)',flexShrink:0}}>
          <div style={{border:`1.5px dashed ${drag?'var(--g)':'var(--bd-2)'}`,borderRadius:8,padding:'24px 12px',textAlign:'center',cursor:'pointer',transition:'border-color .15s, background .15s',background:drag?'var(--g-dim)':'transparent'}}
            onClick={()=>ref.current?.click()}
            onDragOver={e=>{e.preventDefault();setDrag(true);}}
            onDragLeave={()=>setDrag(false)}
            onDrop={e=>{e.preventDefault();setDrag(false);if(e.dataTransfer.files[0])onUpload(e.dataTransfer.files[0]);}}>
            {uploading
              ? <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,fontSize:13,color:'var(--fg-2)'}}>
                  <div style={{width:13,height:13,border:'2px solid var(--g)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>Processing
                </div>
              : <>
                  <p style={{fontSize:13,fontWeight:500,color:'var(--fg-2)',marginBottom:3}}>Drop file or click to upload</p>
                  <p style={{fontSize:11,color:'var(--fg-4)'}}>PDF, TXT, MD · max 10 MB</p>
                </>
            }
          </div>
          <input ref={ref} type="file" accept=".pdf,.txt,.md" style={{display:'none'}} onChange={e=>e.target.files?.[0]&&onUpload(e.target.files[0])} disabled={uploading}/>
          {uploadError&&<p style={{fontSize:12,color:'var(--err)',marginTop:8}}>{uploadError}</p>}
        </div>
        <div style={{flex:1,overflowY:'auto'}}>
          {!docs.length
            ? <p style={{textAlign:'center',fontSize:13,color:'var(--fg-4)',padding:'32px 0'}}>No documents yet</p>
            : docs.map(d=>(
              <div key={d.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'11px 14px',borderBottom:'1px solid var(--bd)',transition:'background .1s'}}
                onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-2)'}
                onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
                <Ico.File/>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontSize:13,color:'var(--fg)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.filename}</p>
                  <p style={{fontSize:11,color:'var(--fg-4)',marginTop:2,fontFamily:'JetBrains Mono,monospace'}}>{fmtBytes(d.size_bytes)} · {rel(d.created_at)} ago</p>
                </div>
                <button onClick={()=>onDelete(d.id)} className="btn-ghost-sm" style={{padding:'3px 5px',color:'var(--err)',opacity:0,transition:'opacity .15s'}}
                  onMouseEnter={e=>(e.currentTarget as HTMLElement).style.opacity='1'}
                  onMouseLeave={e=>(e.currentTarget as HTMLElement).style.opacity='0'}><Ico.Trash/></button>
              </div>
            ))
          }
        </div>
        <div style={{padding:'10px 14px',borderTop:'1px solid var(--bd)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <p style={{fontSize:11,color:'var(--fg-4)',fontFamily:'JetBrains Mono,monospace'}}>{docs.length}/20 docs</p>
          <div style={{display:'flex',gap:2}}>
            {Array.from({length:10}).map((_,i)=>(
              <div key={i} style={{width:4,height:4,borderRadius:2,background:i<Math.ceil(docs.length/2)?'var(--g)':'var(--bg-3)',opacity:i<Math.ceil(docs.length/2)?.7:.4}}/>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────
function Toasts({ items, onDismiss }: { items: Toast[]; onDismiss: (id:number)=>void }) {
  return (
    <div style={{position:'fixed',top:16,right:16,zIndex:200,display:'flex',flexDirection:'column',gap:8,pointerEvents:'none'}}>
      {items.map(t=>(
        <div key={t.id} className="toast" style={{display:'flex',alignItems:'center',gap:10,padding:'11px 15px',background:'var(--bg-2)',border:`1px solid ${t.ok?'rgba(74,222,128,.18)':'rgba(248,113,113,.18)'}`,borderRadius:10,boxShadow:'var(--sh-lg)',fontSize:13,color:'var(--fg)',maxWidth:340,pointerEvents:'auto'}}>
          <span style={{color:t.ok?'var(--ok)':'var(--err)',fontSize:12,flexShrink:0}}>{t.ok?'✓':'✕'}</span>
          <span style={{flex:1}}>{t.msg}</span>
          <button onClick={()=>onDismiss(t.id)} className="btn-ghost-sm" style={{padding:'2px 4px',flexShrink:0}}><Ico.X/></button>
        </div>
      ))}
    </div>
  );
}

// ─── IconButton helper ────────────────────────────────────────
function IcoBtn({ children, onClick, title, active, danger }: { children: React.ReactNode; onClick?: ()=>void; title?: string; active?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title} className="btn-ghost-sm"
      style={{padding:'6px 7px',color:danger?'var(--err)':active?'var(--g)':'var(--fg-3)',background:active?'var(--g-dim)':'transparent'}}>
      {children}
    </button>
  );
}

// ─── Feature toggle pill ──────────────────────────────────────
function FeaturePill({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: ()=>void }) {
  return (
    <button onClick={onClick}
      style={{display:'inline-flex',alignItems:'center',gap:5,padding:'5px 10px',borderRadius:20,fontSize:12,fontWeight:500,fontFamily:'Inter,sans-serif',cursor:'pointer',border:`1px solid ${active?'var(--g-bd)':'var(--bd-2)'}`,background:active?'var(--g-dim)':'transparent',color:active?'var(--g-text)':'var(--fg-3)',transition:'all .15s',whiteSpace:'nowrap'}}
      onMouseEnter={e=>{if(!active){(e.currentTarget as HTMLElement).style.background='var(--bg-2)';(e.currentTarget as HTMLElement).style.color='var(--fg-2)';}}}
      onMouseLeave={e=>{if(!active){(e.currentTarget as HTMLElement).style.background='transparent';(e.currentTarget as HTMLElement).style.color='var(--fg-3)';}}}
    >
      {icon} {label}
    </button>
  );
}

// ─── Main ChatShell ───────────────────────────────────────────
export default function ChatShell({ user, initialConversations }: { user: User; initialConversations: Conv[] }) {
  const [convs, setConvs] = useState<Conv[]>(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [abortRef] = useState<{current: AbortController|null}>({current: null});
  const [useSearch, setUseSearch] = useState(false);
  const [useDeep, setUseDeep] = useState(false);
  const [researching, setResearching] = useState(false);
  const [useRag, setUseRag] = useState(true);
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const [titleVal, setTitleVal] = useState('');
  const [loadingConv, setLoadingConv] = useState(false);
  const [convSearch, setConvSearch] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<number,boolean>>({});
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [density, setDensity] = useState<'compact'|'comfortable'>('comfortable');
  const [showStats, setShowStats] = useState(true);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docsOpen, setDocsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string|null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [dragImg, setDragImg] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const [toolList, setToolList] = useState<ToolInfo[]>([]);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [loadedNames, setLoadedNames] = useState<Set<string>>(new Set());
  const [modelDetails, setModelDetails] = useState<Record<string,{parameterSize?:string|null;quantization?:string|null}>>({});
  const [localLive, setLocalLive] = useState<LocalLive|null>(null);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [ctxChoice, setCtxChoice] = useState<number|null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const tts = useTextToSpeech();
  const [autoRead, setAutoRead] = useState(false);
  const speech = useSpeechRecognition();
  const [showExport, setShowExport] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const tid = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const convSearchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const atBottom = useRef(true);

  function toast(msg: string, ok=true) { const id=++tid.current; setToasts(p=>[...p,{id,msg,ok}]); setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),4000); }
  function onScroll() { const el=scrollRef.current; if(el) atBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<100; }
  useEffect(()=>{ if(atBottom.current) endRef.current?.scrollIntoView({behavior:'smooth'}); },[msgs]);
  useEffect(()=>{
    const update=()=>{ const d=window.innerWidth>=768; setIsDesktop(d); };
    update();
    if(window.innerWidth>=768) setSidebarOpen(true);
    window.addEventListener('resize',update);
    return()=>window.removeEventListener('resize',update);
  },[]);
  useEffect(()=>{ fetch('/api/documents').then(r=>r.json()).then((d:Doc[])=>setDocs(Array.isArray(d)?d:[])).catch(()=>{}); },[]);
  useEffect(()=>{ fetch('/api/prompts').then(r=>r.json()).then((p:Prompt[])=>setPrompts(Array.isArray(p)?p:[])).catch(()=>{}); },[]);
  useEffect(()=>{ fetch('/api/folders').then(r=>r.json()).then((f:Folder[])=>setFolders(Array.isArray(f)?f:[])).catch(()=>{}); },[]);
  useEffect(()=>{ fetch('/api/tools').then(r=>r.json()).then((t:ToolInfo[])=>setToolList(Array.isArray(t)?t:[])).catch(()=>{}); },[]);
  useEffect(()=>{ refreshLoaded(); refreshLocal(); // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{ const c=localStorage.getItem('chakor-context-size'); if(c) setCtxChoice(Number(c)||null); },[]);
  useEffect(()=>{ if(ctxChoice) localStorage.setItem('chakor-context-size',String(ctxChoice)); else localStorage.removeItem('chakor-context-size'); },[ctxChoice]);
  useEffect(()=>{
    fetch('/api/models').then(r=>r.json()).then((ms:Model[])=>{
      if(!Array.isArray(ms)) return;
      setModels(ms);
      const saved=localStorage.getItem('chakor-selected-model');
      setModelId(ms.find(m=>m.id===saved)?.id??ms[0]?.id??'');
    }).catch(()=>{});
  },[]);
  useEffect(()=>{ if(modelId) localStorage.setItem('chakor-selected-model',modelId); },[modelId]);
  useEffect(()=>{
    const d=localStorage.getItem('chakor-density') as typeof density|null; if(d) setDensity(d);
    setAutoRead(localStorage.getItem('chakor-auto-read')==='true');
    const tc=localStorage.getItem('chakor-show-token-count'); setShowStats(tc===null?true:tc==='true');
  },[]);
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{
      const meta=e.metaKey||e.ctrlKey;
      if(e.key==='Escape'){if(showExport){setShowExport(false);return;}if(streaming){abortRef.current?.abort();return;}}
      if(meta&&e.key==='k'){e.preventDefault();convSearchRef.current?.focus();}
      if(meta&&e.key==='n'){e.preventDefault();startNew();}
    };
    window.addEventListener('keydown',h); return()=>window.removeEventListener('keydown',h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[streaming,showExport]);
  useEffect(()=>{
    if(speech.transcript){ setInput(p=>{const b=p.replace(speech.interimTranscript,'').trimEnd(); return b+(b?' ':'')+speech.transcript;}); speech.reset(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[speech.transcript]);

  const curConv = convs.find(c=>c.id===activeId)??null;
  const filtered = useMemo(()=>convSearch.trim()?convs.filter(c=>c.title.toLowerCase().includes(convSearch.toLowerCase())):[],[convs,convSearch]);
  const visibleConvs = useMemo(()=>convs.filter(c=>!c.archived),[convs]);
  const pinnedConvs = useMemo(()=>visibleConvs.filter(c=>c.pinned),[visibleConvs]);
  const archivedConvs = useMemo(()=>convs.filter(c=>c.archived),[convs]);
  const unfiled = useMemo(()=>visibleConvs.filter(c=>!c.pinned&&c.folder_id==null),[visibleConvs]);
  const grouped = useMemo(()=>convSearch.trim()?null:groupConvs(unfiled),[unfiled,convSearch]);
  const ragActive = useRag && docs.length > 0;
  const userInits = inits(user.name);
  const curModel = models.find(m=>m.id===modelId);
  // For the local model, trust what llama-server actually reports about itself
  // (so switching to a vision GGUF lights up image attach without a config flag).
  const visionOk = curModel?.provider==='llama' ? (localLive?.vision ?? !!curModel?.vision) : !!curModel?.vision;
  const toolsOk = !!curModel && ['openai','openrouter','ollama','lmstudio','llama'].includes(curModel.provider);
  const canSend = input.trim().length>0 || images.length>0;

  const loadConv = useCallback(async(id:string)=>{
    if(window.innerWidth<768) setSidebarOpen(false);
    setLoadingConv(true); setMsgs([]); setActiveId(id);
    try {
      const r=await fetch(`/api/conversations/${id}`);
      if(r.ok){const d=await r.json(); setMsgs((d.messages as {id:number;role:string;content:string;images?:string[]}[]).filter(m=>m.role==='user'||m.role==='assistant').map(m=>({role:m.role as 'user'|'assistant',content:m.content,dbId:m.id,images:m.images}))); setTitleVal(d.title);}
    } finally { setLoadingConv(false); }
  },[]);

  function startNew() { if(window.innerWidth<768)setSidebarOpen(false); setActiveId(null); setMsgs([]); setTitleVal(''); setEditTitle(false); taRef.current?.focus(); }
  async function deleteConv(id:string,e:React.MouseEvent) { e.stopPropagation(); await fetch(`/api/conversations/${id}`,{method:'DELETE'}); setConvs(p=>p.filter(c=>c.id!==id)); if(activeId===id) startNew(); }
  async function patchConv(id:string, patch:Record<string,unknown>) { try { await fetch(`/api/conversations/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}); } catch {} }
  function togglePin(c:Conv) { const v=c.pinned?0:1; setConvs(p=>p.map(x=>x.id===c.id?{...x,pinned:v}:x)); patchConv(c.id,{pinned:!!v}); }
  function toggleArchive(c:Conv) { const v=c.archived?0:1; setConvs(p=>p.map(x=>x.id===c.id?{...x,archived:v}:x)); patchConv(c.id,{archived:!!v}); if(activeId===c.id&&v) startNew(); }
  function moveToFolder(c:Conv, folderId:number|null) { setConvs(p=>p.map(x=>x.id===c.id?{...x,folder_id:folderId}:x)); patchConv(c.id,{folderId}); }
  async function createFolderSubmit() { const name=newFolderName.trim(); if(!name)return; try { const r=await fetch('/api/folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}); if(r.ok){const f=await r.json(); setFolders(p=>[...p,f]); setNewFolderName(''); setNewFolderOpen(false); toast('Folder created');} else toast('Could not create folder',false); } catch { toast('Network error',false); } }
  async function deleteFolderUI(id:number) { await fetch(`/api/folders/${id}`,{method:'DELETE'}).catch(()=>{}); setFolders(p=>p.filter(f=>f.id!==id)); setConvs(p=>p.map(c=>c.folder_id===id?{...c,folder_id:null}:c)); }
  async function refreshLoaded() { try { const r=await fetch('/api/models/loaded'); const d=await r.json(); if(Array.isArray(d.models)) setLoadedNames(new Set((d.models as {name:string}[]).map(m=>m.name))); } catch {} }
  async function refreshLocal() { try { const r=await fetch('/api/models/local'); if(r.ok){ const d=await r.json(); if(d?.live) setLocalLive(d.live); } } catch {} }
  async function refreshEngines() { try { const r=await fetch('/api/system'); if(r.ok){ const d=await r.json(); if(Array.isArray(d.engines)) setEngines(d.engines); } } catch {} }
  async function fetchModelDetails(names:string[]) {
    const missing=names.filter(n=>!(n in modelDetails));
    if(!missing.length) return;
    const entries=await Promise.all(missing.map(async n=>{ try { const r=await fetch('/api/models/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})}); if(!r.ok) return [n,{}] as const; const d=await r.json(); return [n,{parameterSize:d.parameterSize,quantization:d.quantization}] as const; } catch { return [n,{}] as const; } }));
    setModelDetails(p=>{const next={...p}; for(const [n,d] of entries) next[n]=d; return next;});
  }
  function onModelMenuOpen(open:boolean) { if(open){ refreshLoaded(); refreshLocal(); refreshEngines(); fetchModelDetails(models.filter(m=>m.provider==='ollama').map(m=>m.name)); } }
  async function toggleLoad(name:string, loaded:boolean) {
    toast(loaded?`Unloading ${name}…`:`Loading ${name}…`);
    try { const r=await fetch('/api/models/loaded',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,action:loaded?'unload':'load'})}); const d=await r.json(); if(!r.ok) toast(d.error??'Failed',false); else toast(loaded?`Unloaded ${name}`:`Loaded ${name}`); } catch { toast('Network error',false); }
    refreshLoaded();
  }
  async function saveTitle() { if(!activeId||!titleVal.trim()){setEditTitle(false);return;} const t=titleVal.trim().slice(0,100); await fetch(`/api/conversations/${activeId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t})}); setConvs(p=>p.map(c=>c.id===activeId?{...c,title:t}:c)); setEditTitle(false); }
  async function refreshTitle(id:string) { const r=await fetch(`/api/conversations/${id}`); if(!r.ok) return; const d=await r.json(); setConvs(p=>p.map(c=>c.id===id?{...c,title:d.title,updated_at:d.updated_at}:c)); if(activeId===id) setTitleVal(d.title); }
  async function handleEdit(idx:number) { const m=msgs[idx]; if(!m||m.role!=='user') return; if(activeId&&m.dbId) await fetch(`/api/conversations/${activeId}/truncate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fromMessageId:m.dbId})}); setMsgs(p=>p.slice(0,idx)); setInput(m.content); taRef.current?.focus(); }
  async function handleRegen(idx:number) { const am=msgs[idx]; if(!am||am.role!=='assistant') return; if(activeId&&am.dbId) await fetch(`/api/conversations/${activeId}/truncate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fromMessageId:am.dbId})}); const prior=msgs.slice(0,idx); const lastUser=[...prior].reverse().find(m=>m.role==='user'); if(!lastUser) return; setMsgs(prior); await sendMsg(lastUser.content,prior,lastUser.images); }
  async function uploadDoc(file:File) { setUploading(true); setUploadErr(null); try { const form=new FormData(); form.append('file',file); const r=await fetch('/api/documents',{method:'POST',body:form}); const d=await r.json(); if(!r.ok){setUploadErr(d.error??'Upload failed');return;} const list=await(await fetch('/api/documents')).json(); setDocs(Array.isArray(list)?list:[]); toast('Document uploaded'); } catch { setUploadErr('Network error.'); } finally { setUploading(false); } }
  async function deleteDoc(id:number) { await fetch(`/api/documents/${id}`,{method:'DELETE'}); setDocs(p=>p.filter(d=>d.id!==id)); }
  function exportConv(fmt:'md'|'json') { const title=curConv?.title??'conversation'; const safe=title.replace(/[^a-z0-9]/gi,'-').toLowerCase(); const content=fmt==='md'?`# ${title}\n\n${toMd(msgs)}`:JSON.stringify({title,messages:msgs},null,2); const blob=new Blob([content],{type:fmt==='md'?'text/markdown':'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`${safe}.${fmt}`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); setShowExport(false); }
  async function shareConv() { if(!activeId) return; try { const r=await fetch(`/api/conversations/${activeId}/share`,{method:'POST'}); const d=await r.json(); if(!r.ok) return; await navigator.clipboard.writeText(`${window.location.origin}/share/${d.slug}`); toast('Share link copied'); } catch { toast('Failed to share',false); } }

  async function savePrompt() {
    const body=input.trim(); if(!body){toast('Type something to save first',false);return;}
    const title=(body.split('\n')[0]||'Prompt').slice(0,60);
    try { const r=await fetch('/api/prompts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,body})}); const d=await r.json(); if(r.ok){setPrompts(p=>[d,...p]);toast('Prompt saved');} else toast(d.error??'Failed to save',false); } catch { toast('Network error',false); }
  }
  async function deletePrompt(id:number) { await fetch(`/api/prompts/${id}`,{method:'DELETE'}); setPrompts(p=>p.filter(x=>x.id!==id)); }
  function usePrompt(body:string) { setInput(prev=>prev.trim()?prev.replace(/\s*$/,'')+'\n'+body:body); setPromptsOpen(false); requestAnimationFrame(()=>{const el=taRef.current;if(el){el.focus();el.style.height='auto';el.style.height=Math.min(el.scrollHeight,180)+'px';}}); }
  async function importConv(file:File) {
    try { const data=JSON.parse(await file.text()); const r=await fetch('/api/conversations/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); const conv=await r.json(); if(!r.ok){toast(conv.error??'Import failed',false);return;} setConvs(p=>[conv,...p]); toast('Conversation imported'); loadConv(conv.id); } catch { toast('Could not read that file',false); }
  }

  // Resize to <=1536px and re-encode as JPEG so we are not stuffing huge base64
  // blobs into SQLite. Falls back to the raw file if the canvas path is blocked.
  async function fileToDataUrl(file:File):Promise<string> {
    try {
      const bitmap=await createImageBitmap(file);
      const max=1536; let {width,height}=bitmap;
      if(width>max||height>max){const s=Math.min(max/width,max/height);width=Math.round(width*s);height=Math.round(height*s);}
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('no canvas');
      ctx.drawImage(bitmap,0,0,width,height); bitmap.close?.();
      return canvas.toDataURL('image/jpeg',0.85);
    } catch {
      return await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result as string);fr.onerror=rej;fr.readAsDataURL(file);});
    }
  }
  async function addImages(files:FileList|File[]) {
    const arr=Array.from(files).filter(f=>f.type.startsWith('image/'));
    if(!arr.length) return;
    const room=4-images.length;
    if(room<=0){toast('Up to 4 images per message',false);return;}
    for(const f of arr.slice(0,room)){
      if(f.size>12*1024*1024){toast('Image too big (max 12 MB)',false);continue;}
      try{const url=await fileToDataUrl(f);setImages(p=>p.length<4?[...p,url]:p);}catch{toast('Could not read that image',false);}
    }
  }

  async function sendMsg(text:string, priorOverride?:Msg[], imagesArg?:string[]) {
    const imgs=imagesArg??[];
    if((!text.trim()&&imgs.length===0)||streaming) return;
    atBottom.current=true;
    const isFirst=(priorOverride??msgs).length===0;
    if(useDeep) setResearching(true);
    setMsgs(p=>[...(priorOverride??p),{role:'user',content:text,images:imgs.length?imgs:undefined},{role:'assistant',content:'',streaming:true}]);
    setStreaming(true);
    const ctrl=new AbortController(); abortRef.current=ctrl; let acc=''; let resolvedId:string|null=activeId;
    try {
      const ctxToSend = curModel?.provider==='llama' ? (localLive?.nCtx ?? undefined) : (ctxChoice ?? undefined);
      const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:activeId||undefined,message:text,useSearch:useSearch&&!useDeep,useDeepResearch:useDeep,useRag:ragActive,modelId:modelId||undefined,images:imgs.length?imgs:undefined,tools:toolIds.length?toolIds:undefined,contextSize:ctxToSend}),signal:ctrl.signal});
      setResearching(false); if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const newId=r.headers.get('X-Conversation-Id');
      if(newId&&!activeId){resolvedId=newId;setActiveId(newId);setConvs(p=>[{id:newId,title:'New conversation',model:modelId||'chakor',created_at:Math.floor(Date.now()/1000),updated_at:Math.floor(Date.now()/1000)},...p]);}
      const reader=r.body!.getReader(); const dec=new TextDecoder(); let buf='';
      outer:while(true){const{done,value}=await reader.read(); if(done) break; buf+=dec.decode(value,{stream:true}); const parts=buf.split('\n\n'); buf=parts.pop()??'';
        for(const part of parts){const line=part.trim(); if(!line.startsWith('data:')) continue; const data=line.slice(5).trim(); if(data==='[DONE]') break outer;
          try{const p=JSON.parse(data) as {delta?:string;sources?:Source[];stats?:Stats;userMsgId?:number;assistantMsgId?:number;toolEvent?:ToolEvt};
            if(p.userMsgId) setMsgs(prev=>{const u=[...prev];const i=u.length-2;if(i>=0&&u[i].role==='user')u[i]={...u[i],dbId:p.userMsgId};return u;});
            if(p.assistantMsgId) setMsgs(prev=>{const u=[...prev];u[u.length-1]={...u[u.length-1],dbId:p.assistantMsgId};return u;});
            if(p.sources) setMsgs(prev=>{const u=[...prev];u[u.length-1]={...u[u.length-1],sources:p.sources};return u;});
            if(p.stats) setMsgs(prev=>{const u=[...prev];u[u.length-1]={...u[u.length-1],stats:p.stats};return u;});
            if(p.toolEvent) setMsgs(prev=>{const u=[...prev];const last=u[u.length-1];u[u.length-1]={...last,toolEvents:[...(last.toolEvents??[]),p.toolEvent!]};return u;});
            if(p.delta){acc+=p.delta;setMsgs(prev=>{const u=[...prev];u[u.length-1]={...u[u.length-1],content:acc,streaming:true};return u;});}
          }catch{}
        }
      }
    } catch(err) {
      setResearching(false);
      if(!(err instanceof Error&&err.name==='AbortError')) setMsgs(p=>{const u=[...p];u[u.length-1]={role:'assistant',content:acc||'*Connection error. Please try again.*'};return u;});
    } finally {
      abortRef.current=null; setStreaming(false); setResearching(false);
      setMsgs(p=>{const u=[...p];if(u.length>0)u[u.length-1]={...u[u.length-1],streaming:false};return u;});
      if(isFirst&&resolvedId) setTimeout(()=>refreshTitle(resolvedId!),1500);
      if(autoRead&&tts.supported&&acc) tts.speak(acc,msgs.length.toString());
    }
  }

  async function handleSend() { const text=input.trim(); if((!text&&images.length===0)||streaming) return; const imgs=images; setInput(''); setImages([]); if(taRef.current) taRef.current.style.height='auto'; await sendMsg(text,undefined,imgs); }

  const renderItem = (c:Conv)=>(
    <ConvItem key={c.id} conv={c} active={activeId===c.id} folders={folders}
      onClick={()=>loadConv(c.id)} onDelete={e=>deleteConv(c.id,e)}
      onPin={()=>togglePin(c)} onArchive={()=>toggleArchive(c)} onMove={fid=>moveToFolder(c,fid)}/>
  );

  return (
    <div style={{display:'flex',height:'100vh',overflow:'hidden',background:'var(--bg)',fontFamily:'Inter,sans-serif'}}>
      <Toasts items={toasts} onDismiss={id=>setToasts(p=>p.filter(t=>t.id!==id))}/>

      {/* Mobile overlay */}
      {sidebarOpen && <div style={{position:'fixed',inset:0,zIndex:20,background:'rgba(0,0,0,0.55)'}} className="md:hidden" onClick={()=>setSidebarOpen(false)}/>}

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside style={{
        width:260,flexShrink:0,display:'flex',flexDirection:'column',
        background:'var(--bg-1)',borderRight:'1px solid var(--bd)',
        position:'fixed',top:0,bottom:0,left:0,zIndex:30,
        transform:sidebarOpen?'translateX(0)':'translateX(-100%)',
        transition:'transform .25s ease',
      }}>
        {/* Logo */}
        <div style={{padding:'18px 14px 12px',borderBottom:'1px solid var(--bd)',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
            <div className="chakor-mark"><ChakorMark size={24}/></div>
            <span style={{fontWeight:800,fontSize:15,letterSpacing:'0.06em',color:'var(--fg)'}}>{APP.name.toUpperCase()}</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <div className="status-dot"/>
            <span style={{fontSize:11,color:'var(--fg-4)',fontFamily:'JetBrains Mono,monospace',letterSpacing:'0.04em'}}>online · private · self-hosted</span>
          </div>
        </div>

        {/* New chat */}
        <div style={{padding:'10px 10px 2px',flexShrink:0}}>
          <button onClick={startNew} className="btn-ghost-sm" style={{width:'100%',justifyContent:'flex-start',gap:8,padding:'9px 12px',borderRadius:7,border:'1px solid var(--bd-2)',color:'var(--fg-2)'}}>
            <Ico.Edit/> New conversation
          </button>
          <button onClick={()=>importRef.current?.click()} className="btn-ghost-sm" style={{width:'100%',justifyContent:'flex-start',gap:8,padding:'6px 12px',marginTop:4,fontSize:12,color:'var(--fg-4)'}}>
            <Ico.Up/> Import conversation
          </button>
          <input ref={importRef} type="file" accept=".json,application/json" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0]; if(f) importConv(f); e.currentTarget.value='';}}/>
          <Link href="/compare" className="btn-ghost-sm" style={{display:'flex',width:'100%',justifyContent:'flex-start',gap:8,padding:'6px 12px',marginTop:4,fontSize:12,color:'var(--fg-4)',textDecoration:'none'}}>
            <Ico.Compare/> Compare models
          </Link>
          <Link href="/notes" className="btn-ghost-sm" style={{display:'flex',width:'100%',justifyContent:'flex-start',gap:8,padding:'6px 12px',marginTop:2,fontSize:12,color:'var(--fg-4)',textDecoration:'none'}}>
            <Ico.Note/> Notes
          </Link>
          <Link href="/memory" className="btn-ghost-sm" style={{display:'flex',width:'100%',justifyContent:'flex-start',gap:8,padding:'6px 12px',marginTop:2,fontSize:12,color:'var(--fg-4)',textDecoration:'none'}}>
            <Ico.Memory/> Memory
          </Link>
        </div>

        {/* Search */}
        <div style={{padding:'4px 10px 6px',flexShrink:0}}>
          <div style={{position:'relative'}}>
            <svg style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--fg-4)',pointerEvents:'none'}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input ref={convSearchRef} value={convSearch} onChange={e=>setConvSearch(e.target.value)} placeholder="Search…"
              style={{width:'100%',background:'var(--bg-2)',border:'1px solid var(--bd)',borderRadius:7,color:'var(--fg)',fontFamily:'Inter,sans-serif',fontSize:13,padding:'7px 10px 7px 30px',outline:'none',transition:'border-color .15s'}}
              onFocus={e=>(e.target.style.borderColor='var(--bd-2)')} onBlur={e=>(e.target.style.borderColor='var(--bd)')}/>
          </div>
        </div>

        {/* Conversations */}
        <div style={{flex:1,overflowY:'auto'}} className="conv-fade">
          {convSearch.trim() ? (
            filtered.length
              ? filtered.map(renderItem)
              : <p style={{textAlign:'center',fontSize:13,color:'var(--fg-4)',padding:'28px 16px'}}>No matches</p>
          ) : (
            <>
              {/* Folders */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px 2px'}}>
                <span style={{fontSize:10,fontWeight:600,color:'var(--fg-4)',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:'JetBrains Mono,monospace'}}>Folders</span>
                <button onClick={()=>setNewFolderOpen(o=>!o)} className="btn-ghost-sm" style={{padding:'2px 5px'}} title="New folder"><Ico.FolderPlus/></button>
              </div>
              {newFolderOpen && (
                <div style={{padding:'2px 12px 6px'}}>
                  <input autoFocus value={newFolderName} onChange={e=>setNewFolderName(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter')createFolderSubmit();if(e.key==='Escape'){setNewFolderOpen(false);setNewFolderName('');}}}
                    placeholder="Folder name, Enter to add"
                    style={{width:'100%',background:'var(--bg-2)',border:'1px solid var(--bd-2)',borderRadius:6,color:'var(--fg)',fontFamily:'Inter,sans-serif',fontSize:12.5,padding:'6px 9px',outline:'none'}}/>
                </div>
              )}
              {folders.map(f=>{
                const fc=visibleConvs.filter(c=>c.folder_id===f.id&&!c.pinned);
                const open=!collapsed[f.id];
                return (
                  <div key={f.id}>
                    <div className="conv-item" style={{color:'var(--fg-3)'}}
                      onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-2)'}
                      onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
                      <button onClick={()=>setCollapsed(p=>({...p,[f.id]:!p[f.id]}))} className="btn-ghost-sm" style={{padding:'2px',flexShrink:0,color:'var(--fg-4)'}}>
                        <span style={{display:'inline-flex',transform:open?'rotate(0deg)':'rotate(-90deg)',transition:'transform .12s'}}><Ico.Down/></span>
                      </button>
                      <Ico.Folder/>
                      <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:13,marginLeft:2}}>{f.name}</span>
                      <span style={{fontSize:10.5,color:'var(--fg-4)',fontFamily:'JetBrains Mono,monospace'}}>{fc.length||''}</span>
                      <button onClick={()=>{if(window.confirm(`Delete folder "${f.name}"? The chats inside move out, they are not deleted.`))deleteFolderUI(f.id);}} className="btn-ghost-sm" style={{padding:'2px 4px',color:'var(--err)',opacity:0,flexShrink:0}}
                        onMouseEnter={e=>(e.currentTarget as HTMLElement).style.opacity='1'} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.opacity='0'} title="Delete folder"><Ico.Trash/></button>
                    </div>
                    {open && fc.map(renderItem)}
                    {open && fc.length===0 && <p style={{padding:'2px 14px 6px 34px',fontSize:11.5,color:'var(--fg-4)'}}>Empty</p>}
                  </div>
                );
              })}

              {/* Pinned */}
              {pinnedConvs.length>0 && (
                <div>
                  <div style={{padding:'12px 14px 4px',fontSize:10,fontWeight:600,color:'var(--fg-4)',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:'JetBrains Mono,monospace'}}>Pinned</div>
                  {pinnedConvs.map(renderItem)}
                </div>
              )}

              {/* Time-grouped, unfiled */}
              {grouped?.map(g=>(
                <div key={g.l}>
                  <div style={{padding:'12px 14px 4px',fontSize:10,fontWeight:600,color:'var(--fg-4)',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:'JetBrains Mono,monospace'}}>{g.l}</div>
                  {g.i.map(renderItem)}
                </div>
              ))}

              {/* Archived */}
              {archivedConvs.length>0 && (
                <div>
                  <button onClick={()=>setShowArchived(s=>!s)} className="btn-ghost-sm" style={{width:'100%',justifyContent:'flex-start',gap:6,padding:'12px 14px 6px',fontSize:10,fontWeight:600,color:'var(--fg-4)',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:'JetBrains Mono,monospace'}}>
                    <span style={{display:'inline-flex',transform:showArchived?'rotate(0deg)':'rotate(-90deg)',transition:'transform .12s'}}><Ico.Down/></span> Archived ({archivedConvs.length})
                  </button>
                  {showArchived && archivedConvs.map(renderItem)}
                </div>
              )}

              {convs.length===0 && (
                <p style={{textAlign:'center',fontSize:13,color:'var(--fg-4)',padding:'32px 16px'}}>No conversations yet.<br/>Start one below.</p>
              )}
            </>
          )}
        </div>

        {/* User */}
        <div style={{borderTop:'1px solid var(--bd)',padding:'12px 12px',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:9}}>
            <div style={{width:28,height:28,borderRadius:'50%',background:'var(--bg-3)',border:'1px solid var(--bd-2)',color:'var(--fg-3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,flexShrink:0}}>{userInits}</div>
            <div style={{flex:1,minWidth:0}}>
              <p style={{fontSize:13,fontWeight:500,color:'var(--fg)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{user.name??user.email??'User'}</p>
              <div style={{display:'flex',gap:8,marginTop:2}}>
                {user.isAdmin&&<Link href="/admin" style={{fontSize:11,color:'var(--g-text)',textDecoration:'none',fontFamily:'JetBrains Mono,monospace'}}>admin</Link>}
                <Link href="/settings" style={{fontSize:11,color:'var(--fg-4)',textDecoration:'none'}}>settings</Link>
                <button onClick={()=>setThemeOpen(true)} style={{fontSize:11,color:'var(--fg-4)',background:'none',border:'none',cursor:'pointer',padding:0,fontFamily:'Inter,sans-serif'}}>theme</button>
              </div>
            </div>
            <button onClick={()=>signOut({callbackUrl:'/login'})} className="btn-ghost-sm" style={{padding:'5px 6px',flexShrink:0}} title="Sign out"><Ico.Logout/></button>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,overflow:'hidden',marginLeft:(isDesktop&&sidebarOpen)?260:0,transition:'margin-left .25s ease'}}>

        {/* Header */}
        <header style={{display:'flex',alignItems:'center',gap:8,padding:'0 16px',height:52,borderBottom:'1px solid var(--bd)',background:'var(--bg)',flexShrink:0}}>
          <button onClick={()=>setSidebarOpen(o=>!o)} className="btn-ghost-sm" style={{padding:'6px 7px',marginLeft:-4,flexShrink:0}}><Ico.Menu/></button>

          <div style={{flex:1,minWidth:0,overflow:'hidden',marginRight:8}}>
            {activeId
              ? editTitle
                ? <input value={titleVal} onChange={e=>setTitleVal(e.target.value)} onBlur={saveTitle}
                    onKeyDown={e=>{if(e.key==='Enter')saveTitle();if(e.key==='Escape')setEditTitle(false);}}
                    style={{fontSize:14,fontWeight:500,background:'transparent',border:'none',borderBottom:'1px solid var(--bd-2)',color:'var(--fg)',outline:'none',width:'100%',maxWidth:360,padding:'2px 0',fontFamily:'Inter,sans-serif'}} autoFocus/>
                : <button onClick={()=>{setEditTitle(true);setTitleVal(curConv?.title??'');}}
                    style={{fontSize:14,fontWeight:500,color:'var(--fg)',background:'none',border:'none',cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:360,display:'block',textAlign:'left',fontFamily:'Inter,sans-serif',opacity:.9,padding:0}}
                    onMouseEnter={e=>(e.currentTarget as HTMLElement).style.opacity='0.65'}
                    onMouseLeave={e=>(e.currentTarget as HTMLElement).style.opacity='0.9'}>
                    {curConv?.title??'New conversation'}
                  </button>
              : <span style={{fontSize:14,color:'var(--fg-3)'}}>New conversation</span>
            }
          </div>

          <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
            <ModelSelect models={models} selected={modelId} onChange={setModelId}
              loadedNames={loadedNames} details={modelDetails} isAdmin={!!user.isAdmin}
              onToggleLoad={toggleLoad} onOpenChange={onModelMenuOpen} localName={localLive?.modelName} engines={engines}/>
            <ContextControl model={curModel} localLive={localLive} isAdmin={!!user.isAdmin}
              ctxChoice={ctxChoice} onChoose={setCtxChoice}/>
            {activeId&&msgs.length>0&&(
              <>
                <div style={{position:'relative'}}>
                  <IcoBtn onClick={()=>setShowExport(o=>!o)} title="Export"><Ico.Dl/></IcoBtn>
                  {showExport&&(
                    <div className="anim-scale-in" style={{position:'absolute',right:0,top:'100%',marginTop:6,zIndex:50,background:'var(--bg-2)',border:'1px solid var(--bd-2)',borderRadius:8,boxShadow:'var(--sh-lg)',overflow:'hidden',minWidth:150}}>
                      {['md','json'].map(f=>(
                        <button key={f} onClick={()=>exportConv(f as 'md'|'json')} className="btn-ghost-sm"
                          style={{width:'100%',padding:'9px 14px',justifyContent:'flex-start',borderRadius:0,fontSize:13}}>
                          <Ico.Dl/> Export .{f}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <IcoBtn onClick={shareConv} title="Share"><Ico.Share/></IcoBtn>
              </>
            )}
          </div>
        </header>

        {/* Research indicator */}
        {researching&&(
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 20px',background:'rgba(34,197,94,0.05)',borderBottom:'1px solid var(--g-bd)',fontSize:13,color:'var(--g-text)',flexShrink:0}}>
            <Typing/> Researching across multiple sources…
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} onScroll={onScroll} style={{flex:1,overflowY:'auto'}}>
          <div style={{maxWidth:740,margin:'0 auto',padding:'28px 20px'}}>
            {!activeId&&msgs.length===0&&<Welcome name={user.name} onSelect={setInput} taRef={taRef}/>}
            {loadingConv&&msgs.length===0&&(
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12,padding:'60px 0'}}>
                <Typing/><p style={{fontSize:13,color:'var(--fg-4)'}}>Loading…</p>
              </div>
            )}
            {msgs.map((m,i)=>(
              <MsgBubble key={i} msg={{...m,id:m.dbId?.toString()}}
                onEdit={m.role==='user'&&!streaming?()=>handleEdit(i):undefined}
                onRegen={m.role==='assistant'&&!streaming&&i===msgs.length-1?()=>handleRegen(i):undefined}
                tts={tts} density={density} showStats={showStats} userInits={userInits}/>
            ))}
            <div ref={endRef}/>
          </div>
        </div>

        {/* Input */}
        <div style={{flexShrink:0,padding:'10px 16px 14px',background:'var(--bg)'}}>
          <div style={{maxWidth:740,margin:'0 auto'}}>
            {speech.listening&&speech.interimTranscript&&(
              <div style={{background:'var(--bg-2)',border:'1px solid var(--bd-2)',borderRadius:8,padding:'8px 12px',marginBottom:8,fontSize:13,color:'var(--fg-3)'}}>
                {speech.interimTranscript}
              </div>
            )}

            {toolsOpen&&(
              <div className="anim-scale-in" style={{marginBottom:8,background:'var(--bg-1)',border:'1px solid var(--bd-2)',borderRadius:12,boxShadow:'var(--sh-lg)',overflow:'hidden'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderBottom:'1px solid var(--bd)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <Ico.Tool/><span style={{fontSize:13,fontWeight:600,color:'var(--fg)'}}>Tools</span>
                  </div>
                  <span style={{fontSize:11,color:'var(--fg-4)'}}>{toolIds.length} on</span>
                </div>
                <div style={{maxHeight:230,overflowY:'auto'}}>
                  {toolList.length===0
                    ? <p style={{textAlign:'center',fontSize:13,color:'var(--fg-4)',padding:'18px 0'}}>No tools available.</p>
                    : toolList.map(t=>{
                        const on=toolIds.includes(t.name);
                        return (
                          <button key={t.name} onClick={()=>setToolIds(p=>p.includes(t.name)?p.filter(x=>x!==t.name):[...p,t.name])}
                            style={{display:'flex',alignItems:'flex-start',gap:10,width:'100%',textAlign:'left',padding:'10px 14px',borderBottom:'1px solid var(--bd)',background:'transparent',border:'none',cursor:'pointer',fontFamily:'Inter,sans-serif'}}
                            onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-2)'}
                            onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
                            <span style={{marginTop:1,width:16,height:16,borderRadius:4,border:`1.5px solid ${on?'var(--g)':'var(--bd-2)'}`,background:on?'var(--g)':'transparent',color:'#04100a',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{on&&<Ico.Check/>}</span>
                            <span style={{flex:1,minWidth:0}}>
                              <span style={{display:'block',fontSize:13,color:'var(--fg)',fontFamily:'JetBrains Mono,monospace'}}>{t.name}</span>
                              <span style={{display:'block',fontSize:11.5,color:'var(--fg-4)',marginTop:2,lineHeight:1.4}}>{t.description}</span>
                            </span>
                          </button>
                        );
                      })
                  }
                </div>
                <div style={{padding:'8px 14px',borderTop:'1px solid var(--bd)',fontSize:11,color:'var(--fg-4)'}}>Works with OpenAI, OpenRouter, Ollama and local models.</div>
              </div>
            )}

            {promptsOpen&&(
              <div className="anim-scale-in" style={{marginBottom:8,background:'var(--bg-1)',border:'1px solid var(--bd-2)',borderRadius:12,boxShadow:'var(--sh-lg)',overflow:'hidden'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderBottom:'1px solid var(--bd)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <Ico.Book/><span style={{fontSize:13,fontWeight:600,color:'var(--fg)'}}>Prompt library</span>
                  </div>
                  <button onClick={savePrompt} disabled={!input.trim()} className="btn-ghost-sm" style={{fontSize:12,padding:'4px 8px',color:input.trim()?'var(--g-text)':'var(--fg-4)',cursor:input.trim()?'pointer':'default'}}>+ Save current</button>
                </div>
                <div style={{maxHeight:220,overflowY:'auto'}}>
                  {prompts.length===0
                    ? <p style={{textAlign:'center',fontSize:13,color:'var(--fg-4)',padding:'22px 0'}}>No saved prompts yet.<br/>Type a message, then hit Save.</p>
                    : prompts.map(p=>(
                      <div key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderBottom:'1px solid var(--bd)',transition:'background .1s'}}
                        onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-2)'}
                        onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
                        <button onClick={()=>usePrompt(p.body)} style={{flex:1,minWidth:0,textAlign:'left',background:'none',border:'none',cursor:'pointer',fontFamily:'Inter,sans-serif',padding:0}}>
                          <p style={{fontSize:13,color:'var(--fg)',margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.title}</p>
                          <p style={{fontSize:11,color:'var(--fg-4)',margin:'2px 0 0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.body.slice(0,90)}</p>
                        </button>
                        <button onClick={()=>deletePrompt(p.id)} className="btn-ghost-sm" style={{padding:'4px 6px',color:'var(--err)',flexShrink:0}} title="Delete prompt"><Ico.Trash/></button>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            <div style={{background:'var(--bg-2)',border:`1px solid ${dragImg?'var(--g)':'var(--bd-2)'}`,borderRadius:12,transition:'border-color .15s, box-shadow .15s'}}
              onFocusCapture={e=>{ const el=e.currentTarget as HTMLElement; el.style.borderColor='rgba(34,197,94,0.3)'; el.style.boxShadow='0 0 0 3px rgba(34,197,94,0.06)'; }}
              onBlurCapture={e=>{ const el=e.currentTarget as HTMLElement; el.style.borderColor='var(--bd-2)'; el.style.boxShadow='none'; }}
              onDragOver={e=>{if(visionOk){e.preventDefault();setDragImg(true);}}}
              onDragLeave={()=>setDragImg(false)}
              onDrop={e=>{setDragImg(false);if(visionOk&&e.dataTransfer.files.length){e.preventDefault();addImages(e.dataTransfer.files);}}}>
              {images.length>0&&(
                <div style={{display:'flex',gap:8,flexWrap:'wrap',padding:'12px 14px 0'}}>
                  {images.map((src,i)=>(
                    <div key={i} style={{position:'relative',width:54,height:54,borderRadius:8,overflow:'hidden',border:'1px solid var(--bd-2)',flexShrink:0}}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                      <button onClick={()=>setImages(p=>p.filter((_,j)=>j!==i))} title="Remove"
                        style={{position:'absolute',top:2,right:2,width:16,height:16,borderRadius:'50%',background:'rgba(0,0,0,0.6)',color:'#fff',border:'none',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0}}><Ico.X/></button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{padding:'12px 14px 8px'}}>
                <textarea ref={taRef} value={input} onChange={e=>setInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();}}}
                  onPaste={e=>{if(!visionOk)return;const imgs=Array.from(e.clipboardData.items).filter(it=>it.type.startsWith('image/')).map(it=>it.getAsFile()).filter((f):f is File=>!!f);if(imgs.length){e.preventDefault();addImages(imgs);}}}
                  rows={1} disabled={streaming}
                  placeholder={`Message ${APP.name}…`}
                  style={{width:'100%',background:'transparent',border:'none',outline:'none',resize:'none',color:'var(--fg)',fontFamily:'Inter,sans-serif',fontSize:15,lineHeight:1.7,minHeight:26,maxHeight:180}}
                  onInput={e=>{const el=e.currentTarget;el.style.height='auto';el.style.height=Math.min(el.scrollHeight,180)+'px';}}/>
              </div>

              {/* Bottom controls */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 10px 10px',gap:8}}>
                <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}}>
                  <FeaturePill icon={<Ico.Globe/>} label="Search" active={useSearch} onClick={()=>setUseSearch(s=>!s)}/>
                  <FeaturePill icon={<Ico.Flask/>} label="Deep research" active={useDeep} onClick={()=>setUseDeep(d=>!d)}/>
                  <FeaturePill icon={<Ico.File/>} label={docs.length>0?`Docs (${docs.length})`:'Docs'} active={ragActive||docsOpen} onClick={()=>{setDocsOpen(o=>!o);setUploadErr(null);}}/>
                  <FeaturePill icon={<Ico.Book/>} label={prompts.length>0?`Prompts (${prompts.length})`:'Prompts'} active={promptsOpen} onClick={()=>setPromptsOpen(o=>!o)}/>
                  {toolsOk&&<FeaturePill icon={<Ico.Tool/>} label={toolIds.length>0?`Tools (${toolIds.length})`:'Tools'} active={toolsOpen||toolIds.length>0} onClick={()=>setToolsOpen(o=>!o)}/>}
                  {visionOk&&(
                    <>
                      <FeaturePill icon={<Ico.Image/>} label={images.length>0?`Image (${images.length})`:'Image'} active={images.length>0} onClick={()=>imgRef.current?.click()}/>
                      <input ref={imgRef} type="file" accept="image/*" multiple style={{display:'none'}} onChange={e=>{if(e.target.files)addImages(e.target.files);e.currentTarget.value='';}}/>
                    </>
                  )}
                  {speech.supported&&(
                    <button onClick={()=>speech.listening?speech.stop():speech.start()}
                      style={{display:'inline-flex',alignItems:'center',gap:5,padding:'5px 10px',borderRadius:20,fontSize:12,fontWeight:500,fontFamily:'Inter,sans-serif',cursor:'pointer',border:`1px solid ${speech.listening?'rgba(248,113,113,.4)':'var(--bd-2)'}`,background:speech.listening?'rgba(248,113,113,.08)':'transparent',color:speech.listening?'var(--err)':'var(--fg-3)',transition:'all .15s'}}>
                      <Ico.Mic/>{speech.listening?'Listening…':'Voice'}
                    </button>
                  )}
                  {docs.length>0&&!useRag&&<button onClick={()=>setUseRag(true)} className="btn-ghost-sm" style={{fontSize:12}}>Enable doc context</button>}
                </div>

                <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
                  {tts.supported&&(
                    <IcoBtn onClick={()=>tts.speaking?tts.stop():undefined} active={tts.speaking}><Ico.Vol/></IcoBtn>
                  )}
                  {streaming
                    ? <button onClick={()=>abortRef.current?.abort()}
                        style={{width:34,height:34,borderRadius:8,background:'var(--bg-3)',border:'1px solid var(--bd-2)',color:'var(--fg-3)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',transition:'background .12s',flexShrink:0}}
                        onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-4)'}
                        onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-3)'}>
                        <Ico.Stop/>
                      </button>
                    : <button onClick={handleSend} disabled={!canSend}
                        style={{width:34,height:34,borderRadius:8,background:canSend?'var(--g)':'var(--bg-3)',color:canSend?'#04100a':'var(--fg-4)',display:'flex',alignItems:'center',justifyContent:'center',cursor:canSend?'pointer':'not-allowed',transition:'background .15s',border:'none',flexShrink:0,boxShadow:canSend?'0 0 0 1px rgba(34,197,94,.4), 0 2px 8px rgba(34,197,94,.15)':'none'}}
                        onMouseEnter={e=>{if(canSend)(e.currentTarget as HTMLElement).style.background='#16a34a';}}
                        onMouseLeave={e=>{if(canSend)(e.currentTarget as HTMLElement).style.background='var(--g)';}}>
                        <Ico.Send/>
                      </button>
                  }
                </div>
              </div>
            </div>

            <p style={{textAlign:'center',marginTop:8,fontSize:11,color:'var(--fg-4)',fontFamily:'JetBrains Mono,monospace',letterSpacing:'0.02em'}}>
              {APP.name} can make mistakes. Double check anything that matters.
            </p>
          </div>
        </div>
      </div>

      {docsOpen&&<DocsPanel docs={docs} uploading={uploading} uploadError={uploadErr} onUpload={uploadDoc} onDelete={deleteDoc} onClose={()=>setDocsOpen(false)}/>}
      <ThemeEditor open={themeOpen} onClose={()=>setThemeOpen(false)}/>
      {showExport&&<div style={{position:'fixed',inset:0,zIndex:40}} onClick={()=>setShowExport(false)}/>}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @media (max-width: 767px) { .anim-fade-up { animation-delay: 0s !important; } }`}</style>
    </div>
  );
}
