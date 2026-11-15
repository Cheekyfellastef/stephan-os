import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SOVEREIGN_MAINTENANCE_OWNER_VERSION } from './sovereignMaintenanceAdmissionV1.mjs';
import { SOVEREIGN_CONTROL_SYSTEM_INSPECTION_SCHEMA_V1, SOVEREIGN_CONTROL_SYSTEM_STATUS_SCHEMA_V1,
  SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1, projectSovereignControlSystemStatusV1,
  sovereignControlSystemDiagnosticCodeV1 } from './sovereignControlSystemStatusV1.mjs';

const HEAD = 'a'.repeat(40), NOW = '2026-10-31T13:00:00.000Z';
function inspection() {
  return { schemaVersion: SOVEREIGN_CONTROL_SYSTEM_INSPECTION_SCHEMA_V1,
    observedAtUtc: NOW, observationOnly: true, observationCompleted: true, blocker: '',
    source: { available: true, sourceHead: HEAD, expectedMain: HEAD, expectedMainMatches: true,
      stable: true, loadedSourceBytesProven: false, remoteMainProven: false, reason: '' },
    caller: { available: true, administratorEnabled: false, sid: 'S-1-5-21-111-222-333-1001',
      observationAppliesTo: 'DIAGNOSTIC_CALLER_ONLY', observedAtUtc: NOW, reason: '' },
    owner: { available: true, stable: true, observedAtUtc: NOW, reason: '',
      before: { pid: 17281, commandSha256: 'b'.repeat(64), imageSha256: 'c'.repeat(64) },
      after: { pid: 17281 }, custodyRecordSha256: 'd'.repeat(64) },
    guardian: { available: true, enabled: true, running: false, scheduled: false,
      maintenanceInFlight: false, custodyState: 'NOT_HELD_REPORTED', blocker: '',
      sourceHead: HEAD, observedAtUtc: NOW, rawLog: 'PRIVATE_LOG' },
    nativeRuntime: { available: true, qualificationObserved: true, reason: '', sourceHead: HEAD,
      profiles: ['MAINTENANCE_GOAL_BUILDER_V1', 'SOURCE_TASK_V1'], observedAtUtc: NOW,
      bootStartedAtUtc: '2026-10-31T08:00:00.000Z', dispatchAllowed: true,
      executionCustodyReleased: true, nativeRecordId: 17281, custodyRecordSha256: 'd'.repeat(64) },
    requestLedger: { requested: true, recordObserved: true, phase: 'TERMINAL', terminalState: 'BLOCKED',
      relayWorkspaceIdentityProven: false, reason: '', requestId: 'control-tower-build-41192328171-1',
      workspaceSelection: 'DEFAULT', path: 'C:\\PRIVATE\\ledger.json', terminalProofHash: 'f'.repeat(64) },
    secret: 'PRIVATE_TOKEN', execute: true, rawPath: 'C:\\PRIVATE\\source',
  };
}

test('one closed public projection removes identity, logs and execution capabilities at every level', () => {
  const input = inspection(), projected = projectSovereignControlSystemStatusV1(input);
  assert.equal(projected.schemaVersion, SOVEREIGN_CONTROL_SYSTEM_STATUS_SCHEMA_V1);
  assert.equal(projected.observationOnly, true); assert.equal(projected.observationCompleted, true);
  assert.equal(projected.owner.stable, true); assert.equal(projected.nativeRuntime.qualificationObserved, true);
  assert.deepEqual(projected.nativeRuntime.profiles, ['MAINTENANCE_GOAL_BUILDER_V1', 'SOURCE_TASK_V1']);
  assert.equal(projected.source.loadedSourceBytesProven, false);
  assert.equal(projected.source.remoteMainProven, false);
  assert.equal(projected.requestLedger.relayWorkspaceIdentityProven, false);
  const serialized = JSON.stringify(projected);
  assert.ok(Buffer.byteLength(serialized) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1, serialized);
  for (const forbidden of ['PRIVATE', 'sid', 'pid', '17281', 'custodyRecord', 'nativeRecordId', 'dispatchAllowed',
    'executionCustodyReleased', 'terminalProofHash', 'requestId', 'workspaceSelection', 'execute', 'rawLog', 'path'])
    assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(input.nativeRuntime.dispatchAllowed, true);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.nativeRuntime.profiles), true);
});

