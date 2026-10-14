'use client';

import { memo, useCallback, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MermaidBoundary, MermaidDiagram } from './Mermaid';

// Shared markdown pipeline: GFM + syntax highlighting + code blocks with a
// copy button. Used by the chat bubbles, the arena, and the public share page.

const IcoCopy = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const IcoCheck = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>;

/** Plain text of a React node tree — survives rehype-highlight's span wrapping. */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  const children = (node as { props?: { children?: React.ReactNode } })?.props?.children;
  return children !== undefined ? textOf(children) : '';
}

export const CodeBlock = memo(function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  let lang = '';
  try { const m = ((children as {props?:{className?:string}})?.props?.className??'').match(/language-(\w+)/); if(m) lang=m[1]; } catch {}
  const codeText = textOf(children);
  const copy = async () => { try { await navigator.clipboard.writeText(codeText || ref.current?.textContent || ''); setCopied(true); setTimeout(()=>setCopied(false),2000); } catch {} };
  // Mermaid blocks render as diagrams; if the diagram won't parse, fall back
  // to the plain code block — a bad diagram must never break the message.
  // The failure is remembered PER CODE STRING: while a reply is streaming the
  // block is incomplete and any render attempt can fail, but the code keeps
  // changing, so a completed diagram always earns a fresh attempt.
  const [mermaidFailedFor, setMermaidFailedFor] = useState<string | null>(null);
  const onMermaidError = useCallback(() => setMermaidFailedFor(codeText), [codeText]);
  const asDiagram = lang === 'mermaid' && mermaidFailedFor !== codeText;
  return (
    <div className="codeblock">
      <div className="codeblock-header">
        <span className="codeblock-lang">{lang||'code'}</span>
        <button onClick={copy} className={`codeblock-copy ${copied?'copied':''}`}>
          {copied ? <><IcoCheck /> Copied</> : <><IcoCopy /> Copy</>}
        </button>
      </div>
      {asDiagram
        ? (
          <MermaidBoundary fallback={<pre ref={ref}>{children}</pre>}>
            <MermaidDiagram code={codeText} onError={onMermaidError} />
          </MermaidBoundary>
        )
        : <pre ref={ref}>{children}</pre>}
    </div>
  );
});

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
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
        // Generated/attached images (workspace /api/workspace/... URLs) render
        // inline, capped to the bubble width, still click-through downloadable.
        img:    ({src,alt})=>(
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt??''} loading="lazy" style={{maxWidth:'100%',maxHeight:480,border:'1px solid var(--bd-2)',display:'block',margin:'6px 0'}}/>
        ),
      }}>
      {children}
    </ReactMarkdown>
  );
});
