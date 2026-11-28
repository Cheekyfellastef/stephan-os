import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SOVEREIGN_MAINTENANCE_OWNER_VERSION } from './sovereignMaintenanceAdmissionV1.mjs';
import { MAINTENANCE_OWNER_DIAGNOSTIC_CODES_V1 } from '../../scripts/sovereign-maintenance-owner-observation-v2.mjs';
import { createControlTowerRequestObservationV1, projectControlTowerRequestObservationV1,
  CONTROL_TOWER_REQUEST_OBSERVATION_MAX_BYTES_V1 }
  from './controlTowerRequestObservationV1.mjs';
import { fixture as controlTowerFixture } from './fixtures/controlTowerBuildV1.mjs';
import { SOVEREIGN_CONTROL_SYSTEM_INSPECTION_SCHEMA_V1, SOVEREIGN_CONTROL_SYSTEM_STATUS_SCHEMA_V1,
  SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1, projectSovereignControlSystemStatusV1,
  sovereignControlSystemDiagnosticCodeV1, sovereignControlSystemGovernorObservationCodeV1,
  sovereignControlSystemOwnerDiagnosticCodeV1, projectSovereignControlSystemGovernorPermissionV1,
  SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_PERMISSION_PREDICATES_V1,
  sovereignControlSystemQualificationDiagnosticCodeV1,
  SOVEREIGN_CONTROL_SYSTEM_QUALIFICATION_DIAGNOSTIC_CODES_V1 }
  from './sovereignControlSystemStatusV1.mjs';

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
  assert.equal(Object.hasOwn(projected, 'governorObservation'), false);
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

function governorInspection(governorHoldCode = 'FIXED_RUNTIME_GOVERNOR_OBSERVATION_STALE') {
  const input = inspection();
  input.nativeRuntime = { available: true, qualificationObserved: false,
    reason: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD', observedAtUtc: NOW, governorHoldCode };
  return input;
}

function ownerRefusal(diagnosticCode = 'OWNER_NATIVE_ACCESS_DENIED') {
  const input = governorInspection();
  input.blocker = 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN';
  input.owner = { available: false, stable: false, reason: input.blocker, diagnosticCode };
  input.protocol = { available: false, matches: false, reason: input.blocker };
  return input;
}

test('owner detail is an optional closed refusal leaf and preserves every existing authority field', () => {
  const baseline = ownerRefusal(); delete baseline.owner.diagnosticCode;
  for (const code of MAINTENANCE_OWNER_DIAGNOSTIC_CODES_V1) {
    assert.equal(sovereignControlSystemOwnerDiagnosticCodeV1(code), code);
    assert.equal(sovereignControlSystemDiagnosticCodeV1(code), 'SOVEREIGN_CONTROL_SYSTEM_OBSERVATION_UNPROVEN');
    const result = projectSovereignControlSystemStatusV1(ownerRefusal(code));
    const { diagnosticCode, ...owner } = result.owner;
    assert.equal(diagnosticCode, code);
    assert.deepEqual({ ...result, owner }, projectSovereignControlSystemStatusV1(baseline));
    assert.equal(result.owner.available, false); assert.equal(result.owner.stable, false);
    assert.equal(result.guardian.available, false); assert.equal(result.protocol.available, false);
    assert.equal(result.nativeRuntime.qualificationObserved, false);
    assert.equal(Object.isFrozen(result.owner), true);
    assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(result))), result);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
  }
});

test('owner detail never survives a different owner state or unbound source', () => {
  for (const change of [row => { row.owner.available = true; }, row => { row.owner.stable = true; },
    row => { row.owner.reason = ''; }, row => { row.owner.reason = 'SOVEREIGN_CONTROL_SYSTEM_OWNER_CHANGED'; },
    row => { delete row.owner.available; }, row => { delete row.owner.stable; },
    row => { row.source.available = false; }, row => { row.source.stable = false; },
    row => { row.source.expectedMain = 'e'.repeat(40); },
    row => { row.source.reason = 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED'; }]) {
    const input = ownerRefusal(); change(input);
    const result = projectSovereignControlSystemStatusV1(input);
    assert.equal(Object.hasOwn(result.owner, 'diagnosticCode'), false);
  }
  const success = inspection(); success.owner.diagnosticCode = 'OWNER_NATIVE_ACCESS_DENIED';
  assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(success).owner, 'diagnosticCode'), false);
});

test('public owner diagnostics discard private strings, coercions and accessor inputs', () => {
  let invoked = 0;
  for (const value of [null, 1, true, [], {}, 'PRIVATE_TOKEN', 'OWNER_PRIVATE_TOKEN',
    'C:\\PRIVATE\\owner', 'PRIVATE_'.repeat(1000), { toString() { invoked++; return 'PRIVATE_TOKEN'; } }]) {
    const result = projectSovereignControlSystemStatusV1(ownerRefusal(value));
    assert.equal(result.owner.diagnosticCode, 'OWNER_OBSERVER_INVALID_RECEIPT');
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(result), result);
  }
  const input = ownerRefusal();
  Object.defineProperty(input.owner, 'diagnosticCode', { get() { invoked++; return 'PRIVATE_TOKEN'; } });
  assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(input).owner, 'diagnosticCode'), false);
  assert.equal(invoked, 0);
});

test('owner refusal detail survives actual Control Tower receipt readback with its original proof hash', () => {
  const status = projectSovereignControlSystemStatusV1(ownerRefusal()), nowMs = Date.parse(NOW);
  const bytes = JSON.stringify(status), observationProofHash = createHash('sha256').update(bytes).digest('hex');
  const request = { ...controlTowerFixture().request, operation: 'OBSERVE_CONTROL_SYSTEM',
    artifactId: 200, artifactSha256: 'c'.repeat(64),
    createdAtUtc: new Date(nowMs - 1000).toISOString(), expiresAtUtc: new Date(nowMs + 599000).toISOString() };
  let receipt = createControlTowerRequestObservationV1(request, { commandDigest: 'd'.repeat(64),
    acceptedAtUtc: NOW, observedAtUtc: NOW, state: 'OBSERVATION_COMPLETED', blocker: '',
    controlSystemStatus: status, observationProofHash, nowMs });
  assert(receipt);
  for (let count = 0; count < 3; count++) {
    receipt = projectControlTowerRequestObservationV1(JSON.parse(JSON.stringify(receipt)), { nowMs });
    assert(receipt);
    assert.equal(receipt.controlSystemStatus.owner.diagnosticCode, 'OWNER_NATIVE_ACCESS_DENIED');
    assert.equal(JSON.stringify(receipt.controlSystemStatus), bytes);
    assert.equal(receipt.observationProofHash, observationProofHash);
    assert.equal(receipt.wakeProofHash, ''); assert.equal(receipt.nativePickupProven, false);
    assert.ok(Buffer.byteLength(JSON.stringify(receipt)) <= CONTROL_TOWER_REQUEST_OBSERVATION_MAX_BYTES_V1);
  }
});

