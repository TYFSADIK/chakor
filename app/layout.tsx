import type { Metadata, Viewport } from 'next';
import './globals.css';
import 'highlight.js/styles/atom-one-dark.css';
import { Providers } from './providers';
import { APP } from '@/lib/config';
import Script from 'next/script';

const SITE_URL  = APP.url;
const SITE_NAME = APP.name;
const TITLE     = `${APP.name} · ${APP.tagline}`;
const DESC      = APP.description;

const jsonLd = {
  '@context': 'https://schema.org', '@type': 'SoftwareApplication',
  name: SITE_NAME, applicationCategory: 'AIApplication', operatingSystem: 'Web, Linux, macOS, Windows, Android',
  description: DESC, url: SITE_URL,
  ...(APP.creator ? { author: { '@type': 'Person', name: APP.creator } } : {}),
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  featureList: [
    'Self hosted, runs entirely on your own hardware',
    'Local models with llama.cpp or Ollama, GPU or CPU',
    'Bring your own API keys for OpenAI, Anthropic, Google, OpenRouter',
    'Private by default, your conversations stay on your machine',
    'Chat with your own PDFs and notes',
    'Live web search via SearXNG, Brave, or DuckDuckGo',
    'Research mode with multi source synthesis and citations',
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s · ${SITE_NAME}` },
  description: DESC,
  applicationName: SITE_NAME,
  keywords: [
    'self-hosted AI', 'private AI assistant', 'local AI', 'open source ChatGPT alternative',
    'llama.cpp UI', 'RAG chat', 'document chat', 'AI research tool', 'bring your own API key',
    'OpenRouter', `${SITE_NAME}`,
  ],
  ...(APP.creator ? { authors: [{ name: APP.creator }], creator: APP.creator } : {}),
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
  openGraph: { type: 'website', locale: 'en_US', url: SITE_URL, siteName: SITE_NAME, title: TITLE, description: DESC, images: [{ url: '/icon-512.png', width: 512, height: 512, alt: SITE_NAME }] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: ['/icon-512.png'] },
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
        {/* Apply a saved accent before paint so there is no flash of the default green. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var a=localStorage.getItem('chakor-accent');if(!a)return;var m=/^#?([0-9a-fA-F]{6})$/.exec(a.trim());if(!m)return;var n=parseInt(m[1],16),r=(n>>16)&255,g=(n>>8)&255,b=n&255,s=document.documentElement.style;s.setProperty('--g','#'+m[1]);s.setProperty('--g-dim','rgba('+r+','+g+','+b+',0.08)');s.setProperty('--g-bd','rgba('+r+','+g+','+b+',0.2)');s.setProperty('--g-glow','0 0 20px rgba('+r+','+g+','+b+',0.25)');var lr=Math.round(r+(255-r)*0.45),lg=Math.round(g+(255-g)*0.45),lb=Math.round(b+(255-b)*0.45);s.setProperty('--g-text','rgb('+lr+','+lg+','+lb+')');}catch(e){}})();`,
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
