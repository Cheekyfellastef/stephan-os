import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { canonicalMobileInstallationReceiptV1, mobileInstallationCandidateDigestV1,
  mobileInstallationChallengeV1 } from '../shared/agents/battleBridgeMobileInstallationV1.mjs';
import {
  MOBILE_INSTALL_NATIVE_MARKER_V1,
  MOBILE_INSTALL_NATIVE_PROBE_SCHEMA_V1,
  MOBILE_INSTALL_NATIVE_CACHE_MS_V1,
  observeBattleBridgeMobileInstallNativeV1,
  parseMobileInstallNativeObservationV1,
  createBattleBridgeMobileInstallationProviderV1,
} from './windows/battle-bridge-mobile-install-native-v1.mjs';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const NOW = Date.parse('2026-11-14T15:00:00.000Z');
const REQUEST_ID = 'mobile-install-caravan-test-0001';
const marker = row => `${MOBILE_INSTALL_NATIVE_MARKER_V1}${JSON.stringify(row)}\r\n`;
function missing(now = NOW) {
  return { schemaVersion: MOBILE_INSTALL_NATIVE_PROBE_SCHEMA_V1,
    observedAtUtc: new Date(now).toISOString(), state: 'MISSING',
    reason: 'MOBILE_INSTALL_ENROLLMENT_MISSING', sameOperator: null,
    interactiveSession: true, fixedTask: null, protectedFiles: null,
    helperSha256: null, installationAuthority: false };
}
function present(now = NOW) {
  return { ...missing(now), state: 'UNQUALIFIED', reason: 'MOBILE_INSTALL_NATIVE_VERIFIER_QUALIFICATION_REQUIRED',
    sameOperator: true, fixedTask: true, protectedFiles: true, helperSha256: 'c'.repeat(64) };
}
function fixture(result, delayMs = 0) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = result.error ? undefined : 99999999;
  let closed = false;
  child.kill = signal => {
    if (!closed) { closed = true; queueMicrotask(() => child.emit('close', null, signal)); }
    return true;
  };
  const emit = () => {
    if (closed) return;
    if (result.error) { child.emit('error', result.error); return; }
    if (result.stdout) child.stdout.emit('data', Buffer.from(result.stdout));
    if (result.stderr) child.stderr.emit('data', Buffer.from(result.stderr));
    if (!closed) { closed = true; child.emit('close', result.status ?? 0, result.signal ?? null); }
  };
  if (delayMs) setTimeout(emit, delayMs); else queueMicrotask(emit);
  return child;
}
const sourceOptions = overrides => ({ expectedMain: HEAD, platform: 'win32', nowMs: NOW, probeSlot: { pending: false },
  spawnFn: () => fixture({ status: 0, stdout: marker(missing()) }), ...overrides });

test('fresh missing observation remains data with no native execution authority', async () => {
  assert.equal(parseMobileInstallNativeObservationV1(marker(missing()), { nowMs: NOW }).state, 'MISSING');
  const observation = await observeBattleBridgeMobileInstallNativeV1(sourceOptions());
  assert.equal(observation.reason, 'MOBILE_INSTALL_ENROLLMENT_MISSING');
  assert.equal(observation.expectedSourceHead, HEAD);
  assert.equal(observation.sourceHead, undefined);
  assert.equal(observation.installationAuthority, false);
  assert.equal(observation.nativeExecutionAvailable, false);
  assert.equal(observation.candidate, null);
  assert.equal(observation.enrollment, null);
  assert.equal(observation.receipt, null);
});

test('forged ready flags, array-coerced hashes and inconsistent structural proof are rejected', () => {
  const attacks = [
    { ...present(), installationAuthority: true }, { ...present(), state: 'READY' },
    { ...present(), state: 'QUALIFIED' }, { ...present(), sameOperator: false },
    { ...present(), fixedTask: false }, { ...present(), interactiveSession: false },
    { ...present(), protectedFiles: null }, { ...present(), helperSha256: '../private' },
    { ...present(), helperSha256: ['c'.repeat(64)] }, { ...present(), elevatedTaskAllowed: true },
    { ...missing(), helperSha256: 'c'.repeat(64) },
    { ...missing(), reason: 'MOBILE_INSTALL_NATIVE_VERIFIER_QUALIFICATION_REQUIRED' },
  ];
  for (const row of attacks)
    assert.equal(parseMobileInstallNativeObservationV1(marker(row), { nowMs: NOW }), null);
});

