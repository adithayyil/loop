// Debug 3: raw CDP input + hit-test at the button center + target inventory
import 'dotenv/config';
import { chromium } from 'playwright-core';
import Steel from 'steel-sdk';

const client = new Steel({ steelAPIKey: process.env.STEEL_KEY });
const session = await client.sessions.create({ timeout: 300_000, inactivityTimeout: 60_000 });
const browser = await chromium.connectOverCDP(
  `wss://connect.steel.dev?apiKey=${process.env.STEEL_KEY}&sessionId=${session.id}`);
const ctx = browser.contexts()[0];
console.log('pages:', ctx.pages().map(p => p.url()));

const page = ctx.pages()[0];
await page.goto('https://www.saucedemo.com/', { waitUntil: 'domcontentloaded' });
await page.locator('[data-test="username"]').fill('standard_user');
await page.locator('[data-test="password"]').fill('secret_sauce');
await page.locator('[data-test="login-button"]').click();
await page.waitForURL('**/inventory.html');

const info = await page.evaluate(() => {
  const el = document.querySelector('[data-test="add-to-cart-sauce-labs-bike-light"]');
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return { cx, cy, hitTag: hit?.tagName, hitTestId: hit?.getAttribute('data-test'),
    hitIsButton: hit === el, vw: innerWidth, vh: innerHeight,
    hasFocus: document.hasFocus(), visState: document.visibilityState };
});
console.log('hit-test:', info);

// raw CDP mouse events
const cdp = await ctx.newCDPSession(page);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.cx, y: info.cy });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.cx, y: info.cy, button: 'left', clickCount: 1 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.cx, y: info.cy, button: 'left', clickCount: 1 });
await page.waitForTimeout(1000);
console.log('badge after raw CDP:', await page.locator('.shopping_cart_badge').textContent().catch(() => 'none'));

// check what onclick does when invoked through React props directly
const direct = await page.evaluate(() => {
  const el = document.querySelector('[data-test="add-to-cart-sauce-labs-backpack"]');
  const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps'));
  const props = el[propsKey];
  try { props.onClick?.({}); return 'onClick invoked, badge=' + (document.querySelector('.shopping_cart_badge')?.textContent ?? 'none'); }
  catch (e) { return 'onClick threw: ' + e.message; }
});
console.log('direct react onClick:', direct);
await page.waitForTimeout(500);
console.log('badge now:', await page.locator('.shopping_cart_badge').textContent().catch(() => 'none'));

await client.sessions.release(session.id);
process.exit(0);
