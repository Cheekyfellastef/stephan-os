import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';

function createBaseStore(overrides = {}) {
  return {
    isBusy: false,
    provider: 'ollama',
    providerHealth: {},
    apiStatus: {
      state: 'ready',
      label: 'Backend reachable',
      detail: 'Diagnostics synced.',
      frontendOrigin: 'http://localhost:5173',
    },
    runtimeStatusModel: undefined,
    uiLayout: {
      commandDeck: true,
    },
    getActiveProviderConfig: () => ({ baseURL: '', model: 'llama3' }),
    setUiDiagnostics: () => {},
    togglePanel: () => {},
    ...overrides,
  };
}

const storeModulePath = path.join(srcRoot, 'test/mockAIStore.js');
const aliases = {
  '../state/aiStore': storeModulePath,
};

test('AIConsole renders mission console shell with internal message region and anchored input region', async () => {
  const { renderAIConsole } = await importBundledModule(
    path.join(srcRoot, 'test/renderAIConsoleEntry.jsx'),
    aliases,
    'ai-console-render',
  );
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore();

  const rendered = renderAIConsole();
  assert.match(rendered, /mission-console-shell/);
  assert.match(rendered, /output-panel ai-console-messages/);
  assert.match(rendered, /command-form mission-console-input/);
});

test('AIConsole avoids viewport-targeting scrollIntoView calls for message updates', async () => {
  const source = await fs.readFile(path.join(srcRoot, 'components/AIConsole.jsx'), 'utf8');
  assert.doesNotMatch(source, /scrollIntoView\s*\(/);
});