test('Spatial and mailbox compiled inventory fits the bounded projection without granting their execution', () => {
  const profiles=['MAINTENANCE_GOAL_BUILDER_V1','SPATIAL_WORKSPACE_PREPARE_V1',
    'SOURCE_TASK_V1','CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1'];
  const input=inspection();input.nativeRuntime.profiles=profiles;
  const result=projectSovereignControlSystemStatusV1(input);
  assert.equal(result.nativeRuntime.qualificationObserved,true);
  assert.deepEqual(result.nativeRuntime.profiles,profiles);
  assert.equal(result.observationOnly,true);
  assert.equal(Object.isFrozen(result.nativeRuntime.profiles),true);
  assert.ok(Buffer.byteLength(JSON.stringify(result))<=SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
  assert.equal(Object.hasOwn(result.nativeRuntime,'dispatchAllowed'),false);
  assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(result))),result);
  for(const invalid of [[...profiles,profiles[0]],[...profiles.slice(0,3),profiles[0]],
    [...profiles.slice(0,3),'ARBITRARY_SHELL'],['SPATIAL_WORKSPACE_PREPARE_V1',{}]]) {
    const changed=inspection();changed.nativeRuntime.profiles=invalid;
    const refused=projectSovereignControlSystemStatusV1(changed);
    assert.equal(refused.nativeRuntime.qualificationObserved,false);
    assert.equal(refused.nativeRuntime.available,false);
    assert.equal(Object.hasOwn(refused.nativeRuntime,'profiles'),false);
  }
});

test('persisted public observation revalidates identically through ledger, beacon and conversation', () => {
  const first = projectSovereignControlSystemStatusV1(inspection());
  assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(first))), first);
  const input = inspection(); input.nativeRuntime = { available: true, qualificationObserved: false,
    reason: 'RUNTIME_NORMAL_OPERATOR_REQUIRED', observedAtUtc: NOW };
  const denied = projectSovereignControlSystemStatusV1(input);
  assert.equal(denied.observationCompleted, true);
  assert.deepEqual(projectSovereignControlSystemStatusV1(denied), denied);
});

function protocol(failedPredicates = []) {
  return { available: true, matches: true, failedPredicates,
    expectedVersion: SOVEREIGN_MAINTENANCE_OWNER_VERSION,
    observedVersion: failedPredicates.includes('OWNER_VERSION') ? 'OTHER' : SOVEREIGN_MAINTENANCE_OWNER_VERSION,
    observedAtUtc: NOW, reason: failedPredicates.length ? 'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED' : '' };
}

test('historical observations without protocol retain their exact persisted bytes and hash', () => {
  const projected = projectSovereignControlSystemStatusV1(inspection());
  assert.equal(Object.hasOwn(projected, 'protocol'), false);
  // Captured from the unchanged db8c public projection before this extension.
  const bytes = JSON.stringify(projected);
  assert.equal(Buffer.byteLength(bytes), 1317);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '5dfe16f064029a63a139a4e54d245661916ef5c3d202d9791a2f9d03299fe555');
  assert.equal(JSON.stringify(projectSovereignControlSystemStatusV1(JSON.parse(bytes))), bytes);
});

