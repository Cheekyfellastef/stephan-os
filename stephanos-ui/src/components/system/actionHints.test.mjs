import test from 'node:test';
import assert from 'node:assert/strict';
import { collectActionHints } from './actionHints.js';

test('collectActionHints uses shared selectors for mission-aware guidance', () => {
  const hints = collectActionHints({ routeKind: 'cloud', backendReachableState: 'yes', selectedRouteReachableState: 'yes', routeUsableState: 'yes', requestedProvider: 'openai', executedProvider: 'openai' }, {
    selectors: {
      currentMissionState: { intentSource: 'inferred' },
      continuityLoopState: { strength: 'sparse' },
      missionBlocked: true,
      blockageExplanation: 'Intent is inferred while continuity is sparse; explicit operator objective is required.',
      nextRecommendedAction: 'Review mission packet and choose accept/reject/defer explicitly.',
      buildAssistanceReadiness: { state: 'analysis-ready', explanation: 'Build assistance can analyze and suggest a bounded patch plan.' },
      commandReadiness: {
        'start-mission': { allowed: false, reason: 'mission-blocked', message: 'Start is blocked until mission blockers are resolved.' },
      },
    },
    canonicalSourceDistAlignment: {
      buildAlignmentState: 'stale',
      blockingSeverity: 'warning',
      alignmentReason: 'Hosted/runtime dist appears stale relative to expected build truth.',
      operatorActionText: 'Run npm run stephanos:build, verify with npm run stephanos:verify, then push updated dist before trusting hosted runtime behavior.',
    },
  });
  const rendered = hints.map((entry) => (typeof entry === 'string' ? entry : `${entry.subsystem}: ${entry.text}`));

  assert.ok(rendered.some((line) => line.includes('Intent is inferred')));
  assert.ok(rendered.some((line) => line.includes('Mission:')));
  assert.ok(rendered.some((line) => line.includes('Mission blocked')));
  assert.ok(rendered.some((line) => line.includes('Build assistance: analysis-ready')));
  assert.ok(rendered.some((line) => line.includes('Next step: Review mission packet')));
  assert.ok(rendered.some((line) => line.includes('Blocked now:')));
  assert.ok(rendered.some((line) => line.includes('stale relative to expected build truth')));
});

test('collectActionHints classifies healthy route + stale backend contract boundary', () => {
  const hints = collectActionHints({
    routeKind: 'home-node',
    backendReachableState: 'yes',
    selectedRouteReachableState: 'yes',
    routeUsableState: 'yes',
    requestedProvider: 'ollama',
    selectedProvider: 'ollama',
    executedProvider: 'none',
  }, {
    canonicalSourceDistAlignment: {
      buildAlignmentState: 'unknown',
    },
  });
  const rendered = hints.map((entry) => (typeof entry === 'string' ? entry : `${entry.subsystem}: ${entry.text}`));
  assert.ok(rendered.some((line) => line.includes('Route healthy; backend execution contract appears stale or incomplete.')));
  assert.ok(rendered.some((line) => line.includes('Selected/requested provider (ollama) is not executable')));
  assert.ok(rendered.some((line) => line.includes('Rebuild/restart Battle Bridge')));
});

test('collectActionHints keeps true route failures in route-issue language', () => {
  const hints = collectActionHints({
    routeKind: 'home-node',
    backendReachableState: 'no',
    selectedRouteReachableState: 'no',
    routeUsableState: 'no',
    requestedProvider: 'groq',
    selectedProvider: 'groq',
    executedProvider: 'none',
  }, {});
  const rendered = hints.map((entry) => (typeof entry === 'string' ? entry : `${entry.subsystem}: ${entry.text}`));
  assert.ok(rendered.some((line) => line.includes('Route issue unresolved')));
  assert.ok(!rendered.some((line) => line.includes('Route healthy; backend execution contract appears stale')));
});
