import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');

test('mission console readiness diagnostics reflect chat input, submit route, answer pane, and ai route state', () => {
  assert.match(source, /const executionReadiness = useMemo\(/);
  assert.match(source, /chatInputReady/);
  assert.match(source, /submitRouteReady/);
  assert.match(source, /answerPaneReady/);
  assert.match(source, /AI route:/);
  assert.match(source, /Execution readiness:/);
});
