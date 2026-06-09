import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Notes from '@/components/Notes';
import { listNotes } from '@/lib/db';
import { APP } from '@/lib/config';

export const metadata = { title: `Notes · ${APP.name}` };

export default async function NotesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as unknown as { id: number }).id;
  return <Notes initialNotes={listNotes(userId)} />;
}
