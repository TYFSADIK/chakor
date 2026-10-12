import type { Metadata, Viewport } from 'next';
import './globals.css';
import 'highlight.js/styles/atom-one-dark.css';
import { Providers } from './providers';
import { APP } from '@/lib/config';
import Script from 'next/script';

const SITE_URL  = process.env.NEXT_PUBLIC_APP_URL ?? process.env.CHAKOR_APP_URL ?? APP.url;
const SITE_NAME = APP.name;
const TITLE     = `${APP.name} · ${APP.tagline}`;
const DESC      = APP.description;
const CREATOR   = APP.creator || 'tyfsadik';
const OG_IMAGE  = { url: '/og.png', width: 1200, height: 630, alt: `${SITE_NAME} — self-hosted AI workspace` };

const jsonLd = {
  '@context': 'https://schema.org', '@type': 'SoftwareApplication',
  name: SITE_NAME, applicationCategory: 'AIApplication', operatingSystem: 'Web, Linux, macOS, Windows, Android',
  description: DESC, url: SITE_URL,
  author: { '@type': 'Person', name: CREATOR },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  featureList: [
    'Self hosted, runs entirely on your own hardware',
    'Local models with llama.cpp or Ollama, GPU or CPU',
    'Bring your own API keys for OpenAI, Anthropic, Google, OpenRouter',
    'Private by default, your conversations stay on your machine',
    'Agent workspace: a sandboxed agent that writes files, runs Python, and generates docx and pptx',
    'Chat with your own PDFs and notes',
    'Live web search via SearXNG, Brave, or DuckDuckGo',
    'Deep research mode with multi source synthesis and citations',
    'Compare mode: run the same prompt across models side by side',
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s · ${SITE_NAME}` },
  description: DESC,
  applicationName: SITE_NAME,
  keywords: [
    'self-hosted AI chat', 'private AI', 'local AI', 'local LLM', 'uncensored local AI',
    'open source ChatGPT alternative', 'ChatGPT alternative self-hosted',
    'llama.cpp', 'llama.cpp UI', 'GGUF', 'Ollama alternative UI', 'Ollama web UI', 'LM Studio alternative',
    'AI agent workspace', 'AI agent sandbox', 'deep research', 'AI research tool',
    'RAG chat', 'document chat', 'bring your own API key', 'OpenRouter',
    'offline AI', 'AI without cloud', `${SITE_NAME}`,
  ],
  authors: [{ name: CREATOR }], creator: CREATOR,
  category: 'technology',
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
  openGraph: { type: 'website', locale: 'en_US', url: SITE_URL, siteName: SITE_NAME, title: TITLE, description: DESC, images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: [OG_IMAGE.url], creator: `@${CREATOR}` },
  icons: {
    icon: [
      { url: '/logo.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: SITE_NAME },
  alternates: { canonical: SITE_URL },
};

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 5,
  themeColor: '#09090b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Apply saved theme mode + accent before paint (no flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var mode=localStorage.getItem('chakor-mode');if(mode==='dark')document.documentElement.classList.add('dark');var fs=localStorage.getItem('chakor-font-size');var fm={small:'13px',medium:'15px',large:'17px'};if(fs&&fm[fs])document.documentElement.style.setProperty('--chat-font',fm[fs]);var a=localStorage.getItem('chakor-accent');if(a){var m=/^#?([0-9a-fA-F]{6})$/.exec(a.trim());if(m){var n=parseInt(m[1],16),r=(n>>16)&255,g=(n>>8)&255,b=n&255,s=document.documentElement.style;s.setProperty('--g','#'+m[1]);s.setProperty('--g-dim','rgba('+r+','+g+','+b+',0.08)');s.setProperty('--g-bd','rgba('+r+','+g+','+b+',0.3)');var lr=Math.round(r+(255-r)*0.45),lg=Math.round(g+(255-g)*0.45),lb=Math.round(b+(255-b)*0.45);s.setProperty('--g-text','rgb('+lr+','+lg+','+lb+')');}}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased font-sans">
        <Script id="ld" type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} strategy="beforeInteractive" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
