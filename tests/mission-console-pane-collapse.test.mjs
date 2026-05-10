import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('canonical pane stack tracks collapsed state map', () => {
  const source = readFileSync(new URL('../stephanos-ui/src/components/CanonicalPaneStack.jsx', import.meta.url), 'utf8');
  assert.match(source, /collapsed/);
  assert.match(source, /canonical-pane--collapsed/);
});
