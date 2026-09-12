// Debug: why do React onClick handlers not fire from Playwright clicks on saucedemo?
import 'dotenv/config';
import { chromium } from 'playwright-core';
import Steel from 'steel-sdk';

const client = new Steel({ steelAPIKey: process.env.STEEL_KEY });
const session = await client.sessions.create({ timeout: 300_000, inactivityTimeout: 60_000 });
const browser = await chromium.connectOverCDP(
  `wss://connect.steel.dev?apiKey=${process.env.STEEL_KEY}&sessionId=${session.id}`);
const page = browser.contexts()[0].pages()[0];
page.on('console', m => console.log('[page]', m.type(), m.text().slice(0, 120)));
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto('https://www.saucedemo.com/', { waitUntil: 'domcontentloaded' });
await page.locator('[data-test="username"]').fill('standard_user');
await page.locator('[data-test="password"]').fill('secret_sauce');
await page.locator('[data-test="login-button"]').click();
await page.waitForURL('**/inventory.html', { timeout: 10000 });
console.log('logged in:', page.url());
console.log('webdriver:', await page.evaluate(() => navigator.webdriver));

const btn = page.locator('[data-test="add-to-cart-sauce-labs-bike-light"]');
console.log('buttons matched:', await btn.count());

// 1) playwright click
await btn.click();
await page.waitForTimeout(1000);
console.log('after pw click   -> label:', await btn.textContent(), '| badge:', await page.locator('.shopping_cart_badge').textContent().catch(() => 'none'));

// 2) raw coordinate click (mimics human-in-viewer)
const box = await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(1000);
console.log('after coord click -> badge:', await page.locator('.shopping_cart_badge').textContent().catch(() => 'none'));

// 3) JS dispatch (synthetic, untrusted) for comparison
await page.evaluate(() => document.querySelector('[data-test="add-to-cart-onesie"]').click());
await page.waitForTimeout(1000);
console.log('after js click   -> badge:', await page.locator('.shopping_cart_badge').textContent().catch(() => 'none'));

await page.screenshot({ path: 'recordings/debug-click.png' });
await client.sessions.release(session.id);
process.exit(0);
