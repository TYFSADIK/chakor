import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import AdminPanel from '@/components/AdminPanel';
import { APP } from '@/lib/config';

export const metadata = { title: `Admin · ${APP.name}` };

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!(session.user as unknown as { isAdmin?: boolean }).isAdmin) redirect('/');

  const selfId = (session.user as unknown as { id: number }).id;
  return <AdminPanel selfId={selfId} />;
}
