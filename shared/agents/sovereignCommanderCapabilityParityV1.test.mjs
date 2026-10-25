import assert from 'node:assert/strict';
import test from 'node:test';

// Exercise the existing fleet supervisor fail-closed tests in the trusted parity CI lane.
import './sovereignCommanderFleetGoalSupervisorV1.test.mjs';

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

test('direct ChatGPT Remote Commander observations feed the same parity ratchet', () => {
  const result = classifyRemoteCommanderCapabilityObservation({
    ...remote('start-search'),
    adapter: 'desktop-commander-direct',
  });
  assert.equal(result.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BUILDABLE_GAP);
  assert.equal(result.partialSovereignEquivalent, 'search_project');
  assert.equal(result.runtimeParityProven, false);
  assert.equal(result.observationIngress, 'desktop-commander-direct');
  assert.equal(result.canonicalOwnerGoal, '#2573');
});

test('Remote Commander device/reachability probes resolve to Sovereign visibility snapshot parity', () => {
  for (const operation of ['list-devices', 'device-status', 'connection-status']) {
    const result = classifyRemoteCommanderCapabilityObservation({
      ...remote(operation),
      adapter: 'desktop-commander-direct',
    });
    assert.equal(result.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT, operation);
    assert.equal(result.sovereignEquivalent, 'visibility-snapshot', operation);
    assert.equal(result.operatorFallbackAllowed, false, operation);
    assert.equal(result.meterDependencyAccepted, false, operation);
  }
});

test('repository search does not claim whole-PC or search-session parity', () => {
  const project = classifyRemoteCommanderCapabilityObservation(remote('search-project'));
  assert.equal(project.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT);
  assert.equal(project.sovereignEquivalent, 'search_project');
  for (const operation of ['start-search', 'search-files', 'get-more-search-results', 'stop-search', 'list-searches']) {
    const result = classifyRemoteCommanderCapabilityObservation(remote(operation));
    assert.equal(result.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.BUILDABLE_GAP, operation);
    assert.equal(result.partialSovereignEquivalent, 'search_project', operation);
    assert.equal(result.partialScope, 'CANONICAL_REPOSITORY_LITERAL_SEARCH_ONLY', operation);
    assert.equal(result.parityEvidenceScope, 'SOURCE_CATALOG_ONLY', operation);
    assert.equal(result.runtimeParityProven, false, operation);
    assert.notEqual(result.sovereignEquivalent, 'search_project', operation);
    assert.match(result.parityGapReason, /NOT_IMPLEMENTED$/, operation);
    assert.equal(result.operatorFallbackAllowed, false, operation);
    assert.equal(result.meterDependencyAccepted, false, operation);
  }
});

test('retained broad-search false parity is corrected without a new call or lost provenance', () => {
  const previousCapabilities = ['start-search', 'search-files', 'get-more-search-results'].map((capabilityId) => ({
    capabilityId,
    state: 'PARITY_PRESENT',
    sovereignEquivalent: 'search_project',
    firstSeenAtUtc: '2026-10-02T10:00:00.000Z',
    lastSeenAtUtc: '2026-10-24T18:00:00.000Z',
    observationCount: 17,
    missionIds: ['original-mission'],
    actionIds: ['original-action'],
    queuePaths: ['C:/queue/original-observation.json'],
  }));
  const ledger = buildSovereignCommanderCapabilityParityLedger([], {
    priorLedger: { capabilities: previousCapabilities },
    nowUtc: '2026-10-25T15:00:00.000Z',
  });
  assert.equal(ledger.buildableGapCount, 3);
  assert.equal(ledger.parityPresentCount, 0);
  assert.equal(ledger.newlyProvenParityCount, 0);
  assert.equal(ledger.daemonMayReportGreen, false);
  assert.equal(ledger.zeroGapInvariantSatisfied, false);
  assert.equal(ledger.closureRequired, true);
  for (const capability of ledger.capabilities) {
    const previous = previousCapabilities.find((item) => item.capabilityId === capability.capabilityId);
    assert.equal(capability.state, 'BUILDABLE_GAP');
    assert.equal(capability.stateTransition, 'PARITY_PRESENT->BUILDABLE_GAP');
    assert.equal(capability.currentObserved, false);
    assert.equal(capability.newlyProvenParity, false);
    assert.equal(capability.runtimeParityProven, false);
    assert.equal(capability.partialSovereignEquivalent, 'search_project');
    for (const key of ['firstSeenAtUtc', 'lastSeenAtUtc', 'observationCount', 'missionIds', 'actionIds', 'queuePaths'])
      assert.deepEqual(capability[key], previous[key], key);
  }
  const next = buildSovereignCommanderCapabilityParityLedger([], {
    priorLedger: ledger,
    nowUtc: '2026-10-25T15:01:00.000Z',
  });
  assert.equal(next.buildableGapCount, 3);
  assert.equal(next.newlyProvenParityCount, 0);
  assert.equal(next.capabilities[0].stateTransition, 'RETAINED');
  assert.equal(next.capabilities[0].observationCount, 17);
});

