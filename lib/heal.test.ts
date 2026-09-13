import test from 'node:test';
import assert from 'node:assert/strict';
import { patchFromHealDecision } from './heal.ts';

test('patchFromHealDecision prefers data-testid and clears the old locator fields', () => {
  const patch = patchFromHealDecision({ found: true, dataTest: 'download' });
  assert.deepEqual(patch, { css: null, role: null, name: null, dataTest: 'download' });
});

test('patchFromHealDecision builds a role+name patch with nth', () => {
  const patch = patchFromHealDecision({ found: true, role: 'button', name: 'Download', nth: 2 });
  assert.deepEqual(patch, {
    css: null,
    role: 'button',
    name: 'Download',
    dataTest: null,
    nth: 2,
  });
});

test('patchFromHealDecision falls back to css, then visible text', () => {
  assert.deepEqual(patchFromHealDecision({ found: true, css: '.row .dl' }), {
    css: '.row .dl',
    role: null,
    name: null,
    dataTest: null,
  });
  assert.deepEqual(patchFromHealDecision({ found: true, name: 'Download' }), {
    css: null,
    role: null,
    name: 'Download',
    dataTest: null,
  });
});

test('patchFromHealDecision returns null when nothing usable was found', () => {
  assert.equal(patchFromHealDecision({ found: false, role: 'button', name: 'x' }), null);
  assert.equal(patchFromHealDecision({ found: true }), null);
});
