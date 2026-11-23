import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { inspectSovereignControlSystemV1, parseSovereignControlSystemInspectionArgumentsV1,
  readSovereignGovernorDiagnosticV1 }
  from './sovereign-commander-native-inspect.mjs';
import { projectSovereignControlSystemStatusV1, SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1,
  SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_PERMISSION_PREDICATES_V1,
  SOVEREIGN_CONTROL_SYSTEM_QUALIFICATION_DIAGNOSTIC_CODES_V1 }
  from '../shared/agents/sovereignControlSystemStatusV1.mjs';
import { callSovereignMaintenanceOwnerV1 } from '../shared/agents/sovereignCommanderRemoteMailboxV1.mjs';
import { SOVEREIGN_MAINTENANCE_OWNER_VERSION } from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';
import { MAINTENANCE_OWNER_DIAGNOSTIC_CODES_V1, readMaintenanceNativeOwnerV2 }
  from './sovereign-maintenance-owner-observation-v2.mjs';

const HEAD = 'a'.repeat(40), NOW = '2026-10-31T13:00:00.000Z';
const REQUEST = 'control-tower-build-41192328171-1';
const SID = 'S-1-5-21-111111-222222-333333-1001';
const nativeOwner = (extra = {}) => ({ schemaVersion: 'stephanos.maintenance-owner-native-observation.v2',
  pid: 13291, createdAtUtc: '2026-10-31T09:00:00.000Z', observedAtUtc: NOW,
  commandSha256: 'b'.repeat(64), imageSha256: 'c'.repeat(64), ...extra });
const freshGovernor = (extra = {}) => ({ schemaVersion: 'stephanos.gaming-resource-admission-observation.v1',
  observedAtUtc: NOW, signalActive: false, overrideMode: 'AUTO', preparePending: false, readOnly: true, ...extra });
const ownerHealth = (extra = {}) => ({ ok: true, service: 'stephanos-sovereign-commander',
  token: 'PRIVATE_HEALTH_TOKEN', continuousRepairGuardian: {
    enabled: true, running: false, scheduled: false, maintenanceInFlight: false,
    timeoutCustodyHeld: false, lastBlocker: 'FIXED_RUNTIME_PROFILE_NOT_QUALIFIED',
    lastSourceHead: HEAD, persistentCustody: { held: false, blocker: '', token: 'PRIVATE_CUSTODY_TOKEN' },
    ...extra,
  } });
function fixture(overrides = {}) {
  const calls = [];
  return { calls, options: { expectedMain: HEAD, controlTowerRequestId: REQUEST, testOnly: true,
    dependencies: { platform: 'win32', now: () => new Date(NOW),
      readSourceHead: () => { calls.push('source'); return HEAD; },
      readGovernor: head => { calls.push('governor'); assert.equal(head, HEAD); return freshGovernor(); },
      readCaller: () => { calls.push('caller'); return { schemaVersion: 'stephanos.sovereign-diagnostic-caller.v1',
        sid: SID, administratorEnabled: false, observedAtUtc: NOW }; },
      readOwner: () => { calls.push('owner'); return nativeOwner(); },
      fetchFn: async (url, options) => {
        if (url === PROTOCOL_URL) { calls.push('protocol'); return Response.json(protocolHealth()); }
        calls.push('health'); assert.equal(url, 'http://127.0.0.1:18791/health');
        assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json(ownerHealth());
      },
      inspectRuntime: () => { calls.push('native'); return { ok: false,
        reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING', executionCustodyReleased: true,
        dispatchAllowed: false, stderr: 'PRIVATE_NATIVE_ERROR' }; },
      readLedger: id => { calls.push('ledger'); assert.equal(id, REQUEST);
        return { record: null, workspaceSelection: 'DEFAULT' }; },
      ...overrides,
    } } };
}

const PROTOCOL_URL = 'http://127.0.0.1:18791/health?view=protocol';
const protocolHealth = (extra = {}) => ({ ok: true, service: 'stephanos-sovereign-commander',
  observationScope: 'TRANSPORT_PROTOCOL_ONLY', maintenanceAdmissionProven: false,
  maintenanceOwnerAdmissionVersion: SOVEREIGN_MAINTENANCE_OWNER_VERSION, ...extra });
function protocolFixture(response = () => Response.json(protocolHealth()), overrides = {}) {
  const value = fixture(overrides), fetchGeneral = value.options.dependencies.fetchFn;
  value.options.dependencies.fetchFn = async (url, options) => {
    if (url !== PROTOCOL_URL) return fetchGeneral(url, options);
    value.calls.push('protocol');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { accept: 'application/json' });
    assert.ok(options.signal instanceof AbortSignal);
    return response(options.signal);
  };
  return value;
}

test('fixed protocol view reports each actual delegation predicate without credentials or authority', async () => {
  for (const [predicate, extra, status] of [
    ['HTTP_OK', {}, 503], ['HEALTH_OK', { ok: false }, 200],
    ['SERVICE', { service: 'PRIVATE_SERVICE' }, 200],
    ['OBSERVATION_SCOPE', { observationScope: 'PRIVATE_SCOPE' }, 200],
    ['NO_ADMISSION', { maintenanceAdmissionProven: true }, 200],
    ['OWNER_VERSION', { maintenanceOwnerAdmissionVersion: 'PRIVATE_VERSION' }, 200],
  ]) {
    const response = () => Response.json(protocolHealth(extra), { status });
    const f = protocolFixture(response), report = await inspectSovereignControlSystemV1(f.options);
    assert.equal(report.protocol?.available, true, predicate);
    assert.equal(report.protocol.matches, false);
    assert.deepEqual(report.protocol.failedPredicates, [predicate]);
    assert.equal(report.protocol.expectedVersion, SOVEREIGN_MAINTENANCE_OWNER_VERSION);
    assert.equal(report.protocol.observedVersion, predicate === 'OWNER_VERSION' ? 'OTHER' : SOVEREIGN_MAINTENANCE_OWNER_VERSION);
    const published = projectSovereignControlSystemStatusV1(report);
    assert.deepEqual(published.protocol, report.protocol);
    assert.equal(published.nativeRuntime.qualificationObserved, false);
    assert.equal(published.source.loadedSourceBytesProven, false);
    assert.equal(published.requestLedger.relayWorkspaceIdentityProven, false);
    assert.equal(JSON.stringify(published).includes('PRIVATE_'), false);
    let credentials = 0, requests = 0;
    const refused = await callSovereignMaintenanceOwnerV1({ actionId: 'repair-goal-builder-flow',
      arguments: { actionId: 'repair-goal-builder-flow' } }, {
      readFileFn: async () => { credentials++; assert.fail('protocol refusal must not read credentials'); },
      fetchFn: async (url, options) => { requests++; assert.equal(url, PROTOCOL_URL);
        assert.equal(options.method, 'GET'); return response(); },
    });
    assert.equal(refused.blocker, 'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED');
    assert.equal(credentials, 0); assert.equal(requests, 1);
    assert.equal(f.calls.filter(call => call === 'native').length, 1, 'existing native observation is not repeated');
  }
});

test('matching protocol is an owner-bracketed observation and survives bounded public reprojection', async () => {
  const f = protocolFixture(), report = await inspectSovereignControlSystemV1(f.options);
  assert.equal(report.protocol?.matches, true); assert.deepEqual(report.protocol.failedPredicates, []);
  assert.equal(report.protocol.observedVersion, SOVEREIGN_MAINTENANCE_OWNER_VERSION);
  assert.equal(report.protocol.expectedVersion, SOVEREIGN_MAINTENANCE_OWNER_VERSION);
  assert.equal(report.protocol.reason, ''); assert.equal(report.protocol.observedAtUtc, NOW);
  assert.deepEqual(f.calls, ['source', 'governor', 'caller', 'owner', 'health', 'protocol', 'owner', 'native', 'ledger', 'source']);
  const published = projectSovereignControlSystemStatusV1(report);
  assert.equal(published.protocol.matches, true);
  assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(published))), published);
  assert.ok(Buffer.byteLength(JSON.stringify(published)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
});

test('protocol version observations are closed and never publish unknown response strings', async () => {
  for (const [value, expected] of [[undefined, 'MISSING'], [null, 'INVALID'], [123, 'INVALID'], ['x'.repeat(129), 'INVALID'],
    ['C:\\PRIVATE_TOKEN', 'OTHER'], ['2026-10-27-private-token-v1', 'OTHER']]) {
    const report = await inspectSovereignControlSystemV1(protocolFixture(() => Response.json(
      protocolHealth({ maintenanceOwnerAdmissionVersion: value }))).options);
    assert.equal(report.protocol?.observedVersion, expected);
    assert.deepEqual(report.protocol.failedPredicates, ['OWNER_VERSION']);
    assert.equal(JSON.stringify(report).includes('PRIVATE_TOKEN'), false);
    assert.equal(JSON.stringify(report).includes('private-token'), false);
  }
});