test('freshness, bounds, duplicate lines, malformed JSON and unknown output fields fail closed', () => {
  for (const stdout of [
    marker(missing(NOW - 30_001)), marker(missing(NOW + 5_001)),
    marker({ ...missing(), observedAtUtc: '2026-02-31T15:00:00.000Z' }),
    marker({ ...missing(), privateLog: 'not public' }),
    marker(missing()) + marker(missing()), 'private log\n' + marker(missing()),
    MOBILE_INSTALL_NATIVE_MARKER_V1 + '{', 'x'.repeat(16_385),
  ]) assert.equal(parseMobileInstallNativeObservationV1(stdout, { nowMs: NOW }), null);
});

test('fixed native invocation has no caller-controlled executable, command, path or environment', async () => {
  let captured;
  const output = await observeBattleBridgeMobileInstallNativeV1(sourceOptions({
    command: 'Start-Process arbitrary.exe', path: 'C:\\untrusted.ps1',
    spawnFn: (...args) => { captured = args; return fixture({ stdout: marker(missing()) }); },
  }));
  assert.equal(captured[0], 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(captured[1].slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.equal(captured[1].length, 5);
  const loader = Buffer.from(captured[1][4], 'base64').toString('utf16le');
  assert.ok(loader.includes('observe-battle-bridge-mobile-install-v1.ps1'));
  assert.ok(loader.includes(createHash('sha256').update(readFileSync(new URL('./windows/observe-battle-bridge-mobile-install-v1.ps1', import.meta.url))).digest('hex')));
  assert.equal(loader.includes('C:\\untrusted.ps1'), false);assert.equal(loader.includes('Start-Process arbitrary.exe'), false);
  assert.equal(/ExecutionPolicy|Bypass/.test(loader), false);
  assert.equal(captured[2].shell, false);
  assert.deepEqual(captured[2].stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(captured[2].env.NODE_OPTIONS, undefined);
  assert.equal(captured[2].env.PSModulePath, undefined);
  assert.equal(output.reason, 'MOBILE_INSTALL_ENROLLMENT_MISSING');
});

test('unsupported platform, malformed source identity and invalid clocks never start a child', async () => {
  const spawnFn = () => assert.fail('unexpected child');
  assert.equal((await observeBattleBridgeMobileInstallNativeV1(sourceOptions({ platform: 'linux', spawnFn }))).reason,
    'MOBILE_INSTALL_WINDOWS_REQUIRED');
  for (const expectedMain of ['', OTHER_HEAD + ';cmd', { head: HEAD }, [HEAD]])
    assert.equal((await observeBattleBridgeMobileInstallNativeV1(sourceOptions({ expectedMain, spawnFn }))).reason,
      'MOBILE_INSTALL_EXACT_SOURCE_REQUIRED');
  for (const nowMs of [NaN, Infinity, 9e15])
    assert.equal((await observeBattleBridgeMobileInstallNativeV1(sourceOptions({ nowMs, spawnFn }))).reason,
      'MOBILE_INSTALL_EXACT_SOURCE_REQUIRED');
});

test('native child failures expose only a typed reason', async () => {
  for (const result of [
    { error: Object.assign(new Error('secret C:\\private\\token.txt'), { code: 'ENOENT' }) },
    { status: 1, stdout: marker(missing()), stderr: 'private-token' },
    { status: 0, signal: 'SIGTERM', stdout: marker(missing()) },
  ]) {
    const observed = await observeBattleBridgeMobileInstallNativeV1(sourceOptions({ spawnFn: () => fixture(result) }));
    assert.equal(observed.reason, 'MOBILE_INSTALL_NATIVE_OBSERVATION_UNPROVEN');
    assert.equal(observed.enrollmentObservation, null);
    assert.doesNotMatch(JSON.stringify(observed), /private|token\.txt|ENOENT/);
  }
});

test('structural task presence never becomes trusted enrollment or a signed receipt', async () => {
  const observed = await observeBattleBridgeMobileInstallNativeV1(sourceOptions({
    spawnFn: () => fixture({ stdout: marker(present()) }),
  }));
  assert.equal(observed.enrollmentObservation.fixedTask, true);
  assert.equal(observed.enrollmentObservation.state, 'UNQUALIFIED');
  assert.equal(observed.enrollment, null);
  assert.equal(observed.receipt, null);
  assert.equal(observed.nativeExecutionAvailable, false);
});

test('concurrent reads coalesce without blocking the event loop; cache keeps original observation time', async () => {
  let now = NOW;
  let calls = 0;
  const provider = createBattleBridgeMobileInstallationProviderV1(sourceOptions({ nowFn: () => now,
    spawnFn: () => { calls++; return fixture({ stdout: marker(missing(now)) }, 40); },
  }));
  let settled = false;
  const batch = Promise.all(Array.from({ length: 12 }, () => provider.observe())).then(rows => { settled = true; return rows; });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(settled, false);
  assert.equal(calls, 1);
  const reads = await batch;
  assert.ok(reads.every(row => row === reads[0]));
  now += MOBILE_INSTALL_NATIVE_CACHE_MS_V1 - 1;
  assert.equal((await provider.observe()).nativeObservation.observedAtUtc, new Date(NOW).toISOString());
  assert.equal(calls, 1);
  now += 1;
  assert.equal((await provider.observe()).nativeObservation.observedAtUtc, new Date(now).toISOString());
  assert.equal(calls, 2);
});

test('approval refuses before dispatch and reconciliation cannot manufacture completion', async () => {
  let calls = 0;
  const provider = createBattleBridgeMobileInstallationProviderV1(sourceOptions({ nowFn: () => NOW,
    spawnFn: () => { calls++; return fixture({ stdout: marker(missing()) }); },
  }));
  const approval = await provider.approve({ requestId: REQUEST_ID,
    assertion: { approved: true }, enrollment: { trusted: true }, command: 'runas' });
  assert.equal(calls, 0);
  assert.equal(approval.accepted, false);
  assert.equal(approval.dispatched, false);
  assert.equal(approval.reason, 'MOBILE_INSTALL_ASSERTION_INVALID');
  assert.equal(approval.requestId, REQUEST_ID);
  const result = await provider.reconcile(REQUEST_ID);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.requestId, REQUEST_ID);
  assert.equal(result.receipt, null);
  assert.equal(calls, 1);
  for (const requestId of ['C:\\private\\secret', [REQUEST_ID]]) {
    const invalid = await provider.reconcile(requestId);
    assert.equal(invalid.requestId, null);
    assert.equal(invalid.reason, 'MOBILE_INSTALL_REQUEST_ID_INVALID');
  }
  assert.equal(calls, 1);
});

function clientFixture() {
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const receiptKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = key => key.export({ format: 'der', type: 'spki' }).toString('base64url');
  const candidate = { schemaVersion: 'stephanos.battle-bridge-mobile-installation-candidate.v1',
    repository: 'Cheekyfellastef/stephan-os', issueNumber: 1814, action: 'INSTALL_SOVEREIGN_FIXED_RUNTIME_V1',
    requestId: REQUEST_ID, nonce: '1'.repeat(64), machineHash: '2'.repeat(64), operatorSid: 'S-1-5-21-1-2-3-1001',
    sourceHead: HEAD, sourceTree: 'b'.repeat(40), packageSha256: '3'.repeat(64), closureSha256: '4'.repeat(64),
    releaseProofSha256: '5'.repeat(64), enrollmentGeneration: 1, requestedAtUtc: new Date(NOW - 1000).toISOString(),
    expiresAtUtc: new Date(NOW + 240_000).toISOString() };
  const enrollment = { schemaVersion: 'stephanos.battle-bridge-mobile-installation-enrollment.v1',
    machineHash: candidate.machineHash, operatorSid: candidate.operatorSid, generation: 1,
    rpId: 'stephanos.example', origin: 'https://bridge.stephanos.example', credentialId: Buffer.alloc(24, 7).toString('base64url'),
    publicKeySpki: spki(device.publicKey), userHandle: Buffer.from('native-client-fixture').toString('base64url'),
    lastSignCount: 0, revoked: false, receiptPublicKeySpki: spki(receiptKey.publicKey) };
  const envelope = (state = 'AWAITING_APPROVAL', sequence = 1, overrides = {}, selectedCandidate = candidate, key = receiptKey.privateKey) => {
    const payload = { schemaVersion: 'stephanos.battle-bridge-mobile-installation-receipt.v1', requestId: selectedCandidate.requestId,
      candidateSha256: mobileInstallationCandidateDigestV1(selectedCandidate), machineHash: selectedCandidate.machineHash,
      enrollmentGeneration: selectedCandidate.enrollmentGeneration, sequence, state, observedAtUtc: new Date(NOW).toISOString(),
      sourceHead: selectedCandidate.sourceHead, packageSha256: selectedCandidate.packageSha256,
      retainedProcessId: ['INSTALLING', 'INSTALLED_PENDING_BOOT', 'READY'].includes(state) ? 4242 : null,
      executionStartedAtUtc: ['INSTALLING', 'INSTALLED_PENDING_BOOT', 'READY'].includes(state) ? new Date(NOW - 100).toISOString() : null,
      installedHelperSha256: ['INSTALLED_PENDING_BOOT', 'READY'].includes(state) ? 'd'.repeat(64) : null,
      installationBootId: ['INSTALLED_PENDING_BOOT', 'READY'].includes(state) ? 'e'.repeat(64) : null,
      qualifiedBootId: state === 'READY' ? 'f'.repeat(64) : null, reasonCode: 'NATIVE_CLIENT_FIXTURE', ...overrides };
    return { payload, signature: sign('sha256', Buffer.from(canonicalMobileInstallationReceiptV1(payload)), key).toString('base64url') };
  };
  const wrap = (receipt = envelope(), selectedCandidate = candidate, returnedEnrollment = enrollment, trusted = enrollment) =>
    'STEPHANOS_MOBILE_INSTALL_CLIENT_V1=' + JSON.stringify({ schemaVersion: 'stephanos.mobile-install-client.v1',
      trustedEnrollmentBase64: Buffer.from(JSON.stringify(trusted)).toString('base64'),
      responseBase64: Buffer.from(JSON.stringify({ schemaVersion: 'stephanos.mobile-install-pipe-response.v1',
        candidate: selectedCandidate, enrollment: returnedEnrollment, receipt })).toString('base64') });
  const clientCalls = [], clientScripts = [];
  const provider = responder => createBattleBridgeMobileInstallationProviderV1(sourceOptions({ nowFn: () => NOW,
    clientSlot: { pending: false }, spawnFn: (exe, args, options) => {
      const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      if (!script.includes('ReadProtectedClientEnrollmentV1')) return fixture({ stdout: marker(present()) });
      clientScripts.push(script);
      assert.equal(exe, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.equal(options.shell, false);assert.equal(options.windowsHide, true);assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
      assert.ok(script.indexOf('ReadProtectedClientEnrollmentV1') < script.indexOf('CallProtectedPipeV1'));
      assert.ok(script.includes('LoadFrom($path)'));assert.ok(script.includes('$file.GetAccessControl()'));
      assert.equal(/Add-Type|CompileAssembly|Start-Process|RunAs/.test(script), false);
      const result = {};const child = fixture(result);child.stdin = new EventEmitter();
      child.stdin.end = wire => {clientCalls.push(wire);Object.assign(result, typeof responder === 'function' ? responder(wire) : { stdout: wrap() });};
      return child;
    },
  }));
  const approval = () => {
    const hash = value => createHash('sha256').update(value).digest();
    const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: mobileInstallationChallengeV1(candidate), origin: enrollment.origin, crossOrigin: false }));
    const auth = Buffer.concat([hash(enrollment.rpId), Buffer.from([5]), Buffer.from([0, 0, 0, 1])]);
    return { type: 'public-key', id: enrollment.credentialId, rawId: enrollment.credentialId, response: {
      clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'),
      signature: sign('sha256', Buffer.concat([auth, hash(client)]), device.privateKey).toString('base64url'), userHandle: null } };
  };
  return { candidate, enrollment, envelope, wrap, provider, approval, clientCalls, clientScripts, receiptKey };
}