test('governor subcode is a bounded optional denial leaf and not a generic public reason', () => {
  const input = governorInspection(), baseline = governorInspection();
  delete baseline.nativeRuntime.governorHoldCode;
  const projected = projectSovereignControlSystemStatusV1(input);
  assert.equal(projected.nativeRuntime.governorHoldCode, input.nativeRuntime.governorHoldCode);
  const { governorHoldCode, ...nativeRuntime } = projected.nativeRuntime;
  assert.deepEqual({ ...projected, nativeRuntime }, projectSovereignControlSystemStatusV1(baseline));
  assert.equal(sovereignControlSystemDiagnosticCodeV1(governorHoldCode), 'SOVEREIGN_CONTROL_SYSTEM_OBSERVATION_UNPROVEN');
  assert.equal(Object.isFrozen(projected.nativeRuntime), true);
  assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(projected))), projected);
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
});

test('historical governor refusals without the optional leaf retain exact bytes and hash', () => {
  const input = governorInspection(); delete input.nativeRuntime.governorHoldCode;
  const projected = projectSovereignControlSystemStatusV1(input), bytes = JSON.stringify(projected);
  assert.equal(Object.hasOwn(projected.nativeRuntime, 'governorHoldCode'), false);
  assert.equal(Object.hasOwn(projected, 'governorObservation'), false);
  assert.equal(Buffer.byteLength(bytes), 1192);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    'ae4cb8d1162ad2ccf44feb5411a1bc152997dc923beca9ca2e4c60a32e6b3480');
  assert.equal(JSON.stringify(projectSovereignControlSystemStatusV1(JSON.parse(bytes))), bytes);
});

test('actual Control Tower receipt reprojection preserves governor diagnostic bytes and observation hash', () => {
  const status = projectSovereignControlSystemStatusV1(governorInspection()), nowMs = Date.parse(NOW);
  const bytes = JSON.stringify(status), observationProofHash = createHash('sha256').update(bytes).digest('hex');
  const request = { ...controlTowerFixture().request, operation: 'OBSERVE_CONTROL_SYSTEM',
    artifactId: 200, artifactSha256: 'c'.repeat(64),
    createdAtUtc: new Date(nowMs - 1000).toISOString(), expiresAtUtc: new Date(nowMs + 599000).toISOString() };
  let receipt = createControlTowerRequestObservationV1(request, { commandDigest: 'd'.repeat(64),
    acceptedAtUtc: NOW, observedAtUtc: NOW, state: 'OBSERVATION_COMPLETED', blocker: '',
    controlSystemStatus: status, observationProofHash, nowMs });
  assert(receipt);
  for (let count = 0; count < 3; count++) {
    receipt = projectControlTowerRequestObservationV1(JSON.parse(JSON.stringify(receipt)), { nowMs });
    assert(receipt);
    assert.equal(receipt.controlSystemStatus.nativeRuntime.governorHoldCode, 'FIXED_RUNTIME_GOVERNOR_OBSERVATION_STALE');
    assert.equal(JSON.stringify(receipt.controlSystemStatus), bytes);
    assert.equal(createHash('sha256').update(JSON.stringify(receipt.controlSystemStatus)).digest('hex'), receipt.observationProofHash);
    assert.equal(receipt.observationProofHash, observationProofHash);
    assert.equal(receipt.wakeProofHash, ''); assert.equal(receipt.nativePickupProven, false);
  }
});

test('explicit invalid governor diagnostics cannot publish private strings or evaluate values', () => {
  let invoked = 0;
  for (const value of [null, 1, true, [], {}, 'PRIVATE_TOKEN', 'FIXED_RUNTIME_GOVERNOR_PRIVATE_TOKEN',
    'C:\\PRIVATE\\governor', 'PRIVATE_'.repeat(1000), { toString() { invoked++; return 'PRIVATE_TOKEN'; } }]) {
    const projected = projectSovereignControlSystemStatusV1(governorInspection(value));
    assert.equal(projected.nativeRuntime.governorHoldCode, 'FIXED_RUNTIME_GOVERNOR_EVIDENCE_UNAVAILABLE');
    assert.equal(projected.nativeRuntime.qualificationObserved, false);
    assert.equal(JSON.stringify(projected).includes('PRIVATE'), false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(projected), projected);
  }
  const input = governorInspection();
  Object.defineProperty(input.nativeRuntime, 'governorHoldCode', { get() { invoked++; return 'PRIVATE_TOKEN'; } });
  const refused = projectSovereignControlSystemStatusV1(input);
  assert.equal(refused.nativeRuntime.available, false);
  assert.equal(Object.hasOwn(refused.nativeRuntime, 'governorHoldCode'), false);
  assert.equal(invoked, 0);
});

