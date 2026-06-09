import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Compare from '@/components/Compare';
import { APP } from '@/lib/config';

export const metadata = { title: `Compare · ${APP.name}` };

export default async function ComparePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  return <Compare />;
}
