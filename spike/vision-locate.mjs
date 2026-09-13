// Spike: can a VLM ground a click target from a screenshot alone, and can Steel
// Computer execute that coordinate reliably? Ground truth is exact because the test
// page is drawn on a canvas by us, so we know each target's pixel rect. No tunnel:
// the page is injected over CDP with setContent.
//
// Run: node --experimental-strip-types spike/vision-locate.mjs
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright-core';
import { createSession, steelApiKey, steelClient } from '../lib/steel.ts';

const MODEL = process.env.LOOP_COMPILER_MODEL ?? 'claude-sonnet-4-5';
const WIDTH = 1280;
const HEIGHT = 800;
const LABELS = ['Export CSV', 'Filter Unpaid', 'Download PDF', 'Settings', 'Refresh'];

const PAGE = `<!doctype html><html><head><style>
html,body{margin:0;padding:0;overflow:hidden;background:#111}
canvas{display:block}
</style></head><body><canvas id="c"></canvas><script>
const c = document.getElementById('c');
c.width = window.innerWidth; c.height = window.innerHeight;
const ctx = c.getContext('2d');
window.__targets = {};
window.__lastHit = null;
function draw() {
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, c.width, c.height);
  for (const [name, t] of Object.entries(window.__targets)) {
    ctx.fillStyle = t.color; ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px sans-serif';
    ctx.fillText(name, t.x + 20, t.y + t.h / 2 + 8);
  }
}
window.__setup = (targets) => { window.__targets = targets; draw(); };
c.addEventListener('click', (e) => {
  const r = c.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  for (const [name, t] of Object.entries(window.__targets)) {
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) { window.__lastHit = name; return; }
  }
  window.__lastHit = 'MISS';
});
</script></body></html>`;

const SYSTEM = `A web app is drawn entirely on an HTML canvas, so there is no DOM or accessibility
tree to query. You are given a screenshot of it. Find the center of the requested
control and return its pixel coordinates measured from the top-left of the image, in
the same pixel grid as the image you were given.

Only report a control whose visible text matches the request. If no control with that
text is present, set found to false and return no coordinates. Never substitute a
different or similar-looking control just to return a location.`;

const TOOL = {
  name: 'locate_target',
  description: 'Return the center pixel coordinates of the requested control.',
  input_schema: {
    type: 'object',
    properties: {
      found: { type: 'boolean', description: 'true only if a control with the exact requested text is visible' },
      coordinates: {
        type: 'array',
        items: { type: 'number' },
        minItems: 2,
        maxItems: 2,
        description: '[x, y] center in image pixels; omit when found is false',
      },
      reason: { type: 'string' },
    },
    required: ['found'],
  },
};

/** Accept a [x,y] array, numeric x/y, or a comma-joined string, since models drift. */
function normalizeCoords(decision) {
  if (Array.isArray(decision.coordinates) && decision.coordinates.length >= 2) {
    const [x, y] = decision.coordinates.map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
  }
  const nums = [];
  for (const value of [decision.x, decision.y]) {
    if (typeof value === 'number') nums.push(value);
    else if (typeof value === 'string') for (const m of value.matchAll(/-?\d+(?:\.\d+)?/g)) nums.push(Number(m[0]));
  }
  return nums.length >= 2 && nums.every(Number.isFinite) ? [nums[0], nums[1]] : null;
}

function gridTargets(width, height) {
  const cols = 3;
  const rows = 2;
  const pad = 40;
  const cellW = (width - pad * (cols + 1)) / cols;
  const cellH = (height - pad * (rows + 1)) / rows;
  const colors = ['#e2483d', '#3d8be2', '#2fb56b', '#c78a2b', '#8b5cf6'];
  const targets = {};
  LABELS.forEach((label, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const w = 220;
    const h = 90;
    const cx = pad + col * (cellW + pad) + (cellW - w) / 2;
    const cy = pad + row * (cellH + pad) + (cellH - h) / 2;
    targets[label] = { x: Math.round(cx), y: Math.round(cy), w, h, color: colors[i] };
  });
  return targets;
}

const evalTarget = async (page, label) => page.evaluate((l) => window.__targets[l] ?? null, label);

/** Read width/height from a PNG (IHDR) base64 payload. */
function pngSize(base64) {
  const buf = Buffer.from(base64, 'base64');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const client = steelClient();
const session = await createSession(client, {
  timeout: 5 * 60 * 1000,
  dimensions: { width: WIDTH, height: HEIGHT },
});
const browser = await chromium.connectOverCDP(
  `wss://connect.steel.dev?apiKey=${steelApiKey()}&sessionId=${session.id}`,
);
const page = browser.contexts()[0].pages()[0];
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_KEY ?? '' });

