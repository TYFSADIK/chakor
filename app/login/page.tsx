import type { Metadata } from 'next';
import LoginForm from '@/components/LoginForm';
import { APP } from '@/lib/config';

export const metadata: Metadata = {
  title: `Sign in · ${APP.name}`,
  description: `Sign in to your ${APP.name} workspace. A private AI assistant you run yourself.`,
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main>
      <LoginForm />
    </main>
  );
}
