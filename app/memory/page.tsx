import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Memory from '@/components/Memory';
import { listMemories } from '@/lib/db';
import { APP } from '@/lib/config';

export const metadata = { title: `Memory · ${APP.name}` };

export default async function MemoryPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as unknown as { id: number }).id;
  return <Memory initialMemories={listMemories(userId)} />;
}
