import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { listConversations } from '@/lib/db';
import ChatShell from '@/components/ChatShell';
import { APP } from '@/lib/config';

export const metadata = { title: APP.name };

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userId = (session.user as unknown as { id: number }).id;
  const conversations = listConversations(userId);

  return (
    <ChatShell
      user={{
        id: userId,
        name: session.user.name,
        email: session.user.email,
        isAdmin: (session.user as { isAdmin?: boolean }).isAdmin,
      }}
      initialConversations={conversations}
    />
  );
}
