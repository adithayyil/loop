import { NextResponse } from 'next/server';
import { agentControllers, agentRuns } from '@/lib/agent-runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = agentRuns.get(id);
  if (!run) return NextResponse.json({ error: 'Agent run not found' }, { status: 404 });
  return NextResponse.json({ run });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = agentRuns.get(id);
  if (!run) return NextResponse.json({ error: 'Agent run not found' }, { status: 404 });
  agentControllers.get(id)?.abort();
  run.status = 'failed';
  run.error = 'Stopped';
  run.steps.push({ n: run.steps.length + 1, action: 'stopped', detail: 'Stopped by you' });
  return NextResponse.json({ ok: true });
}
