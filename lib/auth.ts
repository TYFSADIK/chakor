import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getUserByUsername, getUserById } from './db';

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

        const user = getUserByUsername(username);
        if (!user) return null;

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return null;

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
        (session.user as unknown as { id?: number }).id = token.uid as number;
        // refresh admin flag from DB on each session read
        const u = getUserById(token.uid as number);
        if (u) {
          (session.user as unknown as { isAdmin?: boolean }).isAdmin = u.is_admin === 1;
          session.user.name = (u as unknown as { display_name?: string }).display_name ?? u.username;
        }
      }
      return session;
    },
  },
});
