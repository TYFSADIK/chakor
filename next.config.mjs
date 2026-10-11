/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3', 'pdf-parse'],
  // Allow a staging build next to a running production server without clobbering
  // its .next directory: CHAKOR_DIST_DIR=.next-staging npm run build
  distDir: process.env.CHAKOR_DIST_DIR || '.next',
  // Baseline security headers. script-src allows inline because Next injects
  // inline RSC payloads; the real XSS gate is react-markdown escaping raw HTML.
  // connect-src 'self' means no browser-side data leaves this origin at all.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "connect-src 'self'",
              "font-src 'self' data:",
              "media-src 'self'",
              "worker-src 'self'",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
  // Allow streaming from llama.cpp on local network
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
