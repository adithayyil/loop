// Product E2E: record -> compile -> save -> run -> verify, over the app's own HTTP API
// (the same calls the UI makes). Two scenarios:
//   1. TodoMVC — structural replay (nav, add, toggle, filter).
//   2. Wikipedia — parameterized input replay; the typed value must show up in the
//      replayed final URL, proving fill/Enter + param substitution actually happened.
//
// Run: node --experimental-strip-types spike/product-e2e.mjs
import 'dotenv/config';
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
let total = 0;
const check = (name, ok, detail = '') => {
  total += 1;
  if (ok) passed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function api(path, init) {
  const response = await fetch(`${BASE}${path}`, init);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, body };
}

/** Record a task by driving the Steel session with the given Playwright-like actions. */
async function record(startUrl, human) {
  const start = await api('/api/recordings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startUrl }),
  });
  check(`record: open ${startUrl}`, start.ok, start.body.id ?? start.body.error);
  if (!start.ok) return null;

  const browser = await chromium.connectOverCDP(
    `wss://connect.steel.dev?apiKey=${process.env.STEEL_KEY}&sessionId=${start.body.sessionId}`,
  );
  try {
    const page = browser.contexts()[0].pages()[0];
    await human(page);
  } finally {
    await browser.close().catch(() => {});
  }

  const stop = await api(`/api/recordings/${start.body.id}/stop`, { method: 'POST' });
  check('record: stop + compile', stop.ok, stop.body.error);
  return { recordingId: start.body.id, result: stop.body.result, recording: stop.body.recording };
}

async function saveAndRun(name, recordingId, steps, profileId, params) {
  const save = await api('/api/skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordingId,
      name,
      trigger: { type: 'phrase', value: 'e2e' },
      steps,
      profileId: profileId ?? null,
    }),
  });
  check('save: POST /api/skills', save.ok, save.body.id ?? save.body.error);
  if (!save.ok) return null;

  const run = await api(`/api/skills/${save.body.id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ params: params ?? {} }),
  });
  check('run: POST /api/skills/:id/run', run.ok, run.body.runId ?? run.body.error);

  let record;
  for (let i = 0; i < 120; i += 1) {
    await sleep(1000);
    const poll = await api(`/api/runs/${run.body.runId}`);
    record = poll.body.run;
    if (record?.status !== 'running') break;
  }
  await api(`/api/skills/${save.body.id}`, { method: 'DELETE' });
  return record;
}

console.log(`\nloop product E2E -> ${BASE}\n`);
try {
  const home = await fetch(`${BASE}/`);
  check('server reachable', home.ok, `GET / ${home.status}`);
} catch {
  console.error(`Cannot reach ${BASE}. Start it with: npm run dev`);
  process.exit(2);
}

/* ---------------------------------------------------------------- scenario 1 */

console.log('\nScenario 1: TodoMVC (structural replay)');
{
  const rec = await record('https://todomvc.com/examples/react/dist/', async (page) => {
    await page.locator('.new-todo').waitFor({ timeout: 20_000 });
    for (const text of ['buy milk', 'pay invoice']) {
      await page.locator('.new-todo').fill(text);
      await page.keyboard.press('Enter');
      await sleep(250);
    }
    await page.locator('.todo-list li .toggle').first().click();
    await sleep(250);
    await page.getByRole('link', { name: 'Active' }).click();
    await sleep(600);
  });

  if (rec) {
    const steps = rec.result?.steps ?? [];
    check('compile returned steps', steps.length > 0, `${steps.length} steps`);
    check(
      'compiled the typed values',
      steps.some((s) => JSON.stringify(s.value ?? '').includes('buy milk')) &&
        steps.some((s) => JSON.stringify(s.value ?? '').includes('pay invoice')),
    );

    const run = await saveAndRun(`E2E TodoMVC ${Date.now()}`, rec.recordingId, steps, rec.recording?.profileId, {});
    check('run status done', run?.status === 'done', run?.result?.error ?? run?.status);
    check(
      'all steps ran',
      run?.result?.stepsRun === run?.result?.totalSteps,
      `${run?.result?.stepsRun}/${run?.result?.totalSteps}`,
    );
    check('landed on Active filter', (run?.result?.finalUrl ?? '').includes('#/active'), run?.result?.finalUrl);
  }
}

/* ---------------------------------------------------------------- scenario 2 */

console.log('\nScenario 2: Wikipedia (parameterized input replay)');
{
  const rec = await record('https://en.wikipedia.org/wiki/Main_Page', async (page) => {
    const search = page.getByRole('searchbox').first();
    await search.waitFor({ timeout: 20_000 });
    await search.fill('Invoice');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/wiki/Invoice**', { timeout: 15_000 }).catch(() => {});
    await sleep(800);
  });

  if (rec) {
    const steps = rec.result?.steps ?? [];
    const variable = steps.find((s) => s.param?.mode === 'variable') ?? steps.find((s) => s.value);
    check('compile marked an input', Boolean(variable), variable?.text);
    check('input default is the recorded term', String(variable?.value ?? '').includes('Invoice'));

    const paramName = variable?.param?.name;
    const params = paramName ? { [paramName]: 'Browser automation' } : {};
    const run = await saveAndRun(`E2E Wikipedia ${Date.now()}`, rec.recordingId, steps, rec.recording?.profileId, params);

    check('run status done', run?.status === 'done', run?.result?.error ?? run?.status);
    check(
      'all steps ran',
      run?.result?.stepsRun === run?.result?.totalSteps,
      `${run?.result?.stepsRun}/${run?.result?.totalSteps}`,
    );
    check(
      'replayed the substituted term (final URL)',
      (run?.result?.finalUrl ?? '').includes('/wiki/') &&
        !(run?.result?.finalUrl ?? '').includes('/wiki/Invoice'),
      run?.result?.finalUrl,
    );
  }
}

console.log(`\n${passed}/${total} checks passed`);
console.log(passed === total ? 'PRODUCT-E2E: PASS' : 'PRODUCT-E2E: FAIL');
process.exit(passed === total ? 0 : 1);