test('governor subcode cannot outlive a valid denial and stable exact source', () => {
  for (const change of [row => { row.nativeRuntime.available = false; },
    row => { row.nativeRuntime.qualificationObserved = true; },
    row => { row.nativeRuntime.reason = 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING'; },
    row => { row.nativeRuntime.reason = 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED'; },
    row => { delete row.nativeRuntime.observedAtUtc; }, row => { row.source.available = false; },
    row => { row.source.stable = false; }, row => { row.source.expectedMain = 'e'.repeat(40); },
    row => { row.source.reason = 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED'; }]) {
    const input = governorInspection(); change(input);
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(Object.hasOwn(projected.nativeRuntime, 'governorHoldCode'), false);
    assert.equal(projected.nativeRuntime.qualificationObserved, false);
  }
  const success = inspection(); success.nativeRuntime.governorHoldCode = 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED';
  assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(success).nativeRuntime, 'governorHoldCode'), false);
});

test('governor diagnostic retains the original 2048-byte bound and explicit overflow refusal', () => {
  const input = governorInspection('FIXED_RUNTIME_GOVERNOR_EVIDENCE_UNAVAILABLE');
  input.protocol = protocol(['HTTP_OK', 'HEALTH_OK', 'SERVICE', 'OBSERVATION_SCOPE', 'NO_ADMISSION', 'OWNER_VERSION']);
  const code = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';
  input.blocker = code;
  for (const key of ['caller', 'owner', 'requestLedger']) input[key].reason = code;
  input.guardian.blocker = code;
  const projected = projectSovereignControlSystemStatusV1(input);
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
  if (!projected.source) assert.equal(projected.blocker, 'SOVEREIGN_CONTROL_SYSTEM_STATUS_BOUND_EXCEEDED');
  else assert.equal(projected.nativeRuntime.governorHoldCode, input.nativeRuntime.governorHoldCode);
  assert.deepEqual(projectSovereignControlSystemStatusV1(projected), projected);
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

function governorObservation(extra = {}) {
  return { available: true, observedAtUtc: NOW, signalActive: false, overrideMode: 'AUTO',
    preparePending: false, readOnly: true, diagnosticOnly: true, executionAuthority: false, ...extra };
}

test('fresh governor facts are diagnostic only and cannot change persisted qualification or original evidence', () => {
  const input = governorInspection();
  input.blocker = 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN';
  input.owner = { available: false, stable: false, reason: input.blocker };
  input.guardian = { available: false, blocker: input.blocker };
  const baseline = projectSovereignControlSystemStatusV1(input);
  for (const overrideMode of ['AUTO', 'FORCE_ON', 'FORCE_OFF']) {
    for (const signalActive of [false, true]) for (const preparePending of [false, true]) {
      input.governorObservation = governorObservation({ overrideMode, signalActive, preparePending });
      const projected = projectSovereignControlSystemStatusV1(input);
      const { governorObservation: observed, ...original } = projected;
      assert.deepEqual(original, baseline);
      assert.deepEqual(observed, input.governorObservation);
      assert.equal(observed.executionAuthority, false);
      assert.equal(observed.diagnosticOnly, true);
      assert.equal(Object.isFrozen(observed), true);
      assert.equal(projected.owner.available, false);
      assert.equal(projected.nativeRuntime.qualificationObserved, false);
      assert.equal(projected.nativeRuntime.reason, 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD');
      assert.equal(projected.nativeRuntime.governorHoldCode, 'FIXED_RUNTIME_GOVERNOR_OBSERVATION_STALE');
      assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(projected))), projected);
    }
  }
});

test('governor diagnostics alone cannot complete the control-system observation or release custody', () => {
  const input = inspection();
  input.owner = { available: false, stable: false, reason: 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN' };
  input.guardian = { available: false, blocker: 'MAINTENANCE_CUSTODY_HELD' };
  input.nativeRuntime = { available: false, qualificationObserved: false,
    reason: 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN' };
  input.governorObservation = governorObservation();
  const projected = projectSovereignControlSystemStatusV1(input);
  assert.equal(projected.governorObservation.available, true);
  assert.equal(projected.observationCompleted, false);
  assert.equal(projected.owner.available, false);
  assert.equal(projected.guardian.blocker, 'MAINTENANCE_CUSTODY_HELD');
  assert.equal(projected.nativeRuntime.qualificationObserved, false);
  for (const flag of ['dispatchAllowed', 'custodyReleased', 'executionCustodyReleased', 'nativePickupProven'])
    assert.equal(JSON.stringify(projected).includes(flag), false);
});

test('governor observation timestamps normalize but remain bound to the original inspection start', () => {
  for (const [timestamp, expected] of [
    ['2026-10-31T13:00:00Z', NOW],
    ['2026-10-31T13:00:00.1234567Z', '2026-10-31T13:00:00.123Z'],
    ['2026-10-31T13:00:30.000Z', '2026-10-31T13:00:30.000Z'],
  ]) {
    const input = governorInspection();
    input.governorObservation = governorObservation({ observedAtUtc: timestamp });
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(projected.governorObservation.available, true);
    assert.equal(projected.governorObservation.observedAtUtc, expected);
    assert.equal(projected.observedAtUtc, NOW);
    assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(projected))), projected);
  }
  for (const timestamp of [null, 1, '', '2026-02-31T13:00:00.000Z', '2026-10-31T12:59:59.999Z',
    '2026-10-31T13:00:30.001Z', '2026-10-31T13:00:00+00:00', '2026-10-31T13:00:00.00000001Z']) {
    const input = governorInspection();
    input.governorObservation = governorObservation({ observedAtUtc: timestamp });
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(projected.governorObservation.available, false, String(timestamp));
    assert.equal(projected.governorObservation.reason, 'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_INVALID');
    assert.equal(Object.hasOwn(projected.governorObservation, 'observedAtUtc'), false);
  }
});

test('governor observation rejects unknown fields, wrong types and authority flags without evaluating accessors', () => {
  let invoked = 0;
  const getter = governorObservation();
  Object.defineProperty(getter, 'signalActive', { get() { invoked++; return false; } });
  const symbol = governorObservation(); symbol[Symbol('PRIVATE')] = true;
  const inherited = Object.create(governorObservation());
  const missing = governorObservation(); delete missing.preparePending;
  for (const leaf of [null, [], {}, getter, symbol, inherited, missing,
    governorObservation({ signalActive: 'false' }), governorObservation({ preparePending: 0 }),
    governorObservation({ available: 'true' }), governorObservation({ overrideMode: 'PRIVATE_MODE' }),
    governorObservation({ overrideMode: { toString() { invoked++; return 'AUTO'; } } }),
    governorObservation({ readOnly: false }), governorObservation({ diagnosticOnly: false }),
    governorObservation({ executionAuthority: true }), governorObservation({ reason: '' }),
    governorObservation({ rawPath: 'C:\\PRIVATE\\governor' }), governorObservation({ sourceHead: HEAD }),
    governorObservation({ custodyReleased: true }), governorObservation({ dispatchAllowed: true }),
  ]) {
    const input = governorInspection(); input.governorObservation = leaf;
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(projected.governorObservation.available, false);
    assert.equal(projected.governorObservation.reason, 'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_INVALID');
    assert.equal(projected.governorObservation.executionAuthority, false);
    assert.equal(Object.hasOwn(projected.governorObservation, 'signalActive'), false);
    assert.equal(JSON.stringify(projected).includes('PRIVATE'), false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(projected))), projected);
  }
  assert.equal(invoked, 0);
});

