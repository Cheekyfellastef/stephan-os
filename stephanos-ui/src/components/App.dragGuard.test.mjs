import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';

test('shouldStartPaneDrag blocks drag start for interactive pane controls', async () => {
  const { shouldStartPaneDrag } = await importBundledModule(
    path.join(srcRoot, 'App.jsx'),
    {},
    'app-drag-guard-test',
  );

  assert.equal(shouldStartPaneDrag({
    closest: (selector) => (selector.includes('button') ? {} : null),
  }), false);

  assert.equal(shouldStartPaneDrag({
    closest: () => null,
  }), true);
});
