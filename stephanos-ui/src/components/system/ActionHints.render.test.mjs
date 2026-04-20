import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../../test/renderHarness.mjs';

const storeModulePath = path.join(srcRoot, 'test/mockAIStore.js');

function createStore(overrides = {}) {
  return {
    uiLayout: {
      actionHintsPanel: true,
    },
    togglePanel: () => {},
    ...overrides,
  };
}

test('ActionHints renders pending message when runtime truth is unavailable', async () => {
  const { renderActionHints } = await importBundledModule(
    path.join(srcRoot, 'test/renderActionHintsEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'action-hints-no-truth',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderActionHints(null);
  assert.match(rendered, /Runtime truth pending/);
});

test('ActionHints renders route/provider warnings from shared guidance projection', async () => {
  const { renderActionHints } = await importBundledModule(
    path.join(srcRoot, 'test/renderActionHintsEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'action-hints-fallback-mock',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderActionHints({
    canonicalRouteRuntimeTruth: {
      winningRoute: 'cloud',
      routeReachable: false,
      routeUsable: false,
      backendReachable: false,
      executedProvider: 'mock',
    },
    orchestration: {
      selectors: {
        currentMissionState: { missionPhase: 'awaiting-approval' },
        buildAssistanceReadiness: { state: 'blocked', explanation: 'Mission blocked.' },
        missionBlocked: true,
        blockageExplanation: 'Backend blocked.',
        nextRecommendedAction: 'Restore backend reachability.',
        commandReadiness: {
          'start-mission': { allowed: false, reason: 'mission-blocked', message: 'Start blocked.' },
        },
      },
    },
  });

  assert.match(rendered, /Route issue unresolved: verify Home Bridge reachability/);
  assert.match(rendered, /Mock provider is executing/);
  assert.match(rendered, /Blocked now: start-mission/);
});

test('ActionHints renders continuity-aware caution when intent is inferred', async () => {
  const { renderActionHints } = await importBundledModule(
    path.join(srcRoot, 'test/renderActionHintsEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'action-hints-inferred-intent',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderActionHints({
    canonicalRouteRuntimeTruth: {
      winningRoute: 'local',
      routeReachable: true,
      routeUsable: true,
      backendReachable: true,
      selectedProvider: 'openai',
      executedProvider: 'openai',
    },
    orchestration: {
      selectors: {
        currentMissionState: { intentSource: 'inferred', missionPhase: 'awaiting-approval' },
        continuityLoopState: { strength: 'sparse', sparse: true },
        buildAssistanceReadiness: { state: 'analysis-ready', explanation: 'Analysis-only until approval.' },
        nextRecommendedAction: 'Confirm explicit objective.',
      },
    },
  });

  assert.match(rendered, /Intent is inferred/);
  assert.match(rendered, /Sparse continuity/);
});
