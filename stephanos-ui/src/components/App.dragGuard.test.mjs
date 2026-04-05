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

test('resolvePaneCollapsedState uses canonical layout key so outer pane follows panel collapse truth', async () => {
  const { resolvePaneCollapsedState } = await importBundledModule(
    path.join(srcRoot, 'App.jsx'),
    {},
    'app-pane-collapse-state-test',
  );

  assert.equal(resolvePaneCollapsedState({ id: 'statusPanel' }, { statusPanel: false }), true);
  assert.equal(resolvePaneCollapsedState({ id: 'statusPanel' }, { statusPanel: true }), false);
  assert.equal(resolvePaneCollapsedState({ id: 'aiConsole', layoutKey: 'commandDeck' }, { commandDeck: false }), true);
  assert.equal(resolvePaneCollapsedState({ id: 'aiConsole', layoutKey: 'commandDeck' }, { aiConsole: false, commandDeck: true }), false);
});
