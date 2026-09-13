// Seed real, useful "record it yourself" loops into the library. Each is recorded,
// compiled, saved, then verified with a replay; a scenario that fails verification is
// deleted so the library only keeps working loops.
//
// Run: node --experimental-strip-types spike/seed-demo.mjs
import 'dotenv/config';
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, init) {
  const response = await fetch(`${BASE}${path}`, init);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, body };
}

async function record(target, human) {
  const start = await api('/api/recordings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startUrl: target }),
  });
  if (!start.ok) throw new Error(`start failed: ${start.body.error}`);
  const browser = await chromium.connectOverCDP(
    `wss://connect.steel.dev?apiKey=${process.env.STEEL_KEY}&sessionId=${start.body.sessionId}`,
  );
  let landed = '';
  try {
    const page = browser.contexts()[0].pages()[0];
    await human(page);
    landed = page.url();
  } finally {
    await browser.close().catch(() => {});
  }
  const stop = await api(`/api/recordings/${start.body.id}/stop`, { method: 'POST' });
  if (!stop.ok) throw new Error(`stop failed: ${stop.body.error}`);
  return { recordingId: start.body.id, result: stop.body.result, profileId: stop.body.recording?.profileId, landed };
}

async function run(skillId, params) {
  const kick = await api(`/api/skills/${skillId}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ params }),
  });
  let record;
  for (let i = 0; i < 120; i += 1) {
    await sleep(1000);
    record = (await api(`/api/runs/${kick.body.runId}`)).body.run;
    if (record?.status !== 'running') break;
  }
  return record;
}

async function seed({ name, phrase, target, human, runParams, assertReplay }) {
  console.log(`\n=== ${name} ===`);

  // Idempotent: replace any earlier seed with the same name.
  const existing = await api('/api/skills');
  for (const skill of existing.body.skills ?? []) {
    if (skill.name === name) await api(`/api/skills/${skill.id}`, { method: 'DELETE' });
  }

  const rec = await record(target, human);
  const steps = rec.result?.steps ?? [];
  console.log(`  record landed on: ${rec.landed}`);
  console.log(`  compiled ${steps.length} steps:`);
  for (const step of steps) {
    console.log(`    ${step.n}. ${step.text}${step.param ? `  [${step.param.mode}: ${step.param.name}]` : ''}`);
  }

  const save = await api('/api/skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordingId: rec.recordingId,
      name,
      trigger: { type: 'phrase', value: phrase },
      steps,
      profileId: rec.profileId ?? null,
    }),
  });
  if (!save.ok) throw new Error(`save failed: ${save.body.error}`);
  const skillId = save.body.id;

  const params = runParams ? runParams(steps) : {};
  const result = await run(skillId, params);
  const finalUrl = result?.result?.finalUrl ?? '';
  const ok = result?.status === 'done' && (!assertReplay || assertReplay(finalUrl, result));
  console.log(`  replay: status=${result?.status} steps=${result?.result?.stepsRun}/${result?.result?.totalSteps} url=${finalUrl}`);

  if (ok) {
    console.log(`  KEPT (skill ${skillId})`);
    return { name, skillId, kept: true };
  }
  await api(`/api/skills/${skillId}`, { method: 'DELETE' });
  console.log(`  DELETED (replay did not verify) — reason: ${result?.result?.error ?? 'assertion failed'}`);
  return { name, kept: false };
}

const results = [];
const attempt = async (label, fn) => {
  try {
    results.push(await fn());
  } catch (error) {
    console.log(`  ${label} failed: ${error instanceof Error ? error.message : error}`);
    results.push({ name: label, kept: false });
  }
};

// 1. Wikipedia: turn a topic into a quick lookup. Proven to replay with a new topic.
await attempt('Look up a topic on Wikipedia', () =>
  seed({
    name: 'Look up a topic on Wikipedia',
    phrase: 'look up on wikipedia',
    target: 'https://en.wikipedia.org/wiki/Main_Page',
    human: async (page) => {
      const box = page.getByRole('searchbox').first();
      await box.waitFor({ timeout: 20_000 });
      await box.fill('Photosynthesis');
      await page.keyboard.press('Enter');
      await page.waitForURL('**/wiki/Photosynthesis**', { timeout: 15_000 }).catch(() => {});
      await sleep(700);
    },
    runParams: (steps) => {
      const variable = steps.find((s) => s.param?.mode === 'variable') ?? steps.find((s) => s.value);
      return variable?.param?.name ? { [variable.param.name]: 'Mitochondrion' } : {};
    },
    // Wikipedia canonicalizes titles (Mitochondrion -> Mitochondria), so just require a
    // /wiki/ article that isn't the originally recorded term.
    assertReplay: (url) => url.includes('/wiki/') && !url.includes('/wiki/Photosynthesis'),
  }),
);

// 2. Gutenberg: look up a book and download it (exercise the Files API).
await attempt('Download a book from Project Gutenberg', () =>
  seed({
    name: 'Download a book from Project Gutenberg',
    phrase: 'download a book from gutenberg',
    target: 'https://www.gutenberg.org/',
    human: async (page) => {
      const box = page.locator('input[name="query"], #query').first();
      await box.waitFor({ timeout: 20_000 });
      await box.fill('Moby Dick');
      await page.keyboard.press('Enter');
      await page.waitForURL('**/ebooks/search/**', { timeout: 15_000 }).catch(() => {});
      await page.locator('.booklink a').first().click();
      await page.waitForURL('**/ebooks/**', { timeout: 15_000 }).catch(() => {});
      await sleep(500);
      await page.getByRole('link', { name: /EPUB/i }).first().click();
      await sleep(3000);
    },
    assertReplay: (_url, result) => (result?.result?.files?.length ?? 0) > 0,
  }),
);

console.log('\n--- summary ---');
for (const r of results) console.log(`  ${r.kept ? 'kept  ' : 'skip  '} ${r.name}${r.skillId ? ` (${r.skillId})` : ''}`);
process.exit(results.some((r) => r.kept) ? 0 : 1);
