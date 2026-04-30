import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function classifyPane(source, paneId) {
  const hasCanonicalId = source.includes(`id: '${paneId}'`);
  const hasCollapsible = source.includes('CollapsiblePanel');
  if (hasCanonicalId && hasCollapsible) return 'first-class';
  if (hasCanonicalId) return 'partially first-class';
  return 'not first-class';
}

test('audit identifies expected first-class Stephanos tile panes', () => {
  const appSource = readFileSync(new URL('../stephanos-ui/src/App.jsx', import.meta.url), 'utf8');
  const openClaw = classifyPane(appSource, 'openClawPanel');
  const agents = classifyPane(appSource, 'agentsPanel');
  assert.equal(openClaw, 'first-class');
  assert.equal(agents, 'first-class');
});
