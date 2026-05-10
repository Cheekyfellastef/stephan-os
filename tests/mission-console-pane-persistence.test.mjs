import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('canonical pane stack persists layout in localStorage with scoped key', () => {
  const source = readFileSync(new URL('../stephanos-ui/src/components/CanonicalPaneStack.jsx', import.meta.url), 'utf8');
  assert.match(source, /localStorage/);
  assert.match(source, /STORAGE_KEY_PREFIX/);
  assert.match(source, /scope = 'mission-console'/);
});
