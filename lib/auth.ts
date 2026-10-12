import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getUserByUsername, getUserById } from './db';
import { rateLimit } from './ratelimit';

// Constant hash compared against when the user does not exist, so both paths
// cost one bcrypt.compare and valid usernames are not revealed by timing (S3).
const DUMMY_HASH = '$2a$12$AwzvigHLnh/EbBake7qEVuTJdL3oz3zlhTfo6wknzi2bjDO.C0LJq';

/**
 * A JWT issued before the user's last password change is stale: the session
 * callback strips its identifying fields so the old token can't keep acting.
 * Exported (pure) for unit tests.
 */
export function sessionStaleAfterPasswordChange(
  user: { password_changed_at?: number | null } | undefined,
  tokenIat: unknown,
): boolean {
  return !!user?.password_changed_at && typeof tokenIat === 'number' && tokenIat < user.password_changed_at;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 }, // 30 days
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      credentials: {
        username: { label: 'username', type: 'text' },
        password: { label: 'password', type: 'password' },
      },
      async authorize(credentials, request) {
        const username = String(credentials?.username ?? '').trim().toLowerCase();
        const password = String(credentials?.password ?? '');
        if (!username || !password) return null;

        // Throttle credential stuffing per username before any bcrypt work.
        if (!rateLimit(`login:${username}`, 10, 5 * 60 * 1000)) return null;

        // Per-IP throttle as a second bucket, so spreading guesses across many
        // usernames still hits a wall. x-forwarded-for is only honored when the
        // deployer opted in with TRUST_PROXY (a real proxy sets/strips it);
        // otherwise all direct traffic shares one bucket.
        const fwd = request?.headers?.get?.('x-forwarded-for');
        const ip = process.env.TRUST_PROXY === 'true' && fwd ? fwd.split(',')[0].trim() : 'direct';
        if (!rateLimit(`login-ip:${ip}`, 30, 5 * 60 * 1000)) return null;

        const user = getUserByUsername(username);
        // Always run one compare — against the dummy hash when the user is
        // missing — so both paths take the same time.
        const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
        if (!user || !ok) return null;

        return {
          id: String(user.id),
          name: user.username,
          email: user.email ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.uid = Number(user.id);
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) {
        // refresh admin flag from DB on each session read
        const u = getUserById(token.uid as number);
        const su = session.user as unknown as { id?: number; isAdmin?: boolean };
        // Password changed after this JWT was issued: the token is stale.
        const staleAfterPasswordChange = sessionStaleAfterPasswordChange(u, token.iat);
        if (u && !staleAfterPasswordChange) {
          su.id = token.uid as number;
          su.isAdmin = u.is_admin === 1;
          session.user.name = (u as unknown as { display_name?: string }).display_name ?? u.username;
        } else {
          // User was deleted, or the password changed after this JWT was
          // issued: strip identifying fields so downstream ownership/admin
          // checks fail instead of letting the stale session act until token
          // expiry. (Middleware's JWT-presence check still passes until
          // expiry — that is a residual limitation.)
          delete su.id;
          delete su.isAdmin;
          session.user.name = null;
        }
      }
      return session;
    },
  },
});
