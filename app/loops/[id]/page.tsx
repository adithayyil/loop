import { notFound } from 'next/navigation';
import { store } from '@/lib/store';
import { LoopDetail } from './loop-detail-client';

export const dynamic = 'force-dynamic';

export default async function LoopPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string; runId?: string }>;
}) {
  const { id } = await params;
  const skill = store.skills.get(id);
  if (!skill) notFound();
  const { run, runId } = await searchParams;
  return <LoopDetail skill={skill} autoRun={run === '1'} initialRunId={runId ?? null} />;
}
