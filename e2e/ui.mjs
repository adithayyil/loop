// Browser E2E: drives the real loop UI in a real Chromium. Seeds data via the app's
// HTTP API, exercises the workspace flows, and asserts what the user sees. On a NixOS
// box it uses the nixpkgs Chromium wrapper; elsewhere it falls back to Playwright's
// installed browser.
//
// Run: npm run test:e2e        (builds + starts the app if needed)
import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SHOT_DIR = process.env.E2E_SHOT_DIR ?? 'recordings/e2e';
fs.mkdirSync(SHOT_DIR, { recursive: true });
let shotN = 0;
async function shot(page, name) {
  shotN += 1;
  const file = `${SHOT_DIR}/${String(shotN).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  console.log(`     [shot] ${file}`);
}

let passed = 0;
let total = 0;
const failures = [];
function check(name, ok, detail = '') {
  total += 1;
  if (ok) passed += 1;
  else failures.push(name);
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${name}${detail ? `  (${detail})` : ''}`);
}

async function api(path, init) {
  const response = await fetch(`${BASE}${path}`, init);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, body };
}

function findChromium() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  if (fs.existsSync('/nix/store')) {
    const dirs = fs
      .readdirSync('/nix/store')
      .filter((dir) => /-chromium-\d/.test(dir) && !dir.includes('unwrapped'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const bin = `/nix/store/${dir}/bin/chromium`;
      if (fs.existsSync(bin)) return bin;
    }
  }
  return undefined;
}

async function ensureServer() {
  try {
    const response = await fetch(`${BASE}/`);
    if (response.ok) return null;
  } catch {
    /* not up */
  }
  if (!fs.existsSync('.next/BUILD_ID')) {
    console.log('no production build found; building…');
    const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
    if (build.status !== 0) throw new Error('next build failed');
  }
  console.log(`starting server at ${BASE}…`);
  const child = spawn('npm', ['run', 'start'], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return child;
    } catch {
      /* keep waiting */
    }
  }
  throw new Error('server did not start');
}

/* ------------------------------------------------------------------ seed */

async function seedSkill(name, steps) {
  const created = await api('/api/skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordingId: 'e2e',
      name,
      trigger: { type: 'phrase', value: 'e2e' },
      steps,
      profileId: null,
    }),
  });
  if (!created.ok) throw new Error(`seed skill failed: ${created.body.error}`);
  return created.body.id;
}

