import { NextResponse } from 'next/server';
import { runSkill } from '@/lib/replay';
import { runs, type RunRecord } from '@/lib/runs';
import { store } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Kick off a run in the background and return immediately so the client can
 * embed the Steel live viewer and poll `/api/runs/[id]` for state.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const skill = store.skills.get(id);
  if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { params?: Record<string, string> };

  const record: RunRecord = {
    id: crypto.randomUUID(),
    skillId: id,
    status: 'running',
    startedAt: Date.now(),
  };
  runs.set(record.id, record);

  void runSkill(skill, {
    params: body.params ?? {},
    releaseDelayMs: 4000,
    cacheKey: record.id,
    onSession: (sessionId, debugUrl) => {
      record.sessionId = sessionId;
      record.debugUrl = debugUrl;
    },
  })
    .then((result) => {
      record.status = result.status;
      record.result = result;
    })
    .catch((error: unknown) => {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : 'Run failed';
    });

  return NextResponse.json({ runId: record.id });
}
