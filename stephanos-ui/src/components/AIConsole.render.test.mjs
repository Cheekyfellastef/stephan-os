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

test('Mission console collapsed panel body does not keep reserved height when hidden', async () => {
  const stylesSource = await fs.readFile(path.join(srcRoot, 'styles.css'), 'utf8');
  assert.match(stylesSource, /\.mission-console \.panel-body\[hidden\]\s*\{/);
  assert.match(stylesSource, /\.mission-console \.panel-body\[hidden\][\s\S]*display:\s*none;/m);
  assert.match(stylesSource, /\.mission-console \.panel-body\[hidden\][\s\S]*height:\s*0;/m);
});

test('assistant answer pane keeps text selection enabled for drag-copy operations', async () => {
  const stylesSource = await fs.readFile(path.join(srcRoot, 'styles.css'), 'utf8');
  assert.match(stylesSource, /\.assistant-answer-text\s*\{/);
  assert.match(stylesSource, /\.assistant-answer-text[\s\S]*user-select:\s*text;/m);
});

test('assistant answer pane enforces tall bounded scrolling region so long answers stay inside pane', async () => {
  const stylesSource = await fs.readFile(path.join(srcRoot, 'styles.css'), 'utf8');
  assert.match(stylesSource, /\.assistant-answer-text[\s\S]*min-height:\s*clamp\(12rem,\s*34vh,\s*22rem\);/m);
  assert.match(stylesSource, /\.assistant-answer-text[\s\S]*max-height:\s*50vh;/m);
  assert.match(stylesSource, /\.assistant-answer-text[\s\S]*overflow-y:\s*auto;/m);
});


test('AIConsole renders copy buttons for historical and new assistant answer panes', async () => {
  const { renderAIConsole } = await importBundledModule(
    path.join(srcRoot, 'test/renderAIConsoleEntry.jsx'),
    aliases,
    'ai-console-copy-buttons',
  );
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore();

  const rendered = renderAIConsole({
    commandHistory: [
      {
        id: 'assistant-older',
        timestamp: '2026-04-05T08:00:00.000Z',
        raw_input: 'Earlier prompt',
        output_text: 'Older answer',
        route: 'assistant',
        response: { type: 'assistant_response', route: 'assistant', debug: { selected_subsystem: 'assistant' } },
        data_payload: { retrieval_truth: { source: 'history' } },
      },
      {
        id: 'tool-1',
        timestamp: '2026-04-05T08:05:00.000Z',
        raw_input: '/status',
        output_text: 'Tool output',
        route: 'status',
        response: { type: 'tool_result', route: 'status' },
      },
      {
        id: 'assistant-new',
        timestamp: '2026-04-05T08:10:00.000Z',
        raw_input: 'Latest prompt',
        output_text: 'Latest answer',
        route: 'assistant',
        response: { type: 'assistant_response', route: 'assistant', debug: { selected_subsystem: 'assistant' } },
      },
    ],
  });

  const answerCopyMatches = rendered.match(/aria-label="Copy answer"/g) || [];
  const debugCopyMatches = rendered.match(/aria-label="Copy debug payload"/g) || [];
  assert.equal(answerCopyMatches.length, 2);
  assert.equal(debugCopyMatches.length, 2);
  assert.match(rendered, /answer-pane-copy-button/);
  assert.match(rendered, /assistant-answer-text/);
});
