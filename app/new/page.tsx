import { NewLoopClient } from './new-loop-client';

export const dynamic = 'force-dynamic';

export default async function NewLoopPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const initialMode = mode === 'record' || mode === 'agent' ? mode : null;
  return <NewLoopClient initialMode={initialMode} />;
}
