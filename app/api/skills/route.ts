import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import type { CompiledStep, Skill } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const skills = [...store.skills.values()].sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ skills });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    recordingId?: unknown;
    name?: unknown;
    trigger?: { type?: unknown; value?: unknown };
    steps?: unknown;
    profileId?: unknown;
  };

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const triggerType = body.trigger?.type;
  const triggerValue = body.trigger?.value;
  const validTrigger =
    (triggerType === 'phrase' || triggerType === 'schedule') && typeof triggerValue === 'string';

  if (!name || !Array.isArray(body.steps) || !validTrigger) {
    return NextResponse.json(
      { error: 'name, steps, and a phrase|schedule trigger are required' },
      { status: 400 },
    );
  }

  const skill: Skill = {
    id: crypto.randomUUID(),
    name,
    trigger: { type: triggerType as 'phrase' | 'schedule', value: triggerValue as string },
    profileId: typeof body.profileId === 'string' ? body.profileId : null,
    sourceRecordingId: typeof body.recordingId === 'string' ? body.recordingId : 'unknown',
    steps: body.steps as CompiledStep[],
    createdAt: Date.now(),
  };

  store.skills.set(skill.id, skill);
  return NextResponse.json({ id: skill.id, skill });
}
