import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkpointTerminalMailboxReceipt,
  createSanitizedMailboxReceiptProjection,
  serializeBoundedReceiptJson,
} from './battle-bridge-github-command-mailbox.mjs';
import {
  FLEET_SUPERVISOR_ACTION as ACTION,
  FLEET_SUPERVISOR_SCHEMA as SCHEMA,
  compactFleetSupervisorReceiptV1,
} from '../shared/agents/sovereignCommanderFleetGoalSupervisorReceiptV1.mjs';

const HEAD = 'c'.repeat(40);
const PUBLIC_LIMIT = 9 * 1024;
const PRIVATE = 'PRIVATE_SEED_DIAGNOSTIC_TOKEN';
const STATE = Object.freeze({ issueNumber: 2964, phase: 'BLOCKED', dispatchStatus: 'failed',
  continuity: 'PARKED_BLOCKED', revision: 17, updatedAt: '2026-10-25T10:00:00.000Z' });

function diagnostics(dense = false) {
  const selected = { ...STATE, phase: 'AGENT_IMPLEMENTATION', dispatchStatus: 'running',
    continuity: 'ACTIVE', revision: 18, updatedAt: '2026-10-25T10:01:00.000Z' };
  return {
    persistedStateOnly: true,
    storedMissions: {
      snapshotStage: 'ADMISSION_RESULT', observed: true, selected, selectedOmitted: false,
      activeCount: dense ? 12 : 1,
      active: Array.from({ length: dense ? 4 : 1 }, (_, index) => ({ ...selected, issueNumber: 2964 + index })),
      truncated: dense,
    },
    retryScan: {
      snapshotStage: 'BEFORE_RETRY', observed: true, recordCount: dense ? 30 : 1,
      candidateCount: dense ? 9 : 1, evaluatedCount: dense ? 4 : 1,
      reasons: Array.from({ length: dense ? 8 : 1 }, (_, index) => ({
        issueNumber: 2964 + index, gateCode: 'OWNER_TEST_SET_UNCHANGED',
      })),
      truncated: dense,
      recovery: { issueNumber: 2964, matchCount: 1, state: { ...STATE },
        stateOmitted: false, gateCode: 'OWNER_TEST_SET_UNCHANGED' },
    },
  };
}

// Keep the established v1 core small; the existing fleet publication suite owns
// its full fixture matrix. These tests add only optional diagnostic coverage.
function packet(detail, ok = true, dense = false) {
  return {
    schemaVersion: SCHEMA, ok,
    finalVerdict: `SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_${ok ? 'HELD_EXPLAINED' : 'BLOCKED'}`,
    blockerCode: ok ? '' : 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING',
    ...(detail === undefined ? {} : { missionDiagnostics: detail }),
    retryAdmission: { present: true, classification: 'SOURCE_DIFF_RETRY_REQUIRES_STRONGER_OWNER_ACCEPTANCE',
      retried: false, issueNumber: 1557 },
    admission: { present: true, classification: 'ELASTIC_GOAL_MISSIONS_OCCUPIED', reasonCode: 'UNKNOWN' },
    held: { count: dense ? 30 : 0,
      reasons: Array.from({ length: dense ? 8 : 0 }, (_, index) => ({ issueNumber: 2955 + index,
        reasonCode: 'EXISTING_GOAL_MISSION_TERMINAL_AWAITING_GOAL_RECONCILIATION' })), truncated: dense },
    activeMissionCount: 1, runningMissionCount: 1, runnableGoalCount: 0, availableSlotCount: 73,
    dispatchCount: 0, pickupPendingCount: 0, provenPickupCount: 0, heldGoalCount: 0,
    diagnosticOnly: true, duplicateSchedulerAllowed: false, duplicateLeaseAllowed: false,
    mergeAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false,
  };
}

function receipt(value, overrides = {}) {
  const result = {
    ok: value.ok, remoteAction: ACTION, processId: ACTION, status: value.ok ? 0 : 2,
    finalVerdict: value.ok ? 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE'
      : 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED',
    sourceHead: HEAD, expectedHeadMatch: true, proofHash: 'a'.repeat(64), fleetSupervisor: value,
    publicReceiptSafe: true, secretMaterialReturned: false, ...overrides,
  };
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'meter-continuity-seed-growth-diagnostic-20261025t103000000z',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os', issueNumber: 3149, branch: 'main',
    acceptedAt: '2026-10-25T10:30:01.000Z', heartbeatAt: '2026-10-25T10:30:02.000Z',
    completedAt: '2026-10-25T10:30:03.000Z',
    expectedHead: HEAD, processSourceHead: HEAD, state: result.ok ? 'DONE' : 'BLOCKED',
    result: { ok: result.ok, verdict: result.ok ? 'COMMAND_EXECUTION_COMPLETE' : 'COMMAND_EXECUTION_BLOCKED', result },
  };
}

