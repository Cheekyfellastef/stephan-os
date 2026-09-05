import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';

const storeModulePath = path.join(srcRoot, 'test/mockAIStore.js');
const aliases = { '../state/aiStore': storeModulePath };

function store() {
  return {
    isBusy: false,
    provider: 'ollama',
    providerHealth: {},
    apiStatus: { state: 'ready', label: 'Backend reachable', detail: 'Diagnostics synced.', frontendOrigin: 'http://localhost:5173' },
    runtimeStatusModel: undefined,
    uiLayout: { commandDeck: true },
    getActiveProviderConfig: () => ({ baseURL: '', model: 'llama3' }),
    setUiDiagnostics: () => {},
    togglePanel: () => {},
    lastExecutionMetadata: {},
  };
}

function canvasView(overrides = {}) {
  return {
    schemaVersion: 'stephanos.ui-agent.conversation-canvas-presenter.v1',
    valid: true,
    state: 'READY',
    surface: 'desktop-browser',
    layoutProfile: { layout: 'TWO_COLUMN_WITH_DETAIL_RAIL' },
    stateBanner: { state: 'READY', label: 'Answer and available evidence are ready.', detail: '', colorOnlyStatusAllowed: false },
    summary: {
      kind: 'DIRECT_ANSWER',
      text: 'CANVAS_SUMMARY_RENDERED',
      continuity: { roundId: 'round-001', questionId: 'question-001', responseId: 'response-001' },
      visibleByDefault: true,
    },
    sections: [],
    experienceModes: [{ mode: 'SYSTEMS_EXPERT_MAP', executable: false }],
    accessibility: {
      reducedMotion: true,
      colorOnlyStatusAllowed: false,
      evidenceKeyboardReachable: true,
      touchTargetsLarge: false,
      animationAllowed: false,
    },
    authority: {
      sourceMutationAllowed: false,
      commandExecutionAllowed: false,
      approvalAuthorityAdded: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      providerSelectionAuthorityAdded: false,
      privateUiTruthAllowed: false,
      presenterMayExecuteActions: false,
      presenterMayHideEvidence: false,
    },
    ...overrides,
  };
}

function assistantEntry(dataPayload) {
  return {
    id: 'assistant-canvas-1',
    timestamp: '2026-08-20T04:20:00.000Z',
    raw_input: 'Explain the current system state.',
    output_text: 'PLAIN_FALLBACK_SHOULD_NOT_RENDER',
    stream_finalized: true,
    route: 'assistant',
    response: { type: 'assistant_response', route: 'assistant', debug: { selected_subsystem: 'assistant' } },
    data_payload: dataPayload,
  };
}

async function render(commandHistory, label) {
  const { renderAIConsole } = await importBundledModule(
    path.join(srcRoot, 'test/renderAIConsoleEntry.jsx'),
    aliases,
    label,
  );
  globalThis.__STEPHANOS_TEST_AI_STORE__ = store();
  return renderAIConsole({ commandHistory });
}

test('AIConsole serves a valid bounded conversation_canvas_view through the existing assistant answer pane', async () => {
  const rendered = await render([
    assistantEntry({ conversation_canvas_view: canvasView() }),
  ], 'ai-console-conversation-canvas');

  assert.match(rendered, /data-testid="latest-assistant-answer-pane"/);
  assert.match(rendered, /data-testid="conversation-canvas-card"/);
  assert.match(rendered, /CANVAS_SUMMARY_RENDERED/);
  assert.match(rendered, /Systems Expert Map/);
  assert.doesNotMatch(rendered, /PLAIN_FALLBACK_SHOULD_NOT_RENDER/);
});

test('AIConsole fails closed to the existing plain answer when Canvas identity or authority is invalid', async () => {
  const invalidAuthority = canvasView({
    authority: { ...canvasView().authority, providerSelectionAuthorityAdded: true },
  });
  const rendered = await render([
    assistantEntry({ conversation_canvas_view: invalidAuthority }),
  ], 'ai-console-conversation-canvas-fallback');

  assert.doesNotMatch(rendered, /data-testid="conversation-canvas-card"/);
  assert.match(rendered, /PLAIN_FALLBACK_SHOULD_NOT_RENDER/);
});

test('AIConsole accepts the bounded camelCase Canvas alias without changing the current command-history contract', async () => {
  const rendered = await render([
    assistantEntry({
      conversationCanvasView: canvasView({
        surface: 'iphone',
        layoutProfile: { layout: 'SINGLE_COLUMN_PROGRESSIVE' },
        accessibility: {
          reducedMotion: true,
          colorOnlyStatusAllowed: false,
          evidenceKeyboardReachable: true,
          touchTargetsLarge: true,
          animationAllowed: false,
        },
      }),
    }),
  ], 'ai-console-conversation-canvas-alias');

  assert.match(rendered, /data-canvas-surface="iphone"/);
  assert.match(rendered, /data-canvas-layout="SINGLE_COLUMN_PROGRESSIVE"/);
  assert.match(rendered, /CANVAS_SUMMARY_RENDERED/);
});
