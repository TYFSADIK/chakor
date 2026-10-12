import type { MetadataRoute } from 'next';
import { APP } from '@/lib/config';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.CHAKOR_APP_URL ?? APP.url;

// Only the pages a crawler can meaningfully see without a session. Shared
// conversations (/share/[slug]) are per-link and opted out via robots.ts.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/login`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/register`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.4 },
  ];
}
