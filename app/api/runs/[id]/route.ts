import { NextResponse } from 'next/server';
import { runs } from '@/lib/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = runs.get(id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  return NextResponse.json({ run });
}
