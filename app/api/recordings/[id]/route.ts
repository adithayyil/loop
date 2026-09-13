import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const recording = store.recordings.get(id);
  if (!recording) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  }
  return NextResponse.json({ recording });
}