function publish(value, limit = PUBLIC_LIMIT) {
  const json = serializeBoundedReceiptJson(value, limit);
  assert.ok(Buffer.byteLength(json, 'utf8') <= limit);
  assert.doesNotMatch(json, /PRIVATE_SEED_DIAGNOSTIC_TOKEN|privateRequiredTests|privateLease|rawMissionId|PrivateOwner/);
  return JSON.parse(json);
}

function checkpoint(value) {
  const state = { consumedRequestIds: [], acceptedRequestIds: [value.requestId] };
  let writes = 0;
  checkpointTerminalMailboxReceipt(state, value, { persist() { writes++; } });
  assert.equal(writes, 1);
  assert.deepEqual(state.acceptedRequestIds, []);
  assert.deepEqual(state.consumedRequestIds, [value.requestId]);
  return state.lastReceipt;
}

function assertNoPickup(value) {
  assert.equal(value.dispatchCount, 0);
  assert.equal(value.provenPickupCount, 0);
  assert.equal(value.retryAdmission.retried, false);
  assert.equal(value.diagnosticOnly, true);
  for (const key of ['duplicateSchedulerAllowed', 'duplicateLeaseAllowed', 'mergeAuthority',
    'runtimeMutationAuthority', 'arbitraryShellAllowed']) assert.equal(value[key], false);
}

test('old v1 fleet packets remain valid without inventing optional mission diagnostics', () => {
  for (const ok of [true, false]) {
    const expected = packet(undefined, ok);
    let current = checkpoint(receipt(expected));
    for (let pass = 0; pass < 4; pass++) {
      assert.deepEqual(current.result.result.fleetSupervisor, expected);
      assert.equal(Object.hasOwn(current.result.result.fleetSupervisor, 'missionDiagnostics'), false);
      assert.equal(current.result.result.maintenanceStatus, ok ? 0 : 2);
      current = publish(current);
    }
  }
});

for (const ok of [true, false]) {
  test(`${ok ? 'completed' : 'blocked'} fleet checkpoints retain distinct pre-retry and admission snapshots`, () => {
    const expected = packet(diagnostics(), ok);
    const raw = receipt({ ...expected, privateLease: PRIVATE, rawMissionId: PRIVATE },
      { stdout: PRIVATE, privateRequiredTests: [PRIVATE] });
    assert.deepEqual(createSanitizedMailboxReceiptProjection(raw).operationResult.fleetSupervisor, expected);
    let current = checkpoint(raw);
    for (let pass = 0; pass < 4; pass++) {
      const actual = current.result.result.fleetSupervisor;
      assert.deepEqual(actual, expected);
      assert.equal(current.state, ok ? 'DONE' : 'BLOCKED');
      assert.equal(current.result.result.maintenanceStatus, ok ? 0 : 2);
      assert.equal(actual.missionDiagnostics.retryScan.snapshotStage, 'BEFORE_RETRY');
      assert.equal(actual.missionDiagnostics.retryScan.recovery.state.phase, 'BLOCKED');
      assert.equal(actual.missionDiagnostics.retryScan.recovery.state.revision, 17);
      assert.equal(actual.missionDiagnostics.storedMissions.snapshotStage, 'ADMISSION_RESULT');
      assert.equal(actual.missionDiagnostics.storedMissions.selected.dispatchStatus, 'running');
      assert.equal(actual.missionDiagnostics.storedMissions.selected.revision, 18);
      assertNoPickup(actual);
      current = publish(current);
    }
  });
}

