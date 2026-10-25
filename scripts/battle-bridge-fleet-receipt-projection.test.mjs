import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkpointTerminalMailboxReceipt,
  createSanitizedMailboxReceiptProjection,
  createWindowsSafeMailboxReceiptFilename,
  readMailboxReceipt,
  serializeBoundedReceiptJson,
} from './battle-bridge-github-command-mailbox.mjs';
import {
  FLEET_SUPERVISOR_ACTION as ACTION,
  FLEET_SUPERVISOR_SCHEMA as SCHEMA,
} from '../shared/agents/sovereignCommanderFleetGoalSupervisorReceiptV1.mjs';

const HEAD = 'f'.repeat(40);
const PUBLIC_LIMIT = 9 * 1024;
const SECRET = 'PRIVATE_CODE_SHAPED_TOKEN_2964';
const PRIVATE_PATH = 'C:\\Users\\PrivateOwner\\source-lease.json';
const HELD = 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_HELD_EXPLAINED';
const BLOCKED = 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED';
const ORIGINAL_HOLD = 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING';
const AUTHORITY_KEYS = [
  'duplicateSchedulerAllowed', 'duplicateLeaseAllowed', 'mergeAuthority',
  'runtimeMutationAuthority', 'arbitraryShellAllowed',
];

function fleetPacket({ ok = true, dense = false } = {}) {
  const reasons = dense
    ? Array.from({ length: 8 }, (_, index) => ({
      issueNumber: 2964 + index,
      reasonCode: 'EXISTING_GOAL_MISSION_TERMINAL_AWAITING_GOAL_RECONCILIATION',
    }))
    : [{ issueNumber: 2964, reasonCode: 'RESOURCE_SCOPE_CONFLICT' }];
  return {
    schemaVersion: SCHEMA,
    ok,
    finalVerdict: ok ? HELD : BLOCKED,
    blockerCode: ok ? '' : ORIGINAL_HOLD,
    retryAdmission: {
      present: true,
      classification: 'SOURCE_DIFF_RETRY_REQUIRES_STRONGER_OWNER_ACCEPTANCE',
      retried: false,
      issueNumber: 2964,
    },
    admission: {
      present: true,
      classification: 'ELASTIC_GOAL_MISSIONS_AVAILABLE',
      reasonCode: 'UNKNOWN',
    },
    held: { count: dense ? 23 : 1, reasons, truncated: dense },
    activeMissionCount: 1,
    runningMissionCount: 0,
    runnableGoalCount: 1,
    availableSlotCount: 1,
    dispatchCount: 0,
    pickupPendingCount: 0,
    provenPickupCount: 0,
    heldGoalCount: dense ? 23 : 1,
    diagnosticOnly: true,
    duplicateSchedulerAllowed: false,
    duplicateLeaseAllowed: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  };
}

function operation(packet = fleetPacket(), overrides = {}) {
  return {
    ok: packet.ok,
    remoteAction: ACTION,
    finalVerdict: packet.ok
      ? 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE'
      : 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED',
    sourceHead: HEAD,
    branch: 'main',
    expectedHeadMatch: true,
    processId: ACTION,
    status: packet.ok ? 0 : 2,
    proofHash: 'a'.repeat(64),
    executionBlocker: packet.ok ? '' : 'FLEET_SUPERVISOR_REPORTED_BLOCKED',
    fleetSupervisor: packet,
    publicReceiptSafe: true,
    secretMaterialReturned: false,
    ...overrides,
  };
}

function receipt(result = operation(), suffix = 'single') {
  const requestId = `fleet-public-receipt-${suffix}-001`;
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId,
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 3149,
    branch: 'main',
    state: result.ok ? 'DONE' : 'BLOCKED',
    acceptedAt: '2026-10-25T01:00:00.000Z',
    completedAt: '2026-10-25T01:01:00.000Z',
    expectedHead: HEAD,
    processSourceHead: HEAD,
    result: {
      ok: result.ok,
      verdict: result.ok ? 'COMMAND_EXECUTION_COMPLETE' : 'COMMAND_EXECUTION_BLOCKED',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId,
      result,
    },
  };
}

