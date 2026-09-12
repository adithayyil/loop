import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { anthropicInferer } from '@/lib/anthropic';
import { compile } from '@/lib/compiler';
import { store } from '@/lib/store';
import type { RecordedEvent, Recording } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function loadFixture(name: string): RecordedEvent[] | null {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  const file = path.join(process.cwd(), 'lib', 'fixtures', `${name}.ndjson`);
  if (!fs.existsSync(file)) return null;
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RecordedEvent);
}

/**
 * Compile saved events without a live Steel session. Accepts either raw `events`
 * or a named `fixture` from `lib/fixtures/`. Persists the result so the review
 * screen can load it, and is how we iterate on the prompt offline.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    events?: unknown;
    fixture?: unknown;
    narration?: unknown;
    title?: unknown;
  };

  let events: RecordedEvent[];
  if (Array.isArray(body.events)) {
    events = body.events as RecordedEvent[];
  } else if (typeof body.fixture === 'string') {
    const loaded = loadFixture(body.fixture);
    if (!loaded) {
      return NextResponse.json({ error: `Unknown fixture "${body.fixture}"` }, { status: 404 });
    }
    events = loaded;
  } else {
    return NextResponse.json({ error: 'events or fixture is required' }, { status: 400 });
  }

  const result = await compile(events, anthropicInferer(), {
    title: typeof body.title === 'string' ? body.title : undefined,
    narration: typeof body.narration === 'string' ? body.narration : undefined,
  });

  const id = crypto.randomUUID();
  const recording: Recording = {
    id,
    sessionId: 'fixture',
    debugUrl: '',
    status: 'stopped',
    events,
    profileId: null,
    result,
    startedAt: Date.now(),
    stoppedAt: Date.now(),
  };
  store.recordings.set(id, recording);

  return NextResponse.json({ id, result, recording });
}