test('unobserved, absent, ambiguous, unknown and not-evaluated witnesses stay distinct after publication', () => {
  const unobserved = diagnostics();
  Object.assign(unobserved.storedMissions, { observed: false, selected: null, activeCount: null, active: [] });
  Object.assign(unobserved.retryScan, { observed: false, recordCount: null, candidateCount: null,
    evaluatedCount: null, reasons: [], recovery: { issueNumber: 2964, matchCount: null,
      state: null, stateOmitted: false, gateCode: 'NOT_OBSERVED' } });
  const absent = diagnostics();
  Object.assign(absent.retryScan, { recordCount: 0, candidateCount: 0, evaluatedCount: 0, reasons: [],
    recovery: { issueNumber: 2964, matchCount: 0, state: null, stateOmitted: false, gateCode: 'MISSION_NOT_OBSERVED' } });
  const ambiguous = diagnostics();
  Object.assign(ambiguous.retryScan, { recordCount: 2, candidateCount: 2, evaluatedCount: 0,
    reasons: Array.from({ length: 2 }, () => ({ issueNumber: 2964, gateCode: 'NOT_EVALUATED' })),
    recovery: { issueNumber: 2964, matchCount: 2, state: null, stateOmitted: false, gateCode: 'AMBIGUOUS_MISSION_IDENTITY' } });
  const notEvaluated = diagnostics();
  notEvaluated.retryScan.evaluatedCount = 0;
  notEvaluated.retryScan.reasons[0].gateCode = 'NOT_EVALUATED';
  notEvaluated.retryScan.recovery.gateCode = 'NOT_EVALUATED';
  const unknown = diagnostics();
  Object.assign(unknown.retryScan.recovery.state, { phase: 'UNKNOWN', dispatchStatus: 'UNKNOWN',
    continuity: 'UNKNOWN', revision: null, updatedAt: null });
  unknown.retryScan.recovery.gateCode = 'UNKNOWN';
  for (const detail of [unobserved, absent, ambiguous, notEvaluated, unknown]) {
    const expected = packet(detail);
    let current = checkpoint(receipt(expected));
    for (let pass = 0; pass < 3; pass++) {
      const actual = current.result.result.fleetSupervisor;
      assert.deepEqual(actual.missionDiagnostics, detail);
      assertNoPickup(actual);
      current = publish(current);
    }
    const compacted = compactFleetSupervisorReceiptV1(expected, 0);
    current = checkpoint(receipt(compacted));
    for (let pass = 0; pass < 3; pass++) {
      const actual = current.result.result.fleetSupervisor;
      assert.deepEqual(actual.missionDiagnostics, {
        detailsOmitted: true, active: detail.storedMissions.activeCount,
        records: detail.retryScan.recordCount, candidates: detail.retryScan.candidateCount,
        evaluated: detail.retryScan.evaluatedCount, issue: 2964,
        matches: detail.retryScan.recovery.matchCount, gate: detail.retryScan.recovery.gateCode,
      });
      assertNoPickup(actual);
      current = publish(current);
    }
  }
});

test('malformed or private optional diagnostics disappear without changing the established fleet result', () => {
  const corruptions = [
    value => { value.persistedStateOnly = false; },
    value => { value.privateLease = PRIVATE; },
    value => { value.storedMissions.selected.rawMissionId = PRIVATE; },
    value => { value.storedMissions.active[0].phase = PRIVATE; },
    value => { value.retryScan.recovery.state.updatedAt = 'C:\\Users\\PrivateOwner\\state.json'; },
    value => { value.retryScan.recovery.issueNumber = 2955; },
    value => { value.retryScan.recovery.state.issueNumber = 2955; },
    value => { value.retryScan.recovery.gateCode = PRIVATE; },
    value => { value.retryScan.reasons[0].privateRequiredTests = [PRIVATE]; },
    value => { value.retryScan.evaluatedCount = 2; },
    value => { value.retryScan.observed = false; },
    value => { value.retryScan.snapshotStage = 'ADMISSION_RESULT'; },
    value => { value.storedMissions.snapshotStage = 'BEFORE_RETRY'; },
  ];
  for (const corrupt of corruptions) {
    const detail = diagnostics(); corrupt(detail);
    const raw = receipt(packet(detail, false));
    const expected = packet(undefined, false);
    assert.deepEqual(createSanitizedMailboxReceiptProjection(raw).operationResult.fleetSupervisor, expected);
    let current = checkpoint(raw);
    for (let pass = 0; pass < 3; pass++) {
      assert.equal(current.state, 'BLOCKED');
      assert.deepEqual(current.result.result.fleetSupervisor, expected);
      current = publish(current);
    }
  }
});

test('explicit pressure omission preserves witness identity and gate without inventing an observed state', () => {
  const full = packet(diagnostics(), false);
  const compacted = compactFleetSupervisorReceiptV1(full, 0);
  assert.ok(compacted);
  const detail = compacted.missionDiagnostics;
  assert.deepEqual(detail, {
    detailsOmitted: true, active: 1, records: 1, candidates: 1, evaluated: 1,
    issue: 2964, matches: 1, gate: 'OWNER_TEST_SET_UNCHANGED',
  });
  let current = checkpoint(receipt(compacted));
  for (let pass = 0; pass < 4; pass++) {
    assert.deepEqual(current.result.result.fleetSupervisor, compacted);
    current = publish(current);
  }
  const absent = diagnostics();
  Object.assign(absent.storedMissions, { selected: null, activeCount: 0, active: [] });
  Object.assign(absent.retryScan, { recordCount: 0, candidateCount: 0, evaluatedCount: 0, reasons: [],
    recovery: { issueNumber: 2964, matchCount: 0, state: null, stateOmitted: false, gateCode: 'MISSION_NOT_OBSERVED' } });
  const absentOutput = publish(checkpoint(receipt(compactFleetSupervisorReceiptV1(packet(absent), 0))))
    .result.result.fleetSupervisor.missionDiagnostics;
  assert.deepEqual(absentOutput, {
    detailsOmitted: true, active: 0, records: 0, candidates: 0, evaluated: 0,
    issue: 2964, matches: 0, gate: 'MISSION_NOT_OBSERVED',
  });
});

