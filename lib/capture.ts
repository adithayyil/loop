import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import Steel from 'steel-sdk';
import { RECORDER_SCRIPT } from './recorder';
import { createSession, profileForSession, steelApiKey, steelClient } from './steel';
import type { RecordedEvent, Recording } from './types';

const RECORDINGS_DIR = path.join(process.cwd(), 'recordings');

interface ActiveCapture {
  id: string;
  sessionId: string;
  debugUrl: string;
  startedAt: number;
  events: RecordedEvent[];
  browser: Browser;
  page: Page;
  client: Steel;
  ndjson: fs.WriteStream;
}

const globalRef = globalThis as unknown as {
  __loopCaptures?: Map<string, ActiveCapture>;
};

/** globalThis-backed so the stop route sees sessions the create route started. */
const active: Map<string, ActiveCapture> =
  globalRef.__loopCaptures ?? (globalRef.__loopCaptures = new Map());

export interface StartRecordingOptions {
  startUrl?: string;
  timeoutMs?: number;
}

/** Navigate an open recording session (the in-app address bar). */
export async function navigateRecording(id: string, url: string): Promise<void> {
  const capture = active.get(id);
  if (!capture) throw new Error(`No active recording "${id}"`);
  await capture.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
}

/**
 * Create a Steel session, connect over CDP, and inject the recorder into every
 * document. The user drives the session through the interactive viewer; we only
 * observe DOM events. Returns immediately; call `stopRecording` when done.
 */
export async function startRecording(opts: StartRecordingOptions): Promise<Recording> {
  const apiKey = steelApiKey();
  const client = steelClient();
  const session = await createSession(client, { timeout: opts.timeoutMs ?? 15 * 60 * 1000 });

  const id = crypto.randomUUID();
  const startedAt = Date.now();
  const browser = await chromium.connectOverCDP(
    `wss://connect.steel.dev?apiKey=${apiKey}&sessionId=${session.id}`,
  );
  const context = browser.contexts()[0] ?? (await browser.newContext());

  const events: RecordedEvent[] = [];
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  const ndjson = fs.createWriteStream(path.join(RECORDINGS_DIR, `${id}.ndjson`), { flags: 'a' });

  const push = (event: RecordedEvent) => {
    events.push(event);
    ndjson.write(`${JSON.stringify(event)}\n`);
  };

  await context.exposeBinding('__loopEmit', (_source, event) => push({ ts: Date.now(), ...event }));
  await context.addInitScript(RECORDER_SCRIPT);

  const attach = async (page: Page) => {
    try {
      await page.evaluate(RECORDER_SCRIPT);
    } catch {
      /* about:blank or detached */
    }
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        push({ ts: Date.now(), type: 'navigate', url: frame.url() });
      }
    });
  };

  context.on('page', attach);
  for (const page of context.pages()) await attach(page);

  const page = context.pages()[0] ?? (await context.newPage());
  if (opts.startUrl) {
    await page.goto(opts.startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  active.set(id, {
    id,
    sessionId: session.id,
    debugUrl: session.debugUrl,
    startedAt,
    events,
    browser,
    page,
    client,
    ndjson,
  });

  return {
    id,
    sessionId: session.id,
    debugUrl: session.debugUrl,
    status: 'recording',
    events,
    startedAt,
  };
}

export function getActiveRecording(id: string): ActiveCapture | undefined {
  return active.get(id);
}

/** Detach the recorder, collect the profile, and release the Steel session. */
export async function stopRecording(id: string): Promise<Recording> {
  const capture = active.get(id);
  if (!capture) throw new Error(`No active recording "${id}"`);

  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    await capture.browser.close();
  } catch {
    /* already gone */
  }

  let profileId: string | null = null;
  try {
    profileId = await profileForSession(capture.client, capture.sessionId);
  } catch {
    /* profile listing is best-effort; replay can still run logged-out */
  }

  try {
    await capture.client.sessions.release(capture.sessionId);
  } catch {
    /* release is best-effort; timeout will clean up */
  }
  capture.ndjson.end();
  active.delete(id);

  return {
    id,
    sessionId: capture.sessionId,
    debugUrl: capture.debugUrl,
    status: 'stopped',
    events: capture.events,
    profileId,
    hlsUrl: `https://api.steel.dev/v1/sessions/${capture.sessionId}/hls`,
    startedAt: capture.startedAt,
    stoppedAt: Date.now(),
  };
}