async function runSkillAndWait(skillId, { until = 'failed', timeoutMs = 90_000 } = {}) {
  const kick = await api(`/api/skills/${skillId}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ params: {} }),
  });
  if (!kick.ok) throw new Error(`run failed to start: ${kick.body.error}`);
  const runId = kick.body.runId;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1000);
    const poll = await api(`/api/runs/${runId}`);
    const status = poll.body.run?.status;
    if (status && status !== 'running') return { runId, status, record: poll.body.run };
  }
  throw new Error(`run ${runId} did not reach ${until} in time`);
}

/* ------------------------------------------------------------------ main */

async function main() {
  const server = await ensureServer();
  const createdSkills = [];

  const normalName = `E2E Normal ${Date.now()}`;
  const deleteName = `E2E Delete ${Date.now()}`;
  const brokenName = `E2E Broken ${Date.now()}`;

  try {
    console.log(`\nbrowser E2E -> ${BASE}\n`);

    // seed: a normal loop, a throwaway loop, a loop that fails fast, and a compiled
    // recording for the review screen.
    createdSkills.push(
      await seedSkill(normalName, [
        { n: 1, action: 'goto', text: 'Go to example', url: 'https://example.com' },
        { n: 2, action: 'click', text: 'Click the info link', role: 'link', name: 'More information...' },
      ]),
    );
    const deleteId = await seedSkill(deleteName, [
      { n: 1, action: 'goto', text: 'Go to example', url: 'https://example.com' },
    ]);
    createdSkills.push(deleteId);
    const brokenId = await seedSkill(brokenName, [
      { n: 1, action: 'goto', text: 'Go to a dead host', url: 'https://nonexistent-e2e-host.invalid' },
    ]);
    createdSkills.push(brokenId);

    const compiled = await api('/api/compile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixture: 'roundtrip-events' }),
    });
    const recordingId = compiled.body.id;

    const chromePath = findChromium();
    console.log(`browser: ${chromePath ?? 'playwright default'}\n`);
    const browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await (
        await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
      ).newPage();
      page.setDefaultTimeout(10_000);
      const main = page.getByRole('main');

      /* --- Loops home -------------------------------------------------- */
      console.log('Loops home');
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      check('home shows the Loops heading', (await page.getByRole('heading', { name: 'Loops' }).count()) > 0);
      check('seeded loop is listed', (await main.getByRole('link', { name: normalName }).count()) > 0);
      await shot(page, 'loops-home');

      await page.getByPlaceholder('Search loops…').fill('zzz-no-such-loop');
      await page.getByText('No loops match').waitFor({ state: 'visible' });
      check('search shows the no-match state', true);
      await shot(page, 'loops-search-empty');
      await page.getByPlaceholder('Search loops…').fill(normalName);
      check('search filters to the loop', (await main.getByRole('link', { name: normalName }).count()) > 0);

      /* --- Loop detail ------------------------------------------------- */
      console.log('Loop detail');
      await main.getByRole('link', { name: normalName }).click();
      await page.waitForURL(`**/loops/${createdSkills[0]}`);
      check('detail shows the step list', (await page.getByText('Click the info link').count()) > 0);
      check('detail offers Run now', (await page.getByRole('button', { name: /Run now/ }).count()) > 0);
      await shot(page, 'loop-detail');

      /* --- New loop chooser -------------------------------------------- */
      console.log('New loop');
      await page.goto(`${BASE}/new`, { waitUntil: 'domcontentloaded' });
      check('chooser offers both methods', (await page.getByText('Record it yourself').count()) > 0 && (await page.getByText('Describe it').count()) > 0);
      await shot(page, 'new-chooser');

      await page.getByRole('button', { name: /Record it yourself/ }).click();
      check('record form asks for a URL', (await page.getByText('Starting URL (optional)').count()) > 0);
      check('record form has a start button', (await page.getByRole('button', { name: /Start recording/ }).count()) > 0);
      await shot(page, 'new-record-form');

      await page.getByRole('button', { name: /Change method/ }).click();
      await page.getByRole('button', { name: /Describe it/ }).click();
      check('agent form asks for a goal', (await page.getByLabel('Goal').count()) > 0);
      check('agent form has a run button', (await page.getByRole('button', { name: /Run the agent/ }).count()) > 0);
      await shot(page, 'new-agent-form');

      /* --- Review ------------------------------------------------------ */
      console.log('Review');
      await page.goto(`${BASE}/review/${recordingId}`, { waitUntil: 'domcontentloaded' });
      check('review shows the compiled steps', (await page.getByText('Steps').count()) > 0);
      const pill = page.getByRole('button', { name: /buy milk/ }).first();
      if ((await pill.count()) > 0) {
        await pill.click();
        const variable = page.getByRole('button', { name: /Changes each time/ });
        if ((await variable.count()) > 0) {
          await variable.click();
          check('value pill switches to "changes each time"', true);
        } else {
          check('value pill opens its menu', (await page.getByRole('button', { name: /Always the same/ }).count()) > 0);
        }
      } else {
        check('review exposes a value pill', false, 'no pill found');
      }
      await page.getByRole('button', { name: /Raw events/ }).click();
      await page.getByText('Original events').waitFor({ state: 'visible' });
      check('raw events open in a sheet', true);
      await page.waitForTimeout(350);
      await shot(page, 'review-raw-events');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
      await shot(page, 'review');
      await page.getByRole('button', { name: /Looks good, save it/ }).click();
      await page.getByText('Saved.').waitFor({ state: 'visible' });
      check('saving a loop succeeds', true);
      await shot(page, 'review-saved');
      const runIt = page.getByRole('link', { name: /Run it now/ });
      const savedHref = await runIt.getAttribute('href');
      const savedId = savedHref?.split('/loops/')[1]?.split('?')[0];
      if (savedId) createdSkills.push(savedId);

      /* --- Parameterized run opens the form (no auto-run) -------------- */
      console.log('Parameterized run');
      const paramName = `E2E Params ${Date.now()}`;
      const paramId = await seedSkill(paramName, [
        { n: 1, action: 'goto', text: 'Go to example', url: 'https://example.com' },
        {
          n: 2,
          action: 'fill',
          text: 'Type the term',
          css: '#q',
          role: 'textbox',
          name: 'Query',
          value: 'hello',
          param: { name: 'term', mode: 'variable', value: 'hello' },
        },
      ]);
      createdSkills.push(paramId);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      const paramRow = page.locator('tr', { has: page.getByRole('link', { name: paramName }) });
      await paramRow.getByRole('button', { name: 'Run' }).click();
      await page.waitForURL(`**/loops/${paramId}?run=1`);
      await page.getByText('Fill in the values that change each run.').waitFor({ state: 'visible' });
      check('parameterized Run opens the inputs form', true);
      check(
        'parameterized Run does not auto-start',
        (await page.locator('iframe[title="Steel live session"]').count()) === 0,
      );
      await shot(page, 'loop-params');

      /* --- Delete ------------------------------------------------------ */
      console.log('Delete');
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      const row = page.locator('tr', { has: page.getByRole('link', { name: deleteName }) });
      await row.getByRole('button', { name: 'Loop actions' }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.getByText('Delete this loop?').waitFor({ state: 'visible' });
      check('delete asks for confirmation', true);
      await page.waitForTimeout(350);
      await shot(page, 'delete-dialog');
      await page
        .locator('[data-slot="alert-dialog-content"]')
        .getByRole('button', { name: 'Delete' })
        .click();
      await page.waitForTimeout(1200);
      check('loop is removed after confirming', (await main.getByRole('link', { name: deleteName }).count()) === 0);

      /* --- Runs + "Needs you" shows the browser ------------------------ */
      console.log('Runs / Needs you');
      const failed = await runSkillAndWait(brokenId, { until: 'failed' });
      check('broken loop fails as expected', failed.status === 'failed', failed.record?.error);

      await page.goto(`${BASE}/runs`, { waitUntil: 'domcontentloaded' });
      const runRow = page.locator('tr', { has: page.getByRole('link', { name: brokenName }) });
      check('failed run is listed as Needs you', (await runRow.getByText('Needs you').count()) > 0);
      await shot(page, 'runs');

      await runRow.getByRole('link', { name: brokenName }).click();
      await page.waitForURL(`**/loops/${brokenId}?runId=${failed.runId}`);
      check('run link attaches the specific run', page.url().includes(`runId=${failed.runId}`));
      await page.getByText('Needs you').first().waitFor({ state: 'visible' });
      check('failed run shows the Needs you state', true);
      const viewer = page.locator('iframe[title="Steel live session"]');
      await viewer.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      check('failed run shows the live browser', (await viewer.count()) > 0);
      check('failed run offers Take over', (await page.getByRole('link', { name: /Take over/ }).count()) > 0);
      await shot(page, 'needs-you-browser');

      /* --- Cleanup verification ---------------------------------------- */
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      check('normal loop still present at the end', (await main.getByRole('link', { name: normalName }).count()) > 0);
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (error) {
    check('suite ran to completion', false, error instanceof Error ? error.message : String(error));
  } finally {
    // remove everything this run created
    for (const id of createdSkills) await api(`/api/skills/${id}`, { method: 'DELETE' }).catch(() => {});
    if (server?.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }

  console.log(`\n${passed}/${total} checks passed`);
  if (failures.length) console.log(`failed: ${failures.join('; ')}`);
  console.log(failures.length === 0 ? 'UI-E2E: PASS' : 'UI-E2E: FAIL');
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
