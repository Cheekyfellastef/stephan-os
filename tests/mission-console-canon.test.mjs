import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('AIConsole uses canonical answer pane and canonical pane stack', () => {
  const source = readFileSync(new URL('../stephanos-ui/src/components/AIConsole.jsx', import.meta.url), 'utf8');
  assert.match(source, /CanonicalAnswerPane/);
  assert.match(source, /CanonicalPaneStack/);
});