test('qualified native client verifies independent enrollment and real receipt signatures with fixed unprivileged transport', async () => {
  const f = clientFixture();const provider = f.provider();const observed = await provider.observe();
  assert.equal(observed.nativeExecutionAvailable, true);assert.equal(observed.minimumSequence, 1);
  assert.equal(observed.status, 'AWAITING_APPROVAL');assert.equal(observed.installationAuthority, false);
  assert.ok(Object.isFrozen(observed.candidate));assert.ok(Object.isFrozen(observed.receipt.payload));
  assert.deepEqual(f.clientCalls, ['STEPHANOS_MOBILE_INSTALL_PIPE_V1|PREPARE']);
});

test('signed source/package/request movement and self-selected response key cannot widen trust', async () => {
  const f = clientFixture();const other = clientFixture();
  const moved = { ...f.candidate, sourceHead: OTHER_HEAD };
  const attacks = [
    f.wrap(f.envelope('AWAITING_APPROVAL', 1, {}, moved), moved),
    f.wrap(other.envelope(), f.candidate, other.enrollment),
    f.wrap({ ...f.envelope(), signature: 'A'.repeat(86) }),
    f.wrap(f.envelope('READY', 1)),
    f.wrap(f.envelope('AWAITING_APPROVAL', 1, { packageSha256: '9'.repeat(64) })),
  ];
  for (const output of attacks) {
    const provider = f.provider(() => ({ stdout: output }));const observed = await provider.observe();
    assert.equal(observed.nativeExecutionAvailable, false);assert.equal(observed.receipt, null);assert.equal(observed.status, 'UNKNOWN');
  }
});

