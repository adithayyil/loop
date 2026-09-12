import 'dotenv/config';
import { chromium } from 'playwright-core';
import Steel from 'steel-sdk';

const url = process.argv[2];
if (!url) throw new Error('usage: node tunnel-check.mjs <url>');

const client = new Steel({ steelAPIKey: process.env.STEEL_KEY });
const session = await client.sessions.create({ timeout: 120_000, debugConfig: { interactive: true } });
console.log('session', session.id);
const browser = await chromium.connectOverCDP(
  `wss://connect.steel.dev?apiKey=${process.env.STEEL_KEY}&sessionId=${session.id}`,
);
try {
  const page = browser.contexts()[0].pages()[0];
  const response = await page.goto(`${url}/demo/vendor/login`, { waitUntil: 'domcontentloaded' });
  const status = response?.status();
  const hasForm = await page.locator('[data-testid="login-button"]').count();
  const title = await page.title();
  console.log(JSON.stringify({ status, title, hasForm }));
} finally {
  await browser.close().catch(() => {});
  await client.sessions.release(session.id).catch(() => {});
  console.log('released');
}