const results = [];
try {
  await page.setContent(PAGE, { waitUntil: 'load' });
  const metrics = await page.evaluate(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));
  const targets = gridTargets(metrics.w, metrics.h);
  await page.evaluate((t) => window.__setup(t), targets);
  await page.waitForTimeout(300);
  const firstShot = await client.sessions.computer(session.id, { action: 'take_screenshot' });
  const shotSize = pngSize(firstShot.base64_image);
  const offset = { x: shotSize.width - metrics.w, y: shotSize.height - metrics.h };
  console.log(
    `viewport css=${metrics.w}x${metrics.h} dpr=${metrics.dpr} | steel screenshot=${JSON.stringify(shotSize)} | chrome offset=${offset.x},${offset.y}`,
  );

  const tests = [...LABELS, 'Delete account'];
  const probe = await client.sessions.computer(session.id, { action: 'take_screenshot' });
  console.log(`probe take_screenshot: ${probe.base64_image ? 'OK' : `FAIL ${JSON.stringify(probe)}`}`);
  for (const label of tests) {
    const expected = await evalTarget(page, label);
    const shotResp = await client.sessions.computer(session.id, { action: 'take_screenshot' });
    const shot = Buffer.from(shotResp.base64_image, 'base64');
    const started = Date.now();

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: shot.toString('base64') } },
            { type: 'text', text: `Find and click: "${label}". Return the center coordinates.` },
          ],
        },
      ],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
    });
    const use = message.content.find((b) => b.type === 'tool_use');
    const decision = use?.input ?? { found: false };
    const latency = Date.now() - started;
    if (label === LABELS[0]) console.log('  raw decision:', JSON.stringify(decision));

    const coords = decision.found === false ? null : normalizeCoords(decision);
    if (!coords) {
      results.push({ label, expected: Boolean(expected), found: false, latency, ok: !expected });
      console.log(`  ${label.padEnd(16)} not found  (expected ${expected ? 'a target' : 'none'})  ${latency}ms`);
      continue;
    }
    const [x, y] = coords;

    const body = { action: 'click_mouse', button: 'left', coordinates: [x, y] };
    try {
      await client.sessions.computer(session.id, body);
    } catch (err) {
      console.log(`  ${label.padEnd(16)} computer error for ${JSON.stringify(body)}: ${err?.error?.message ?? err.message}`);
      continue;
    }
    await page.waitForTimeout(150);
    const hit = await page.evaluate(() => window.__lastHit);
    const dx = expected ? x - (expected.x + expected.w / 2 + offset.x) : null;
    const dy = expected ? y - (expected.y + expected.h / 2 + offset.y) : null;
    const error = expected && dx != null && dy != null ? Math.round(Math.hypot(dx, dy)) : null;
    const ok = !expected ? hit === 'MISS' : hit === label;

    results.push({ label, expected: Boolean(expected), found: true, x, y, error, hit, latency, ok });
    console.log(
      `  ${label.padEnd(16)} (${x},${y}) err=${error ?? '-'}px  hit=${hit ?? 'none'}  ${ok ? 'OK' : 'FAIL'}  ${latency}ms`,
    );
  }
} finally {
  await browser.close().catch(() => {});
  await client.sessions.release(session.id).catch(() => {});
}

const positives = results.filter((r) => r.expected);
const hitRate = positives.length ? positives.filter((r) => r.ok).length / positives.length : 0;
const withError = positives.filter((r) => r.error != null);
const meanError = withError.length
  ? Math.round(withError.reduce((sum, r) => sum + r.error, 0) / withError.length)
  : null;
const negatives = results.filter((r) => !r.expected);
const declined = negatives.filter((r) => !r.found).length;
const wrongControl = negatives.filter((r) => r.hit && r.hit !== 'MISS' && r.hit != null).length;

console.log('');
console.log(`positive hit rate   : ${(hitRate * 100).toFixed(0)}%  (${positives.filter((r) => r.ok).length}/${positives.length})`);
console.log(`mean center error   : ${meanError ?? '-'}px (excluding browser chrome)`);
console.log(`abstention (model)  : declined ${declined}/${negatives.length}; clicked a wrong real control ${wrongControl}/${negatives.length}`);
console.log(
  `verdict             : ${hitRate >= 0.8 ? 'PASS on grounding+execution' : 'FAIL on grounding+execution'}; ` +
    'vision heals must be gated by post-action verification, not the model\'s self-reported not-found',
);
process.exit(hitRate >= 0.8 ? 0 : 1);