test('closed protocol diagnostics derive matches and never change existing completion or qualification', () => {
  const baseline = projectSovereignControlSystemStatusV1(inspection());
  for (const failed of [[], ['OBSERVATION_SCOPE'], ['NO_ADMISSION', 'OWNER_VERSION'],
    ['HTTP_OK', 'HEALTH_OK', 'SERVICE', 'OBSERVATION_SCOPE', 'NO_ADMISSION', 'OWNER_VERSION']]) {
    const input = inspection(); input.protocol = { ...protocol(failed),
      secret: 'PRIVATE_TOKEN', dispatchAllowed: true, executionCustodyReleased: true };
    const result = projectSovereignControlSystemStatusV1(input);
    assert.equal(result.protocol.available, true);
    assert.equal(result.protocol.matches, failed.length === 0);
    assert.deepEqual(result.protocol.failedPredicates, failed);
    const { protocol: observed, ...original } = result;
    assert.deepEqual(original, baseline);
    assert.equal(JSON.stringify(observed).includes('PRIVATE'), false);
    assert.equal(Object.hasOwn(observed, 'dispatchAllowed'), false);
    assert.equal(Object.hasOwn(observed, 'executionCustodyReleased'), false);
    assert.equal(Object.isFrozen(observed.failedPredicates), true);
    assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(result))), result);
  }
});

test('protocol rejects inconsistent versions, order, timestamps and accessor arrays without evaluating them', () => {
  let invoked = 0;
  const accessor = []; Object.defineProperty(accessor, '0', { get() { invoked++; return 'OWNER_VERSION'; } });
  const symbol = ['OWNER_VERSION']; symbol[Symbol('secret')] = true;
  const extra = ['OWNER_VERSION']; extra.secret = 'PRIVATE_TOKEN';
  const inherited = ['OWNER_VERSION']; Object.setPrototypeOf(inherited, null);
  const leaf = {}; Object.defineProperty(leaf, 'available', { get() { invoked++; return true; } });
  const malformed = [leaf,
    { ...protocol(), expectedVersion: 'PRIVATE_VERSION' },
    { ...protocol(), observedVersion: 'PRIVATE_VERSION' },
    { ...protocol(), observedVersion: 'OTHER' }, { ...protocol(['OWNER_VERSION']), observedVersion: SOVEREIGN_MAINTENANCE_OWNER_VERSION },
    { ...protocol(), reason: 'PRIVATE_ERROR' }, { ...protocol(), observedAtUtc: '2026-02-31T13:00:00.000Z' },
    { ...protocol(), observedAtUtc: '2026-10-31T13:00:01.000Z' },
    { ...protocol(), observedAtUtc: '2026-10-31T12:59:44.000Z' },
    ...[['PRIVATE_TOKEN'], ['HTTP_OK', 'HTTP_OK'], ['OWNER_VERSION', 'HTTP_OK'],
      accessor, symbol, extra, inherited, Array(1)].map(failedPredicates => ({ ...protocol(['OWNER_VERSION']), failedPredicates })),
  ];
  for (const bad of malformed) {
    const input = inspection(); input.protocol = bad;
    const result = projectSovereignControlSystemStatusV1(input);
    assert.equal(result.protocol.available, false); assert.equal(result.protocol.matches, false);
    assert.equal(Object.hasOwn(result.protocol, 'failedPredicates'), false);
    assert.equal(JSON.stringify(result.protocol).includes('PRIVATE'), false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(result), result);
  }
  assert.equal(invoked, 0);
});

test('protocol cannot outlive its source or native owner bracket', () => {
  for (const alter of [row => { row.source.stable = false; }, row => { row.source.expectedMain = 'e'.repeat(40); },
    row => { row.owner.stable = false; }, row => { row.owner.available = false; },
    row => { row.protocol.available = false; row.protocol.matches = true; }]) {
    const input = inspection(); input.protocol = protocol(); alter(input);
    const result = projectSovereignControlSystemStatusV1(input);
    assert.equal(result.protocol.available, false); assert.equal(result.protocol.matches, false);
    assert.equal(Object.hasOwn(result.protocol, 'observedVersion'), false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(result), result);
  }
});

