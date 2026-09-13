import { NextResponse } from 'next/server';
import { setNarration } from '@/lib/capture';
import { transcribeAudio, whisperConfigured } from '@/lib/transcribe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Transcribe a narration blob for a live recording. Called by the client before
 * stop; a missing key or transcription failure is non-fatal (narration is optional).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!whisperConfigured()) {
    return NextResponse.json({ narration: null, skipped: 'no speech API key set' });
  }

  try {
    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof Blob) || audio.size === 0) {
      return NextResponse.json({ error: 'No audio uploaded' }, { status: 400 });
    }

    const name = audio instanceof File ? audio.name : 'narration.webm';
    const result = await transcribeAudio(await audio.arrayBuffer(), name, audio.type || 'audio/webm');
    if (!result?.text) return NextResponse.json({ narration: null, segments: [] });

    try {
      setNarration(id, result.text, result.segments);
    } catch {
      /* recording already stopped; return the transcript anyway */
    }
    return NextResponse.json({ narration: result.text, segments: result.segments });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transcription failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
