import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cssSource = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('Mission console answer/history surface uses bounded dynamic sizing (reduced from oversized target)', () => {
  assert.equal(cssSource.includes('.mission-console-pane__body.mission-console__history'), true);
  assert.equal(cssSource.includes('min-height: clamp(14rem, 34vh, 24rem);'), true);
  assert.equal(cssSource.includes('max-height: min(62vh, 760px);'), true);
  assert.equal(cssSource.includes('height: auto;'), true);
});

test('Assistant answer text stays content-aware with sensible min/max bounds', () => {
  assert.equal(cssSource.includes('.assistant-answer-text'), true);
  assert.equal(cssSource.includes('min-height: clamp(8rem, 20vh, 14rem);'), true);
  assert.equal(cssSource.includes('max-height: min(60vh, 42rem);'), true);
});