test('protocol maximum failures preserve the original public byte bound without dropping existing evidence', () => {
  const labels = ['HTTP_OK', 'HEALTH_OK', 'SERVICE', 'OBSERVATION_SCOPE', 'NO_ADMISSION', 'OWNER_VERSION'];
  for (const failures of [labels, labels.slice(0, 5)]) {
    const input = inspection(), reason = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';
    input.protocol = protocol(failures); input.blocker = reason;
    for (const key of ['source', 'caller', 'owner', 'nativeRuntime', 'requestLedger']) input[key].reason = reason;
    input.guardian.blocker = reason;
    const result = projectSovereignControlSystemStatusV1(input);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
    if (!result.source) assert.equal(result.blocker, 'SOVEREIGN_CONTROL_SYSTEM_STATUS_BOUND_EXCEEDED');
    else for (const key of ['source', 'caller', 'owner', 'guardian', 'nativeRuntime', 'requestLedger'])
      assert.equal(Object.hasOwn(result, key), true);
    assert.deepEqual(projectSovereignControlSystemStatusV1(result), result);
  }
});

test('typed native refusal remains a successful observation, never successful native execution', () => {
  for (const reason of ['FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING', 'RUNTIME_NORMAL_OPERATOR_REQUIRED',
    'RUNTIME_PENDING_LATER_BOOT_UNPROVEN', 'RUNTIME_SOURCE_REF_CHANGED',
    'RUNTIME_NATIVE_ANCHOR_AUTHENTICATION_FAILED', 'FIXED_RUNTIME_IDENTITY_INSPECTION_TIMEOUT']) {
    const input = inspection(); input.nativeRuntime = { available: true, qualificationObserved: false,
      reason, observedAtUtc: NOW, dispatchAllowed: false, executionCustodyReleased: true };
    const result = projectSovereignControlSystemStatusV1(input);
    assert.equal(result.nativeRuntime.reason, reason); assert.equal(result.nativeRuntime.qualificationObserved, false);
    assert.equal(result.observationCompleted, true);
    assert.equal(Object.hasOwn(result.nativeRuntime, 'executionCustodyReleased'), false);
  }
});

test('unrecognized uppercase codes and arbitrary exception text cannot leak through a safe-looking field', () => {
  for (const secret of ['PRIVATE_SECRET', 'C:\\private\\account', 'RUNTIME_PRIVATE_SECRET', 'A'.repeat(10000)]) {
    const input = inspection(); input.blocker = secret; input.owner.reason = secret;
    input.guardian.blocker = secret; input.nativeRuntime.reason = secret; input.requestLedger.reason = secret;
    const result = projectSovereignControlSystemStatusV1(input), serialized = JSON.stringify(result);
    assert.equal(serialized.includes(secret), false);
    assert.equal(result.blocker, 'SOVEREIGN_CONTROL_SYSTEM_OBSERVATION_UNPROVEN');
    assert.equal(result.nativeRuntime.qualificationObserved, false);
    assert.equal(result.nativeRuntime.available, false);
  }
  assert.equal(sovereignControlSystemDiagnosticCodeV1('secret', 'PRIVATE_FALLBACK'),
    'SOVEREIGN_CONTROL_SYSTEM_OBSERVATION_UNPROVEN');
});

test('invalid schema, accessor, inherited and symbol-bearing records are refused without evaluation', () => {
  let getterCalled = false;
  const getter = {}; Object.defineProperty(getter, 'schemaVersion', { get() { getterCalled = true; return SOVEREIGN_CONTROL_SYSTEM_INSPECTION_SCHEMA_V1; } });
  for (const bad of [null, [], {}, { ...inspection(), schemaVersion: 'another-schema' },
    { ...inspection(), observationOnly: false }, { ...inspection(), observedAtUtc: 'arbitrary' },
    getter, Object.create(inspection()), { ...inspection(), [Symbol('secret')]: true }]) {
    const result = projectSovereignControlSystemStatusV1(bad);
    assert.equal(result.observationCompleted, false);
    assert.equal(result.blocker, 'SOVEREIGN_CONTROL_SYSTEM_STATUS_INVALID');
  }
  assert.equal(getterCalled, false);
  const nested = inspection(); nested.owner = getter;
  assert.equal(projectSovereignControlSystemStatusV1(nested).owner.available, false);
  assert.equal(getterCalled, false);
});

