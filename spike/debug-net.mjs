// Debug 2: which resources 401, and is React actually alive?
import 'dotenv/config';
import { chromium } from 'playwright-core';
import Steel from 'steel-sdk';

const client = new Steel({ steelAPIKey: process.env.STEEL_KEY });
const session = await client.sessions.create({ timeout: 300_000, inactivityTimeout: 60_000 });
const browser = await chromium.connectOverCDP(
  `wss://connect.steel.dev?apiKey=${process.env.STEEL_KEY}&sessionId=${session.id}`);
const page = browser.contexts()[0].pages()[0];
page.on('response', r => { if (r.status() >= 400) console.log('[http', r.status() + ']', r.url()); });

await page.goto('https://www.saucedemo.com/', { waitUntil: 'networkidle' });
console.log('scripts on page:');
for (const s of await page.locator('script[src]').all())
  console.log('  ', await s.getAttribute('src'), '| executed? unknown');

await page.locator('[data-test="username"]').fill('standard_user');
await page.locator('[data-test="password"]').fill('secret_sauce');
await page.locator('[data-test="login-button"]').click();
await page.waitForURL('**/inventory.html', { timeout: 10000 });
await page.waitForLoadState('networkidle').catch(() => {});
console.log('on inventory');

// is React alive? check a React-managed prop + try the hamburger menu (pure React toggle)
console.log('react fiber on button:', await page.evaluate(() => {
  const el = document.querySelector('[data-test="add-to-cart-sauce-labs-bike-light"]');
  return Object.keys(el).filter(k => k.startsWith('__react'));
}));
await page.locator('#react-burger-menu-btn').click();
await page.waitForTimeout(800);
console.log('menu visible after burger click:', await page.locator('.bm-menu-wrap').isVisible().catch(() => 'n/a'),
  '| aria-hidden:', await page.locator('.bm-menu-wrap').getAttribute('aria-hidden').catch(() => 'n/a'));

// click via evaluate with full mouse event sequence on the exact element
const r = await page.evaluate(() => {
  const el = document.querySelector('[data-test="add-to-cart-sauce-labs-bike-light"]');
  const rect = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window, button: 0,
    clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
  for (const t of ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
    el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, opts));
  return document.querySelector('.shopping_cart_badge')?.textContent ?? 'none';
});
console.log('badge after full synthetic sequence:', r);

await client.sessions.release(session.id);
process.exit(0);