test('approval dispatch sends only the original assertion and never automatically repeats after possible write', async () => {
  const f = clientFixture();const provider = f.provider(wire => ({ stdout: f.wrap(wire.includes('|APPROVE|') ? f.envelope('INSTALLING', 2) : f.envelope()) }));
  await provider.observe();const assertion = f.approval();
  const approved = await provider.approve({ requestId: REQUEST_ID, assertion });
  assert.equal(approved.dispatched, true);assert.equal(approved.status, 'INSTALLING');
  const parts = f.clientCalls.at(-1).split('|');assert.deepEqual(parts.slice(0, 3), ['STEPHANOS_MOBILE_INSTALL_PIPE_V1', 'APPROVE', REQUEST_ID]);
  assert.deepEqual(JSON.parse(Buffer.from(parts[3], 'base64').toString('utf8')), assertion);
  const count = f.clientCalls.length;const second = await provider.approve({ requestId: REQUEST_ID, assertion });
  assert.equal(second.dispatched, false);assert.equal(second.status, 'UNKNOWN');assert.equal(f.clientCalls.length, count);
});

test('lost native approval acknowledgement holds the same request and read-only reconciliation rejects rollback', async () => {
  const f = clientFixture();let sequence = 5;
  const provider = f.provider(wire => wire.includes('|APPROVE|') ? { stderr: 'private C:\\secret-fixture', status: 1 }
    : { stdout: f.wrap(f.envelope('AWAITING_APPROVAL', sequence)) });
  await provider.observe();const first = await provider.approve({ requestId: REQUEST_ID, assertion: f.approval() });
  assert.equal(first.status, 'UNKNOWN');assert.equal(first.dispatched, true);assert.equal(JSON.stringify(first).includes('secret-fixture'), false);
  const before = f.clientCalls.length;await provider.approve({ requestId: REQUEST_ID, assertion: f.approval() });assert.equal(f.clientCalls.length, before);
  sequence = 4;const stale = await provider.reconcile(REQUEST_ID);assert.equal(stale.status, 'UNKNOWN');assert.equal(stale.receipt, null);
});

