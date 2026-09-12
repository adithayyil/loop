// Produce a backup demo video: drive the golden path in a Steel session, then
// pull the session's HLS recording and mux it to mp4 with ffmpeg.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import Steel from 'steel-sdk';

const TUNNEL = process.argv[2];
if (!TUNNEL) throw new Error('usage: node backup-video.mjs <tunnel-origin>');
const FFMPEG = process.env.FFMPEG ?? '/nix/store/a2qfg58bz9c68lqgr4id8g2vvqdagman-ffmpeg-9.0.1-bin/bin/ffmpeg';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new Steel({ steelAPIKey: process.env.STEEL_KEY });
const session = await client.sessions.create({
  persistProfile: true,
  timeout: 300_000,
  debugConfig: { interactive: true },
});
console.log('session', session.id);

const browser = await chromium.connectOverCDP(
  `wss://connect.steel.dev?apiKey=${process.env.STEEL_KEY}&sessionId=${session.id}`,
);
try {
  const page = browser.contexts()[0].pages()[0];
  await page.goto(`${TUNNEL}/demo/vendor/login`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await page.getByTestId('username').fill('vendor');
  await sleep(500);
  await page.getByTestId('password').fill('hunter2');
  await sleep(500);
  await page.locator('[data-testid="login-button"]').click();
  await page.waitForURL('**/demo/vendor', { timeout: 15000 });
  await sleep(800);
  await page.getByRole('link', { name: 'Unpaid' }).click();
  await sleep(1200);
  await page.locator('[data-testid="download-INV-1001"]').click();
  await sleep(2000);
  await page.screenshot({ path: 'recordings/backup-final.png' });
} finally {
  await browser.close().catch(() => {});
}

const hlsUrl = `https://api.steel.dev/v1/sessions/${session.id}/hls`;
async function probe(label) {
  const res = await fetch(hlsUrl, { headers: { 'steel-api-key': process.env.STEEL_KEY } }).catch((e) => ({ status: 0, text: async () => e.message }));
  const text = typeof res.text === 'function' ? await res.text() : '';
  console.log(label, 'status', res.status, '| first line:', text.split('\n')[0]?.slice(0, 80));
  return text.startsWith('#EXTM3U') ? text : null;
}

let playlist = await probe('HLS while live:');
if (!playlist) {
  await sleep(2000);
  playlist = await probe('HLS before release:');
}
await client.sessions.release(session.id).catch(() => {});
if (!playlist) {
  await sleep(4000);
  playlist = await probe('HLS after release:');
}

if (playlist) {
  try {
    execFileSync(
      FFMPEG,
      ['-y', '-headers', `steel-api-key: ${process.env.STEEL_KEY}\r\n`, '-i', hlsUrl, '-c', 'copy', 'recordings/backup-demo.mp4'],
      { stdio: 'inherit' },
    );
    const size = fs.statSync('recordings/backup-demo.mp4').size;
    console.log('WROTE recordings/backup-demo.mp4', size, 'bytes');
  } catch (error) {
    console.log('ffmpeg failed:', error.message);
  }
} else {
  console.log('no HLS playlist available');
}
