import assert from 'node:assert/strict';
import test from 'node:test';
import { createSovereignCommanderMcpHandler } from '../../scripts/sovereign-commander-mcp.mjs';
import { buildSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import { SOVEREIGN_COMMANDER_REMOTE_ACTIONS } from './sovereignCommanderRemoteMailboxV1.mjs';
import {
  buildStephanosExecutionCommandEnvelopeV1,
  buildStephanosExecutionSurfaceCatalogV1,
} from './stephanosExecutionCommandFabricV1.mjs';

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

test('Battle Bridge diagnosis and fixed repairs resolve across registry, MCP and cloud admission', async () => {
  const repoRoot = 'C:\\repo';
  const handler = createSovereignCommanderMcpHandler({ repoRoot });
  await handler('initialize', { protocolVersion: '2025-11-25' }, { isRequest: true });
  await handler('notifications/initialized', {}, { isNotification: true });
  const listed = await handler('tools/list', {}, { isRequest: true });
  const admitted = listed.tools.find(({ name }) => name === 'maintenance_action').inputSchema.properties.actionId.enum;
  for (const action of [
    'battle-bridge-status', 'battle-bridge-observe', 'visibility-snapshot',
    'cpu-pressure-snapshot', 'controller-lane-status', 'meter-status', 'status-recovery-mesh',
    'status-worker-watchdog', 'status-stephanos-core-daemon', 'gaming-resource-status',
    'starfield-vr-performance-diagnosis', 'repair-ui-4173', 'repair-control-plane',
    'repair-battle-bridge', 'repair-openclaw-stack',
  ]) {
    const result = classifyRemoteCommanderCapabilityObservation(remote(action));
    assert.equal(result.state, 'PARITY_PRESENT', action);
    assert.equal(result.sovereignEquivalent, action);
    assert.ok(admitted.includes(action), `${action} must be discoverable from local ChatGPT`);
    assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes(action), `${action} must have guarded cloud ingress`);
    const envelope = buildStephanosExecutionCommandEnvelopeV1({
      catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: repoRoot }),
      surface: 'SOVEREIGN_COMMANDER', actionId: 'parity-test', missionId: 'parity-test',
      operation: 'MAINTENANCE_ACTION', payload: { actionId: action },
    });
    const command = buildSovereignCommanderCommandV1(envelope, { repoRoot });
    assert.equal(command.dispatchAllowed, true, action);
    assert.equal(command.plan.kind, 'fixed-process');
    assert.equal(command.plan.processId, action);
    assert.equal(result.runtimeMutationAuthority, false, 'parity classification is not action approval');
  }
});

test('diagnostic parity cannot convert general PowerShell or authority-widening requests into approval', () => {
  for (const operation of ['powershell', 'service-control', 'kill-process']) {
    assert.equal(classifyRemoteCommanderCapabilityObservation(remote(operation)).state, 'BUILDABLE_GAP');
  }
  for (const operation of ['arbitrary-shell', 'pc-restart', 'credential-export']) {
    assert.equal(classifyRemoteCommanderCapabilityObservation(remote(operation)).state, 'BOUNDARY_HOLD');
  }
  for (const action of ['cpu-pressure-snapshot', 'repair-control-plane']) {
    const result = classifyRemoteCommanderCapabilityObservation(remote(action, { payload: { arbitraryShellAllowed: true } }));
    assert.equal(result.state, 'BOUNDARY_HOLD');
    assert.equal(result.arbitraryShellAllowed, false);
  }
});

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
  assert.equal(result.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT);
  assert.equal(result.sovereignEquivalent, 'search_project');
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

test('Remote Commander project search resolves to native Sovereign search parity', () => {
  for (const operation of ['start-search', 'search-files', 'search-project', 'get-more-search-results']) {
    const result = classifyRemoteCommanderCapabilityObservation(remote(operation));
    assert.equal(result.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT, operation);
    assert.equal(result.sovereignEquivalent, 'search_project', operation);
    assert.equal(result.operatorFallbackAllowed, false, operation);
    assert.equal(result.meterDependencyAccepted, false, operation);
  }
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