function step(index, packet = fleetPacket(), overrides = {}) {
  return {
    stepIndex: index,
    remoteAction: ACTION,
    proofHash: String(index + 1).repeat(64),
    processId: ACTION,
    status: packet.ok ? 0 : 2,
    errorCode: '',
    fleetSupervisor: packet,
    stdout: SECRET,
    privatePath: PRIVATE_PATH,
    ...overrides,
  };
}

function publicResult(value, limit = PUBLIC_LIMIT) {
  const json = serializeBoundedReceiptJson(value, limit);
  assert.ok(Buffer.byteLength(json, 'utf8') <= limit);
  return { json, value: JSON.parse(json), result: JSON.parse(json).result.result };
}

function assertPrivateFieldsAbsent(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  assert.doesNotMatch(json, /PRIVATE_CODE_SHAPED_TOKEN_2964|PrivateOwner|source-lease\.json/);
  assert.doesNotMatch(json, /critical-2964-private-mission|privateRequiredTests|rawStdout|privateLease/);
}

function assertPacket(actual, expected, { compacted = false } = {}) {
  assert.ok(actual, 'the typed fleet packet must survive publication');
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  const { held: actualHeld, ...actualRest } = actual;
  const { held: expectedHeld, ...expectedRest } = expected;
  assert.deepEqual(actualRest, expectedRest);
  if (!compacted) assert.deepEqual(actualHeld, expectedHeld);
  else {
    assert.equal(actualHeld.count, expectedHeld.count);
    assert.deepEqual(actualHeld.reasons, expectedHeld.reasons.slice(0, actualHeld.reasons.length));
    assert.equal(actualHeld.truncated, expectedHeld.count > actualHeld.reasons.length);
  }
  for (const key of AUTHORITY_KEYS) assert.equal(actual[key], false);
  assert.equal(actual.diagnosticOnly, true);
  assert.equal(actual.provenPickupCount, 0);
  assert.equal(actual.dispatchCount, 0);
}

test('successful fleet publication keeps the actual held retry and zero pickup evidence', () => {
  const expected = fleetPacket();
  const raw = receipt(operation({
    ...expected,
    rawStdout: SECRET,
    privateLease: { path: PRIVATE_PATH },
    missionId: 'critical-2964-private-mission',
    privateRequiredTests: [SECRET],
  }, { stdout: SECRET, stderr: PRIVATE_PATH, contentText: SECRET }));
  const projected = createSanitizedMailboxReceiptProjection(raw);
  assertPacket(projected.operationResult.fleetSupervisor, expected);
  const published = publicResult(raw);
  assert.equal(published.value.state, 'DONE');
  assert.equal(published.result.maintenanceStatus, 0);
  assertPacket(published.result.fleetSupervisor, expected);
  assert.equal(published.result.fleetSupervisor.finalVerdict, HELD);
  assert.equal(published.result.fleetSupervisor.retryAdmission.retried, false);
  assertPrivateFieldsAbsent(projected);
  assertPrivateFieldsAbsent(published.json);
});

test('blocked fleet publication preserves the finite original-owner hold without granting success', () => {
  const expected = fleetPacket({ ok: false });
  const raw = receipt(operation(expected), 'blocked');
  const projected = createSanitizedMailboxReceiptProjection(raw);
  const published = publicResult(raw);
  assert.equal(projected.state, 'BLOCKED');
  assert.equal(projected.execution.ok, false);
  assert.equal(projected.operationResult.ok, false);
  assertPacket(projected.operationResult.fleetSupervisor, expected);
  assert.equal(published.value.state, 'BLOCKED');
  assert.equal(published.value.result.ok, false);
  assert.equal(published.result.ok, false);
  assert.equal(published.result.maintenanceStatus, 2);
  assert.equal(published.result.fleetSupervisor.blockerCode, ORIGINAL_HOLD);
  assertPacket(published.result.fleetSupervisor, expected);
});

