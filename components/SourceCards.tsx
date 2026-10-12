import { memo } from 'react';

export type Source = { title: string; url: string; snippet?: string };

// ─── Source cards ─────────────────────────────────────────────
// Shared by the chat (components/ChatShell.tsx) and the public share page
// (app/share/[slug]/page.tsx) so persisted research sources render the same
// way they did while streaming. No hooks — safe in server components.
export const SourceCards = memo(function SourceCards({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <div style={{display:'flex',gap:8,overflowX:'auto',paddingBottom:8,marginBottom:14,scrollbarWidth:'none'}}>
      {sources.slice(0,6).map((s,i)=>{
        let domain=''; try{domain=new URL(s.url).hostname.replace(/^www\./,'');}catch{}
        return (
          <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="src" style={{flexShrink:0,width:176,padding:12,display:'block',textDecoration:'none'}}>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
              {/* Local letter chip — no third-party favicon service, so searched
                  domains are never leaked off this machine. */}
              <span aria-hidden="true" style={{width:14,height:14,borderRadius:0,background:'var(--g-dim)',border:'1px solid var(--g-bd)',color:'var(--g-text)',fontSize:9,fontWeight:700,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0,textTransform:'uppercase'}}>{domain.charAt(0)||'?'}</span>
              <span style={{fontSize:11,color:'var(--fg-4)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:'JetBrains Mono,monospace'}}>{domain}</span>
              <span style={{marginLeft:'auto',fontSize:10,color:'var(--fg-4)',flexShrink:0,fontFamily:'JetBrains Mono,monospace'}}>[{i+1}]</span>
            </div>
            <p style={{fontSize:12,color:'var(--fg-2)',lineHeight:1.4,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{s.title.slice(0,70)}</p>
          </a>
        );
      })}
    </div>
  );
});
