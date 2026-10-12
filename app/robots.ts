import type { MetadataRoute } from 'next';
import { APP } from '@/lib/config';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.CHAKOR_APP_URL ?? APP.url;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/', '/admin', '/settings', '/notes', '/memory', '/compare',
        '/share/', // shared conversations are reachable by link, not crawlable
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
