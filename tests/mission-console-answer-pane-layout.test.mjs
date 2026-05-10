import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('canonical answer pane renders CommandResultCard', () => {
  const source = readFileSync(new URL('../stephanos-ui/src/components/CanonicalAnswerPane.jsx', import.meta.url), 'utf8');
  assert.match(source, /CommandResultCard/);
});
