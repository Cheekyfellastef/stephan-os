import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { srcRoot } from '../test/renderHarness.mjs';

test('renders compact UI reality summary with collapsible details', () => {
  const source = fs.readFileSync(path.join(srcRoot, 'components/UIRealityStatusPanel.jsx'), 'utf8');
  assert.equal(source.includes('UI Reality:'), true);
  assert.equal(source.includes('Pane shells:'), true);
  assert.equal(source.includes('<details>'), true);
  assert.equal(source.includes('UI Reality details'), true);
});

test('UI reality status panel does not mutate pane layout', () => {
  const source = fs.readFileSync(path.join(srcRoot, 'components/UIRealityStatusPanel.jsx'), 'utf8');
  assert.equal(source.includes('togglePanel('), false);
  assert.equal(source.includes('setUiLayout('), false);
});
