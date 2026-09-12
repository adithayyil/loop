// Spike A: record a human-driven task in a Steel cloud session.
// - Prints the interactive debugUrl for the human to drive
// - Attaches Playwright over CDP and injects our own event recorder (fallback path)
// - On done-file (/tmp/opencode/loop-spike-done), pulls Steel agent-traces for comparison
// - Writes events to recordings/spike-events.ndjson, traces to recordings/spike-traces.json
import 'dotenv/config';
import { chromium } from 'playwright-core';
import Steel from 'steel-sdk';
import fs from 'node:fs';

const DONE_FILE = '/tmp/opencode/loop-spike-done';
const START_URL = 'https://www.saucedemo.com/';

fs.mkdirSync('recordings', { recursive: true });
try { fs.unlinkSync(DONE_FILE); } catch {}

const client = new Steel({ steelAPIKey: process.env.STEEL_KEY });

const session = await client.sessions.create({
  timeout: 600_000,          // 10 min
  inactivityTimeout: 180_000,
});
console.log('SESSION_ID=' + session.id);
console.log('DEBUG_URL=' + session.debugUrl);
console.log('--- Human: open the DEBUG_URL, do the task, then create the done file ---');

const wsUrl = `wss://connect.steel.dev?apiKey=${process.env.STEEL_KEY}&sessionId=${session.id}`;
const browser = await chromium.connectOverCDP(wsUrl);
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

const out = fs.createWriteStream('recordings/spike-events.ndjson', { flags: 'a' });
const emit = (ev) => { out.write(JSON.stringify({ ts: Date.now(), ...ev }) + '\n'); };

// recorder injected into every document
const RECORDER = `(() => {
  if (window.__loopRecorder) return; window.__loopRecorder = true;
  function info(el) {
    const r = el.getBoundingClientRect();
    const text = (el.innerText || el.value || '').trim().slice(0, 80);
    const role = el.getAttribute('role')
      || ({ BUTTON:'button', A:'link', SELECT:'combobox', TEXTAREA:'textbox' }[el.tagName])
      || (el.tagName === 'INPUT' ? ({ checkbox:'checkbox', radio:'radio', submit:'button', button:'button' }[el.type] || 'textbox') : null);
    let css = el.tagName.toLowerCase();
    if (el.id) css += '#' + CSS.escape(el.id);
    else {
      const dt = el.getAttribute('data-test') || el.getAttribute('data-testid');
      if (dt) css += '[data-test="' + dt + '"]';
      else if (el.name) css += '[name="' + el.name + '"]';
      else if (el.placeholder) css += '[placeholder="' + el.placeholder + '"]';
    }
    return { tag: el.tagName.toLowerCase(), css, role,
      name: el.getAttribute('aria-label') || text || el.placeholder || el.name || null,
      dataTest: el.getAttribute('data-test') || el.getAttribute('data-testid'),
      id: el.id || null, inputType: el.type || null,
      x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }
  document.addEventListener('click', (e) => {
    window.__loopEmit({ type: 'click', url: location.href, ...info(e.target) });
  }, true);
  document.addEventListener('change', (e) => {
    window.__loopEmit({ type: 'fill', url: location.href, value: e.target.value, ...info(e.target) });
  }, true);
})();`;

await context.exposeBinding('__loopEmit', (_src, ev) => emit(ev));
await context.addInitScript(RECORDER);
try { await page.evaluate(RECORDER); } catch (e) { console.log('inject-now failed:', e.message); }

page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) emit({ type: 'navigate', url: frame.url() });
});

await page.goto(START_URL);
console.log('RECORDER_READY');

// wait for done file
await new Promise((resolve) => {
  const t = setInterval(() => {
    if (fs.existsSync(DONE_FILE)) { clearInterval(t); resolve(); }
  }, 1000);
});
console.log('DONE_SIGNAL received, pulling agent-traces...');

const res = await fetch(`https://api.steel.dev/v1/sessions/${session.id}/agent-traces`, {
  headers: { 'steel-api-key': process.env.STEEL_KEY },
});
const traces = await res.json();
fs.writeFileSync('recordings/spike-traces.json', JSON.stringify(traces, null, 2));
console.log('TRACES_SAVED status=' + res.status + ' events=' + (traces.events?.length ?? 'n/a'));

await client.sessions.release(session.id);
console.log('SESSION_RELEASED');
process.exit(0);