test('owner or source movement invalidates protocol observation without inferring custody release', async () => {
  let owners = 0, source = 0;
  const changedOwner = protocolFixture(undefined, { readOwner: () => nativeOwner({ pid: ++owners }) });
  const first = await inspectSovereignControlSystemV1(changedOwner.options);
  assert.equal(first.protocol?.available, false); assert.equal(first.protocol.matches, false);
  assert.equal(first.protocol.reason, 'SOVEREIGN_CONTROL_SYSTEM_OWNER_CHANGED');
  const changedSource = protocolFixture(undefined, { readSourceHead: () => ++source === 1 ? HEAD : 'e'.repeat(40) });
  const second = await inspectSovereignControlSystemV1(changedSource.options);
  assert.equal(second.protocol?.available, false); assert.equal(second.protocol.matches, false);
  assert.equal(second.protocol.reason, 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED');
  for (const report of [first, second]) {
    assert.equal(Object.hasOwn(report.protocol, 'failedPredicates'), false);
    assert.equal(Object.hasOwn(report.protocol, 'observedVersion'), false);
    assert.equal(JSON.stringify(report).includes('executionCustodyReleased'), false);
  }
});

test('invalid or oversized protocol bodies remain closed failures and do not erase general health', async () => {
  for (const [response, reason] of [
    [() => Promise.reject(Error('PRIVATE_NETWORK_ERROR')), 'SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_UNPROVEN'],
    [() => new Response('PRIVATE_NOT_JSON'), 'SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_UNPROVEN'],
    [() => new Response(new Uint8Array([0xff])), 'SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_UNPROVEN'],
    [() => new Response('x'.repeat(65537)), 'SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_BOUND_EXCEEDED'],
  ]) {
    const report = await inspectSovereignControlSystemV1(protocolFixture(response).options);
    assert.equal(report.protocol?.available, false); assert.equal(report.protocol.reason, reason);
    assert.equal(report.guardian.available, true); assert.equal(report.observationCompleted, true);
    assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
  }
});

test('protocol deadline bounds a stalled response body even when a reader ignores abort', { timeout: 10000 }, async () => {
  let cancelled = false, released = false, signal;
  const f = protocolFixture(value => { signal = value; return { ok: true, body: { getReader: () => ({
    read: () => new Promise(() => {}), cancel: () => { cancelled = true; return new Promise(() => {}); },
    releaseLock: () => { released = true; },
  }) } }; });
  const started = performance.now(), report = await inspectSovereignControlSystemV1(f.options);
  assert.equal(report.protocol?.reason, 'SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_TIMEOUT');
  assert.equal(report.protocol.available, false); assert.equal(signal.aborted, true);
  assert.equal(cancelled, true); assert.equal(released, true);
  assert.ok(performance.now() - started < 9000);
  assert.equal(report.guardian.available, true);
});

test('completed source-bound observation preserves refusal without granting repair or claiming loaded bytes', async () => {
  const { options, calls } = fixture(), report = await inspectSovereignControlSystemV1(options);
  assert.deepEqual(calls, ['source', 'governor', 'caller', 'owner', 'health', 'protocol', 'owner', 'native', 'ledger', 'source']);
  assert.equal(report.observationCompleted, true);
  assert.equal(report.owner.stable, true);
  assert.equal(report.caller.sid, SID);
  assert.equal(report.caller.observationAppliesTo, 'DIAGNOSTIC_CALLER_ONLY');
  assert.equal(report.nativeRuntime.qualificationObserved, false);
  assert.equal(report.nativeRuntime.reason, 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING');
  assert.equal(report.source.loadedSourceBytesProven, false);
  assert.equal(report.source.remoteMainProven, false);
  assert.equal(report.requestLedger.recordObserved, false);
  assert.equal(report.requestLedger.relayWorkspaceIdentityProven, false);
  assert.equal(report.requestLedger.reason, 'SOVEREIGN_CONTROL_SYSTEM_REQUEST_NOT_OBSERVED');
  const serialized = JSON.stringify(report);
  for (const forbidden of ['PRIVATE_', 'dispatchAllowed', 'executionCustodyReleased', 'nativeRecordId'])
    assert.equal(serialized.includes(forbidden), false);
  const published = projectSovereignControlSystemStatusV1(report);
  assert.equal(published.observationCompleted, true);
  assert.ok(Buffer.byteLength(JSON.stringify(published)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
  assert.equal(JSON.stringify(published).includes(SID), false);
});

test('fresh governor diagnostics survive an unproven owner without refreshing native admission', async () => {
  const f = fixture({
    readOwner: () => { throw Object.assign(Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN'),
      { diagnosticCode: 'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN' }); },
    readGovernor: () => freshGovernor({ signalActive: true, overrideMode: 'FORCE_ON', preparePending: true }),
    inspectRuntime: () => ({ ok: false, reason: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD',
      governorHoldCode: 'FIXED_RUNTIME_GOVERNOR_OBSERVATION_STALE' }),
  });
  const report = await inspectSovereignControlSystemV1(f.options);
  assert.equal(report.owner.available, false); assert.equal(report.owner.stable, false);
  assert.equal(report.owner.reason, 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN');
  assert.equal(report.owner.diagnosticCode, 'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN');
  assert.deepEqual(report.governorObservation, { available: true, observedAtUtc: NOW,
    signalActive: true, overrideMode: 'FORCE_ON', preparePending: true,
    readOnly: true, diagnosticOnly: true, executionAuthority: false });
  const published = projectSovereignControlSystemStatusV1(report);
  assert.deepEqual(published.governorObservation, report.governorObservation);
  assert.equal(published.owner.diagnosticCode, 'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN');
  assert.equal(published.guardian.available, false);
  assert.equal(published.nativeRuntime.qualificationObserved, false);
  assert.equal(published.nativeRuntime.governorHoldCode, 'FIXED_RUNTIME_GOVERNOR_OBSERVATION_STALE');
  assert.equal(published.source.loadedSourceBytesProven, false);
  assert.equal(published.source.remoteMainProven, false);
});

test('owner refusal details survive either failed bracket without claiming identity or admission', async () => {
  for (const failures of [['OWNER_NATIVE_ACCESS_DENIED', null], [null, 'OWNER_OBSERVER_TIMEOUT'],
    ['OWNER_CIM_LISTENER_QUERY_FAILED', 'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN']]) {
    let reads = 0;
    const report = await inspectSovereignControlSystemV1(fixture({ readOwner: () => {
      const diagnosticCode = failures[reads++];
      if (diagnosticCode) throw Object.assign(Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN'), { diagnosticCode });
      return nativeOwner();
    } }).options);
    assert.equal(reads, 2);
    assert.equal(report.owner.diagnosticCode, failures.find(Boolean));
    const published = projectSovereignControlSystemStatusV1(report);
    assert.equal(published.owner.diagnosticCode, failures.find(Boolean));
    assert.equal(published.owner.reason, 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN');
    assert.equal(published.owner.available, false); assert.equal(published.owner.stable, false);
    assert.equal(published.guardian.available, false); assert.equal(published.protocol.available, false);
    assert.equal(published.nativeRuntime.qualificationObserved, false);
    const bytes = JSON.stringify(published);
    assert.ok(Buffer.byteLength(bytes) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
    for (const privateField of ['pid', 'commandSha256', 'imageSha256', SID, 'PRIVATE'])
      assert.equal(bytes.includes(privateField), false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(bytes)), published);
  }
});

test('owner error diagnostics reject private data and ignore accessors or inherited fields', async () => {
  let invoked = 0;
  for (const diagnosticCode of ['PRIVATE_TOKEN', 'C:\\PRIVATE\\owner.exe', 'OWNER_PRIVATE_TOKEN',
    'x'.repeat(10000), null, [], {}, { toString() { invoked++; return 'OWNER_NATIVE_ACCESS_DENIED'; } }]) {
    const report = await inspectSovereignControlSystemV1(fixture({ readOwner: () => {
      throw Object.assign(Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN'), { diagnosticCode });
    } }).options);
    const published = projectSovereignControlSystemStatusV1(report);
    assert.equal(published.owner.diagnosticCode, 'OWNER_OBSERVER_INVALID_RECEIPT');
    assert.equal(JSON.stringify(published).includes('PRIVATE'), false);
  }
  const accessor = Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN');
  Object.defineProperty(accessor, 'diagnosticCode', { get() { invoked++; return 'PRIVATE_TOKEN'; } });
  const inherited = Object.create(Object.assign(Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN'),
    { diagnosticCode: 'OWNER_NATIVE_ACCESS_DENIED' }));
  const unrelated = Object.assign(Error('SOVEREIGN_CONTROL_SYSTEM_OWNER_UNPROVEN'),
    { diagnosticCode: 'OWNER_NATIVE_ACCESS_DENIED' });
  for (const [error, expected] of [[accessor, undefined], [inherited, undefined],
    [unrelated, undefined]]) {
    const report = await inspectSovereignControlSystemV1(fixture({ readOwner: () => { throw error; } }).options);
    assert.equal(report.owner.diagnosticCode, expected);
    assert.equal(projectSovereignControlSystemStatusV1(report).owner.diagnosticCode, expected);
  }
  assert.equal(invoked, 0);
});

test('owner failure detail is withdrawn when its exact source moves or never matches', async () => {
  let sourceReads = 0;
  const f = fixture({
    readSourceHead: () => ++sourceReads === 1 ? HEAD : 'f'.repeat(40),
    readOwner: () => { throw Object.assign(Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN'),
      { diagnosticCode: 'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN' }); },
  });
  const report = await inspectSovereignControlSystemV1(f.options);
  assert.equal(report.source.reason, 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED');
  assert.equal(report.observationCompleted, false);
  assert.equal(Object.hasOwn(report.owner, 'diagnosticCode'), false);
  const published = projectSovereignControlSystemStatusV1(report);
  assert.equal(Object.hasOwn(published.owner, 'diagnosticCode'), false);
  assert.deepEqual(projectSovereignControlSystemStatusV1(published), published);
  let ownerReads = 0;
  f.options.dependencies.readSourceHead = () => 'f'.repeat(40);
  f.options.dependencies.readOwner = () => { ownerReads++; return nativeOwner(); };
  const mismatched = await inspectSovereignControlSystemV1(f.options);
  assert.equal(mismatched.blocker, 'SOVEREIGN_CONTROL_SYSTEM_EXPECTED_MAIN_MISMATCH');
  assert.equal(ownerReads, 0);
  assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(mismatched).owner, 'diagnosticCode'), false);
});

test('native owner refusal detail survives either observation bracket without granting admission', async () => {
  for (const diagnosticCode of MAINTENANCE_OWNER_DIAGNOSTIC_CODES_V1) {
    for (const failedAt of [1, 2]) {
      let reads = 0;
      const report = await inspectSovereignControlSystemV1(fixture({ readOwner: () => {
        if (++reads !== failedAt) return nativeOwner();
        return readMaintenanceNativeOwnerV2({ platform: 'win32', spawnSyncFn: () => ({ status: 2,
          stdout: JSON.stringify({ schemaVersion: 'stephanos.maintenance-owner-native-diagnostic.v1',
            ok: false, observationOnly: true, diagnosticCode }) }) });
      } }).options);
      assert.equal(reads, 2);
      assert.equal(report.owner.diagnosticCode, diagnosticCode);
      assert.equal(report.owner.reason, 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN');
      const published = projectSovereignControlSystemStatusV1(report);
      assert.equal(published.owner.diagnosticCode, diagnosticCode);
      for (const result of [report, published]) {
        assert.equal(result.blocker, 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN');
        assert.equal(result.owner.available, false); assert.equal(result.owner.stable, false);
        assert.equal(result.guardian.available, false); assert.equal(result.protocol.available, false);
        assert.equal(result.nativeRuntime.qualificationObserved, false);
        assert.equal(result.source.loadedSourceBytesProven, false);
      }
      assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(published))), published);
      assert.ok(Buffer.byteLength(JSON.stringify(published)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
    }
  }
});

test('owner detail follows the original first failure and disappears on source movement', async () => {
  const failure = code => Object.assign(Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN'), { diagnosticCode: code });
  for (const first of [failure('OWNER_NATIVE_ACCESS_DENIED'), Error('PRIVATE_FIRST_OWNER_FAILURE')]) {
    let reads = 0;
    const report = await inspectSovereignControlSystemV1(fixture({ readOwner: () => {
      throw ++reads === 1 ? first : failure('OWNER_COMMAND_LINE_UNAVAILABLE');
    } }).options);
    assert.equal(report.owner.diagnosticCode, first.diagnosticCode);
    assert.equal(report.owner.reason, first.diagnosticCode
      ? 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN' : 'SOVEREIGN_CONTROL_SYSTEM_OWNER_UNPROVEN');
    assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
  }
  let heads = 0;
  const moved = await inspectSovereignControlSystemV1(fixture({
    readSourceHead: () => ++heads === 1 ? HEAD : 'e'.repeat(40),
    readOwner: () => { throw failure('OWNER_NATIVE_ACCESS_DENIED'); },
  }).options);
  assert.equal(moved.source.stable, false); assert.equal(moved.observationCompleted, false);
  assert.equal(Object.hasOwn(moved.owner, 'diagnosticCode'), false);
  assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(moved).owner, 'diagnosticCode'), false);
});

test('owner diagnostics never evaluate values or copy private and unrelated errors', async () => {
  let invoked = 0;
  for (const value of [null, 1, true, [], {}, 'PRIVATE_TOKEN', 'OWNER_PRIVATE_TOKEN',
    'C:\\PRIVATE\\owner', 'PRIVATE_'.repeat(1000), { toString() { invoked++; return 'PRIVATE_TOKEN'; } }]) {
    const report = await inspectSovereignControlSystemV1(fixture({ readOwner: () => {
      throw Object.assign(Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN'), { diagnosticCode: value });
    } }).options);
    assert.equal(report.owner.diagnosticCode, 'OWNER_OBSERVER_INVALID_RECEIPT');
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  }
  const accessor = Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN');
  Object.defineProperty(accessor, 'diagnosticCode', { get() { invoked++; return 'PRIVATE_TOKEN'; } });
  const inherited = Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN');
  Object.setPrototypeOf(inherited, Object.assign(Object.create(Error.prototype), { diagnosticCode: 'OWNER_NATIVE_ACCESS_DENIED' }));
  for (const error of [accessor, inherited, Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN'),
    Object.assign(Error('PRIVATE_OTHER_FAILURE'), { diagnosticCode: 'OWNER_NATIVE_ACCESS_DENIED' })]) {
    const report = await inspectSovereignControlSystemV1(fixture({ readOwner: () => { throw error; } }).options);
    assert.equal(Object.hasOwn(report.owner, 'diagnosticCode'), false);
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  }
  assert.equal(invoked, 0);
});

test('governor diagnostics reject invalid data, extra authority and out-of-capture timestamps', async () => {
  let getterCalls = 0;
  const accessor = freshGovernor();
  Object.defineProperty(accessor, 'signalActive', { get() { getterCalls++; return false; } });
  for (const value of [null, [], Object.create(freshGovernor()), accessor,
    freshGovernor({ signalActive: 0 }), freshGovernor({ preparePending: 'false' }),
    freshGovernor({ readOnly: false }), freshGovernor({ overrideMode: 'PRIVATE_MODE' }),
    freshGovernor({ schemaVersion: 'PRIVATE_SCHEMA' }), freshGovernor({ executionAuthority: true }),
    freshGovernor({ observedAtUtc: '2026-10-31T12:59:59.999Z' }),
    freshGovernor({ observedAtUtc: '2026-10-31T13:00:00.001Z' })]) {
    const report = await inspectSovereignControlSystemV1(fixture({ readGovernor: () => value }).options);
    assert.deepEqual(report.governorObservation, { available: false,
      reason: 'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_INVALID',
      readOnly: true, diagnosticOnly: true, executionAuthority: false });
    assert.equal(report.observationCompleted, true);
    assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
  }
  assert.equal(getterCalls, 0);
});

test('governor child time is bounded by actual capture and original inspection, never replay time', async () => {
  let now = Date.parse(NOW);
  const f = fixture({ now: () => new Date(now), readGovernor: () => {
    now += 1200; return freshGovernor({ observedAtUtc: new Date(now - 300).toISOString() });
  } });
  const report = await inspectSovereignControlSystemV1(f.options);
  assert.equal(report.governorObservation.available, true);
  assert.equal(report.governorObservation.observedAtUtc, '2026-10-31T13:00:00.900Z');
  const published = projectSovereignControlSystemStatusV1(report);
  assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(published))), published);
  now = Date.parse(NOW);
  f.options.dependencies.readGovernor = () => {
    now += 30001; return freshGovernor({ observedAtUtc: new Date(now).toISOString() });
  };
  assert.equal((await inspectSovereignControlSystemV1(f.options)).governorObservation.available, false);
});

test('governor failures stay bounded and source changes invalidate the fresh observation', async () => {
  for (const reason of ['SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_SOURCE_UNPROVEN',
    'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_TIMEOUT', 'PRIVATE_PATH_OR_TOKEN']) {
    const report = await inspectSovereignControlSystemV1(fixture({ readGovernor: () => { throw Error(reason); } }).options);
    assert.equal(report.governorObservation.available, false);
    assert.equal(report.governorObservation.reason, reason.startsWith('PRIVATE_')
      ? 'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_UNPROVEN' : reason);
    assert.equal(Object.hasOwn(report.governorObservation, 'signalActive'), false);
    assert.equal(Object.hasOwn(report.governorObservation, 'overrideMode'), false);
    assert.equal(report.nativeRuntime.qualificationObserved, false);
  }
  let count = 0;
  const changed = await inspectSovereignControlSystemV1(fixture({
    readSourceHead: () => ++count === 1 ? HEAD : 'f'.repeat(40),
  }).options);
  assert.equal(changed.governorObservation.available, false);
  assert.equal(changed.governorObservation.reason, 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED');
  assert.equal(changed.observationCompleted, false);
});

function governorChildFixture({ source = Buffer.from("[CmdletBinding()]\nparam([string]$Action='Watch')\n"),
  mode = '100644', duplicate = false, missing = false } = {}) {
  const objects = new Map(), calls = [];
  const object = (type, bytes) => {
    const id = createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
    objects.set(type + ':' + id, Buffer.from(bytes)); return id;
  };
  const entry = (mode, name, id) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(id, 'hex')]);
  const blob = object('blob', source), leaf = entry(mode, missing ? 'other.ps1' : 'run-vr-resource-governor.ps1', blob);
  const windows = object('tree', duplicate ? Buffer.concat([leaf, leaf]) : leaf);
  const scripts = object('tree', entry('40000', 'windows', windows));
  const root = object('tree', entry('40000', 'scripts', scripts));
  const head = object('commit', Buffer.from(`tree ${root}\nauthor Fixture <fixture@example.invalid> 0 +0000\n\nfixture\n`));
  const dependencies = { platform: 'win32', readSourceHead: () => head,
    monotonicNow: () => 100, environment: { USERPROFILE: 'C:\\Fixture', TEMP: 'C:\\Temp',
      NODE_OPTIONS: '--import=PRIVATE_LOADER', PSModulePath: 'PRIVATE_MODULE', SECRET: 'PRIVATE_TOKEN',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'alias.cat-file', GIT_CONFIG_VALUE_0: '!PRIVATE_COMMAND',
      STEPHANOS_GAME_PROCESS_NAMES: 'CustomGame', STEPHANOS_GAME_LIBRARY_ROOTS: 'C:\\Games' },
    spawnSync(executable, args, options) {
      calls.push({ executable, args, options });
      assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
      assert.equal(options.env.NODE_OPTIONS, undefined); assert.equal(options.env.PSModulePath, undefined);
      assert.equal(options.env.SECRET, undefined);
      if (args.includes('cat-file')) {
        const [type, id] = args.slice(-2);
        assert.equal(options.env.GIT_NO_REPLACE_OBJECTS, '1');
        assert.equal(options.env.GIT_NO_LAZY_FETCH, '1');
        return { status: 0, stdout: objects.get(type + ':' + id), stderr: Buffer.alloc(0) };
      }
      assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
      assert.equal(args.length, 5); assert.ok(args[4].length < 6000);
      const wrapper = Buffer.from(args[4], 'base64').toString('utf16le');
      assert.match(wrapper, /-Action ObserveAdmission/);
      assert.match(wrapper, /\$PSModuleAutoLoadingPreference='None'/);
      assert.equal(args.includes('-File'), false);
      assert.deepEqual(Buffer.from(options.input.trim(), 'base64'), source);
      assert.equal(options.env.STEPHANOS_GAME_PROCESS_NAMES, 'CustomGame');
      assert.equal(options.env.STEPHANOS_GAME_LIBRARY_ROOTS, 'C:\\Games');
      assert.equal(options.env.GIT_CONFIG_COUNT, undefined);
      assert.equal(options.timeout, 8000); assert.equal(options.maxBuffer, 4096);
      return { status: 0, stdout: Buffer.from(JSON.stringify(freshGovernor())), stderr: Buffer.alloc(0) };
    } };
  return { head, calls, objects, dependencies, options: { testOnly: true, dependencies } };
}

test('fixed governor child captures authenticated immutable source over stdin with a bounded argv and environment', () => {
  const f = governorChildFixture({ source: Buffer.from('#' + 'x'.repeat(50000) + '\n') });
  assert.deepEqual(readSovereignGovernorDiagnosticV1(f.head, f.options), freshGovernor());
  assert.equal(f.calls.filter(call => call.args.includes('cat-file')).length, 5);
  assert.equal(f.calls.filter(call => call.args.includes('-EncodedCommand')).length, 1);
});

test('the committed governor source fits the authenticated observation path', () => {
  const source = readFileSync(new URL('./windows/run-vr-resource-governor.ps1', import.meta.url));
  assert.ok(source.length > 65536, 'exercise the production regression above the former byte ceiling');
  const f = governorChildFixture({ source });
  assert.deepEqual(readSovereignGovernorDiagnosticV1(f.head, f.options), freshGovernor());
  assert.equal(f.calls.filter(call => call.args.includes('-EncodedCommand')).length, 1);
});

test('governor source capture accepts its exact finite budget and refuses the next byte before PowerShell', () => {
  const maximum = 128 * 1024;
  const allowed = governorChildFixture({ source: Buffer.alloc(maximum, 65) });
  assert.deepEqual(readSovereignGovernorDiagnosticV1(allowed.head, allowed.options), freshGovernor());
  const refused = governorChildFixture({ source: Buffer.alloc(maximum + 1, 65) });
  assert.throws(() => readSovereignGovernorDiagnosticV1(refused.head, refused.options), /GOVERNOR_SOURCE_UNPROVEN/);
  assert.equal(refused.calls.some(call => call.args.includes('-EncodedCommand')), false);
});

test('governor source authentication refuses substitution, wrong mode, duplicate membership and invalid UTF-8 before PowerShell', () => {
  for (const options of [{ mode: '120000' }, { mode: '100755' }, { duplicate: true }, { missing: true },
    { source: Buffer.from([255]) }, { source: Buffer.from([0]) }, { source: Buffer.alloc(128 * 1024 + 1, 65) }]) {
    const f = governorChildFixture(options);
    assert.throws(() => readSovereignGovernorDiagnosticV1(f.head, f.options));
    assert.equal(f.calls.some(call => call.args.includes('-EncodedCommand')), false);
  }
  for (const type of ['commit', 'tree', 'blob']) {
    const f = governorChildFixture(), run = f.dependencies.spawnSync;
    f.dependencies.spawnSync = (exe, args, options) => {
      const result = run(exe, args, options);
      if (args.at(-2) === type) result.stdout = Buffer.from('PRIVATE_SUBSTITUTED_SOURCE');
      return result;
    };
    assert.throws(() => readSovereignGovernorDiagnosticV1(f.head, f.options), /GOVERNOR_SOURCE_UNPROVEN/);
    assert.equal(f.calls.some(call => call.args.includes('-EncodedCommand')), false);
  }
});

test('governor capture closes on changed source, deadlines, failed children and bounded malformed output', () => {
  const changed = governorChildFixture(); let reads = 0;
  changed.dependencies.readSourceHead = () => ++reads === 1 ? changed.head : HEAD;
  assert.throws(() => readSovereignGovernorDiagnosticV1(changed.head, changed.options), /GOVERNOR_SOURCE_UNPROVEN/);
  assert.equal(changed.calls.some(call => call.args.includes('-EncodedCommand')), false);
  for (const [result, code] of [
    [{ status: null, error: { code: 'ETIMEDOUT' } }, 'OBSERVATION_TIMEOUT'],
    [{ status: null, signal: 'SIGTERM' }, 'OBSERVATION_INVALID'],
    [{ status: 2, stdout: Buffer.from('PRIVATE_ERROR') }, 'OBSERVATION_INVALID'],
    [{ status: 0, stdout: Buffer.alloc(4097, 32) }, 'OBSERVATION_INVALID'],
    [{ status: 0, stdout: Buffer.from([255]) }, 'OBSERVATION_INVALID'],
    [{ status: 0, stdout: Buffer.from('{}'), stderr: Buffer.from('PRIVATE_ERROR') }, 'OBSERVATION_INVALID'],
    [{ status: 0, stdout: Buffer.from('PRIVATE_ERROR') }, 'OBSERVATION_INVALID'],
  ]) {
    const f = governorChildFixture(), run = f.dependencies.spawnSync;
    f.dependencies.spawnSync = (exe, args, options) => args.includes('-EncodedCommand') ? result : run(exe, args, options);
    assert.throws(() => readSovereignGovernorDiagnosticV1(f.head, f.options), new RegExp(code));
  }
  const slow = governorChildFixture(); let tick = 0;
  slow.dependencies.monotonicNow = () => tick++ * 10001;
  assert.throws(() => readSovereignGovernorDiagnosticV1(slow.head, slow.options), /OBSERVATION_TIMEOUT/);
  assert.equal(slow.calls.length, 0);
});

test('governor runner rejects caller commands and ambiguous detection settings', () => {
  for (const options of [{ path: 'PRIVATE_PATH' }, { source: 'PRIVATE_CODE' }, { action: 'Reconcile' },
    { testOnly: false, dependencies: {} }, { dependencies: {} }]) {
    assert.throws(() => readSovereignGovernorDiagnosticV1(HEAD, options));
  }
  for (const extra of [{ STEPHANOS_GAME_PROCESS_NAMES: 'x'.repeat(4097) },
    { STEPHANOS_GAME_LIBRARY_ROOTS: 'C:\\Games\nPRIVATE' }, { stephanos_game_process_names: 'Duplicate' }]) {
    const f = governorChildFixture(); Object.assign(f.dependencies.environment, extra);
    assert.throws(() => readSovereignGovernorDiagnosticV1(f.head, f.options), /OBSERVATION_INVALID/);
    assert.equal(f.calls.some(call => call.args.includes('-EncodedCommand')), false);
  }
});

function harmlessGovernorObservationSource(size) {
  const prefix = `[CmdletBinding()]\nparam([string]$Action='Watch')\n`;
  const suffix = `if($Action -cne 'ObserveAdmission'){exit 3}\n` +
    `[pscustomobject]@{schemaVersion='stephanos.gaming-resource-admission-observation.v1';` +
    `observedAtUtc=[DateTime]::UtcNow.ToString('o');signalActive=$false;overrideMode='AUTO';preparePending=$false;readOnly=$true}|ConvertTo-Json\n`;
  const source = Buffer.from(prefix + '#' + 'x'.repeat(size - Buffer.byteLength(prefix + suffix) - 2) + '\n' + suffix);
  assert.equal(source.length, size);
  return source;
}

test('actual Windows stdin wrapper preserves the param block and invokes the fixed observation action',
  { skip: process.platform !== 'win32', timeout: 15000 }, () => {
    const source = harmlessGovernorObservationSource(128 * 1024);
    const f = governorChildFixture({ source }), run = f.dependencies.spawnSync;
    f.dependencies.environment = process.env;
    f.dependencies.spawnSync = (exe, args, options) => args.includes('cat-file')
      ? run(exe, args, options) : spawnSync(exe, args, { ...options, cwd: process.cwd() });
    const before = Date.now(), row = readSovereignGovernorDiagnosticV1(f.head, f.options);
    assert.equal(row.schemaVersion, freshGovernor().schemaVersion);
    assert.equal(row.readOnly, true); assert.equal(row.signalActive, false);
    assert.ok(Date.parse(row.observedAtUtc) >= before && Date.parse(row.observedAtUtc) <= Date.now());
  });

test('actual Windows wrapper rejects decoded and wire overflow at the same finite source budget',
  { skip: process.platform !== 'win32', timeout: 20000 }, () => {
    const maximum = 128 * 1024;
    for (const extra of [1, 4]) {
      const source = harmlessGovernorObservationSource(maximum);
      const f = governorChildFixture({ source }), run = f.dependencies.spawnSync;
      let wrapperCalls = 0;
      f.dependencies.environment = process.env;
      f.dependencies.spawnSync = (exe, args, options) => {
        if (args.includes('cat-file')) return run(exe, args, options);
        wrapperCalls++;
        // +1 fits the same base64 length and must fail decoded-byte validation;
        // +4 exceeds the wire budget and exercises the sentinel read.
        const input = Buffer.concat([source, Buffer.alloc(extra, 32)]).toString('base64') + '\n';
        return spawnSync(exe, args, { ...options, input, cwd: process.cwd() });
      };
      assert.throws(() => readSovereignGovernorDiagnosticV1(f.head, f.options), /GOVERNOR_OBSERVATION_INVALID/);
      assert.equal(wrapperCalls, 1);
    }
  });

test('fixed native inspection reads a comment request locator without inventing a workflow run identity', async () => {
  const id = 'control-tower-comment-700-1';
  const { options } = fixture({ readLedger: requested => {
    assert.equal(requested, id); return { record: null, workspaceSelection: 'DEFAULT' };
  } });
  options.controlTowerRequestId = id;
  const report = await inspectSovereignControlSystemV1(options);
  assert.equal(report.observationCompleted, true);
  assert.equal(report.requestLedger.requestId, id);
  assert.equal(report.requestLedger.recordObserved, false);
  assert.equal(report.nativeRuntime.qualificationObserved, false);
});

test('native success is an observation for this caller, never a serialized execution qualification', async () => {
  const { options } = fixture({ inspectRuntime: () => ({ ok: true, sourceHead: HEAD,
    observedAtUtc: NOW, bootStartedAtUtc: '2026-10-31T08:00:00.000Z',
    profiles: ['MAINTENANCE_GOAL_BUILDER_V1', 'SOURCE_TASK_V1'], dispatchAllowed: true,
    custodyRecordSha256: 'd'.repeat(64), nativeRecordId: 17281 }) });
  const report = await inspectSovereignControlSystemV1(options);
  assert.equal(report.nativeRuntime.qualificationObserved, true);
  assert.deepEqual(report.nativeRuntime.profiles, ['MAINTENANCE_GOAL_BUILDER_V1', 'SOURCE_TASK_V1']);
  const publicStatus = projectSovereignControlSystemStatusV1(report);
  assert.equal(publicStatus.nativeRuntime.qualificationObserved, true);
  for (const forbidden of ['dispatchAllowed', 'custodyRecord', 'nativeRecordId', '17281'])
    assert.equal(JSON.stringify(publicStatus).includes(forbidden), false);
});

test('four declared compiled profiles remain observation-only and reject duplicate or unknown inventory', async () => {
  const profiles=['MAINTENANCE_GOAL_BUILDER_V1','SPATIAL_WORKSPACE_PREPARE_V1',
    'SOURCE_TASK_V1','CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1'];
  const observe=async candidate=>inspectSovereignControlSystemV1(fixture({inspectRuntime:()=>({
    ok:true,sourceHead:HEAD,observedAtUtc:NOW,profiles:candidate,dispatchAllowed:true,
  })}).options);
  const report=await observe(profiles);
  assert.equal(report.nativeRuntime.qualificationObserved,true);
  assert.deepEqual(report.nativeRuntime.profiles,profiles);
  const published=projectSovereignControlSystemStatusV1(report);
  assert.equal(published.nativeRuntime.qualificationObserved,true);
  assert.deepEqual(published.nativeRuntime.profiles,profiles);
  assert.equal(published.observationOnly,true);
  assert.equal(JSON.stringify(published).includes('dispatchAllowed'),false);
  for(const invalid of [[...profiles,profiles[0]],[...profiles.slice(0,3),profiles[0]],
    [...profiles.slice(0,3),'ARBITRARY_SHELL'],['SPATIAL_WORKSPACE_PREPARE_V1',null]]) {
    const refused=await observe(invalid);
    assert.equal(refused.nativeRuntime.qualificationObserved,false);
    assert.equal(refused.nativeRuntime.reason,'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
    assert.equal(Object.hasOwn(refused.nativeRuntime,'profiles'),false);
  }
});

test('canonical source changes invalidate completion and any observed native qualification', async () => {
  let reads = 0;
  const { options } = fixture({ readSourceHead: () => ++reads === 1 ? HEAD : 'e'.repeat(40),
    inspectRuntime: () => ({ ok: true, sourceHead: HEAD, observedAtUtc: NOW,
      profiles: ['MAINTENANCE_GOAL_BUILDER_V1'] }) });
  const report = await inspectSovereignControlSystemV1(options);
  assert.equal(report.observationCompleted, false);
  assert.equal(report.source.stable, false);
  assert.equal(report.blocker, 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED');
  assert.equal(report.nativeRuntime.qualificationObserved, false);
  assert.equal(Object.hasOwn(report.nativeRuntime, 'profiles'), false);
});

test('wrong expected main or platform stops before any native observation', async () => {
  const wrong = fixture(); wrong.options.expectedMain = 'e'.repeat(40);
  const mismatch = await inspectSovereignControlSystemV1(wrong.options);
  assert.deepEqual(wrong.calls, ['source']);
  assert.equal(mismatch.blocker, 'SOVEREIGN_CONTROL_SYSTEM_EXPECTED_MAIN_MISMATCH');
  assert.equal(mismatch.observationCompleted, false);
  const linux = fixture({ platform: 'linux' });
  const refused = await inspectSovereignControlSystemV1(linux.options);
  assert.deepEqual(linux.calls, []);
  assert.equal(refused.blocker, 'SOVEREIGN_CONTROL_SYSTEM_WINDOWS_REQUIRED');
});

test('changed, stale, missing or malformed native owner cannot authenticate the health snapshot', async () => {
  const invalid = [() => { throw Error('PRIVATE_OWNER_PATH'); },
    () => nativeOwner({ observedAtUtc: '2026-10-31T12:59:44.000Z' }),
    () => nativeOwner({ observedAtUtc: '2026-10-31T13:00:01.000Z' }),
    () => nativeOwner({ pid: '13291' }), () => nativeOwner({ rawCommand: 'PRIVATE_COMMAND' })];
  for (const readOwner of invalid) {
    const report = await inspectSovereignControlSystemV1(fixture({ readOwner }).options);
    assert.equal(report.owner.stable, false); assert.equal(report.guardian.available, false);
    assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
  }
  let reads = 0;
  const report = await inspectSovereignControlSystemV1(fixture({
    readOwner: () => nativeOwner({ pid: ++reads === 1 ? 100 : 101 }),
  }).options);
  assert.equal(report.owner.available, true); assert.equal(report.owner.stable, false);
  assert.equal(report.owner.reason, 'SOVEREIGN_CONTROL_SYSTEM_OWNER_CHANGED');
  assert.equal(report.guardian.available, false);
});

test('live held custody stays held and missing custody fields stay unknown', async () => {
  const held = await inspectSovereignControlSystemV1(fixture({
    fetchFn: async () => Response.json(ownerHealth({ timeoutCustodyHeld: true,
      persistentCustody: { held: true, blocker: 'MAINTENANCE_CUSTODY_STATE_MISSING' } })),
  }).options);
  assert.equal(held.guardian.custodyState, 'HELD');
  assert.equal(held.guardian.blocker, 'MAINTENANCE_CUSTODY_STATE_MISSING');
  const missing = await inspectSovereignControlSystemV1(fixture({
    fetchFn: async () => Response.json(ownerHealth({ persistentCustody: undefined })),
  }).options);
  assert.equal(missing.guardian.available, false);
  assert.equal(missing.guardian.blocker, 'SOVEREIGN_CONTROL_SYSTEM_HEALTH_UNPROVEN');
});

test('health failures, invalid UTF-8 and oversized streams remain sanitized bounded observations', async () => {
  const badFetches = [async () => { throw Error('PRIVATE_HTTP_ERROR'); },
    async () => new Response('{}', { status: 503 }), async () => new Response('not json'),
    async () => new Response(new Uint8Array([0xff, 0xff])),
    async () => Response.json({ ...ownerHealth(), service: 'another-service' }),
    async () => Response.json({ ...ownerHealth(), ok: false }),
    async () => new Response('x'.repeat(65537))];
  for (const fetchFn of badFetches) {
    const report = await inspectSovereignControlSystemV1(fixture({ fetchFn }).options);
    assert.equal(report.guardian.available, false);
    assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
    assert.equal(report.nativeRuntime.available, true);
  }
  let cancelled = false, released = false;
  const reader = { read: async () => ({ done: false, value: new Uint8Array(65537) }),
    cancel: async () => { cancelled = true; }, releaseLock: () => { released = true; } };
  const report = await inspectSovereignControlSystemV1(fixture({
    fetchFn: async () => ({ ok: true, body: { getReader: () => reader } }),
  }).options);
  assert.equal(cancelled, true); assert.equal(released, true);
  assert.equal(report.guardian.blocker, 'SOVEREIGN_CONTROL_SYSTEM_HEALTH_BOUND_EXCEEDED');
});

test('typed native denials survive; malformed success and arbitrary errors never qualify', async () => {
  for (const reason of ['RUNTIME_NORMAL_OPERATOR_REQUIRED', 'RUNTIME_PENDING_LATER_BOOT_UNPROVEN',
    'RUNTIME_SOURCE_REF_CHANGED', 'FIXED_RUNTIME_IDENTITY_INSPECTION_TIMEOUT', 'FIXED_RUNTIME_INSPECTOR_NOT_FOUND']) {
    const report = await inspectSovereignControlSystemV1(fixture({ inspectRuntime: () => ({ ok: false, reason }) }).options);
    assert.equal(report.nativeRuntime.reason, reason); assert.equal(report.observationCompleted, true);
  }
  for (const native of [{ ok: true, sourceHead: 'b'.repeat(40), observedAtUtc: NOW, profiles: [] },
    { ok: true, sourceHead: HEAD, observedAtUtc: NOW, profiles: ['ARBITRARY_SHELL'] },
    { ok: true, sourceHead: HEAD, observedAtUtc: '2026-10-31T13:01:00Z', profiles: [] },
    { ok: true, sourceHead: HEAD, observedAtUtc: NOW, profiles: ['SOURCE_TASK_V1', 'SOURCE_TASK_V1'] },
    { ok: false, reason: 'PRIVATE_SECRET' }]) {
    const report = await inspectSovereignControlSystemV1(fixture({ inspectRuntime: () => native }).options);
    assert.equal(report.nativeRuntime.qualificationObserved, false);
    assert.equal(report.nativeRuntime.reason, 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
    assert.equal(JSON.stringify(report).includes('PRIVATE_SECRET'), false);
  }
});

test('every declared qualification denial survives public projection without additional observations', async () => {
  const codes = SOVEREIGN_CONTROL_SYSTEM_QUALIFICATION_DIAGNOSTIC_CODES_V1;
  assert.equal(codes.length, 60);
  for (const [index, qualificationDiagnosticCode] of codes.entries()) {
    const f = fixture();
    f.options.dependencies.inspectRuntime = () => {
      f.calls.push('native');
      return { ok: false, reason: qualificationDiagnosticCode,
        ...(index % 2 ? { sourceHead: HEAD } : {}),
        dispatchAllowed: true, executionCustodyReleased: true, profiles: ['SOURCE_TASK_V1'],
        sourceCode: 'PRIVATE_SOURCE_CODE', sourceStep: 'PRIVATE_SOURCE_STEP',
        sourceConfiguration: { value: 'PRIVATE_CONFIGURATION' }, stderr: 'PRIVATE_NATIVE_ERROR' };
    };
    const report = await inspectSovereignControlSystemV1(f.options);
    assert.equal(report.observationCompleted, true);
    assert.equal(report.nativeRuntime.available, true);
    assert.equal(report.nativeRuntime.reason, 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
    assert.equal(report.nativeRuntime.qualificationObserved, false);
    assert.equal(report.nativeRuntime.qualificationDiagnosticCode, qualificationDiagnosticCode);
    assert.equal(Object.isFrozen(report.nativeRuntime), true);
    const published = projectSovereignControlSystemStatusV1(report);
    assert.equal(published.nativeRuntime.qualificationDiagnosticCode, qualificationDiagnosticCode);
    assert.equal(published.nativeRuntime.reason, 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
    assert.equal(published.nativeRuntime.qualificationObserved, false);
    assert.equal(published.observationOnly, true);
    for (const forbidden of ['dispatchAllowed', 'executionCustodyReleased', 'profiles',
      'sourceCode', 'sourceStep', 'sourceConfiguration', 'stderr']) {
      assert.equal(Object.hasOwn(report.nativeRuntime, forbidden), false);
      assert.equal(Object.hasOwn(published.nativeRuntime, forbidden), false);
    }
    assert.equal(JSON.stringify(published).includes('PRIVATE_'), false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(published))), published);
    assert.ok(Buffer.byteLength(JSON.stringify(published)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
    assert.deepEqual(f.calls, ['source', 'governor', 'caller', 'owner', 'health', 'protocol',
      'owner', 'native', 'ledger', 'source']);
  }
});

test('qualification details cannot invent a cause from generic, private or coerced native reasons', async () => {
  let invoked = 0;
  const code = 'FIXED_RUNTIME_SOURCE_PROOF_READ';
  for (const reason of [undefined, null, 1, true, Symbol('PRIVATE_SYMBOL'), [], {}, new String(code),
    { toString() { invoked++; return code; } }, 'x'.repeat(10000), 'C:\\PRIVATE\\native.json',
    'FIXED_RUNTIME_SOURCE_PROOF_PRIVATE_TOKEN', 'CANONICAL_GIT_PROBE_PRIVATE_TOKEN',
    'MAINTENANCE_RECOVERY_PRIVATE_TOKEN', 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN']) {
    const report = await inspectSovereignControlSystemV1(fixture({ inspectRuntime: () => ({ ok: false,
      reason, qualificationDiagnosticCode: code, sourceCode: code, sourceStep: 'PRIVATE_STEP' }) }).options);
    const published = projectSovereignControlSystemStatusV1(report);
    assert.equal(report.nativeRuntime.available, true);
    assert.equal(report.nativeRuntime.reason, 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
    assert.equal(report.nativeRuntime.qualificationObserved, false);
    assert.equal(Object.hasOwn(report.nativeRuntime, 'qualificationDiagnosticCode'), false);
    assert.equal(Object.hasOwn(published.nativeRuntime, 'qualificationDiagnosticCode'), false);
    assert.equal(JSON.stringify(published).includes('PRIVATE_'), false);
  }
  assert.equal(invoked, 0);
});

test('qualification denial capture rejects native accessors, inherited values and symbol keys without invoking them', async () => {
  let invoked = 0;
  const code = 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN';
  const accessorRows = ['reason', 'sourceHead', 'qualificationDiagnosticCode'].map(key => {
    const row = { ok: false, reason: code };
    Object.defineProperty(row, key, { get() { invoked++; return key === 'sourceHead' ? HEAD : code; } });
    return row;
  });
  for (const native of [...accessorRows, Object.assign(Object.create({ reason: code }), { ok: false }),
    { ok: false, reason: code, [Symbol('PRIVATE_SYMBOL')]: code }]) {
    const report = await inspectSovereignControlSystemV1(fixture({ inspectRuntime: () => native }).options);
    assert.equal(report.nativeRuntime.available, false);
    assert.equal(report.nativeRuntime.qualificationObserved, false);
    assert.equal(Object.hasOwn(report.nativeRuntime, 'qualificationDiagnosticCode'), false);
    assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(report).nativeRuntime,
      'qualificationDiagnosticCode'), false);
  }
  assert.equal(invoked, 0);
});

test('qualification detail requires an actual failed result and no conflicting native source', async () => {
  const code = 'FIXED_RUNTIME_GIT_CLOSURE_CHANGED';
  for (const native of [
    { ok: true, reason: code, sourceHead: HEAD, observedAtUtc: NOW, profiles: [] },
    { ok: 'false', reason: code }, { reason: code },
    { ok: false, reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING', qualificationDiagnosticCode: code },
    { ok: false, reason: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD', qualificationDiagnosticCode: code },
    ...['e'.repeat(40), '', undefined, null, 1, [], {}]
      .map(sourceHead => ({ ok: false, reason: code, sourceHead })),
  ]) {
    const report = await inspectSovereignControlSystemV1(fixture({ inspectRuntime: () => native }).options);
    assert.equal(Object.hasOwn(report.nativeRuntime, 'qualificationDiagnosticCode'), false);
    assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(report).nativeRuntime,
      'qualificationDiagnosticCode'), false);
    if (native.ok === true) assert.equal(report.nativeRuntime.qualificationObserved, true);
    else assert.equal(report.nativeRuntime.qualificationObserved, false);
  }
  for (const message of [code, 'EACCES: PRIVATE_NATIVE_PATH']) {
    const report = await inspectSovereignControlSystemV1(fixture({ inspectRuntime: () => { throw Error(message); } }).options);
    assert.equal(report.nativeRuntime.available, false);
    assert.equal(report.nativeRuntime.reason, 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
    assert.equal(Object.hasOwn(report.nativeRuntime, 'qualificationDiagnosticCode'), false);
  }
});

test('source drift and expected-main mismatch remove qualification details without another native inspection', async () => {
  for (const finalRead of [() => 'e'.repeat(40), () => { throw Error('PRIVATE_SOURCE_PATH'); }]) {
    let sourceReads = 0, nativeCalls = 0;
    const report = await inspectSovereignControlSystemV1(fixture({
      readSourceHead: () => ++sourceReads === 1 ? HEAD : finalRead(),
      inspectRuntime: () => { nativeCalls++; return { ok: false, reason: 'FIXED_RUNTIME_SOURCE_PROOF_HEAD_CHANGED' }; },
    }).options);
    assert.equal(report.observationCompleted, false);
    assert.equal(report.nativeRuntime.reason, 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED');
    assert.equal(report.nativeRuntime.qualificationObserved, false);
    assert.equal(Object.hasOwn(report.nativeRuntime, 'qualificationDiagnosticCode'), false);
    assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(report).nativeRuntime,
      'qualificationDiagnosticCode'), false);
    assert.equal(sourceReads, 2); assert.equal(nativeCalls, 1);
  }
  const wrong = fixture(); wrong.options.expectedMain = 'e'.repeat(40);
  const refused = await inspectSovereignControlSystemV1(wrong.options);
  assert.equal(Object.hasOwn(refused.nativeRuntime, 'qualificationDiagnosticCode'), false);
  assert.deepEqual(wrong.calls, ['source']);
});

test('qualification and owner refusal details coexist without proving either owner custody or runtime qualification', async () => {
  const report = await inspectSovereignControlSystemV1(fixture({
    readOwner: () => { throw Object.assign(Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN'),
      { diagnosticCode: 'OWNER_LISTENER_UNPROVEN' }); },
    inspectRuntime: () => ({ ok: false, reason: 'RUNTIME_SOURCE_PROOF_PROTECTED_CLOSURE_CHANGED' }),
  }).options);
  const published = projectSovereignControlSystemStatusV1(report);
  assert.equal(published.owner.reason, 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN');
  assert.equal(published.owner.diagnosticCode, 'OWNER_LISTENER_UNPROVEN');
  assert.equal(published.owner.available, false);
  assert.equal(published.owner.stable, false);
  assert.equal(published.nativeRuntime.reason, 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
  assert.equal(published.nativeRuntime.qualificationDiagnosticCode, 'RUNTIME_SOURCE_PROOF_PROTECTED_CLOSURE_CHANGED');
  assert.equal(published.nativeRuntime.qualificationObserved, false);
  assert.equal(published.observationOnly, true);
  assert.ok(Buffer.byteLength(JSON.stringify(published)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
});

test('actual fixed-runtime governor vocabulary survives observation and public projection without authority', async () => {
  const source = readFileSync(new URL('./sovereign-fixed-runtime-parent-v1.mjs', import.meta.url), 'utf8');
  const codes = [...source.matchAll(/'native-capacity-gaming-[^']+':'(FIXED_RUNTIME_GOVERNOR_[^']+)'/g)]
    .map(match => match[1]);
  assert.equal(codes.length, 10); assert.equal(new Set(codes).size, 10);
  for (const governorHoldCode of codes) {
    let nativeCalls = 0;
    const f = fixture({ inspectRuntime: () => {
      nativeCalls++;
      return { ok: false, reason: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD',
        governorHoldCode, dispatchAllowed: true, executionCustodyReleased: true, privateReason: 'PRIVATE_TOKEN' };
    } });
    const report = await inspectSovereignControlSystemV1(f.options);
    assert.equal(report.nativeRuntime.governorHoldCode, governorHoldCode);
    assert.equal(report.nativeRuntime.qualificationObserved, false);
    assert.equal(report.nativeRuntime.reason, 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD');
    assert.equal(report.observationCompleted, true);
    const published = projectSovereignControlSystemStatusV1(report);
    assert.equal(published.nativeRuntime.governorHoldCode, governorHoldCode);
    assert.equal(published.nativeRuntime.qualificationObserved, false);
    assert.equal(Object.hasOwn(published.nativeRuntime, 'dispatchAllowed'), false);
    assert.equal(Object.hasOwn(published.nativeRuntime, 'executionCustodyReleased'), false);
    assert.equal(JSON.stringify(published).includes('PRIVATE_'), false);
    assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(JSON.stringify(published))), published);
    assert.ok(Buffer.byteLength(JSON.stringify(published)) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
    assert.equal(nativeCalls, 1);
  }
});

test('the same native permission denial carries bounded causes beside an unproven owner', async () => {
  const governorPermission = { observedAtUtc: '2026-10-31T12:59:29.000Z',
    failed: [...SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_PERMISSION_PREDICATES_V1] };
  let nativeCalls = 0;
  const report = await inspectSovereignControlSystemV1(fixture({
    readOwner: () => { throw Object.assign(Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN'),
      { diagnosticCode: 'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN' }); },
    inspectRuntime: () => {
      nativeCalls++;
      return { ok: false, reason: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD',
        governorHoldCode: 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED', governorPermission,
        dispatchAllowed: true, executionCustodyReleased: true, privateState: 'PRIVATE_TOKEN' };
    },
  }).options);
  assert.equal(nativeCalls, 1);
  assert.deepEqual(report.nativeRuntime.governorPermission, governorPermission);
  assert.notEqual(report.nativeRuntime.governorPermission, governorPermission);
  assert.equal(Object.isFrozen(report.nativeRuntime.governorPermission), true);
  assert.equal(Object.isFrozen(report.nativeRuntime.governorPermission.failed), true);
  const published = projectSovereignControlSystemStatusV1(report), bytes = JSON.stringify(published);
  assert.deepEqual(published.nativeRuntime.governorPermission, governorPermission);
  assert.equal(published.nativeRuntime.reason, 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD');
  assert.equal(published.nativeRuntime.governorHoldCode, 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED');
  assert.equal(published.nativeRuntime.qualificationObserved, false);
  assert.equal(published.owner.diagnosticCode, 'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN');
  assert.equal(published.owner.available, false); assert.equal(published.guardian.available, false);
  assert.equal(published.governorObservation.signalActive, false);
  assert.ok(Buffer.byteLength(bytes) <= SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1);
  for (const forbidden of ['dispatchAllowed', 'executionCustodyReleased', 'PRIVATE', SID])
    assert.equal(bytes.includes(forbidden), false);
  assert.deepEqual(projectSovereignControlSystemStatusV1(JSON.parse(bytes)), published);
});

test('permission causes are omitted for malformed data, other holds and changed source without reading getters', async () => {
  const permission = { observedAtUtc: NOW, failed: ['ACTIVE'] };
  let invoked = 0;
  const accessor = { observedAtUtc: NOW };
  Object.defineProperty(accessor, 'failed', { get() { invoked++; return ['PRIVATE_TOKEN']; } });
  for (const governorPermission of [null, accessor, { ...permission, failed: ['PRIVATE_TOKEN'] },
    { ...permission, observedAtUtc: '2026-10-31T13:00:00.001Z' },
    { ...permission, observedAtUtc: '2026-10-31T12:59:14.999Z' },
    { ...permission, executionAuthority: true }]) {
    const report = await inspectSovereignControlSystemV1(fixture({ inspectRuntime: () => ({
      ok: false, reason: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD',
      governorHoldCode: 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED', governorPermission,
    }) }).options);
    assert.equal(Object.hasOwn(report.nativeRuntime, 'governorPermission'), false);
    assert.equal(report.nativeRuntime.governorHoldCode, 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED');
    assert.equal(report.nativeRuntime.qualificationObserved, false);
    assert.equal(JSON.stringify(projectSovereignControlSystemStatusV1(report)).includes('PRIVATE'), false);
  }
  for (const extra of [{ reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING' },
    { governorHoldCode: 'FIXED_RUNTIME_GOVERNOR_OBSERVATION_STALE' }, { sourceHead: 'e'.repeat(40) },
    { ok: true, sourceHead: HEAD, observedAtUtc: NOW, profiles: [] }]) {
    const report = await inspectSovereignControlSystemV1(fixture({ inspectRuntime: () => ({
      ok: false, reason: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD',
      governorHoldCode: 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED', governorPermission: permission, ...extra,
    }) }).options);
    assert.equal(Object.hasOwn(report.nativeRuntime, 'governorPermission'), false);
  }
  let sourceReads = 0;
  const changed = await inspectSovereignControlSystemV1(fixture({
    readSourceHead: () => ++sourceReads === 1 ? HEAD : 'e'.repeat(40),
    inspectRuntime: () => ({ ok: false, reason: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD',
      governorHoldCode: 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED', governorPermission: permission }),
  }).options);
  assert.equal(changed.nativeRuntime.reason, 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED');
  assert.equal(Object.hasOwn(changed.nativeRuntime, 'governorPermission'), false);
  assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(changed).nativeRuntime, 'governorPermission'), false);
  assert.equal(invoked, 0);
});

test('missing or private governor subcodes become a closed unavailable diagnostic without coercion', async () => {
  let coerced = 0;
  for (const governorHoldCode of [undefined, null, 1, true, [],
    { toString() { coerced++; return 'PRIVATE_TOKEN'; } }, 'PRIVATE_TOKEN', 'FIXED_RUNTIME_GOVERNOR_PRIVATE_TOKEN']) {
    const native = { ok: false, reason: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD' };
    if (governorHoldCode !== undefined) native.governorHoldCode = governorHoldCode;
    const report = await inspectSovereignControlSystemV1(fixture({ inspectRuntime: () => native }).options);
    assert.equal(report.nativeRuntime.governorHoldCode, 'FIXED_RUNTIME_GOVERNOR_EVIDENCE_UNAVAILABLE');
    assert.equal(report.nativeRuntime.qualificationObserved, false);
    assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
  }
  assert.equal(coerced, 0);
});

test('governor diagnostics cannot attach to success, another refusal, accessor input or changed source', async () => {
  const governorHoldCode = 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED';
  let invoked = 0;
  const accessor = { ok: false, reason: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD' };
  Object.defineProperty(accessor, 'governorHoldCode', { get() { invoked++; return governorHoldCode; } });
  for (const native of [accessor, { ok: false, reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING', governorHoldCode },
    { ok: true, sourceHead: HEAD, observedAtUtc: NOW, profiles: [], governorHoldCode }]) {
    const report = await inspectSovereignControlSystemV1(fixture({ inspectRuntime: () => native }).options);
    assert.equal(Object.hasOwn(report.nativeRuntime, 'governorHoldCode'), false);
    assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(report).nativeRuntime, 'governorHoldCode'), false);
  }
  assert.equal(invoked, 0);
  let reads = 0;
  const report = await inspectSovereignControlSystemV1(fixture({
    readSourceHead: () => ++reads === 1 ? HEAD : 'e'.repeat(40),
    inspectRuntime: () => ({ ok: false, reason: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD', governorHoldCode }),
  }).options);
  assert.equal(report.nativeRuntime.reason, 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED');
  assert.equal(report.observationCompleted, false);
  assert.equal(Object.hasOwn(report.nativeRuntime, 'governorHoldCode'), false);
  assert.equal(Object.hasOwn(projectSovereignControlSystemStatusV1(report).nativeRuntime, 'governorHoldCode'), false);
});

test('no usable helper or owner-bound health cannot claim a completed observation', async () => {
  const report = await inspectSovereignControlSystemV1(fixture({
    fetchFn: async () => { throw Error('offline'); },
    inspectRuntime: () => { throw Error('private/path'); },
  }).options);
  assert.equal(report.observationCompleted, false);
  assert.equal(projectSovereignControlSystemStatusV1(report).observationCompleted, false);
});

test('ledger is read only for exact selected request; terminal claims require exact original ownership', async () => {
  const record = { schemaVersion: 'stephanos.mailbox-execution-ledger-entry.v1', requestId: REQUEST,
    issueNumber: 2315, phase: 'TERMINAL', terminalState: 'BLOCKED', terminalProofHash: 'f'.repeat(64) };
  const result = await inspectSovereignControlSystemV1(fixture({ readLedger: () => ({ record, workspaceSelection: 'ENVIRONMENT' }) }).options);
  assert.equal(result.requestLedger.phase, 'TERMINAL'); assert.equal(result.requestLedger.terminalState, 'BLOCKED');
  assert.equal(result.requestLedger.relayWorkspaceIdentityProven, false);
  assert.equal(JSON.stringify(result).includes('terminalProofHash'), false);
  for (const bad of [{ ...record, requestId: REQUEST + '-other' }, { ...record, issueNumber: 3149 },
    { ...record, terminalState: 'SUCCESS' }, { ...record, phase: 'RESERVED' }]) {
    const report = await inspectSovereignControlSystemV1(fixture({
      readLedger: () => ({ record: bad, workspaceSelection: 'DEFAULT' }),
    }).options);
    assert.equal(report.requestLedger.recordObserved, false);
    assert.equal(report.requestLedger.reason, 'SOVEREIGN_CONTROL_SYSTEM_LEDGER_UNPROVEN');
  }
  const noRequest = fixture(); delete noRequest.options.controlTowerRequestId;
  const skipped = await inspectSovereignControlSystemV1(noRequest.options);
  assert.equal(skipped.requestLedger.requested, false); assert.equal(noRequest.calls.includes('ledger'), false);
});

test('caller identity cannot become daemon token evidence, and malformed caller data is not published', async () => {
  for (const caller of [{ sid: SID, administratorEnabled: false },
    { schemaVersion: 'stephanos.sovereign-diagnostic-caller.v1', sid: 'S-1-5-18', administratorEnabled: true, observedAtUtc: NOW },
    { schemaVersion: 'stephanos.sovereign-diagnostic-caller.v1', sid: SID, administratorEnabled: 'false', observedAtUtc: NOW }]) {
    const report = await inspectSovereignControlSystemV1(fixture({ readCaller: () => caller }).options);
    assert.equal(report.caller.available, false); assert.equal(Object.hasOwn(report.caller, 'sid'), false);
    assert.equal(report.caller.observationAppliesTo, 'DIAGNOSTIC_CALLER_ONLY');
  }
});

test('closed API rejects extra fields, accessors, inherited values, symbols and undeclared dependencies', async () => {
  let invoked = false;
  const accessor = {}; Object.defineProperty(accessor, 'expectedMain', { get() { invoked = true; return HEAD; } });
  for (const options of [{ expectedMain: HEAD, path: 'C:\\private' }, { expectedMain: 'MAIN' },
    { controlTowerRequestId: '../../private' }, { testOnly: 'true' }, accessor,
    Object.create({ expectedMain: HEAD }), { [Symbol('secret')]: true },
    { testOnly: true, dependencies: { execute: () => { invoked = true; } } },
    { dependencies: { platform: 'win32' } }]) {
    const report = await inspectSovereignControlSystemV1(options);
    assert.equal(report.observationCompleted, false);
    assert.match(report.blocker, /^SOVEREIGN_CONTROL_SYSTEM_(ARGUMENTS_INVALID|TEST_DEPENDENCIES_FORBIDDEN)$/);
  }
  assert.equal(invoked, false);
});

test('short CLI accepts only exact main and one existing Control Tower request identity', () => {
  assert.deepEqual(parseSovereignControlSystemInspectionArgumentsV1([]), {});
  assert.deepEqual(parseSovereignControlSystemInspectionArgumentsV1(['--expected-main', HEAD, '--control-tower-request', REQUEST]),
    { expectedMain: HEAD, controlTowerRequestId: REQUEST });
  for (const args of [['--expected-main'], ['--repair', 'yes'], ['--expected-main', HEAD, '--expected-main', HEAD],
    ['--control-tower-request', 'control-tower-build-123-2'], ['__proto__', REQUEST], ['toString', REQUEST],
    ['--expected-main', HEAD.toUpperCase()], ['--expected-main', HEAD, '--url', 'http://elsewhere']])
    assert.throws(() => parseSovereignControlSystemInspectionArgumentsV1(args), /ARGUMENTS_INVALID/);
});

test('production process cannot enable dependency injection with only a function argument', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const url = new URL('./sovereign-commander-native-inspect.mjs', import.meta.url).href;
  const script = `const {inspectSovereignControlSystemV1}=await import(${JSON.stringify(url)});`+
    `console.log(JSON.stringify(await inspectSovereignControlSystemV1({testOnly:true,dependencies:{platform:'win32'}})));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env, timeout: 10000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).blocker, 'SOVEREIGN_CONTROL_SYSTEM_TEST_DEPENDENCIES_FORBIDDEN');
});

test('production governor reader cannot accept test-only source or child dependencies', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const url = new URL('./sovereign-commander-native-inspect.mjs', import.meta.url).href;
  const script = `const {readSovereignGovernorDiagnosticV1}=await import(${JSON.stringify(url)});` +
    `try { readSovereignGovernorDiagnosticV1('${HEAD}',{testOnly:true,dependencies:{platform:'win32',` +
    `spawnSync(){throw Error('INJECTED_CHILD')}}}); process.exitCode=5; }` +
    `catch(error){process.stdout.write(error.message)}`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env, timeout: 10000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'SOVEREIGN_CONTROL_SYSTEM_TEST_DEPENDENCIES_FORBIDDEN');
});

test('non-Windows CLI exits with a typed refusal and performs no native inspection', { skip: process.platform === 'win32' }, () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./sovereign-commander-native-inspect.mjs', import.meta.url))],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 2); assert.equal(child.stderr, '');
  const report = JSON.parse(child.stdout);
  assert.equal(report.blocker, 'SOVEREIGN_CONTROL_SYSTEM_WINDOWS_REQUIRED');
  assert.equal(report.nativeRuntime.available, false);
});

test('observation remains outside the immutable native execution closure', () => {
  const closure = JSON.parse(readFileSync(new URL('../shared/agents/sovereignFixedRuntimeSourceClosureV1.json', import.meta.url)));
  for (const path of ['scripts/sovereign-commander-native-inspect.mjs', 'shared/agents/sovereignControlSystemStatusV1.mjs',
    'scripts/control-tower-build-consumer-v1.mjs', 'scripts/battle-bridge-sovereign-relay-daemon.mjs'])
    assert.equal(closure.paths.includes(path), false);
  // The installer and native verifier own the package bound. Check their
  // agreement instead of retaining a third, stale cap in this observation test.
  // This does not change either enforcing implementation or the closure.
  const nativeSource = readFileSync(new URL('./windows/SovereignFixedRuntimeIdentityV1.cs', import.meta.url), 'utf8');
  const installerSource = readFileSync(new URL('./sovereign-fixed-runtime-installer-candidate-v1.mjs', import.meta.url), 'utf8');
  // The production verifier and installer now enforce named constants, not inline
  // literal numbers. Bind both declaration identities to their real guard usages.
  const nativeBounds = [...nativeSource.matchAll(/const\s+int\s+RuntimeSourceMemberLimitV1\s*=\s*(\d+)\s*;/g)];
  const installerBounds = [...installerSource.matchAll(/export\s+const\s+FIXED_RUNTIME_SOURCE_MEMBER_LIMIT_V1\s*=\s*(\d+)\s*;/g)];
  assert.equal(nativeBounds.length, 1, 'native verifier must declare one explicit package bound');
  assert.equal(installerBounds.length, 1, 'installer must declare one explicit package bound');
  assert.equal([...nativeSource.matchAll(/manifest\.Files\.Length\s*>\s*RuntimeSourceMemberLimitV1\b/g)].length,
    1, 'native manifest validation must enforce the declared bound');
  assert.equal([...installerSource.matchAll(/FIXED_RUNTIME_SOURCE_PATHS_V1\.length\s*>\s*FIXED_RUNTIME_SOURCE_MEMBER_LIMIT_V1\b/g)].length,
    1, 'installer must enforce the declared bound');
  assert.equal([...nativeSource.matchAll(/members\.Length\s*>\s*RuntimeSourceMemberLimitV1\b/g)].length,
    1, 'native closure validation must enforce the declared bound');
  assert.equal([...installerSource.matchAll(/members\.length\s*>\s*FIXED_RUNTIME_SOURCE_MEMBER_LIMIT_V1\b/g)].length,
    1, 'installer closure validation must enforce the declared bound');
  const maximumMembers = Number(nativeBounds[0][1]);
  assert.equal(Number(installerBounds[0][1]), maximumMembers, 'installer/native package bounds must agree');
  assert.ok(Number.isSafeInteger(maximumMembers) && maximumMembers >= 40);
  assert.ok(closure.paths.length >= 40 && closure.paths.length <= maximumMembers);
});
