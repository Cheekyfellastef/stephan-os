import test from 'node:test';
import assert from 'node:assert/strict';
import { collectActionHints } from './actionHints.js';

test('collectActionHints uses shared selectors for mission-aware guidance', () => {
  const hints = collectActionHints({ routeKind: 'cloud', backendReachable: true, providerExecution: { executableProvider: 'openai' } }, {
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
  });

  assert.ok(hints.some((line) => line.includes('Intent is inferred')));
  assert.ok(hints.some((line) => line.includes('Mission:')));
  assert.ok(hints.some((line) => line.includes('Mission blocked')));
  assert.ok(hints.some((line) => line.includes('Build assistance: analysis-ready')));
  assert.ok(hints.some((line) => line.includes('Next step: Review mission packet')));
  assert.ok(hints.some((line) => line.includes('Blocked now:')));
});
