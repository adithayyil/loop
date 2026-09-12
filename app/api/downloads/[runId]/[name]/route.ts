import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROOT = path.join(process.cwd(), 'recordings', 'downloads');

/** Serve a file cached from a Steel session before it was released. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; name: string }> },
) {
  const { runId, name } = await params;
  if (!/^[a-z0-9-]+$/i.test(runId) || !/^[A-Za-z0-9._-]+$/.test(name)) {
    return NextResponse.json({ error: 'Invalid download' }, { status: 400 });
  }

  const file = path.join(ROOT, runId, name);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${name}"`,
    },
  });
}