test('ordered completed plan steps retain fleet diagnostics only on the fleet action', () => {
  const expected = fleetPacket();
  const actions = ['battle-bridge-status', ACTION, 'status'];
  const completedSteps = actions.map((remoteAction, index) => step(index, expected, { remoteAction }));
  const raw = receipt(operation(expected, {
    remoteAction: '', remotePlan: actions, completedSteps, stepCount: 3,
    planProofHash: 'b'.repeat(64), finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PLAN_COMPLETE',
  }), 'plan');
  const projected = createSanitizedMailboxReceiptProjection(raw);
  const published = publicResult(raw);
  for (const result of [projected.operationResult, published.result]) {
    assert.deepEqual(result.remotePlan, actions);
    assert.equal(result.stepCount, 3);
    assert.equal(result.planProofHash, 'b'.repeat(64));
    assert.equal(result.completedSteps.length, 3);
    assert.equal(result.fleetSupervisor, undefined);
    assert.deepEqual(result.completedSteps.map(item => item.stepIndex), [0, 1, 2]);
    assert.equal(result.completedSteps[0].fleetSupervisor, undefined);
    assertPacket(result.completedSteps[1].fleetSupervisor, expected);
    assert.equal(result.completedSteps[2].fleetSupervisor, undefined);
  }
  assertPrivateFieldsAbsent(projected);
  assertPrivateFieldsAbsent(published.json);
});

test('a later failed plan step cannot erase the earlier completed fleet observation', () => {
  const expected = fleetPacket();
  const raw = receipt(operation(expected, {
    ok: false,
    remoteAction: 'status-stephanos-core-daemon',
    remotePlan: [ACTION, 'status-stephanos-core-daemon'],
    completedSteps: [step(0, expected)],
    stepCount: 2,
    status: 2,
    blocker: 'SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED',
    finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED',
    planProofHash: 'c'.repeat(64),
  }), 'partial-failure');
  for (const result of [createSanitizedMailboxReceiptProjection(raw).operationResult,
    publicResult(raw).result]) {
    assert.equal(result.ok, false);
    assert.equal(result.fleetSupervisor, undefined);
    assert.equal(result.completedSteps.length, 1);
    assert.equal(result.completedSteps[0].status, 0);
    assertPacket(result.completedSteps[0].fleetSupervisor, expected);
  }
  assert.equal(publicResult(raw).value.state, 'BLOCKED');
});

for (const ok of [true, false]) {
  test(`${ok ? 'successful' : 'blocked'} fleet checkpoint survives repeated publication and exact receipt lookup`, async () => {
    const expected = fleetPacket({ ok });
    const raw = receipt(operation(expected), ok ? 'checkpoint-success' : 'checkpoint-blocked');
    const state = { consumedRequestIds: [], acceptedRequestIds: [raw.requestId] };
    const persisted = [];
    checkpointTerminalMailboxReceipt(state, raw, {
      persist: value => persisted.push(structuredClone(value)),
    });
    assert.equal(persisted.length, 1);
    assert.deepEqual(state.acceptedRequestIds, []);
    assert.deepEqual(state.consumedRequestIds, [raw.requestId]);
    let current = state.lastReceipt;
    for (let generation = 0; generation < 4; generation++) {
      assert.equal(current.state, ok ? 'DONE' : 'BLOCKED');
      assert.equal(current.result.ok, ok);
      assert.equal(current.result.result.ok, ok);
      assert.equal(current.result.result.maintenanceStatus, ok ? 0 : 2);
      assertPacket(current.result.result.fleetSupervisor, expected);
      assertPrivateFieldsAbsent(current);
      current = publicResult(current).value;
    }
    const receiptRoot = await mkdtemp(join(tmpdir(), 'fleet-mailbox-projection-'));
    try {
      await writeFile(join(receiptRoot, createWindowsSafeMailboxReceiptFilename(raw.requestId)),
        JSON.stringify(current), 'utf8');
      const read = await readMailboxReceipt({ targetRequestId: raw.requestId }, {
        receiptRoot,
        readSourceIdentity: async () => ({ ok: true, sourceHead: HEAD, branch: 'main' }),
      });
      assert.equal(read.ok, true);
      assert.equal(read.finalVerdict, 'MAILBOX_RECEIPT_READ_READY');
      assert.equal(read.receipt.state, ok ? 'DONE' : 'BLOCKED');
      assert.equal(read.receipt.operationResult.maintenanceStatus, ok ? 0 : 2);
      assertPacket(read.receipt.operationResult.fleetSupervisor, expected);
      assert.equal(read.commandExecutionAccess, false);
      assert.equal(read.sourceMutationAccess, false);
    } finally {
      await rm(receiptRoot, { recursive: true, force: true });
    }
  });
}

