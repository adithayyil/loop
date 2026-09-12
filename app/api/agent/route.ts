import { NextResponse } from 'next/server';
import { runAgent } from '@/lib/agent';
import { agentControllers, agentRuns, type AgentRecord } from '@/lib/agent-runs';
import { anthropicInferer } from '@/lib/anthropic';
import { compile } from '@/lib/compiler';
import { profileForSession, steelClient } from '@/lib/steel';
import { store } from '@/lib/store';
import type { Recording } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Autonomously achieve a goal on a website, recording as it goes, then compile the
 * captured actions into a reviewable, replayable skill. Returns immediately.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { goal?: unknown; startUrl?: unknown };
  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  const startUrl =
    typeof body.startUrl === 'string' && body.startUrl.trim() ? body.startUrl.trim() : 'about:blank';

  if (!goal) {
    return NextResponse.json({ error: 'goal and startUrl are required' }, { status: 400 });
  }

  const record: AgentRecord = {
    id: crypto.randomUUID(),
    goal,
    startUrl,
    status: 'running',
    steps: [],
    startedAt: Date.now(),
  };
  agentRuns.set(record.id, record);
  const controller = new AbortController();
  agentControllers.set(record.id, controller);

  void (async () => {
    try {
      const result = await runAgent({
        goal,
        startUrl,
        signal: controller.signal,
        onSession: (sessionId, debugUrl) => {
          record.sessionId = sessionId;
          record.debugUrl = debugUrl;
        },
        onStep: (step) => {
          record.steps.push(step);
        },
      });

      record.summary = result.summary;
      record.error = result.error;

      if (result.events.length === 0) {
        record.status = result.status === 'done' ? 'failed' : result.status;
        if (result.status === 'done') record.error = 'Agent finished without capturing any actions';
        return;
      }

      const compiled = await compile(result.events, anthropicInferer(), { title: goal });
      let profileId: string | null = null;
      try {
        profileId = await profileForSession(steelClient(), result.sessionId);
      } catch {
        /* best effort */
      }
      const recordingId = crypto.randomUUID();
      const recording: Recording = {
        id: recordingId,
        sessionId: result.sessionId,
        debugUrl: result.debugUrl,
        status: 'stopped',
        events: result.events,
        profileId,
        result: compiled,
        startedAt: record.startedAt,
        stoppedAt: Date.now(),
      };
      store.recordings.set(recordingId, recording);
      record.recordingId = recordingId;

      // Flip to the terminal state only after the recording exists, so pollers
      // never stop before `recordingId` is available.
      record.status = result.status;
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : 'Agent run failed';
    } finally {
      agentControllers.delete(record.id);
    }
  })();

  return NextResponse.json({ runId: record.id });
}