test('search scope correction preserves authority holds and combines observation provenance', () => {
  const first = buildSovereignCommanderCapabilityParityLedger([
    remote('start-search', { actionGrant: { operation: 'start-search', arbitraryShellAllowed: true } }),
  ], { nowUtc: '2026-10-24T18:00:00.000Z' });
  const held = buildSovereignCommanderCapabilityParityLedger([], {
    priorLedger: first,
    nowUtc: '2026-10-25T15:00:00.000Z',
  });
  assert.equal(held.capabilities[0].state, 'BOUNDARY_HOLD');
  assert.equal(held.capabilities[0].newlyProvenParity, false);
  const before = buildSovereignCommanderCapabilityParityLedger([remote('get-more-search-results')], {
    nowUtc: '2026-10-24T18:00:00.000Z',
  });
  const after = buildSovereignCommanderCapabilityParityLedger([
    remote('get-more-search-results', { missionId: 'second-mission', actionId: 'second-action' }),
  ], { priorLedger: before, nowUtc: '2026-10-25T15:00:00.000Z' });
  assert.equal(after.capabilities[0].observationCount, 2);
  assert.deepEqual(after.capabilities[0].missionIds, ['critical-2573-parity', 'second-mission']);
  assert.deepEqual(after.capabilities[0].actionIds, ['action-get-more-search-results', 'second-action']);
  assert.equal(after.capabilities[0].firstSeenAtUtc, before.capabilities[0].firstSeenAtUtc);
  assert.equal(after.capabilities[0].lastSeenAtUtc, '2026-10-25T15:00:00.000Z');
});

test('source construction resolves to the proven Sovereign canonical build lane', () => {
  const result = classifyRemoteCommanderCapabilityObservation(remote('source-construction'));
  assert.equal(result.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT);
  assert.equal(result.sovereignEquivalent, 'sovereign-source-construction-lane');
  assert.equal(result.canonicalOwnerGoal, '#2573');
  assert.equal(result.createDuplicateGoalAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
});

test('canonical Desktop Commander agent handoff normalizes to source construction parity', () => {
  const result = classifyRemoteCommanderCapabilityObservation({
    adapter: 'desktop-commander',
    path: 'C:/queue/source-build.json',
    item: {
      missionId: 'critical-2573-parity',
      actionId: 'desktop-source-build',
      payload: { actionKind: 'agent-handoff' },
    },
  });
  assert.equal(result.capabilityId, 'source-construction');
  assert.equal(result.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT);
  assert.equal(result.sovereignEquivalent, 'sovereign-source-construction-lane');
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
  assert.equal(first.buildableGapCount, 0);
  assert.equal(first.parityPresentCount, 1);

  const second = buildSovereignCommanderCapabilityParityLedger([], {
    priorLedger: first,
    nowUtc: '2026-10-01T20:01:00.000Z',
  });

  assert.equal(second.capabilities.length, 1);
  assert.equal(second.capabilities[0].currentObserved, false);
  assert.equal(second.capabilities[0].observationCount, 2);
  assert.equal(second.buildableGapCount, 0);
  assert.equal(second.parityPresentCount, 1);
  assert.equal(second.zeroGapInvariantSatisfied, true);
  assert.equal(second.closureRequired, false);
  assert.equal(second.daemonMayReportGreen, true);
  assert.equal(second.mustContinueUntilZero, true);
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

test('new unmetered private read-only diagnostics map to Sovereign capabilities', () => {
  const equivalences = {
    'get-file-info': 'get_file_info',
    'read-multiple-files': 'read_multiple_files',
  };
  for (const [operation, expected] of Object.entries(equivalences)) {
    const result = classifyRemoteCommanderCapabilityObservation(remote(operation));
    assert.equal(result.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT);
    assert.equal(result.sovereignEquivalent, expected);
    assert.equal(result.mergeAuthority, false);
    assert.equal(result.arbitraryShellAllowed, false);
  }
});