test('direct blocked execution wrappers preserve absent observations as unknown through republication', () => {
  const expected = fleetPacket({ ok: false });
  expected.retryAdmission = { present: false, classification: 'UNKNOWN', retried: null, issueNumber: null };
  expected.admission = { present: false, classification: 'UNKNOWN', reasonCode: 'UNKNOWN' };
  expected.held = { count: null, reasons: [], truncated: false };
  expected.blockerCode = 'UNKNOWN';
  const raw = receipt(operation(expected), 'direct-failure');
  raw.result = raw.result.result;
  for (const result of [createSanitizedMailboxReceiptProjection(raw).operationResult,
    publicResult(raw).result, publicResult(publicResult(raw).value).result]) {
    assert.equal(result.ok, false);
    assertPacket(result.fleetSupervisor, expected);
    assert.equal(result.fleetSupervisor.admission.present, false);
    assert.equal(result.fleetSupervisor.held.count, null);
    assert.equal(result.fleetSupervisor.retryAdmission.retried, null);
  }
});

test('foreign actions and malformed fleet packets cannot publish private or contradictory fleet truth', () => {
  const expected = fleetPacket({ ok: false });
  const cases = [
    operation(expected, { remoteAction: 'status' }),
    operation(expected, { status: 0 }),
    operation(expected, { status: null }),
    operation(expected, { status: '2' }),
    operation(expected, { status: undefined }),
    operation(expected, { status: 2, maintenanceStatus: 0 }),
    operation({ ...expected, mergeAuthority: true }),
    operation({ ...expected, dispatchCount: '0' }),
    operation({ ...expected, blockerCode: SECRET }),
    operation({ ...expected, retryAdmission: { ...expected.retryAdmission, classification: SECRET } }),
    operation({ ...expected, held: { ...expected.held,
      reasons: [{ issueNumber: 2964, reasonCode: SECRET }] } }),
    operation({ ...expected, admission: { ...expected.admission, privateLease: PRIVATE_PATH } }),
  ];
  for (const result of cases) {
    const raw = receipt(result, 'malformed');
    const projected = createSanitizedMailboxReceiptProjection(raw);
    const published = publicResult(raw);
    assert.equal(projected.operationResult.fleetSupervisor, undefined);
    assert.equal(published.result.fleetSupervisor, undefined);
    assert.equal(published.value.state, 'BLOCKED');
    assert.equal(published.value.result.ok, false);
    assert.equal(published.result.ok, false);
    assertPrivateFieldsAbsent(projected);
    assertPrivateFieldsAbsent(published.json);
  }
});

