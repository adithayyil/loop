import test from 'node:test';
import assert from 'node:assert/strict';
import { elementCorroborates, parseVisionDecision, pngSize } from './vision-core.ts';

test('parseVisionDecision accepts arrays, numbers, and drifted strings', () => {
  assert.deepEqual(parseVisionDecision({ coordinates: [230, 278] }), { x: 230, y: 278 });
  assert.deepEqual(parseVisionDecision({ x: 12, y: 34 }), { x: 12, y: 34 });
  assert.deepEqual(parseVisionDecision({ x: '227, 209', y: 209 }), { x: 227, y: 209 });
});

test('parseVisionDecision declines on found:false or unusable input', () => {
  assert.equal(parseVisionDecision({ found: false, coordinates: [1, 2] }), null);
  assert.equal(parseVisionDecision({ coordinates: [1] }), null);
  assert.equal(parseVisionDecision({ x: 'abc', y: 'def' }), null);
  assert.equal(parseVisionDecision(undefined), null);
});

test('elementCorroborates blocks a labeled but unrelated control', () => {
  assert.equal(elementCorroborates('Download PDF', { text: 'Download PDF' }), true);
  assert.equal(elementCorroborates('Download PDF', { aria: 'download invoice' }), true);
  assert.equal(elementCorroborates('Download PDF', { text: 'Refresh' }), false);
});

test('elementCorroborates allows unlabeled or untargeted elements', () => {
  assert.equal(elementCorroborates('Download PDF', null), true);
  assert.equal(elementCorroborates('Download PDF', { text: '' }), true);
  assert.equal(elementCorroborates(null, { text: 'anything' }), true);
  assert.equal(elementCorroborates('a b', { text: 'anything' }), true);
});

test('pngSize reads width and height from the IHDR chunk', () => {
  const buf = Buffer.alloc(24);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(1280, 16);
  buf.writeUInt32BE(800, 20);
  assert.deepEqual(pngSize(buf.toString('base64')), { width: 1280, height: 800 });
});
