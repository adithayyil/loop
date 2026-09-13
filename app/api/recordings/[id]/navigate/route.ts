import { NextResponse } from 'next/server';
import { navigateRecording } from '@/lib/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Navigate an open recording session from the in-app address bar. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  let url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  try {
    await navigateRecording(id, url);
    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Navigation failed';
    const status = message.includes('No active recording') ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