test('malformed completed fleet step exits remain unknown and never become successful zero exits', () => {
  const expected = fleetPacket();
  const statuses = [null, '0', undefined, 1, -1, NaN];
  const raw = receipt(operation(fleetPacket({ ok: false }), {
    remoteAction: '', remotePlan: Array(6).fill(ACTION), stepCount: 6,
    completedSteps: statuses.map((status, index) => step(index, expected, { status })),
    finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED',
  }), 'step-exit-invalid');
  for (const result of [createSanitizedMailboxReceiptProjection(raw).operationResult,
    publicResult(raw).result, publicResult(publicResult(raw).value).result]) {
    assert.equal(result.ok, false);
    assert.equal(result.completedSteps.length, 6);
    for (const completed of result.completedSteps) {
      assert.equal(completed.status, null);
      assert.equal(completed.fleetSupervisor, undefined);
    }
  }
});

test('dense serialization retains complete fleet truth before core field compaction is needed', () => {
  const expected = fleetPacket({ dense: true });
  const raw = receipt(operation(expected), 'dense');
  const spacious = serializeBoundedReceiptJson(raw, 256 * 1024);
  const denseBytes = Buffer.byteLength(JSON.stringify(JSON.parse(spacious)), 'utf8');
  const maxBytes = denseBytes + 96;
  assert.ok(Buffer.byteLength(spacious, 'utf8') > maxBytes);
  const published = publicResult(raw, maxBytes);
  assert.equal(published.json.includes('\n'), false);
  assertPacket(published.result.fleetSupervisor, expected);
  assert.equal(Object.hasOwn(published.value, 'missionId'), true,
    'dense serialization should still retain the ordinary projection, not the core fallback');
});

for (const ok of [true, false]) {
  test(`the actual 9 KiB fallback preserves ${ok ? 'six completed fleet steps' : 'a blocked fleet step after five completed steps'}`, () => {
    const success = fleetPacket({ dense: true });
    const failure = fleetPacket({ ok: false, dense: true });
    const completedSteps = Array.from({ length: ok ? 6 : 5 }, (_, index) => step(index, success));
    const raw = receipt(operation(ok ? success : failure, {
      remoteAction: ok ? '' : ACTION,
      remotePlan: Array(6).fill(ACTION),
      stepCount: 6,
      completedSteps,
      planProofHash: 'd'.repeat(64),
      finalVerdict: ok ? 'SOVEREIGN_COMMANDER_REMOTE_PLAN_COMPLETE' : 'SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED',
      stdout: SECRET.repeat(1000),
      privateLease: PRIVATE_PATH,
    }), ok ? 'core-complete' : 'core-blocked');
    const checkpoint = JSON.parse(serializeBoundedReceiptJson(raw, 256 * 1024));
    assert.ok(Buffer.byteLength(JSON.stringify(checkpoint), 'utf8') > PUBLIC_LIMIT,
      'the sanitized dense receipt must exceed the real limit, so the test exercises core fallback');
    let published = publicResult(checkpoint);
    for (let generation = 0; generation < 3; generation++) {
      assert.equal(published.value.githubProjectionTruncated, true);
      assert.equal(Object.hasOwn(published.value, 'missionId'), false,
        'the core fallback must actually have been selected');
      assert.equal(published.value.state, ok ? 'DONE' : 'BLOCKED');
      assert.equal(published.result.ok, ok);
      assert.equal(published.result.stepCount, 6);
      assert.equal(published.result.remotePlan.length, 6);
      assert.equal(published.result.completedSteps.length, ok ? 6 : 5);
      assert.equal(published.result.planProofHash, 'd'.repeat(64));
      for (const [index, completed] of published.result.completedSteps.entries()) {
        assert.equal(completed.stepIndex, index);
        assert.equal(completed.status, 0);
        assertPacket(completed.fleetSupervisor, success, { compacted: true });
        assert.ok(completed.fleetSupervisor.held.reasons.length < 8);
        assert.equal(completed.fleetSupervisor.held.truncated, true);
      }
      if (!ok) {
        assert.equal(published.result.maintenanceStatus, 2);
        assertPacket(published.result.fleetSupervisor, failure, { compacted: true });
        assert.equal(published.result.fleetSupervisor.blockerCode, ORIGINAL_HOLD);
      }
      assertPrivateFieldsAbsent(published.json);
      published = publicResult(published.value);
    }
  });
}
