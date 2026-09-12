import { NextResponse } from 'next/server';
import { agentRuns } from '@/lib/agent-runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = agentRuns.get(id);
  if (!run) return NextResponse.json({ error: 'Agent run not found' }, { status: 404 });
  return NextResponse.json({ run });
}
