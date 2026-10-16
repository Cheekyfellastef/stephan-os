import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileLlamaGovernorV1 } from './seedCanopyLlamaGovernorReconcileV1.mjs';

test('gaming and Quest always deny inference and request custody', () => {
  for (const change of [{ gamingActive: true }, { questActive: true }]) {
    const result = reconcileLlamaGovernorV1({
      gamingActive: false, questActive: false, governorHealthy: true,
      custodyConfirmed: true, ...change,
    });
    assert.equal(result.denyNewInference, true);
    assert.equal(result.needsCustody, true);
    assert.equal(result.qualified, false);
    assert.equal(result.reason, 'GAMING_PRIORITY');
  }
});

test('stale or unknown governor truth fails closed', () => {
  for (const state of [null, {}, { gamingActive: false, questActive: false },
    { gamingActive: false, questActive: false, governorHealthy: false },
    { gamingActive: false, questActive: undefined, governorHealthy: true }]) {
    const result = reconcileLlamaGovernorV1(state);
    assert.equal(result.denyNewInference, true);
    assert.equal(result.needsCustody, true);
    assert.equal(result.reason, 'GOVERNOR_UNCERTAIN');
  }
});

test('even confirmed idle custody cannot remove the production HOLD', () => {
  const result = reconcileLlamaGovernorV1({
    gamingActive: false, questActive: false, governorHealthy: true,
    custodyConfirmed: true,
  });
  assert.equal(result.needsCustody, false);
  assert.equal(result.denyNewInference, true);
  assert.equal(result.qualified, false);
  assert.equal(result.reason, 'PRODUCTION_HOLD');
});
