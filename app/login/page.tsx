import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import LoginForm from '@/components/LoginForm';
import { APP } from '@/lib/config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Sign in · ${APP.name}`,
  description: `Sign in to your ${APP.name} workspace. A private AI assistant you run yourself.`,
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  // Already signed in? There is nothing to do here.
  const session = await auth();
  if (session?.user) redirect('/');
  return (
    <main>
      <LoginForm />
    </main>
  );
}
