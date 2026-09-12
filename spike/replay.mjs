// Spike B: replay the recorded task unattended in a FRESH Steel session.
// Compiles agent-traces -> actions with a locator fallback chain
// (testId > id > role+name > css), executes over CDP, verifies end state.
import 'dotenv/config';
import { chromium } from 'playwright-core';
import Steel from 'steel-sdk';
import fs from 'node:fs';

const traces = JSON.parse(fs.readFileSync('recordings/spike-traces.json'));
// values Steel redacts from traces (our own recorder captures these in-product)
const KNOWN_VALUES = { username: 'standard_user', password: 'secret_sauce' };

// ---- compile traces -> actions ----
const actions = [];
const fills = new Map(); // dedupe repeated change events per target
for (const e of traces.events) {
  if (e.type === 'click' && e.target) {
    actions.push({ kind: 'click', target: e.target });
  } else if (e.type === 'change' && e.target?.attributes?.testId) {
    fills.set(e.target.attributes.testId, { kind: 'fill', target: e.target });
  } else if (e.type === 'navigate' && e.page?.url && actions.length === 0) {
    actions.push({ kind: 'goto', url: e.page.url });
  }
}
// merge fills in order of last change before next click — spike simplification:
// put fills right before the first click that follows them in trace order
const compiled = [];
for (const a of actions) {
  if (a.kind === 'click') { for (const [k, f] of fills) { compiled.push(f); fills.delete(k); } }
  compiled.push(a);
}
if (!compiled.some(a => a.kind === 'goto')) compiled.unshift({ kind: 'goto', url: 'https://www.saucedemo.com/' });
console.log('COMPILED', compiled.map(a => a.kind + ':' + (a.target?.attributes?.testId ?? a.url)).join(' | '));

// ---- locator chain ----
function locate(page, t) {
  if (t.selector?.testId) return page.locator(t.selector.testId).first();
  if (t.selector?.id) return page.locator(t.selector.id).first();
  if (t.role && t.accessibleName) return page.getByRole(t.role, { name: t.accessibleName }).first();
  return page.locator(t.selector.css).first();
}

// ---- run in a fresh session ----
const client = new Steel({ steelAPIKey: process.env.STEEL_KEY });
const session = await client.sessions.create({ timeout: 300_000, inactivityTimeout: 60_000 });
console.log('REPLAY_SESSION=' + session.id);
const browser = await chromium.connectOverCDP(
  `wss://connect.steel.dev?apiKey=${process.env.STEEL_KEY}&sessionId=${session.id}`);
const page = browser.contexts()[0].pages()[0];

let ok = 0;
for (const a of compiled) {
  try {
    if (a.kind === 'goto') { await page.goto(a.url, { waitUntil: 'domcontentloaded' }); }
    else if (a.kind === 'click') {
      const nav = page.waitForURL(u => u.href !== page.url(), { timeout: 4000 }).catch(() => null);
      await locate(page, a.target).click({ timeout: 8000 });
      await nav; // settle if this click navigates
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
    else if (a.kind === 'fill') {
      const v = KNOWN_VALUES[a.target.attributes.testId];
      if (v == null) { console.log('SKIP fill (no known value):', a.target.attributes.testId); continue; }
      await locate(page, a.target).fill(v, { timeout: 8000 });
    }
    ok++; console.log('OK  ', a.kind, a.target?.attributes?.testId ?? a.url ?? '');
  } catch (err) {
    console.log('FAIL', a.kind, a.target?.attributes?.testId ?? '', '|', err.message.split('\n')[0]);
  }
  await page.waitForTimeout(300);
}

// ---- verify ----
await page.waitForLoadState('domcontentloaded').catch(() => {});
const url = page.url();
const badge = await page.locator('.shopping_cart_badge').textContent().catch(() => null);
const cartItems = await page.locator('.cart_item').count().catch(() => 0);
await page.screenshot({ path: 'recordings/replay-proof.png' });
console.log(`RESULT url=${url} badge=${badge} cartItems=${cartItems} steps_ok=${ok}/${compiled.length}`);

await client.sessions.release(session.id);
console.log('REPLAY_SESSION_RELEASED');
process.exit(url.includes('cart') && cartItems === 1 ? 0 : 1);
