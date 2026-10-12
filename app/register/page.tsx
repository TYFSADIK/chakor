import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import RegisterForm from '@/components/RegisterForm';
import { APP } from '@/lib/config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Create account · ${APP.name}`,
  description: `Create your ${APP.name} account. A private AI workspace you run yourself.`,
  robots: { index: false, follow: false },
};

export default async function RegisterPage() {
  // Already signed in? There is nothing to do here.
  const session = await auth();
  if (session?.user) redirect('/');
  // The invite field is only shown when the server will actually require it;
  // enforcement happens in app/api/register/route.ts regardless.
  const inviteRequired = (process.env.REGISTRATION_MODE || 'closed') === 'invite';
  return (
    <main>
      <RegisterForm inviteRequired={inviteRequired} />
    </main>
  );
}
