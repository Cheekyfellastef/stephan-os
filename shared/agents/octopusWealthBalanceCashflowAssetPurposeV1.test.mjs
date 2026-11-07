import assert from 'node:assert/strict';
import test from 'node:test';

import { OCTOPUS_WEALTH_M2_METRIC_ROLES } from './octopusWealthBalanceCashflowV1.mjs';

const assetRoleByMetric = new Map(
  OCTOPUS_WEALTH_M2_METRIC_ROLES
    .filter((role) => role.section === 'ASSET')
    .map((role) => [role.metricId, role]),
);

test('M2 keeps accounting, accessible and retirement-purpose asset categories explicit', () => {
  assert.equal(assetRoleByMetric.size, 5);

  assert.deepEqual(assetRoleByMetric.get('cash-liquid-assets')?.assetPurposes, ['ACCOUNTING', 'ACCESSIBLE']);
  assert.deepEqual(assetRoleByMetric.get('isa-current-value')?.assetPurposes, ['ACCOUNTING', 'ACCESSIBLE']);
  assert.deepEqual(assetRoleByMetric.get('pension-current-value')?.assetPurposes, ['ACCOUNTING', 'RETIREMENT']);
  assert.deepEqual(assetRoleByMetric.get('home-current-value')?.assetPurposes, ['ACCOUNTING']);
  assert.deepEqual(assetRoleByMetric.get('caravan-current-value')?.assetPurposes, ['ACCOUNTING']);
});

test('non-asset roles cannot acquire asset-purpose categories', () => {
  for (const role of OCTOPUS_WEALTH_M2_METRIC_ROLES.filter((entry) => entry.section !== 'ASSET')) {
    assert.equal(Object.hasOwn(role, 'assetPurposes'), false, `${role.metricId} must not carry asset purposes`);
  }
});
