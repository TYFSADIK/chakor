import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

// Edge-safe auth config — no database imports.
// Used by middleware (Edge runtime) for JWT presence checks.
// The actual authorize logic lives in lib/auth.ts.
export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      credentials: {
        username: { label: 'username', type: 'text' },
        password: { label: 'password', type: 'password' },
      },
      // authorize is not called by middleware — only by the login flow.
      // The full implementation is in lib/auth.ts.
      authorize: async () => null,
    }),
  ],
  callbacks: {
    authorized({ auth }) {
      return !!auth;
    },
  },
};
