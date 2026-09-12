import { notFound } from 'next/navigation';
import { store } from '@/lib/store';
import ReviewClient from './ReviewClient';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recording = store.recordings.get(id);
  if (!recording?.result) notFound();

  return (
    <ReviewClient
      recordingId={id}
      initial={recording.result}
      events={recording.events}
      profileId={recording.profileId ?? null}
    />
  );
}
