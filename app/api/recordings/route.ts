import { NextResponse } from 'next/server';
import { startRecording } from '@/lib/capture';
import { store } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECORDING_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Open a browser to record in. `startUrl` is optional: the session opens on a blank
 * page and the client can navigate it from the in-app address bar.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { startUrl?: unknown };
  const startUrl =
    typeof body.startUrl === 'string' && body.startUrl.trim()
      ? body.startUrl.trim()
      : process.env.LOOP_DEMO_URL || undefined;

  try {
    const recording = await startRecording({ startUrl, timeoutMs: RECORDING_TIMEOUT_MS });
    store.recordings.set(recording.id, recording);
    return NextResponse.json({
      id: recording.id,
      sessionId: recording.sessionId,
      debugUrl: recording.debugUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start recording';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
