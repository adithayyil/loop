import test from 'node:test';
import assert from 'node:assert/strict';
import { guardSegments, joinNarration } from './transcribe.ts';

test('guardSegments keeps confident speech and drops silence', () => {
  const kept = guardSegments([
    { start: 0, end: 2, text: 'Log into the vendor portal', no_speech_prob: 0.01, avg_logprob: -0.2 },
    { start: 2, end: 4, text: '   ', no_speech_prob: 0.02, avg_logprob: -0.3 },
    { start: 4, end: 6, text: 'music', no_speech_prob: 0.9, avg_logprob: -0.4 },
    { start: 6, end: 8, text: 'Download every invoice', no_speech_prob: 0.05, avg_logprob: -0.4 },
    { start: 8, end: 10, text: 'mumble mumble', no_speech_prob: 0.1, avg_logprob: -2.5 },
  ]);

  assert.deepEqual(
    kept.map((segment) => segment.text),
    ['Log into the vendor portal', 'Download every invoice'],
  );
  assert.equal(kept[0].start, 0);
  assert.equal(kept[1].start, 6);
});

test('guardSegments defaults missing times to the segment start', () => {
  const kept = guardSegments([{ start: 3, text: 'term is variable' }]);
  assert.equal(kept[0].end, 3);
});

test('joinNarration concatenates kept spans into one transcript', () => {
  const text = joinNarration([
    { start: 0, end: 2, text: 'Log in' },
    { start: 2, end: 4, text: 'then filter each row' },
  ]);
  assert.equal(text, 'Log in then filter each row');
  assert.equal(joinNarration([]), '');
});
