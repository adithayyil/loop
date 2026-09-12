import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deterministicSteps, normalize } from './compiler.ts';
import type { RecordedEvent } from './types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): RecordedEvent[] {
  return fs
    .readFileSync(path.join(here, 'fixtures', name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RecordedEvent);
}

test('normalize collapses focus clicks and redundant checkbox change', () => {
  const actions = normalize(loadFixture('roundtrip-events.ndjson'));

  assert.deepEqual(
    actions.map((a) => a.kind),
    ['goto', 'type+enter', 'type+enter', 'click', 'click'],
  );
  assert.equal(actions[0].url, 'https://todomvc.com/examples/react/dist/');
  assert.equal(actions[1].value, 'buy milk');
  assert.equal(actions[2].value, 'pay invoice');
  assert.equal(actions[3].role, 'checkbox');
  assert.equal(actions[3].note, 'toggle');
  assert.equal(actions[4].role, 'link');
  assert.equal(actions[4].name, 'Active');
});

test('normalize flushes pending fills before a submit click', () => {
  const url = 'https://example.com/login';
  const events: RecordedEvent[] = [
    { ts: 1, type: 'navigate', url },
    { ts: 2, type: 'change', url, value: 'vendor', css: '#username', role: 'textbox', name: 'Username' },
    { ts: 3, type: 'change', url, value: 'hunter2', css: '#password', role: 'textbox', name: 'Password' },
    { ts: 4, type: 'click', url, css: 'button[type="submit"]', role: 'button', name: 'Sign in' },
  ];

  const actions = normalize(events);

  assert.deepEqual(
    actions.map((a) => a.kind),
    ['goto', 'fill', 'fill', 'click'],
  );
  assert.equal(actions[1].value, 'vendor');
  assert.equal(actions[2].value, 'hunter2');
  assert.equal(actions[3].name, 'Sign in');
});

test('normalize folds a click-caused navigation into the click', () => {
  const events: RecordedEvent[] = [
    { ts: 1, type: 'navigate', url: 'https://example.com/' },
    { ts: 2, type: 'click', url: 'https://example.com/', css: 'a#go', role: 'link', name: 'Go' },
    { ts: 3, type: 'navigate', url: 'https://example.com/next' },
  ];

  const actions = normalize(events);

  assert.deepEqual(
    actions.map((a) => a.kind),
    ['goto', 'click'],
  );
  assert.equal(actions[1].name, 'Go');
});

test('normalize emits a goto for a navigation with no preceding action', () => {
  const events: RecordedEvent[] = [
    { ts: 1, type: 'navigate', url: 'https://example.com/' },
    { ts: 2, type: 'navigate', url: 'https://example.com/other' },
  ];

  const actions = normalize(events);

  assert.deepEqual(
    actions.map((a) => a.kind),
    ['goto', 'goto'],
  );
  assert.equal(actions[1].url, 'https://example.com/other');
});

test('normalize drops captcha/challenge interactions', () => {
  const events: RecordedEvent[] = [
    { ts: 1, type: 'navigate', url: 'https://www.google.com/sorry/index?continue=x' },
    { ts: 2, type: 'click', url: 'https://www.google.com/sorry/index', css: '#recaptcha-verify-button', role: 'button', name: 'Verify' },
    { ts: 3, type: 'click', url: 'https://www.google.com/sorry/index', css: 'img', role: 'img', name: 'captcha image 1' },
    { ts: 4, type: 'click', url: 'https://example.com/results', css: 'a', role: 'link', name: 'First result' },
  ];

  const actions = normalize(events);

  assert.deepEqual(
    actions.map((a) => a.kind),
    ['goto', 'click'],
  );
  assert.equal(actions[0].url, 'https://example.com/results');
  assert.equal(actions[1].name, 'First result');
  assert.ok(!actions.some((a) => /captcha|recaptcha/i.test(`${a.css} ${a.name} ${a.url}`)));
});

test('deterministicSteps keeps one step per action with bound locators', () => {
  const actions = normalize(loadFixture('roundtrip-events.ndjson'));
  const result = deterministicSteps(actions);

  assert.equal(result.steps.length, actions.length);
  assert.match(result.steps[1].text, /buy milk/);
  assert.equal(result.steps[1].value, 'buy milk');
  assert.equal(result.steps[4].name, 'Active');
});