test('governor observation failure vocabulary stays closed and separate from admission blockers', () => {
  const codes = [
    'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_SOURCE_UNPROVEN',
    'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_TIMEOUT',
    'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_INVALID',
    'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_UNPROVEN',
    'SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN',
    'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED',
  ];
  for (const reason of [...codes, 'PRIVATE_TOKEN', 'PRIVATE_'.repeat(1000), null, {}, [], 1, true,
    'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED', 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD']) {
    const input = governorInspection();
    input.governorObservation = { available: false, reason,
      readOnly: true, diagnosticOnly: true, executionAuthority: false };
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(projected.governorObservation.available, false);
    assert.equal(projected.governorObservation.reason, codes.includes(reason)
      ? reason : 'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_UNPROVEN');
    assert.equal(projected.nativeRuntime.governorHoldCode, 'FIXED_RUNTIME_GOVERNOR_OBSERVATION_STALE');
    assert.equal(Object.hasOwn(projected.governorObservation, 'signalActive'), false);
    assert.equal(JSON.stringify(projected).includes('PRIVATE'), false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(projected), projected);
  }
  for (const code of codes.slice(0, 4)) {
    assert.equal(sovereignControlSystemGovernorObservationCodeV1(code), code);
    assert.equal(sovereignControlSystemDiagnosticCodeV1(code), 'SOVEREIGN_CONTROL_SYSTEM_OBSERVATION_UNPROVEN');
  }
  const input = governorInspection();
  input.governorObservation = { available: false, reason: codes[1], signalActive: false,
    readOnly: true, diagnosticOnly: true, executionAuthority: false };
  assert.equal(projectSovereignControlSystemStatusV1(input).governorObservation.reason, codes[2]);
});

test('governor facts cannot survive source failure and do not inherit owner proof', () => {
  for (const alter of [row => { row.source.available = false; }, row => { row.source.stable = false; },
    row => { row.source.expectedMain = 'e'.repeat(40); },
    row => { row.source.reason = 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED'; }]) {
    const input = governorInspection(); input.governorObservation = governorObservation(); alter(input);
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(projected.governorObservation.available, false);
    assert.equal(Object.hasOwn(projected.governorObservation, 'signalActive'), false);
    assert.equal(projected.governorObservation.reason, input.source.reason
      || 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN');
    assert.deepEqual(projectSovereignControlSystemStatusV1(projected), projected);
  }
});

test('owner and governor diagnostics survive actual receipt readback with the original hash, time and byte bounds', () => {
  const input = governorInspection('FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED');
  input.owner = { available: false, stable: false, reason: 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN',
    diagnosticCode: 'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN' };
  input.guardian = { available: false, blocker: 'MAINTENANCE_CUSTODY_HELD' };
  input.governorObservation = governorObservation({ observedAtUtc: '2026-10-31T13:00:01.1234567Z' });
  input.nativeRuntime.governorPermission = { observedAtUtc: '2026-10-31T12:59:29.000Z',
    failed: [...SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_PERMISSION_PREDICATES_V1] };
  const status = projectSovereignControlSystemStatusV1(input), nowMs = Date.parse(NOW) + 2000;
  const bytes = JSON.stringify(status), observationProofHash = createHash('sha256').update(bytes).digest('hex');
  assert.ok(Buffer.byteLength(bytes) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
  const request = { ...controlTowerFixture().request, operation: 'OBSERVE_CONTROL_SYSTEM',
    artifactId: 200, artifactSha256: 'c'.repeat(64),
    createdAtUtc: new Date(nowMs - 3000).toISOString(), expiresAtUtc: new Date(nowMs + 597000).toISOString() };
  let receipt = createControlTowerRequestObservationV1(request, { commandDigest: 'd'.repeat(64),
    acceptedAtUtc: NOW, observedAtUtc: new Date(nowMs).toISOString(), state: 'OBSERVATION_COMPLETED', blocker: '',
    controlSystemStatus: status, observationProofHash, nowMs });
  assert(receipt);
  for (let count = 0; count < 3; count++) {
    receipt = projectControlTowerRequestObservationV1(JSON.parse(JSON.stringify(receipt)), { nowMs: nowMs + 86400000 });
    assert(receipt);
    assert.equal(JSON.stringify(receipt.controlSystemStatus), bytes);
    assert.equal(receipt.observationProofHash, observationProofHash);
    assert.equal(createHash('sha256').update(JSON.stringify(receipt.controlSystemStatus)).digest('hex'), observationProofHash);
    assert.equal(receipt.controlSystemStatus.governorObservation.observedAtUtc, '2026-10-31T13:00:01.123Z');
    assert.equal(receipt.controlSystemStatus.owner.diagnosticCode, 'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN');
    assert.equal(receipt.controlSystemStatus.owner.available, false);
    assert.equal(receipt.controlSystemStatus.nativeRuntime.qualificationObserved, false);
    assert.equal(receipt.controlSystemStatus.nativeRuntime.governorHoldCode, 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED');
    assert.deepEqual(receipt.controlSystemStatus.nativeRuntime.governorPermission, input.nativeRuntime.governorPermission);
    assert.equal(receipt.wakeProofHash, ''); assert.equal(receipt.nativePickupProven, false);
    assert.ok(Buffer.byteLength(JSON.stringify(receipt)) <= CONTROL_TOWER_REQUEST_OBSERVATION_MAX_BYTES_V1);
  }
});

test('governor extension keeps the 2048-byte bound with explicit overflow, never silently dropping old evidence', () => {
  const input = governorInspection();
  input.protocol = protocol(['HTTP_OK', 'HEALTH_OK', 'SERVICE', 'OBSERVATION_SCOPE', 'NO_ADMISSION', 'OWNER_VERSION']);
  input.governorObservation = governorObservation({ overrideMode: 'FORCE_OFF' });
  const code = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';
  input.blocker = code;
  for (const key of ['caller', 'owner', 'requestLedger']) input[key].reason = code;
  input.guardian.blocker = code;
  const result = projectSovereignControlSystemStatusV1(input);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
  assert.equal(result.blocker, 'SOVEREIGN_CONTROL_SYSTEM_STATUS_BOUND_EXCEEDED');
  assert.equal(result.observationCompleted, false);
  assert.deepEqual(projectSovereignControlSystemStatusV1(result), result);
});

test('closed owner failure detail covers the native vocabulary without changing custody or admission', () => {
  const input = governorInspection();
  input.owner = { available: false, stable: false, reason: 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN' };
  input.guardian = { available: false, blocker: 'MAINTENANCE_CUSTODY_HELD' };
  input.governorObservation = governorObservation();
  const baseline = projectSovereignControlSystemStatusV1(input);
  assert.equal(Object.hasOwn(baseline.owner, 'diagnosticCode'), false);
  assert.ok(MAINTENANCE_OWNER_DIAGNOSTIC_CODES_V1.includes('OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN'));
  for (const code of MAINTENANCE_OWNER_DIAGNOSTIC_CODES_V1) {
    input.owner.diagnosticCode = code;
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(sovereignControlSystemOwnerDiagnosticCodeV1(code), code);
    assert.equal(sovereignControlSystemDiagnosticCodeV1(code), 'SOVEREIGN_CONTROL_SYSTEM_OBSERVATION_UNPROVEN');
    assert.equal(projected.owner.diagnosticCode, code);
    const { diagnosticCode, ...owner } = projected.owner;
    assert.deepEqual({ ...projected, owner }, baseline);
    assert.equal(projected.owner.available, false); assert.equal(projected.owner.stable, false);
    assert.equal(projected.owner.reason, 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN');
    assert.equal(projected.guardian.blocker, 'MAINTENANCE_CUSTODY_HELD');
    assert.equal(projected.nativeRuntime.qualificationObserved, false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(projected))), projected);
    assert.ok(Buffer.byteLength(JSON.stringify(projected)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
  }
});

test('owner diagnostics exclude private content, accessors, positive identity and mismatched source', () => {
  let invoked = 0;
  for (const diagnosticCode of ['PRIVATE_TOKEN', 'C:\\PRIVATE\\node.exe', 'OWNER_PRIVATE_TOKEN', 'x'.repeat(10000),
    undefined, null, [], {}, 0, true, { toString() { invoked++; return 'OWNER_NATIVE_ACCESS_DENIED'; } }]) {
    const input = governorInspection();
    input.owner = { available: false, stable: false, reason: 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN', diagnosticCode };
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(projected.owner.diagnosticCode, 'OWNER_OBSERVER_INVALID_RECEIPT');
    assert.equal(JSON.stringify(projected).includes('PRIVATE'), false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(projected), projected);
  }
  for (const alter of [row => { row.owner.available = true; }, row => { row.owner.stable = true; },
    row => { row.owner.available = 'false'; }, row => { row.owner.stable = 'false'; },
    row => { row.owner.reason = 'SOVEREIGN_CONTROL_SYSTEM_OWNER_CHANGED'; },
    row => { row.source.available = false; }, row => { row.source.stable = false; },
    row => { row.source.expectedMain = 'e'.repeat(40); },
    row => { row.source.reason = 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED'; }]) {
    const input = governorInspection();
    input.owner = { available: false, stable: false, reason: 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN',
      diagnosticCode: 'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN' };
    alter(input);
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(Object.hasOwn(projected.owner, 'diagnosticCode'), false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(projected), projected);
  }
  const positive = inspection(); positive.owner.diagnosticCode = 'OWNER_NATIVE_ACCESS_DENIED';
  assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(positive).owner, 'diagnosticCode'), false);
  const accessor = governorInspection();
  accessor.owner = { available: false, stable: false, reason: 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN' };
  Object.defineProperty(accessor.owner, 'diagnosticCode', { get() { invoked++; return 'PRIVATE_TOKEN'; } });
  assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(accessor).owner, 'diagnosticCode'), false);
  assert.equal(invoked, 0);
});

test('permission causes retain only original bounded time and a canonical nonempty failed-predicate set', () => {
  const predicates = SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_PERMISSION_PREDICATES_V1;
  assert.deepEqual(predicates, ['PHASE', 'OVERRIDE', 'LOAD', 'COOLDOWN', 'ACTIVE', 'FLAT_GAME', 'AIR_LINK',
    'REAL_AIR_LINK', 'VIRTUAL_AIR_LINK', 'PREPARE_LEASE', 'LOCAL_MODEL', 'HEAVY_MODEL']);
  for (const failed of [predicates, ['PHASE'], ['HEAVY_MODEL'], ['OVERRIDE', 'COOLDOWN', 'REAL_AIR_LINK']]) {
    const input = governorInspection('FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED');
    const baseline = projectSovereignControlSystemStatusV1(input);
    input.nativeRuntime.governorPermission = { observedAtUtc: '2026-10-31T12:59:29.1234567Z', failed };
    const projected = projectSovereignControlSystemStatusV1(input);
    const { governorPermission, ...nativeRuntime } = projected.nativeRuntime;
    assert.deepEqual(governorPermission, { observedAtUtc: '2026-10-31T12:59:29.123Z', failed });
    assert.deepEqual({ ...projected, nativeRuntime }, baseline);
    assert.equal(Object.isFrozen(governorPermission), true); assert.equal(Object.isFrozen(governorPermission.failed), true);
    assert.equal(projected.nativeRuntime.qualificationObserved, false);
    assert.equal(projected.nativeRuntime.governorHoldCode, 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED');
    assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(projected))), projected);
  }
  for (const age of [0, 30000, 31000, 45000]) {
    const permission = { observedAtUtc: new Date(Date.parse(NOW) - age).toISOString(), failed: ['ACTIVE'] };
    assert.deepEqual(projectSovereignControlSystemGovernorPermissionV1(permission, NOW), permission);
  }
  for (const age of [-1, 45001]) {
    const permission = { observedAtUtc: new Date(Date.parse(NOW) - age).toISOString(), failed: ['ACTIVE'] };
    assert.equal(projectSovereignControlSystemGovernorPermissionV1(permission, NOW), null);
  }
});

test('permission causes reject private, malformed, accessor, inherited and noncanonical data without evaluation', () => {
  let invoked = 0;
  const permission = { observedAtUtc: NOW, failed: ['ACTIVE'] };
  const accessor = { observedAtUtc: NOW };
  Object.defineProperty(accessor, 'failed', { get() { invoked++; return ['PRIVATE_TOKEN']; } });
  const arrayAccessor = [];
  Object.defineProperty(arrayAccessor, '0', { get() { invoked++; return 'ACTIVE'; } });
  const extraArray = ['ACTIVE']; extraArray.extra = 'PRIVATE_TOKEN';
  const symbolArray = ['ACTIVE']; symbolArray[Symbol('PRIVATE_TOKEN')] = true;
  const inheritedArray = ['ACTIVE']; Object.setPrototypeOf(inheritedArray, Object.create(Array.prototype));
  const invalid = [null, [], Object.create(permission), accessor,
    { ...permission, [Symbol('PRIVATE_TOKEN')]: true }, { ...permission, executionAuthority: true },
    ...[null, 'ACTIVE', [], ['PRIVATE_TOKEN'], ['ACTIVE', 'ACTIVE'], ['HEAVY_MODEL', 'PHASE'],
      ['ACTIVE', { toString() { invoked++; return 'HEAVY_MODEL'; } }], Array(1), arrayAccessor,
      extraArray, symbolArray, inheritedArray].map(failed => ({ ...permission, failed })),
    ...['PRIVATE_TOKEN', '2026-02-31T13:00:00Z', '2026-10-31T13:00:00+00:00',
      '2026-10-31T13:00:00.001Z', '2026-10-31T12:59:14.999Z'].map(observedAtUtc => ({ ...permission, observedAtUtc })),
  ];
  const input = governorInspection('FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED');
  const baseline = projectSovereignControlSystemStatusV1(input);
  for (const value of invalid) {
    input.nativeRuntime.governorPermission = value;
    assert.equal(projectSovereignControlSystemGovernorPermissionV1(value, NOW), null);
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.deepEqual(projected, baseline);
    assert.equal(JSON.stringify(projected).includes('PRIVATE'), false);
  }
  assert.equal(projectSovereignControlSystemGovernorPermissionV1(permission, 'PRIVATE_TIME'), null);
  assert.equal(invoked, 0);
});

test('permission causes require the original permission-denied hold and stable matching source', () => {
  for (const alter of [row => { row.nativeRuntime.available = false; },
    row => { row.nativeRuntime.qualificationObserved = true; },
    row => { row.nativeRuntime.reason = 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING'; },
    row => { row.nativeRuntime.governorHoldCode = 'FIXED_RUNTIME_GOVERNOR_OBSERVATION_STALE'; },
    row => { delete row.nativeRuntime.governorHoldCode; }, row => { delete row.nativeRuntime.observedAtUtc; },
    row => { row.nativeRuntime.sourceHead = 'e'.repeat(40); }, row => { row.nativeRuntime.sourceHead = 'PRIVATE_HEAD'; },
    row => { row.source.available = false; }, row => { row.source.stable = false; },
    row => { row.source.expectedMain = 'e'.repeat(40); },
    row => { row.source.reason = 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED'; }]) {
    const input = governorInspection('FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED');
    input.nativeRuntime.governorPermission = { observedAtUtc: NOW, failed: ['ACTIVE'] };
    alter(input);
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(Object.hasOwn(projected.nativeRuntime, 'governorPermission'), false);
    assert.equal(projected.nativeRuntime.qualificationObserved, false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(projected), projected);
  }
  const positive = inspection();
  positive.nativeRuntime.governorHoldCode = 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED';
  positive.nativeRuntime.governorPermission = { observedAtUtc: NOW, failed: ['ACTIVE'] };
  assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(positive).nativeRuntime, 'governorPermission'), false);
});

test('permission detail preserves the 2048-byte bound through explicit overflow refusal', () => {
  const input = governorInspection('FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED');
  input.nativeRuntime.governorPermission = { observedAtUtc: NOW,
    failed: [...SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_PERMISSION_PREDICATES_V1] };
  input.protocol = protocol(['HTTP_OK', 'HEALTH_OK', 'SERVICE', 'OBSERVATION_SCOPE', 'NO_ADMISSION', 'OWNER_VERSION']);
  input.governorObservation = governorObservation({ overrideMode: 'FORCE_OFF' });
  const code = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';
  input.blocker = code;
  for (const key of ['caller', 'owner', 'requestLedger']) input[key].reason = code;
  input.guardian.blocker = code;
  const projected = projectSovereignControlSystemStatusV1(input);
  assert.equal(projected.blocker, 'SOVEREIGN_CONTROL_SYSTEM_STATUS_BOUND_EXCEEDED');
  assert.equal(projected.observationCompleted, false);
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
  assert.deepEqual(projectSovereignControlSystemStatusV1(projected), projected);
});

function qualificationInspection(qualificationDiagnosticCode = 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN') {
  const input = inspection();
  input.nativeRuntime = { available: true, qualificationObserved: false,
    reason: 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN', observedAtUtc: NOW, qualificationDiagnosticCode };
  return input;
}

test('qualification diagnostic catalogue covers the source-declared qualification call graph without widening generic reasons', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const section = (source, start, end) => {
    const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `qualification source boundary changed: ${start}`);
    return source.slice(first, last);
  };
  const literals = (source, pattern, prefix = '') => [...source.matchAll(pattern)].map(match => prefix + match[1]);
  const errors = source => literals(source, /new Error\(['"]([A-Z][A-Z0-9_]+)['"]\)/g);
  const parent = read('../../scripts/sovereign-fixed-runtime-parent-v1.mjs');
  // Deliberately stop before execution/consumption routes. A newly imported
  // producer requires reviewing this finite call graph rather than silently
  // admitting every uppercase token found elsewhere in the repository.
  assert.deepEqual(literals(parent, /from\s+['"]([^'"]+)['"]/g).filter(path => !path.startsWith('node:')).sort(), [
    '../shared/agents/battleBridgeExecutionBoundaryV1.mjs',
    '../shared/agents/battleBridgeGitProbeContextV1.mjs',
    '../shared/agents/stephanosNativeCapacityGamingAdmissionV1.mjs',
    './sovereign-fixed-runtime-installer-candidate-v1.mjs',
    './sovereign-maintenance-custody-store-v1.mjs',
  ].sort());
  const qualification = section(parent, '// Private adapter', '// Pure validation cannot mint provenance.');
  const qualificationEntry = section(parent, 'export function inspectFixedRuntimeQualificationV1()',
    '// Pure validation cannot mint provenance.');
  const inspectionFailure = section(parent, 'function fixedRuntimeInspectionFailureReason(',
    'export function inspectFixedRuntimeInstallationPresenceV1');
  // Match emitted return/fallback literals only, not OS errno comparison inputs.
  const inspectionFailureLabels = literals(inspectionFailure,
    /(?:return\s+|const\s+unknown\s*=\s*)['"]([A-Z][A-Z0-9_]+)['"]/g);
  assert.ok(qualificationEntry.includes('fixedRuntimeInspectionFailureReason(observed)'));
  assert.ok(inspectionFailureLabels.length >= 3);
  assert.equal(inspectionFailureLabels.some(code => ['ETIMEDOUT', 'ENOENT'].includes(code)), false);
  const inventory = section(parent, 'const INSPECTION_DENIAL_REASONS = new Set([', ']);');
  const probe = read('./battleBridgeGitProbeContextV1.mjs');
  const recovery = section(read('../../scripts/sovereign-maintenance-custody-store-v1.mjs'),
    'export function readMaintenanceRecoverySourceV1()', 'export function validMaintenanceBootWitnessV1');
  const closure = section(read('../../scripts/sovereign-fixed-runtime-installer-candidate-v1.mjs'),
    'export function fixedRuntimeGitClosureSha256V1(', 'export function buildFixedRuntimeInstallerCandidateV1');
  const fixedConfig = section(read('./battleBridgeExecutionBoundaryV1.mjs'),
    'function fixedEnvironmentConfig(', 'const SAFE_WINDOWS_ENVIRONMENT_KEYS');
  for (const call of ['readMaintenanceRecoverySourceV1()', 'captureFixedRuntimeSourceProofV1(executionHead)',
    'createBattleBridgeGitProbeContextV1(SOURCE)', 'context.assert()', 'context.close()',
    'resolveBattleBridgeGitExecution(', 'fixedRuntimeGitClosureSha256V1('])
    assert.ok(qualification.includes(call), `qualification call graph changed: ${call}`);
  const sourceProof = [...new Set(literals(qualification, /sourceDenied\(['"]([A-Z][A-Z0-9_]+)['"]\)/g,
    'FIXED_RUNTIME_SOURCE_PROOF_'))];
  const nativeProof = literals(inventory, /['"](RUNTIME_SOURCE_PROOF_[A-Z0-9_]+)['"]/g);
  const context = [...new Set(literals(probe, /['"](CANONICAL_GIT_PROBE_[A-Z][A-Z0-9_]+)['"]/g))];
  assert.equal(sourceProof.length, 23); assert.equal(nativeProof.length, 18); assert.equal(context.length, 11);
  const declared = new Set([...errors(qualification), ...sourceProof, ...inspectionFailureLabels,
    ...literals(qualification, /denied\(['"]([A-Z][A-Z0-9_]+)['"]/g),
    ...literals(inventory, /['"]([A-Z][A-Z0-9_]+)['"]/g), ...context,
    ...errors(recovery), ...errors(closure), ...errors(fixedConfig)]);
  const missingGeneric = [...declared].filter(code => sovereignControlSystemDiagnosticCodeV1(code) !== code).sort();
  const catalogue = SOVEREIGN_CONTROL_SYSTEM_QUALIFICATION_DIAGNOSTIC_CODES_V1;
  assert.equal(Object.isFrozen(catalogue), true);
  assert.equal(catalogue.length, 60); assert.equal(new Set(catalogue).size, catalogue.length);
  assert.deepEqual([...catalogue].sort(), missingGeneric);
  // These two defensive producers remain catalogued even though this caller
  // supplies fixed configuration and already-validated closure members.
  assert.deepEqual(errors(fixedConfig), ['BATTLE_BRIDGE_FIXED_GIT_CONFIG_INVALID']);
  assert.deepEqual([...new Set(errors(closure))], ['FIXED_RUNTIME_GIT_CLOSURE_UNPROVEN']);
  for (const code of catalogue) {
    assert.equal(typeof code, 'string'); assert.match(code, /^[A-Z][A-Z0-9_]{1,95}$/);
    assert.equal(sovereignControlSystemQualificationDiagnosticCodeV1(code), code);
    assert.equal(sovereignControlSystemDiagnosticCodeV1(code), 'SOVEREIGN_CONTROL_SYSTEM_OBSERVATION_UNPROVEN');
  }
});

test('every qualification diagnostic preserves the original denial and exposes no execution or raw producer payload', () => {
  const original = qualificationInspection(); delete original.nativeRuntime.qualificationDiagnosticCode;
  const baseline = projectSovereignControlSystemStatusV1(original);
  for (const code of SOVEREIGN_CONTROL_SYSTEM_QUALIFICATION_DIAGNOSTIC_CODES_V1) {
    const input = qualificationInspection(code);
    Object.assign(input.nativeRuntime, { sourceCode: 'PRIVATE_SOURCE_CODE', sourceStep: 'PRIVATE_SOURCE_STEP',
      sourceConfiguration: { path: 'C:\\PRIVATE\\config' }, rawError: 'PRIVATE_ERROR', pid: 17281,
      dispatchAllowed: true, executionCustodyReleased: true, profiles: ['SOURCE_TASK_V1'],
      governorHoldCode: 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED',
      governorPermission: { observedAtUtc: NOW, failed: ['ACTIVE'] } });
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(projected.nativeRuntime.qualificationDiagnosticCode, code);
    const { qualificationDiagnosticCode, ...nativeRuntime } = projected.nativeRuntime;
    assert.deepEqual({ ...projected, nativeRuntime }, baseline, code);
    assert.equal(projected.nativeRuntime.reason, 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
    assert.equal(projected.nativeRuntime.qualificationObserved, false);
    assert.equal(projected.observationOnly, true); assert.equal(Object.isFrozen(projected.nativeRuntime), true);
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|17281|dispatchAllowed|executionCustodyReleased|sourceCode|sourceStep|sourceConfiguration|governorPermission|governorHoldCode/);
    assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(projected))), projected);
  }
});

test('qualification diagnostics omit unknown, private, coerced, inherited and accessor values without evaluation', () => {
  let invoked = 0;
  const original = qualificationInspection(); delete original.nativeRuntime.qualificationDiagnosticCode;
  const baseline = projectSovereignControlSystemStatusV1(original);
  const valid = 'FIXED_RUNTIME_SOURCE_PROOF_TREE_BOUND';
  for (const value of [undefined, null, false, true, 0, 1n, Symbol('PRIVATE'), [], {}, new String(valid),
    '', 'PRIVATE_TOKEN', 'C:\\PRIVATE\\runtime', 'FIXED_RUNTIME_SOURCE_PROOF_PRIVATE_TOKEN',
    'FIXED_RUNTIME_QUALIFICATION_UNPROVEN', 'RUNTIME_NORMAL_OPERATOR_REQUIRED', valid + '\n',
    valid.toLowerCase(), 'A'.repeat(10000), { toString() { invoked++; return valid; } }]) {
    assert.equal(sovereignControlSystemQualificationDiagnosticCodeV1(value), '');
    const input = qualificationInspection(); input.nativeRuntime.qualificationDiagnosticCode = value;
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.deepEqual(projected, baseline);
    assert.equal(Object.hasOwn(projected.nativeRuntime, 'qualificationDiagnosticCode'), false);
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE/);
  }
  for (const change of [row => {
    Object.defineProperty(row, 'qualificationDiagnosticCode', { get() { invoked++; return valid; } });
  }, row => { Object.setPrototypeOf(row, { qualificationDiagnosticCode: valid }); },
  row => { row[Symbol('PRIVATE')] = valid; }]) {
    const input = qualificationInspection(); delete input.nativeRuntime.qualificationDiagnosticCode;
    change(input.nativeRuntime);
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(Object.hasOwn(projected.nativeRuntime, 'qualificationDiagnosticCode'), false);
    assert.equal(projected.nativeRuntime.qualificationObserved, false);
  }
  assert.equal(invoked, 0);
});

test('qualification diagnostic requires an actual generic denial, original valid time and stable matching source', () => {
  const changes = [
    row => { row.nativeRuntime.available = false; }, row => { row.nativeRuntime.available = 'true'; },
    row => { row.nativeRuntime.qualificationObserved = true; }, row => { row.nativeRuntime.qualificationObserved = 'false'; },
    row => { delete row.nativeRuntime.qualificationObserved; },
    row => { row.nativeRuntime.reason = 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD'; },
    row => { row.nativeRuntime.reason = 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING'; },
    row => { row.nativeRuntime.reason = 'FIXED_RUNTIME_SOURCE_PROOF_TREE_BOUND'; },
    row => { row.nativeRuntime.reason = ''; }, row => { delete row.nativeRuntime.observedAtUtc; },
    ...['PRIVATE_TIME', '2026-02-31T13:00:00Z', '2026-10-31T13:00:00+00:00', 0, null]
      .map(time => row => { row.nativeRuntime.observedAtUtc = time; }),
    row => { row.source.available = false; }, row => { row.source.stable = false; },
    row => { row.source.stable = 'true'; }, row => { row.source.reason = 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED'; },
    row => { row.source.expectedMain = 'e'.repeat(40); }, row => { row.source.sourceHead = 'e'.repeat(40); },
    ...['PRIVATE_HEAD', '', undefined, null].map(head => row => { row.source.expectedMain = head; }),
    ...['e'.repeat(40), 'PRIVATE_HEAD', '', undefined, null].map(head => row => { row.nativeRuntime.sourceHead = head; }),
  ];
  for (const change of changes) {
    const input = qualificationInspection(); change(input);
    const projected = projectSovereignControlSystemStatusV1(input);
    assert.equal(Object.hasOwn(projected.nativeRuntime, 'qualificationDiagnosticCode'), false);
    assert.equal(projected.nativeRuntime.qualificationObserved, false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(projected))), projected);
  }
  const positive = inspection(); positive.nativeRuntime.qualificationDiagnosticCode = 'FIXED_RUNTIME_GIT_CLOSURE_CHANGED';
  const success = projectSovereignControlSystemStatusV1(positive);
  assert.equal(success.nativeRuntime.qualificationObserved, true);
  assert.equal(Object.hasOwn(success.nativeRuntime, 'qualificationDiagnosticCode'), false);
  const absentExpected = qualificationInspection(); delete absentExpected.source.expectedMain;
  const absentProjection = projectSovereignControlSystemStatusV1(absentExpected);
  assert.equal(absentProjection.nativeRuntime.qualificationDiagnosticCode, absentExpected.nativeRuntime.qualificationDiagnosticCode);
  assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(absentProjection))), absentProjection);
  const matching = qualificationInspection(); matching.nativeRuntime.sourceHead = HEAD;
  matching.nativeRuntime.observedAtUtc = '2026-10-31T13:00:00.1234567Z';
  const retained = projectSovereignControlSystemStatusV1(matching);
  assert.equal(retained.nativeRuntime.qualificationDiagnosticCode, matching.nativeRuntime.qualificationDiagnosticCode);
  assert.equal(retained.nativeRuntime.observedAtUtc, '2026-10-31T13:00:00.123Z');
  assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(retained))), retained);
});

test('historical generic qualification denials without the optional leaf retain exact bytes and hash', () => {
  const input = qualificationInspection(); delete input.nativeRuntime.qualificationDiagnosticCode;
  const projected = projectSovereignControlSystemStatusV1(input), bytes = JSON.stringify(projected);
  // Captured from the unchanged 93c63f projection, before qualification detail.
  assert.equal(Buffer.byteLength(bytes), 1192);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '15e2049c5cf35e51819e2f0298be5fc692b610ff265dbc0b76aa88cccf27f229');
  assert.equal(Object.hasOwn(projected.nativeRuntime, 'qualificationDiagnosticCode'), false);
  assert.equal(JSON.stringify(projectSovereignControlSystemStatusV1(JSON.parse(bytes))), bytes);
});

test('qualification diagnostics survive real Control Tower receipt persistence with original hashes and existing owner and signal leaves', () => {
  const nowMs = Date.parse(NOW);
  const request = { ...controlTowerFixture().request, operation: 'OBSERVE_CONTROL_SYSTEM',
    artifactId: 200, artifactSha256: 'c'.repeat(64),
    createdAtUtc: new Date(nowMs - 1000).toISOString(), expiresAtUtc: new Date(nowMs + 599000).toISOString() };
  for (const code of SOVEREIGN_CONTROL_SYSTEM_QUALIFICATION_DIAGNOSTIC_CODES_V1) {
    const input = qualificationInspection(code);
    input.owner = { available: false, stable: false, reason: 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN',
      diagnosticCode: 'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN' };
    input.guardian = { available: false, blocker: 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN' };
    input.protocol = { available: false, matches: false, reason: 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN' };
    input.governorObservation = governorObservation({ overrideMode: 'FORCE_OFF' });
    input.blocker = 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN';
    const status = projectSovereignControlSystemStatusV1(input), bytes = JSON.stringify(status);
    assert.equal(status.nativeRuntime.qualificationDiagnosticCode, code);
    assert.ok(Buffer.byteLength(bytes) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1, code);
    const observationProofHash = createHash('sha256').update(bytes).digest('hex');
    let receipt = createControlTowerRequestObservationV1(request, { commandDigest: 'd'.repeat(64),
      acceptedAtUtc: NOW, observedAtUtc: NOW, state: 'OBSERVATION_COMPLETED', blocker: '',
      controlSystemStatus: status, observationProofHash, nowMs });
    assert(receipt, code);
    for (let round = 0; round < 3; round++) {
      receipt = projectControlTowerRequestObservationV1(JSON.parse(JSON.stringify(receipt)), { nowMs: nowMs + 86400000 });
      assert(receipt, code);
      assert.equal(JSON.stringify(receipt.controlSystemStatus), bytes);
      assert.equal(receipt.observationProofHash, observationProofHash);
      assert.equal(createHash('sha256').update(JSON.stringify(receipt.controlSystemStatus)).digest('hex'), observationProofHash);
      assert.equal(receipt.controlSystemStatus.nativeRuntime.qualificationObserved, false);
      assert.equal(receipt.controlSystemStatus.owner.diagnosticCode, input.owner.diagnosticCode);
      assert.equal(receipt.controlSystemStatus.governorObservation.executionAuthority, false);
      assert.equal(receipt.controlSystemStatus.nativeRuntime.observedAtUtc, NOW);
      assert.equal(receipt.wakeProofHash, ''); assert.equal(receipt.nativePickupProven, false);
      assert.equal(receipt.buildStartedProven, false); assert.equal(receipt.goalCompletionProven, false);
      assert.ok(Buffer.byteLength(JSON.stringify(receipt)) <= CONTROL_TOWER_REQUEST_OBSERVATION_MAX_BYTES_V1, code);
    }
  }
});

test('maximum qualification detail and existing leaves retain the 2048-byte bound through explicit overflow refusal', () => {
  const longest = [...SOVEREIGN_CONTROL_SYSTEM_QUALIFICATION_DIAGNOSTIC_CODES_V1].sort((a, b) => b.length - a.length)[0];
  const input = qualificationInspection(longest);
  input.protocol = protocol(['HTTP_OK', 'HEALTH_OK', 'SERVICE', 'OBSERVATION_SCOPE', 'NO_ADMISSION', 'OWNER_VERSION']);
  input.governorObservation = governorObservation({ overrideMode: 'FORCE_OFF' });
  const code = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';
  input.blocker = code;
  for (const key of ['caller', 'owner', 'requestLedger']) input[key].reason = code;
  input.guardian.blocker = code;
  const projected = projectSovereignControlSystemStatusV1(input);
  assert.equal(projected.blocker, 'SOVEREIGN_CONTROL_SYSTEM_STATUS_BOUND_EXCEEDED');
  assert.equal(projected.observationCompleted, false);
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
  assert.deepEqual(projectSovereignControlSystemStatusV1(projected), projected);
});
