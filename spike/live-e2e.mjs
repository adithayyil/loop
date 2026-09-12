// Live end-to-end: record the invoice flow in a Steel session via our API,
// compile with the LLM, save the skill, then replay it in a fresh session.
import 'dotenv/config';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:3000';
const TUNNEL = process.argv[2];
if (!TUNNEL) throw new Error('usage: node live-e2e.mjs <tunnel-origin>');
const url = (p) => `${TUNNEL}${p}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. start recording through the app
const startRes = await fetch(`${BASE}/api/recordings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ startUrl: url('/demo/vendor/login') }),
});
const started = await startRes.json();
if (!startRes.ok) throw new Error(`start failed: ${JSON.stringify(started)}`);
console.log('recording', started.id, 'session', started.sessionId);

// 2. drive the session as the "human" would (second CDP client)
const ws = `wss://connect.steel.dev?apiKey=${process.env.STEEL_KEY}&sessionId=${started.sessionId}`;
const browser = await chromium.connectOverCDP(ws);
try {
  const page = browser.contexts()[0].pages()[0];
  await page.getByTestId('username').fill('vendor');
  await page.getByTestId('password').fill('hunter2');
  await page.locator('[data-testid="login-button"]').click();
  await page.waitForURL('**/demo/vendor', { timeout: 15000 });
  await page.getByRole('link', { name: 'Unpaid' }).click();
  await page.waitForURL('**status=unpaid**', { timeout: 15000 }).catch(() => {});
  await sleep(500);
  await page.locator('[data-testid="download-INV-1001"]').click();
  await sleep(1500);
  console.log('human actions done, final url', page.url());
} finally {
  await browser.close().catch(() => {});
}

// 3. stop + compile
const stopRes = await fetch(`${BASE}/api/recordings/${started.id}/stop`, { method: 'POST' });
const stopped = await stopRes.json();
if (!stopRes.ok) throw new Error(`stop failed: ${JSON.stringify(stopped)}`);
console.log('profileId', stopped.recording.profileId);
console.log('event count', stopped.recording.events.length);
console.log('compiled title:', stopped.result.title);
console.log('compiled steps:');
for (const s of stopped.result.steps) {
  console.log(`  ${s.n}. ${s.text}${s.param ? `  [${s.param.mode}: ${s.param.name}]` : ''}`);
}

// 4. save
const saveRes = await fetch(`${BASE}/api/skills`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    recordingId: started.id,
    name: stopped.result.title,
    trigger: { type: 'phrase', value: 'download unpaid invoices' },
    steps: stopped.result.steps,
    profileId: stopped.recording.profileId,
  }),
});
const saved = await saveRes.json();

// 5. replay
const runRes = await fetch(`${BASE}/api/skills/${saved.id}/run`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ params: {} }),
});
const run = await runRes.json();
console.log('run status', runRes.status);
console.log('run result', JSON.stringify(run.result ?? run));
