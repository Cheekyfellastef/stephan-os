import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultCaravanMode,
  deriveCanonicalCaravanMode,
  normalizeCaravanMode,
} from './caravanMode.mjs';

test('caravan mode canonical object initializes with single-source defaults', () => {
  const mode = createDefaultCaravanMode();
  assert.equal(mode.modeId, 'caravan-mode-v1');
  assert.equal(mode.isActive, false);
  assert.equal(mode.canonCommitAllowed, true);
  assert.equal(mode.stagingEnabled, true);
});

test('caravan mode activates with hosted cognition execution while local authority unavailable', () => {
  const mode = deriveCanonicalCaravanMode({
    sessionKind: 'hosted-web',
    localAuthorityAvailable: false,
    hostedCognitionConfigured: true,
    hostedCognitionAvailable: true,
    hostedCognitionExecutable: true,
    hostedWorkerProvider: 'groq',
    hostedWorkerBaseUrl: 'https://worker.example.com',
    hostedWorkerHealth: 'healthy',
    routeUsable: true,
    executableProvider: 'hosted-cloud-worker',
  });

  assert.equal(mode.isActive, true);
  assert.equal(mode.canonCommitAllowed, false);
  assert.equal(mode.promotionDeferred, true);
  assert.equal(mode.providerExecutionState, 'hosted-cognition-executable');
  assert.equal(mode.hostedWorkerProvider, 'groq');
});

test('caravan mode normalization preserves required semantics and defaults missing values', () => {
  const normalized = normalizeCaravanMode({
    isActive: true,
    authorityClass: 'hosted-cognition-only',
    operatorSummary: 'Custom summary',
  });
  assert.equal(normalized.modeId, 'caravan-mode-v1');
  assert.equal(normalized.isActive, true);
  assert.equal(normalized.authorityClass, 'hosted-cognition-only');
  assert.equal(normalized.operatorSummary, 'Custom summary');
  assert.equal(normalized.nextRecommendedAction.length > 0, true);
});
