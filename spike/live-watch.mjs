// Live record -> compile -> save -> background run with live-watch polling.
import 'dotenv/config';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:3000';
const TUNNEL = process.argv[2];
if (!TUNNEL) throw new Error('usage: node live-watch.mjs <tunnel-origin>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// record
const startRes = await fetch(`${BASE}/api/recordings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ startUrl: `${TUNNEL}/demo/vendor/login` }),
});
const started = await startRes.json();
if (!startRes.ok) throw new Error(`start failed: ${JSON.stringify(started)}`);
console.log('recording', started.id);

const browser = await chromium.connectOverCDP(
  `wss://connect.steel.dev?apiKey=${process.env.STEEL_KEY}&sessionId=${started.sessionId}`,
);
try {
  const page = browser.contexts()[0].pages()[0];
  await page.getByTestId('username').fill('vendor');
  await page.getByTestId('password').fill('hunter2');
  await page.locator('[data-testid="login-button"]').click();
  await page.waitForURL('**/demo/vendor', { timeout: 15000 });
  await page.getByRole('link', { name: 'Unpaid' }).click();
  await sleep(500);
  await page.locator('[data-testid="download-INV-1001"]').click();
  await sleep(1200);
} finally {
  await browser.close().catch(() => {});
}

const stopped = await (
  await fetch(`${BASE}/api/recordings/${started.id}/stop`, { method: 'POST' })
).json();
console.log('compiled:', stopped.result.title, `(${stopped.result.steps.length} steps, profile ${stopped.recording.profileId ? 'yes' : 'no'})`);

const saved = await (
  await fetch(`${BASE}/api/skills`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordingId: started.id,
      name: stopped.result.title,
      trigger: { type: 'phrase', value: 'download unpaid invoices' },
      steps: stopped.result.steps,
      profileId: stopped.recording.profileId,
    }),
  })
).json();

// background run
const kick = await fetch(`${BASE}/api/skills/${saved.id}/run`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ params: {} }),
});
const { runId } = await kick.json();
console.log('runId', runId);

let sawViewer = false;
let record;
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  record = (await (await fetch(`${BASE}/api/runs/${runId}`)).json()).run;
  if (record.debugUrl && !sawViewer) {
    sawViewer = true;
    console.log('live viewer available:', record.debugUrl);
    const player = await fetch(record.debugUrl).catch(() => null);
    if (player) {
      console.log('player headers: x-frame-options =', player.headers.get('x-frame-options'),
        '| csp =', (player.headers.get('content-security-policy') ?? '').slice(0, 60));
    }
  }
  if (record.status !== 'running') break;
}
console.log('final status', record.status, '| skipped', record.result?.skipped, '| files', JSON.stringify(record.result?.files));

if (record.result?.files?.length) {
  const file = record.result.files[0];
  const dl = await fetch(`${BASE}/api/downloads/${runId}/${file.name}`);
  const bytes = Buffer.from(await dl.arrayBuffer());
  console.log('download proxy', dl.status, '| bytes', bytes.length, '| magic', bytes.subarray(0, 5).toString());
}
console.log(record.status === 'done' && record.result?.files?.length > 0 ? 'LIVE-WATCH: PASS' : 'LIVE-WATCH: no-download');