test('qualification requires a consistent head, time and closed profile observation', () => {
  for (const change of [n => { n.sourceHead = 'MAIN'; }, n => { n.sourceHead = 'e'.repeat(40); },
    n => { delete n.observedAtUtc; }, n => { n.observedAtUtc = '2026-02-31T13:00:00.000Z'; },
    n => { n.profiles = ['ARBITRARY_SHELL']; }, n => { n.profiles = ['SOURCE_TASK_V1', 'SOURCE_TASK_V1']; },
    n => { n.reason = 'RUNTIME_SOURCE_REF_CHANGED'; }, n => { n.qualificationObserved = 'true'; }]) {
    const input = inspection(); change(input.nativeRuntime);
    const result = projectSovereignControlSystemStatusV1(input);
    assert.equal(result.nativeRuntime.qualificationObserved, false);
    assert.equal(result.nativeRuntime.available, false);
    assert.equal(Object.hasOwn(result.nativeRuntime, 'profiles'), false);
  }
});

test('source mismatch, unstable owner or absent usable observation cannot be promoted by caller booleans', () => {
  const changed = inspection(); changed.source.expectedMain = 'e'.repeat(40);
  changed.source.expectedMainMatches = true;
  const result = projectSovereignControlSystemStatusV1(changed);
  assert.equal(result.source.expectedMainMatches, false); assert.equal(result.observationCompleted, false);
  for (const owner of [{ available: false, stable: true }, { available: true, stable: true }]) {
    const input = inspection(); input.owner = owner; input.nativeRuntime = {};
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(projected.owner.stable, false); assert.equal(projected.guardian.available, false);
    assert.equal(projected.observationCompleted, false);
  }
  const asserted = inspection(); asserted.source.loadedSourceBytesProven = true;
  asserted.source.remoteMainProven = true; asserted.requestLedger.relayWorkspaceIdentityProven = true;
  const projected = projectSovereignControlSystemStatusV1(asserted);
  assert.equal(projected.source.loadedSourceBytesProven, false);
  assert.equal(projected.source.remoteMainProven, false);
  assert.equal(projected.requestLedger.relayWorkspaceIdentityProven, false);
});

test('ledger terminal phase and state are observations, with no remote-workspace or completion authority', () => {
  for (const ledger of [{ requested: true, recordObserved: true, phase: 'UNRECOGNIZED' },
    { requested: true, recordObserved: true, phase: 'TERMINAL', terminalState: 'SUCCESS' },
    { requested: false, recordObserved: true, phase: 'TERMINAL', terminalState: 'DONE' }]) {
    const input = inspection(); input.requestLedger = ledger;
    const result = projectSovereignControlSystemStatusV1(input);
    assert.equal(result.requestLedger.recordObserved, false);
    assert.equal(result.requestLedger.relayWorkspaceIdentityProven, false);
    assert.equal(Object.hasOwn(result.requestLedger, 'terminalState'), false);
  }
});

test('worst bounded semantic report either fits the ledger budget or returns a small explicit refusal', () => {
  const input = inspection(), code = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';
  input.blocker = code;
  for (const key of ['source', 'caller', 'owner', 'nativeRuntime', 'requestLedger']) input[key].reason = code;
  input.guardian.blocker = code;
  const result = projectSovereignControlSystemStatusV1(input);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
  if (!result.source) {
    assert.equal(result.blocker, 'SOVEREIGN_CONTROL_SYSTEM_STATUS_BOUND_EXCEEDED');
    assert.equal(result.observationCompleted, false);
  }
  assert.deepEqual(projectSovereignControlSystemStatusV1(result), result);
});
