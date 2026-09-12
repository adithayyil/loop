import { notFound } from 'next/navigation';
import { store } from '@/lib/store';
import RunClient from './RunClient';

export const dynamic = 'force-dynamic';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const skill = store.skills.get(id);
  if (!skill) notFound();
  return <RunClient skill={skill} />;
}
