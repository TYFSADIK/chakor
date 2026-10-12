import { notFound } from 'next/navigation';
import { getConversationBySlug, listMessages } from '@/lib/db';
import Link from 'next/link';
import { Markdown } from '@/components/Markdown';
import { SourceCards } from '@/components/SourceCards';
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

  const dateline = new Date(conv.created_at * 1000).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      {/* Masthead */}
      <header style={{ maxWidth: 760, margin: '0 auto', padding: '34px 20px 0', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 10 }}>
          <span className="byline">Public edition</span>
          <span className="byline">{dateline}</span>
        </div>
        <hr className="rule-thin" />
        <h1 className="masthead-name" style={{ fontSize: 'clamp(38px, 8vw, 60px)', padding: '14px 0 10px' }}>
          {APP.name}
        </h1>
        <hr className="rule-double" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0' }}>
          <span className="kicker">Shared conversation</span>
          <Link href="/" className="byline" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>
            Start your own ↗
          </Link>
        </div>
        <hr className="rule-fat" />
      </header>

      {/* Article */}
      <main style={{ maxWidth: 680, margin: '0 auto', padding: '26px 20px 70px' }}>
        <h2 className="headline" style={{ fontSize: 'clamp(24px, 5vw, 34px)', marginBottom: 8 }}>
          {conv.title}
        </h2>
        <p className="byline" style={{ marginBottom: 22 }}>
          Transcript · {messages.length} {messages.length === 1 ? 'entry' : 'entries'}
          {APP.creator ? ` · Printed by ${APP.creator}` : ''}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {messages.map((msg) => (
            msg.role === 'user' ? (
              /* Reader's letter: an inset card on darker stock. */
              <div key={msg.id} style={{ background: 'var(--bg-1)', border: '1px solid var(--bd-2)', borderLeft: '3px solid var(--fg)', padding: '13px 16px' }}>
                <p className="kicker" style={{ marginBottom: 6, fontSize: 10 }}>The Reader writes</p>
                {msg.images && msg.images.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: msg.content ? 10 : 0 }}>
                    {msg.images.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={src} alt={`Attachment ${i + 1}`} style={{ maxWidth: 240, maxHeight: 240, border: '1px solid var(--bd-2)', objectFit: 'cover' }} />
                    ))}
                  </div>
                )}
                {msg.content && (
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 14.5, lineHeight: 1.65, color: 'var(--fg-2)', wordBreak: 'break-word' }}>
                    {msg.content}
                  </div>
                )}
              </div>
            ) : (
              /* The paper answers: running article copy. Same markdown pipeline
                 as the chat: GFM, syntax highlighting, copyable code blocks. */
              <div key={msg.id}>
                <p className="kicker" style={{ marginBottom: 8, fontSize: 10 }}>{APP.name} replies</p>
                {msg.sources && msg.sources.length > 0 && <SourceCards sources={msg.sources} />}
                <div className="prose-ai" style={{ fontSize: 15.5 }}>
                  <Markdown>{msg.content}</Markdown>
                </div>
              </div>
            )
          ))}
        </div>

        {/* Colophon */}
        <hr className="rule-double" style={{ marginTop: 40 }} />
        <div style={{ textAlign: 'center', padding: '16px 0 4px' }}>
          <p className="masthead-name" style={{ fontSize: 22, marginBottom: 6 }}>{APP.name}</p>
          <p className="byline">
            Shared from{' '}
            <Link href="/" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>
              {APP.name}
            </Link>
            {APP.creator ? ` · by ${APP.creator}` : ''}
          </p>
        </div>
      </main>
    </div>
  );
}
