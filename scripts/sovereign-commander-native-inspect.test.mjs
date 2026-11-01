import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { inspectSovereignControlSystemV1, parseSovereignControlSystemInspectionArgumentsV1 }
  from './sovereign-commander-native-inspect.mjs';
import { projectSovereignControlSystemStatusV1, SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1 }
  from '../shared/agents/sovereignControlSystemStatusV1.mjs';

const HEAD = 'a'.repeat(40), NOW = '2026-10-31T13:00:00.000Z';
const REQUEST = 'control-tower-build-41192328171-1';
const SID = 'S-1-5-21-111111-222222-333333-1001';
const nativeOwner = (extra = {}) => ({ schemaVersion: 'stephanos.maintenance-owner-native-observation.v2',
  pid: 13291, createdAtUtc: '2026-10-31T09:00:00.000Z', observedAtUtc: NOW,
  commandSha256: 'b'.repeat(64), imageSha256: 'c'.repeat(64), ...extra });
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
      readCaller: () => { calls.push('caller'); return { schemaVersion: 'stephanos.sovereign-diagnostic-caller.v1',
        sid: SID, administratorEnabled: false, observedAtUtc: NOW }; },
      readOwner: () => { calls.push('owner'); return nativeOwner(); },
      fetchFn: async (url, options) => {
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

test('completed source-bound observation preserves refusal without granting repair or claiming loaded bytes', async () => {
  const { options, calls } = fixture(), report = await inspectSovereignControlSystemV1(options);
  assert.deepEqual(calls, ['source', 'caller', 'owner', 'health', 'owner', 'native', 'ledger', 'source']);
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
  assert.ok(closure.paths.length <= 256);
});
