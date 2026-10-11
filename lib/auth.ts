import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getUserByUsername, getUserById } from './db';
import { rateLimit } from './ratelimit';

// Constant hash compared against when the user does not exist, so both paths
// cost one bcrypt.compare and valid usernames are not revealed by timing (S3).
const DUMMY_HASH = '$2a$12$AwzvigHLnh/EbBake7qEVuTJdL3oz3zlhTfo6wknzi2bjDO.C0LJq';

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
      async authorize(credentials) {
        const username = String(credentials?.username ?? '').trim().toLowerCase();
        const password = String(credentials?.password ?? '');
        if (!username || !password) return null;

        // Throttle credential stuffing per username before any bcrypt work.
        if (!rateLimit(`login:${username}`, 10, 5 * 60 * 1000)) return null;

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
        if (u) {
          su.id = token.uid as number;
          su.isAdmin = u.is_admin === 1;
          session.user.name = (u as unknown as { display_name?: string }).display_name ?? u.username;
        } else {
          // User was deleted after the JWT was issued: strip identifying fields
          // so downstream ownership/admin checks fail instead of letting the
          // ghost session act until token expiry. (Middleware's JWT-presence
          // check still passes until expiry — that is a residual limitation.)
          delete su.id;
          delete su.isAdmin;
          session.user.name = null;
        }
      }
      return session;
    },
  },
});
