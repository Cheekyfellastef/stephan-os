import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE,
  buildSovereignCommanderCapabilityParityLedger,
  classifyRemoteCommanderCapabilityObservation,
} from './sovereignCommanderCapabilityParityV1.mjs';

function remote(operation, overrides = {}) {
  return {
    adapter: 'desktop-commander',
    path: `C:/queue/${operation}.json`,
    item: {
      missionId: 'critical-2573-parity',
      actionId: `action-${operation}`,
      actionGrant: { operation },
      ...overrides,
    },
  };
}

test('known Remote Commander file capability resolves to existing Sovereign Commander parity', () => {
  const result = classifyRemoteCommanderCapabilityObservation(remote('read-file'));
  assert.equal(result.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT);
  assert.equal(result.sovereignEquivalent, 'read_file');
  assert.equal(result.canonicalOwnerGoal, '#2573');
  assert.equal(result.operatorFallbackAllowed, false);
  assert.equal(result.meterDependencyAccepted, false);
});

test('Remote Commander project search resolves to native Sovereign search parity', () => {
  for (const operation of ['start-search', 'search-files', 'search-project', 'get-more-search-results']) {
    const result = classifyRemoteCommanderCapabilityObservation(remote(operation));
    assert.equal(result.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT, operation);
    assert.equal(result.sovereignEquivalent, 'search_project', operation);
    assert.equal(result.operatorFallbackAllowed, false, operation);
    assert.equal(result.meterDependencyAccepted, false, operation);
  }
});

test('source construction becomes a buildable gap owned by the one standing parity goal', () => {
  const result = classifyRemoteCommanderCapabilityObservation(remote('source-construction'));
  assert.equal(result.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BUILDABLE_GAP);
  assert.equal(result.sovereignEquivalent, 'sovereign-source-construction-lane');
  assert.equal(result.canonicalOwnerGoal, '#2573');
  assert.equal(result.createDuplicateGoalAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
});

test('forbidden authority is held at the boundary instead of cloned for parity', () => {
  const result = classifyRemoteCommanderCapabilityObservation(remote('arbitrary-shell'));
  assert.equal(result.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BOUNDARY_HOLD);
  assert.match(result.sovereignEquivalent, /arbitrary-shell/);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.pcRestartAuthority, false);
});

test('repeated observations deduplicate into one durable capability entry', () => {
  const first = buildSovereignCommanderCapabilityParityLedger([
    remote('source-construction'),
    remote('source-construction', { actionId: 'action-second' }),
  ], { nowUtc: '2026-10-01T20:00:00.000Z' });

  assert.equal(first.capabilities.length, 1);
  assert.equal(first.capabilities[0].observationCount, 2);
  assert.equal(first.buildableGapCount, 1);

  const second = buildSovereignCommanderCapabilityParityLedger([], {
    priorLedger: first,
    nowUtc: '2026-10-01T20:01:00.000Z',
  });

  assert.equal(second.capabilities.length, 1);
  assert.equal(second.capabilities[0].currentObserved, false);
  assert.equal(second.capabilities[0].observationCount, 2);
  assert.equal(second.buildableGapCount, 1);
  assert.equal(second.duplicateGoalCreationAllowed, false);
  assert.equal(second.standingGoalMustRemainOpen, true);
});

test('non Remote Commander queue entries are ignored', () => {
  const ledger = buildSovereignCommanderCapabilityParityLedger([
    { adapter: 'stephanos-native', item: { actionGrant: { operation: 'source-construction' } } },
  ], { nowUtc: '2026-10-01T20:00:00.000Z' });
  assert.equal(ledger.retainedCapabilityCount, 0);
  assert.equal(ledger.buildableGapCount, 0);
});
