// Spike final: full product-path round trip on TodoMVC (React), no human needed.
// Session 1: inject OUR recorder, perform actions via Playwright (stands in for the
// human viewer), capture NDJSON with values. Compile NDJSON -> actions.
// Session 2 (fresh): replay compiled actions, verify end state.
import 'dotenv/config';
import { chromium } from 'playwright-core';
import Steel from 'steel-sdk';
import fs from 'node:fs';

const URL = 'https://todomvc.com/examples/react/dist/';
const client = new Steel({ steelAPIKey: process.env.STEEL_KEY });
const connect = (id) => chromium.connectOverCDP(
  `wss://connect.steel.dev?apiKey=${process.env.STEEL_KEY}&sessionId=${id}`);

const RECORDER = `(() => {
  if (window.__loopRecorder) return; window.__loopRecorder = true;
  function info(el) {
    const role = el.getAttribute('role')
      || ({ BUTTON:'button', A:'link', SELECT:'combobox' }[el.tagName])
      || (el.tagName === 'INPUT' ? ({ checkbox:'checkbox', radio:'radio' }[el.type] || 'textbox') : null);
    let css = el.tagName.toLowerCase();
    if (el.id) css += '#' + CSS.escape(el.id);
    else if (el.className && typeof el.className === 'string') css += '.' + el.className.trim().split(/\\s+/)[0];
    return { css, role, name: el.getAttribute('aria-label') || (el.innerText || '').trim().slice(0, 60)
      || el.placeholder || null, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
      inputType: el.type || null, checked: el.checked ?? null };
  }
  document.addEventListener('click', e => window.__loopEmit({ type: 'click', url: location.href, ...info(e.target) }), true);
  document.addEventListener('change', e => window.__loopEmit({ type: 'change', url: location.href, value: e.target.value, ...info(e.target) }), true);
  document.addEventListener('keydown', e => { if (e.key === 'Enter') window.__loopEmit({ type: 'enter', url: location.href, value: e.target.value, ...info(e.target) }); }, true);
})();`;

// ---------- session 1: record ----------
const s1 = await client.sessions.create({ timeout: 300_000, inactivityTimeout: 60_000 });
const b1 = await connect(s1.id);
const ctx1 = b1.contexts()[0];
const page1 = ctx1.pages()[0];
const events = [];
await ctx1.exposeBinding('__loopEmit', (_s, ev) => events.push({ ts: Date.now(), ...ev }));
await ctx1.addInitScript(RECORDER);
await page1.goto(URL, { waitUntil: 'domcontentloaded' });

// "human" actions
await page1.locator('.new-todo').click();
await page1.locator('.new-todo').pressSequentially('buy milk');
await page1.keyboard.press('Enter');
await page1.locator('.new-todo').pressSequentially('pay invoice');
await page1.keyboard.press('Enter');
await page1.locator('.todo-list li .toggle').first().click();
await page1.getByRole('link', { name: 'Active' }).click();
await page1.waitForTimeout(500);
fs.writeFileSync('recordings/roundtrip-events.ndjson', events.map(e => JSON.stringify(e)).join('\n'));
console.log('RECORDED', events.length, 'events');
await client.sessions.release(s1.id);

// ---------- compile ----------
// collapse: keep last change/enter per element before a click; drops empty fills
const actions = [{ kind: 'goto', url: URL }];
for (const e of events) {
  if (e.type === 'enter' && e.value?.trim()) actions.push({ kind: 'type+enter', sel: e.css, value: e.value });
  else if (e.type === 'click' && e.role === 'checkbox') actions.push({ kind: 'click', sel: e.css, note: 'toggle' });
  else if (e.type === 'click' && e.role === 'link') actions.push({ kind: 'click', sel: e.css, role: 'link', name: e.name });
}
console.log('COMPILED', JSON.stringify(actions, null, 1));

// ---------- session 2: replay ----------
const s2 = await client.sessions.create({ timeout: 300_000, inactivityTimeout: 60_000 });
const b2 = await connect(s2.id);
const page2 = b2.contexts()[0].pages()[0];
for (const a of actions) {
  if (a.kind === 'goto') await page2.goto(a.url, { waitUntil: 'domcontentloaded' });
  else if (a.kind === 'type+enter') {
    await page2.locator(a.sel).pressSequentially(a.value);
    await page2.keyboard.press('Enter');
  }
  else if (a.kind === 'click') {
    const loc = a.role === 'link' && a.name ? page2.getByRole('link', { name: a.name }) : page2.locator(a.sel);
    await loc.first().click();
  }
  await page2.waitForTimeout(300);
}
const todos = await page2.locator('.todo-list li').allTextContents();
const url2 = page2.url();
await page2.screenshot({ path: 'recordings/roundtrip-proof.png' });
console.log(`REPLAY RESULT url=${url2} todos=${JSON.stringify(todos)}`);
await client.sessions.release(s2.id);
const pass = url2.includes('#/active') && todos.length === 1 && todos[0].includes('pay invoice');
console.log(pass ? 'ROUNDTRIP: PASS' : 'ROUNDTRIP: FAIL');
process.exit(pass ? 0 : 1);
