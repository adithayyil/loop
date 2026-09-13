import { NextResponse } from 'next/server';
import { anthropicInferer } from '@/lib/anthropic';
import { stopRecording } from '@/lib/capture';
import { compile } from '@/lib/compiler';
import { store } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stop the session, release Steel, and compile the raw events into steps. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const recording = await stopRecording(id);
    const result = await compile(recording.events, anthropicInferer(), {
      title: recording.events.find((e) => e.title)?.title,
      narration: recording.narration,
    });
    recording.result = result;
    store.recordings.set(id, recording);
    return NextResponse.json({ recording, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stop recording';
    const status = message.includes('No active recording') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