test('native cancellation is the closed original-request verb, never an installation or approval flag', async () => {
  const f = clientFixture();const provider = f.provider(wire => ({ stdout: f.wrap(wire.includes('|CANCEL|') ? f.envelope('CANCELLED', 2) : f.envelope()) }));
  await provider.observe();const cancelled = await provider.cancel(REQUEST_ID);assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(f.clientCalls.at(-1), 'STEPHANOS_MOBILE_INSTALL_PIPE_V1|CANCEL|' + REQUEST_ID);
  const before = f.clientCalls.length;await provider.cancel('C:\\not-a-request');assert.equal(f.clientCalls.length, before);
});

test('Windows parses the fixed protected client without loading or invoking protected code',
  { skip: process.platform !== 'win32' }, async () => {
    const f = clientFixture();await f.provider().observe();
    const encoded = Buffer.from(f.clientScripts[0], 'utf16le').toString('base64');
    const script = `$source=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'));` +
      `$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);` +
      `if($errors.Count -gt 0){exit 1};[Console]::Write('CLIENT_PARSE_OK')`;
    const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000, maxBuffer: 8192 });
    assert.equal(result.status, 0, result.stderr);assert.equal(result.stdout, 'CLIENT_PARSE_OK');
  });

test('output cap terminates and reaps a real overproducing child', async () => {
  let childPid;
  const observed = await observeBattleBridgeMobileInstallNativeV1(sourceOptions({ spawnFn: (_exe, _args, options) => {
    const child = spawn(process.execPath, ['-e', "process.stdout.write('x'.repeat(20000));setInterval(()=>{},1000)"], options);
    childPid = child.pid;
    return child;
  } }));
  assert.equal(observed.reason, 'MOBILE_INSTALL_NATIVE_OBSERVATION_UNPROVEN');
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
});

