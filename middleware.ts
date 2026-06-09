import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const { auth } = NextAuth(authConfig);

export default auth((req: NextRequest & { auth: unknown }) => {
  const { pathname } = req.nextUrl;

  // Static assets and the PWA manifest must be reachable without a session,
  // otherwise favicons, icons, social cards, and "add to home screen" break.
  const isAsset =
    pathname === '/manifest.webmanifest' ||
    /\.(?:svg|png|jpg|jpeg|gif|ico|webp|webmanifest|txt|xml|woff2?|ttf)$/.test(pathname);

  const isPublic =
    isAsset ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/share') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/register') ||
    // The OpenAI-compatible API authenticates with a Bearer key, not a session.
    pathname.startsWith('/v1/') ||
    pathname.startsWith('/favicon');

  if (!isPublic && !(req as { auth?: unknown }).auth) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
