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
  assert.equal(result.sovereignEquivalent, 'start_search');
  assert.equal(result.functionalScope, 'ONE_EXPLICIT_LOCAL_WINDOWS_DIRECTORY');
  assert.equal(result.runtimeParityProven, false);
  assert.equal(result.observationIngress, 'desktop-commander-direct');
  assert.equal(result.canonicalOwnerGoal, '#2573');
});

test('local device/reachability probes resolve to Sovereign visibility snapshot parity', () => {
  for (const operation of ['device-status', 'connection-status']) {
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

test('scoped private capabilities map to their own tools without installed acceptance', () => {
  const project = classifyRemoteCommanderCapabilityObservation(remote('search-project'));
  assert.equal(project.sovereignEquivalent, 'search_project');
  for (const operation of ['start-search', 'get-more-search-results', 'stop-search', 'list-searches',
    'get-usage-stats', 'get-recent-tool-calls', 'get-tool-result', 'list-remote-tool-calls',
    'set-config-value']) {
    const result = classifyRemoteCommanderCapabilityObservation(remote(operation));
    assert.equal(result.state, 'PARITY_PRESENT', operation);
    assert.equal(result.sovereignEquivalent, operation.replaceAll('-', '_'), operation);
    assert.notEqual(result.sovereignEquivalent, 'search_project');
    assert.equal(result.privateTransportRequired, true);
    assert.equal(result.parityEvidenceScope, 'SOURCE_CATALOG_ONLY');
    assert.equal(result.runtimeParityProven, false);
    assert.equal(result.runtimeMutationAuthority, false);
  }
  const alias = classifyRemoteCommanderCapabilityObservation(remote('search-files'));
  assert.equal(alias.state, 'BUILDABLE_GAP');
  assert.equal(alias.partialSovereignEquivalent, 'search_project');
  assert.equal(alias.runtimeParityProven, false);
  const directory = classifyRemoteCommanderCapabilityObservation(remote('create-directory'));
  assert.equal(directory.sovereignEquivalent, 'create_directory');
  assert.equal(directory.runtimeParityProven, false);
});

test('same-parent rename remains a move gap and corrects retained false parity without losing provenance', () => {
  const current = classifyRemoteCommanderCapabilityObservation(remote('move-file'));
  assert.equal(current.state, 'BUILDABLE_GAP');
  assert.equal(current.partialSovereignEquivalent, 'move_file');
  assert.equal(current.partialScope, 'SAME_PARENT_REGULAR_FILE_RENAME_NO_REPLACE');
  assert.equal(current.atomicContentCasProven, false);
  const retained = buildSovereignCommanderCapabilityParityLedger([], { priorLedger: { capabilities: [{
    capabilityId: 'move-file', state: 'PARITY_PRESENT', sovereignEquivalent: 'move_file',
    newlyProvenParity: true, observationCount: 3, missionIds: ['original-move-mission'],
  }] } });
  assert.equal(retained.capabilities[0].state, 'BUILDABLE_GAP');
  assert.equal(retained.capabilities[0].observationCount, 3);
  assert.deepEqual(retained.capabilities[0].missionIds, ['original-move-mission']);
  assert.equal(retained.capabilities[0].parityGapReason, 'CROSS_DIRECTORY_FILE_MOVE_UNQUALIFIED');
  assert.equal(retained.newlyProvenParityCount, 0);
  assert.equal(retained.daemonMayReportGreen, false);
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
  assert.equal(ledger.buildableGapCount, 1);
  assert.equal(ledger.parityPresentCount, 2);
  assert.equal(ledger.newlyProvenParityCount, 0);
  assert.equal(ledger.daemonMayReportGreen, false);
  assert.equal(ledger.zeroGapInvariantSatisfied, false);
  assert.equal(ledger.closureRequired, true);
  for (const capability of ledger.capabilities) {
    const previous = previousCapabilities.find((item) => item.capabilityId === capability.capabilityId);
    assert.equal(capability.state, capability.capabilityId === 'search-files' ? 'BUILDABLE_GAP' : 'PARITY_PRESENT');
    assert.equal(capability.stateTransition, capability.capabilityId === 'search-files' ? 'PARITY_PRESENT->BUILDABLE_GAP' : 'RETAINED');
    assert.equal(capability.currentObserved, false);
    assert.equal(capability.newlyProvenParity, false);
    assert.equal(capability.runtimeParityProven, false);
    if (capability.capabilityId === 'search-files') assert.equal(capability.partialSovereignEquivalent, 'search_project');
    else assert.equal(capability.sovereignEquivalent, capability.capabilityId.replaceAll('-', '_'));
    for (const key of ['firstSeenAtUtc', 'lastSeenAtUtc', 'observationCount', 'missionIds', 'actionIds', 'queuePaths'])
      assert.deepEqual(capability[key], previous[key], key);
  }
  const next = buildSovereignCommanderCapabilityParityLedger([], {
    priorLedger: ledger,
    nowUtc: '2026-10-25T15:01:00.000Z',
  });
  assert.equal(next.buildableGapCount, 1);
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

test('own advisory feedback maps to Sovereign intake without vendor delivery or verified failure claims', () => {
  const current = classifyRemoteCommanderCapabilityObservation(remote('give-feedback-to-desktop-commander'));
  assert.equal(current.state, 'PARITY_PRESENT');
  assert.equal(current.sovereignEquivalent, 'submit_feedback');
  assert.equal(current.functionalScope, 'THIS_SOVEREIGN_WORKSPACE_UNVERIFIED_ADVISORY_FEEDBACK');
  assert.equal(current.externalVendorDelivery, false);
  assert.equal(current.automaticLearning, false);
  assert.equal(current.verifiedFailureEvidence, false);
  assert.equal(current.runtimeParityProven, false);
  const retained = buildSovereignCommanderCapabilityParityLedger([], { priorLedger: { capabilities: [{
    capabilityId: 'give-feedback-to-desktop-commander', state: 'BUILDABLE_GAP', observationCount: 3,
  }] } });
  assert.equal(retained.capabilities[0].sovereignEquivalent, 'submit_feedback');
  assert.equal(retained.capabilities[0].newlyProvenParity, false);
  assert.equal(retained.capabilities[0].externalVendorDelivery, false);
  assert.equal(retained.daemonMayReportGreen, false);
});

test('bounded create-only text PDFs never close general PDF outcomes in fresh or retained ledgers', () => {
  const fresh = classifyRemoteCommanderCapabilityObservation(remote('write-pdf'));
  assert.equal(fresh.state, 'BUILDABLE_GAP');
  assert.equal(fresh.partialSovereignEquivalent, 'write_pdf');
  assert.equal(fresh.partialScope, 'CREATE_ONLY_BOUNDED_ASCII_TEXT_PDF');
  const retained = buildSovereignCommanderCapabilityParityLedger([], { priorLedger: { capabilities: [{
    capabilityId: 'write-pdf', state: 'PARITY_PRESENT', sovereignEquivalent: 'write_pdf',
    newlyProvenParity: true, observationCount: 5,
  }] } });
  assert.equal(retained.parityPresentCount, 0); assert.equal(retained.buildableGapCount, 1);
  for (const item of [fresh, retained.capabilities[0]]) {
    assert.equal(item.runtimeParityProven, false);
    assert.equal(item.wholeDocumentAtomicityProven, false);
    assert.equal(item.existingPdfEditingSupported, false);
    assert.equal(item.unicodeTextSupported, false);
    assert.equal(item.parityGapReason, 'GENERAL_PDF_EDITING_AND_RENDERING_UNIMPLEMENTED');
  }
});

test('fixed diagnostic sessions cannot close general process outcomes in fresh or retained ledgers', () => {
  const ids = ['start-process', 'read-process-output', 'list-sessions'];
  for (const id of ids) {
    const fresh = classifyRemoteCommanderCapabilityObservation(remote(id));
    assert.equal(fresh.state, 'BUILDABLE_GAP');
    assert.equal(fresh.partialSovereignEquivalent, id.replaceAll('-', '_'));
    assert.equal(fresh.partialScope, 'THIS_PRIVATE_HANDLER_TWO_FIXED_READ_ONLY_DIAGNOSTIC_PROFILES');
    assert.equal(fresh.descendantsExcluded, false);
    assert.equal(fresh.nativeCustodyQualified, false);
  }
  const retained = buildSovereignCommanderCapabilityParityLedger([], { priorLedger: {
    capabilities: ids.map(id => ({ capabilityId: id, state: 'PARITY_PRESENT',
      sovereignEquivalent: id.replaceAll('-', '_'), newlyProvenParity: true, observationCount: 4 })),
  } });
  assert.equal(retained.buildableGapCount, 3);
  assert.equal(retained.parityPresentCount, 0);
  assert.equal(retained.daemonMayReportGreen, false);
  for (const capability of retained.capabilities) {
    assert.equal(capability.observationCount, 4);
    assert.equal(capability.parityGapReason, 'GENERAL_INTERACTIVE_PROCESS_SESSION_CONTRACT_UNQUALIFIED');
    assert.equal(capability.runtimeParityProven, false);
  }
});

test('owned diagnostic cancellation does not close general termination or accept arbitrary PID authority', () => {
  const fresh = classifyRemoteCommanderCapabilityObservation(remote('force-terminate'));
  const retained = buildSovereignCommanderCapabilityParityLedger([], { priorLedger: { capabilities: [{
    capabilityId: 'force-terminate', state: 'PARITY_PRESENT', sovereignEquivalent: 'cancel_process_session',
    newlyProvenParity: true, observationCount: 9,
  }] } });
  assert.equal(retained.parityPresentCount, 0);
  assert.equal(retained.buildableGapCount, 1);
  assert.equal(retained.daemonMayReportGreen, false);
  assert.equal(retained.capabilities[0].observationCount, 9);
  for (const item of [fresh, retained.capabilities[0]]) {
    assert.equal(item.state, 'BUILDABLE_GAP');
    assert.equal(item.partialSovereignEquivalent, 'cancel_process_session');
    assert.equal(item.partialScope, 'THIS_PRIVATE_HANDLER_TWO_FIXED_DIAGNOSTIC_CHILDREN_CANCELLATION');
    assert.equal(item.parityGapReason, 'GENERAL_PROCESS_TERMINATION_CUSTODY_UNQUALIFIED');
    assert.equal(item.nativeCustodyQualified, false);
    assert.equal(item.descendantsExcluded, false);
    assert.equal(item.runtimeParityProven, false);
  }
  const own = classifyRemoteCommanderCapabilityObservation(remote('cancel-process-session'));
  assert.equal(own.sovereignEquivalent, 'cancel_process_session');
  assert.equal(own.functionalScope, 'THIS_PRIVATE_HANDLER_TWO_FIXED_DIAGNOSTIC_CHILDREN_CANCELLATION');
  assert.equal(own.runtimeParityProven, false);
  const arbitrary = classifyRemoteCommanderCapabilityObservation(remote('kill-process'));
  assert.equal(arbitrary.state, 'BUILDABLE_GAP');
  assert.notEqual(arbitrary.sovereignEquivalent, 'cancel_process_session');
  assert.notEqual(arbitrary.partialSovereignEquivalent, 'cancel_process_session');
});

test('one-host visibility cannot close authenticated account device inventory', () => {
  const fresh = classifyRemoteCommanderCapabilityObservation(remote('list-devices'));
  assert.equal(fresh.state, 'BUILDABLE_GAP');
  assert.equal(fresh.partialSovereignEquivalent, 'visibility-snapshot');
  assert.equal(fresh.partialScope, 'LOCAL_BATTLE_BRIDGE_HOST_VISIBILITY_ONLY');
  const ledger = buildSovereignCommanderCapabilityParityLedger([], { priorLedger: { capabilities: [{
    capabilityId: 'list-devices', state: 'PARITY_PRESENT', sovereignEquivalent: 'visibility-snapshot',
    newlyProvenParity: true, observationCount: 7,
  }] } });
  assert.equal(ledger.parityPresentCount, 0);
  assert.equal(ledger.buildableGapCount, 1);
  assert.equal(ledger.capabilities[0].observationCount, 7);
  assert.equal(ledger.capabilities[0].parityGapReason, 'AUTHENTICATED_ACCOUNT_DEVICE_INVENTORY_UNIMPLEMENTED');
  assert.equal(ledger.capabilities[0].runtimeParityProven, false);
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
  assert.equal(second.sourceGapClosureRequired, false);
  assert.equal(second.closureRequired, true);
  assert.equal(second.daemonMayReportGreen, false);
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

test('empty, static and retained catalog observations never establish installed parity', async () => {
  const { projectSovereignCapabilityCatalogTruth } = await import('./sovereignCommanderCapabilityParityV1.mjs');
  for (const entries of [[], [remote('source-construction')], [remote('read-file')]]) {
    for (const priorLedger of [null, { daemonMayReportGreen: true, runtimeParityProven: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN', capabilities: [{
        capabilityId: 'read-file', state: 'PARITY_PRESENT', newlyProvenParity: true, runtimeParityProven: true,
      }] }]) {
      const ledger = buildSovereignCommanderCapabilityParityLedger(entries, { priorLedger });
      assert.equal(ledger.runtimeParityProven, false);
      assert.equal(ledger.daemonMayReportGreen, false);
      assert.equal(ledger.installedParityState, 'UNKNOWN');
      assert.equal(ledger.closureRequired, true);
      assert.equal(ledger.newlyProvenParityCount, 0);
      assert.ok(ledger.capabilities.every(c => c.runtimeParityProven === false && c.newlyProvenParity === false));
      const projected = projectSovereignCapabilityCatalogTruth(ledger);
      assert.equal(projected.daemonMayReportGreen, false);
      assert.equal(projected.finalVerdict, 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RUNTIME_UNPROVEN');
    }
  }
});

test('public catalog truth rejects malformed counts and cannot launder asserted acceptance', async () => {
  const { projectSovereignCapabilityCatalogTruth: project } = await import('./sovereignCommanderCapabilityParityV1.mjs');
  const legacy = { canonicalOwnerGoal: '#2573', retainedCapabilityCount: 31, parityPresentCount: 31,
    buildableGapCount: 0, boundaryHoldCount: 0, finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN' };
  for (const claimed of [false, true, 'true', null, { allRequiredProofs: true }]) {
    const result = project({ ...legacy, runtimeParityProven: claimed, daemonMayReportGreen: claimed,
      installedHead: 'a'.repeat(40), acceptedOperationCount: 31, proofRefs: ['caller-asserted'], privatePath: 'PRIVATE' });
    assert.equal(result.runtimeParityProven, false);
    assert.equal(result.daemonMayReportGreen, false);
    assert.equal(result.closureRequired, true);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|caller-asserted|installedHead/);
    assert.deepEqual(project(result), result);
  }
  for (const key of ['retainedCapabilityCount','parityPresentCount','buildableGapCount','boundaryHoldCount'])
    for (const bad of [null, '0', false, -1, 0.5, 10001, NaN, Infinity])
      assert.equal(project({ ...legacy, [key]: bad }), null, key + ':' + bad);
  assert.equal(project({ ...legacy, retainedCapabilityCount: 30 }), null);
  assert.equal(project({ ...legacy, canonicalOwnerGoal: '#9999' }), null);
  const held = project({ ...legacy, parityPresentCount: 30, boundaryHoldCount: 1 });
  assert.equal(held.zeroGapInvariantSatisfied, false);
  assert.equal(held.finalVerdict, 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_BOUNDARY_HOLD');
});
