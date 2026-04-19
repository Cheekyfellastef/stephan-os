import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBridgeRevalidationAttemptedConfigKey,
  shouldTreatBridgeHealthProbeAsReachable,
} from './bridgeAutoRevalidation.mjs';

test('buildBridgeRevalidationAttemptedConfigKey includes hosted execution target to reset stale backoff boundaries when hosted bridge target changes', () => {
  const basePlan = {
    transport: 'tailscale',
    candidateUrl: 'https://desktop-9flonkj.taild6f215.ts.net:8787',
    requireHttps: true,
  };
  const remembered = { rememberedAt: '2026-04-19T00:00:00.000Z' };
  const keyA = buildBridgeRevalidationAttemptedConfigKey({
    ...basePlan,
    hostedExecutionCandidate: '',
  }, remembered);
  const keyB = buildBridgeRevalidationAttemptedConfigKey({
    ...basePlan,
    hostedExecutionCandidate: 'https://desktop-9flonkj.taild6f215.ts.net',
  }, remembered);

  assert.notEqual(keyA, keyB);
});

test('shouldTreatBridgeHealthProbeAsReachable accepts successful health JSON without strict service label', () => {
  const probe = {
    ok: true,
    data: {
      ok: true,
      status: 'ok',
    },
  };

  assert.equal(shouldTreatBridgeHealthProbeAsReachable(probe), true);
});
