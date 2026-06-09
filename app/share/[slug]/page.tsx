import { notFound } from 'next/navigation';
import { getConversationBySlug, listMessages } from '@/lib/db';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { APP } from '@/lib/config';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export default async function SharePage({ params }: Params) {
  const { slug } = await params;
  const conv = getConversationBySlug(slug);
  if (!conv) notFound();

  const messages = listMessages(conv.id).filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );

  return (
    <div className="min-h-screen bg-term-bg text-term-text font-mono">
      <header className="border-b border-term-border px-6 py-3 flex items-center gap-4">
        <span className="font-display text-term-green tracking-widest text-lg">CHAKOR</span>
        <span className="text-term-dim text-xs flex-1">// shared conversation</span>
        <Link href="/" className="text-term-dim text-xs hover:text-term-green transition-colors">
          start your own ↗
        </Link>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-term-text text-sm font-mono mb-6 border-b border-term-border pb-3">
          {conv.title}
        </h1>

        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="text-term-green text-xs mr-2 mt-0.5 shrink-0 select-none">▎</div>
              )}
              <div
                className={`max-w-[80%] text-sm leading-relaxed font-mono ${
                  msg.role === 'user'
                    ? 'bg-term-panel border border-term-border px-4 py-2 text-term-text'
                    : 'text-term-text prose-chakor'
                }`}
              >
                {msg.role === 'user' ? (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      pre: ({ children }) => (
                        <pre className="overflow-x-auto bg-term-panel border border-term-border/40 p-3 my-2 text-xs leading-relaxed">{children}</pre>
                      ),
                      code: ({ className, children, ...props }) => {
                        const isBlock = !!(className && /language-/.test(className));
                        if (isBlock) return <code className={className} {...props}>{children}</code>;
                        return <code className="bg-term-panel text-term-amber px-1 py-0.5 text-xs" {...props}>{children}</code>;
                      },
                      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-term-cyan underline hover:opacity-80">{children}</a>,
                      p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>,
                      h1: ({ children }) => <h1 className="text-term-green font-bold text-lg mb-2 mt-4">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-term-green font-bold text-base mb-2 mt-3">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-term-amber font-bold mb-1 mt-2">{children}</h3>,
                      blockquote: ({ children }) => <blockquote className="border-l-2 border-term-dim pl-3 text-term-dim italic my-2">{children}</blockquote>,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-4 border-t border-term-border text-center">
          <p className="text-term-dim text-xs">
            Shared from{' '}
            <Link href="/" className="text-term-green hover:underline">
              {APP.name}
            </Link>
            {APP.creator ? ` · by ${APP.creator}` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