test('private or inconsistent pressure summaries cannot replace the established fleet result', () => {
  const corruptions = [
    value => { value.detailsOmitted = false; },
    value => { value.privateLease = PRIVATE; },
    value => { value.rawMissionId = PRIVATE; },
    value => { value.issue = 2955; },
    value => { value.matches = 0; },
    value => { value.records = null; },
    value => { value.gate = PRIVATE; },
  ];
  for (const corrupt of corruptions) {
    const detail = structuredClone(compactFleetSupervisorReceiptV1(packet(diagnostics()), 0).missionDiagnostics);
    corrupt(detail);
    let current = checkpoint(receipt(packet(detail, false)));
    for (let pass = 0; pass < 3; pass++) {
      assert.equal(current.state, 'BLOCKED');
      assert.equal(current.result.result.maintenanceStatus, 2);
      assert.deepEqual(current.result.result.fleetSupervisor, packet(undefined, false));
      current = publish(current);
    }
  }
});

for (const [ok, maximum] of [[true, false], [false, false], [true, true], [false, true]]) {
  test(`actual 9 KiB publication preserves diagnostics for ${ok ? 'six completed fleet packets' : 'five completed packets and the blocked sixth'}${maximum ? ' with maximum diagnostic counts' : ''}`, () => {
    const detail = diagnostics(true);
    const gateCode = maximum ? 'SOURCE_DIFF_MULTIPLE_BLOCKERS' : 'OWNER_TEST_SET_UNCHANGED';
    if (maximum) {
      detail.storedMissions.activeCount = 1_000_000;
      Object.assign(detail.retryScan, { recordCount: 1_000_000, candidateCount: 1_000_000, evaluatedCount: 1_000_000 });
      detail.retryScan.recovery.gateCode = gateCode;
      for (const row of detail.retryScan.reasons) row.gateCode = gateCode;
    }
    const completed = packet(detail, true, true);
    const blocked = packet(detail, false, true);
    const completedSteps = Array.from({ length: ok ? 6 : 5 }, (_, stepIndex) => ({
      stepIndex, remoteAction: ACTION, processId: ACTION, status: 0, errorCode: '',
      proofHash: String(stepIndex + 1).repeat(64), fleetSupervisor: completed, stdout: PRIVATE,
    }));
    const raw = receipt(ok ? completed : blocked, {
      remoteAction: ok ? '' : ACTION, remotePlan: Array(6).fill(ACTION), stepCount: 6,
      completedSteps, planProofHash: 'd'.repeat(64),
      finalVerdict: ok ? 'SOVEREIGN_COMMANDER_REMOTE_PLAN_COMPLETE' : 'SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED',
    });
    let current = checkpoint(raw);
    assert.ok(Buffer.byteLength(JSON.stringify(current), 'utf8') > PUBLIC_LIMIT,
      'the sanitized dense checkpoint must exceed the real 9 KiB limit');
    for (let pass = 0; pass < 3; pass++) {
      current = publish(current);
      assert.equal(current.githubProjectionTruncated, true);
      assert.equal(Object.hasOwn(current, 'missionId'), false, 'the core fallback was selected');
      assert.equal(current.state, ok ? 'DONE' : 'BLOCKED');
      const result = current.result.result;
      assert.equal(result.stepCount, 6);
      assert.equal(result.remotePlan.length, 6);
      assert.equal(result.completedSteps.length, ok ? 6 : 5);
      const packets = result.completedSteps.map(value => value.fleetSupervisor);
      if (!ok) {
        assert.equal(result.maintenanceStatus, 2);
        assert.equal(result.fleetSupervisor.ok, false);
        assert.equal(result.fleetSupervisor.blockerCode, 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING');
        packets.push(result.fleetSupervisor);
      }
      assert.equal(packets.length, 6);
      for (const value of packets) {
        assertNoPickup(value);
        const detail = value.missionDiagnostics;
        assert.ok(detail, 'bounded diagnostic counts and the fixed witness must survive');
        assert.deepEqual(detail, {
          detailsOmitted: true, active: maximum ? 1_000_000 : 12,
          records: maximum ? 1_000_000 : 30, candidates: maximum ? 1_000_000 : 9,
          evaluated: maximum ? 1_000_000 : 4, issue: 2964, matches: 1, gate: gateCode,
        });
        const { missionDiagnostics: _actualDetails, ...actualCore } = value;
        const { missionDiagnostics: _sourceDetails, ...expectedCore } = value.ok ? completed : blocked;
        assert.deepEqual(actualCore, { ...expectedCore, held: { count: 30, reasons: [], truncated: true } });
        assert.equal(value.held.count, 30);
        assert.equal(value.held.truncated, true);
      }
    }
  });
}
