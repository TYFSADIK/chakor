import type { Metadata } from 'next';
import RegisterForm from '@/components/RegisterForm';
import { APP } from '@/lib/config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Create account · ${APP.name}`,
  description: `Create your ${APP.name} account. A private AI workspace you run yourself.`,
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return (
    <main>
      <RegisterForm />
    </main>
  );
}
