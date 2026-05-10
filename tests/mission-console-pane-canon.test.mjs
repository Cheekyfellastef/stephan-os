import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('canonical pane stack supports move controls and chevron', () => {
  const source = readFileSync(new URL('../stephanos-ui/src/components/CanonicalPaneStack.jsx', import.meta.url), 'utf8');
  assert.match(source, /canonical-pane__chevron/);
  assert.match(source, /move\(pane\.paneId, 'up'\)/);
});