test('timeout terminates and reaps a real stalled child while event loop remains responsive', async () => {
  let childPid;
  let responsive = false;
  const observation = observeBattleBridgeMobileInstallNativeV1(sourceOptions({ spawnFn: (_exe, _args, options) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
    childPid = child.pid;
    return child;
  } }));
  await new Promise(resolve => setTimeout(() => { responsive = true; resolve(); }, 5));
  assert.equal(responsive, true);
  const observed = await observation;
  assert.equal(observed.reason, 'MOBILE_INSTALL_NATIVE_OBSERVATION_UNPROVEN');
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
});

test('uncertain termination returns bounded UNKNOWN while retaining the process slot', async () => {
  const slot = { pending: false };
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 99999999;
  child.kill = () => { throw new Error('termination unavailable'); };
  let starts = 0;
  const options = sourceOptions({ probeSlot: slot, spawnFn: () => {
    starts++;
    queueMicrotask(() => child.stdout.emit('data', Buffer.alloc(20_000)));
    return child;
  } });
  const keepAlive = setInterval(() => {}, 50);
  try {
    const observed = await observeBattleBridgeMobileInstallNativeV1(options);
    assert.equal(observed.reason, 'MOBILE_INSTALL_NATIVE_OBSERVER_PROCESS_HELD');
    assert.equal(slot.pending, true);
    assert.equal((await observeBattleBridgeMobileInstallNativeV1(options)).reason,
      'MOBILE_INSTALL_NATIVE_OBSERVER_PROCESS_HELD');
    assert.equal(starts, 1);
    child.emit('close', null, 'SIGKILL');
    assert.equal(slot.pending, false);
    const next = await observeBattleBridgeMobileInstallNativeV1({ ...options,
      spawnFn: () => fixture({ stdout: marker(missing()) }),
    });
    assert.equal(next.reason, 'MOBILE_INSTALL_ENROLLMENT_MISSING');
  } finally { clearInterval(keepAlive); child.emit('close', null, 'SIGKILL'); }
});

test('Windows PowerShell parses the observer without executing it', { skip: process.platform !== 'win32' }, () => {
  const path = fileURLToPath(new URL('./windows/observe-battle-bridge-mobile-install-v1.ps1', import.meta.url));
  const escaped = path.replaceAll("'", "''");
  const script = `$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$tokens,[ref]$errors);if($errors.Count -gt 0){exit 1};[Console]::Write('PARSE_OK')`;
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000, maxBuffer: 4096 });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'PARSE_OK');
});

test('fixed hash-bound observer runs under process Restricted policy and refuses changed source pin',
  { skip: process.platform !== 'win32', timeout: 15_000 }, async () => {
  let args;
  await observeBattleBridgeMobileInstallNativeV1(sourceOptions({ spawnFn: (_exe, selected) => {
    args = selected;return fixture({ stdout: marker(missing()) });
  } }));
  const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
  const run = code => spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Restricted', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')],
    { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000, maxBuffer: 8192 });
  const allowed = run(script);assert.equal(allowed.status, 0);assert.ok(allowed.stdout.startsWith(MOBILE_INSTALL_NATIVE_MARKER_V1));
  const expected = createHash('sha256').update(readFileSync(new URL('./windows/observe-battle-bridge-mobile-install-v1.ps1', import.meta.url))).digest('hex');
  const refused = run(script.replace(expected, '0'.repeat(64)));assert.notEqual(refused.status, 0);assert.equal(refused.stdout, '');
});

test('fresh Windows NoProfile observer emits the actual read-only protocol without module autoload',
  { skip: process.platform !== 'win32', timeout: 15_000 }, async () => {
  const observed = await observeBattleBridgeMobileInstallNativeV1({ expectedMain: HEAD });
  assert.ok(observed.enrollmentObservation, 'the real script must produce valid bounded JSON');
  assert.equal(observed.enrollmentObservation.schemaVersion, MOBILE_INSTALL_NATIVE_PROBE_SCHEMA_V1);
  assert.ok(['MISSING', 'UNPROVEN', 'UNQUALIFIED'].includes(observed.enrollmentObservation.state));
  assert.equal(observed.installationAuthority, false);
  assert.equal(observed.nativeExecutionAvailable, false);
  assert.equal(observed.receipt, null);
});
