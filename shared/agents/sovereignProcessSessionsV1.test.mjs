import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

let moduleNumber = 0;
const fresh = () => import(new URL(`./sovereignProcessSessionsV1.mjs?fixture=${++moduleNumber}`, import.meta.url));
const START = 'START_PROCESS_SESSION', READ = 'READ_PROCESS_OUTPUT', LIST = 'LIST_SESSIONS', CANCEL = 'CANCEL_PROCESS_SESSION';
const PROFILE = 'status-recovery-mesh';
const environment = { USERPROFILE: 'C:\\Users\\process-fixture', SYSTEMROOT: 'C:\\Windows',
  TEMP: tmpdir(), TMP: tmpdir(), NODE_OPTIONS: '--inspect', PSModulePath: 'C:\\untrusted',
  TOKEN: 'must-not-be-inherited', PATH: 'C:\\untrusted', STEPHANOS_UNTRUSTED: 'must-not-be-inherited' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, timeout = 1000) => {
  const deadline = Date.now() + timeout;
  for (;;) { const result = await fn(); if (result) return result; assert.ok(Date.now() < deadline, 'bounded fixture wait'); await wait(5); }
};
function childFixture({ pid = 12345, killCloses = true, missingStreams = false, killError = false } = {}) {
  const child = new EventEmitter();
  child.pid = pid; child.stdin = null;
  child.stdout = missingStreams ? null : new PassThrough();
  child.stderr = missingStreams ? null : new PassThrough();
  child.kills = 0;
  child.finish = (code = 0, signal = null) => {
    child.emit('exit', code, signal); child.stdout?.end(); child.stderr?.end(); child.emit('close', code, signal);
  };
  child.kill = () => {
    child.kills++;
    if (killError) child.emit('error', Object.assign(new Error('private error must not escape'), { code: 'EPERM' }));
    if (killCloses) child.finish(null, 'SIGTERM');
    return !killError;
  };
  return child;
}
function makeService(module, child, options = {}) {
  return module.createSovereignProcessSessionsV1({ platform: 'win32', environment,
    terminationGraceMs: 5, timeoutMs: 1000,
    spawnFn: () => { queueMicrotask(() => child.emit('spawn')); return child; }, ...options });
}

test('strict argument capture excludes inherited/getter/authority input and normalizes bounded pages', async () => {
  const { validateSovereignProcessSessionArgumentsV1: validate } = await fresh();
  const invalid = [null, [], Object.create({ profile: PROFILE }), { profile: PROFILE, command: 'whoami' },
    { profile: PROFILE, env: {} }, { profile: PROFILE, pid: 42 }, { profile: 'repair-stephanos' },
    { profile: 'STATUS-RECOVERY-MESH' }, { profile: PROFILE, [Symbol('extra')]: true }];
  for (const args of invalid) assert.equal(validate(START, args).ok, false);
  const getter = {}; Object.defineProperty(getter, 'profile', { get() { assert.fail('getter evaluated'); } });
  assert.equal(validate(START, getter).ok, false);
  assert.equal(validate('START_PROCESS', { profile: PROFILE }).ok, false);
  const sessionId = 'process-11111111-2222-3333-4444-555555555555';
  assert.deepEqual(validate(READ, { sessionId }).args, { sessionId, offset: 0, limit: 20 });
  for (const args of [{ sessionId, offset: -1 }, { sessionId, offset: 257 }, { sessionId, limit: 51 },
    { sessionId, limit: '20' }, { sessionId, limit: undefined }, { sessionId, offset: NaN }, { sessionId, pid: 3 }])
    assert.equal(validate(READ, args).ok, false);
  assert.equal(validate(LIST, { other: true }).ok, false);
  assert.deepEqual(validate(CANCEL, { sessionId }).args, { sessionId });
  for (const args of [{}, { sessionId: '12345' }, { sessionId, pid: 12345 },
    { sessionId, signal: 'SIGKILL' }, { sessionId, profile: PROFILE }, { sessionId, offset: 0 },
    { sessionId, limit: 1 }, { sessionId, [Symbol('extra')]: true }, Object.create({ sessionId })])
    assert.equal(validate(CANCEL, args).ok, false);
  const cancelGetter = {}; Object.defineProperty(cancelGetter, 'sessionId', { get() { assert.fail('getter evaluated'); } });
  assert.equal(validate(CANCEL, cancelGetter).ok, false);
  const captured = validate(START, { profile: PROFILE }); assert.ok(Object.isFrozen(captured.args));
});

test('launch uses captured pinned bytes, fixed executable/modules/environment and ignored stdin', async t => {
  const module = await fresh(), child = childFixture();
  let launch;
  const service = makeService(module, child, { spawnFn: (...args) => {
    launch = args; queueMicrotask(() => child.emit('spawn')); return child;
  } });
  t.after(() => service.dispose());
  const result = await service.execute(START, { profile: PROFILE });
  assert.equal(result.ok, true); assert.equal(result.launchState, 'SPAWN_OBSERVED');
  const [exe, argv, options] = launch;
  assert.equal(exe, module.SOVEREIGN_PROCESS_SESSION_EXECUTABLE_V1);
  assert.deepEqual(argv.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
  assert.equal(options.shell, false); assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(options.env.USERPROFILE, environment.USERPROFILE);
  assert.equal(options.env.PSModulePath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  for (const key of ['NODE_OPTIONS', 'TOKEN', 'STEPHANOS_UNTRUSTED']) assert.equal(Object.hasOwn(options.env, key), false);
  const wrapper = Buffer.from(argv[5], 'base64').toString('utf16le');
  assert.match(wrapper, /PSModuleAutoLoadingPreference='None'/);
  assert.match(wrapper, /ScheduledTasks\\ScheduledTasks\.psd1/);
  assert.match(wrapper, /Microsoft\.PowerShell\.Utility/);
  assert.match(wrapper, /Microsoft\.PowerShell\.Management/);
  assert.match(wrapper, /& \(\[scriptblock\]::Create/);
  const encoded = wrapper.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)[1];
  const captured = Buffer.from(encoded, 'base64');
  assert.match(captured.toString('utf8'), /^\[CmdletBinding\(\)\]\nparam\(\)/);
  assert.equal(createHash('sha256').update(captured).digest('hex'), module.SOVEREIGN_PROCESS_SESSION_PROFILES_V1[PROFILE].scriptSha256);
  assert.equal(wrapper.includes(environment.USERPROFILE), false);
  child.finish();
});

test('platform, absent profile and changed script are known no-launch refusals', async () => {
  const module = await fresh(); let spawns = 0;
  for (const options of [{ platform: 'linux' }, { environment: {} },
    { readFileSyncFn: () => Buffer.from('changed script') }, { readFileSyncFn: () => { throw Error('private path'); } }]) {
    const service = module.createSovereignProcessSessionsV1({ platform: 'win32', environment,
      spawnFn: () => { spawns++; assert.fail('must not spawn'); }, ...options });
    const result = await service.execute(START, { profile: PROFILE });
    assert.equal(result.ok, false); assert.equal(result.launchState, 'NOT_STARTED');
    assert.equal(JSON.stringify(result).includes('private path'), false);
    await service.dispose();
  }
  assert.equal(spawns, 0);
});

test('actual output is readable before a real child exits, including split UTF-8', async t => {
  const module = await fresh(); let nativeChild;
  const fixture = `process.stdout.write('first\\n');process.stdout.write(Buffer.from([0xf0,0x9f]));setTimeout(()=>process.stdout.write(Buffer.from([0xa6,0x8a,10])),30);setTimeout(()=>process.stderr.write('stderr\\n'),40);setTimeout(()=>process.exit(0),650);`;
  const service = module.createSovereignProcessSessionsV1({ platform: 'win32', environment, timeoutMs: 2000,
    spawnFn: () => nativeChild = spawn(process.execPath, ['-e', fixture], { stdio: ['ignore', 'pipe', 'pipe'] }) });
  t.after(async () => { await service.dispose(); if (nativeChild?.exitCode === null) nativeChild.kill(); });
  const started = await service.execute(START, { profile: PROFILE });
  assert.equal(started.ok, true); assert.equal(started.session.state, 'RUNNING');
  const early = await until(async () => {
    const page = await service.execute(READ, { sessionId: started.sessionId });
    return page.chunks.map(row => row.text).join('').includes('🦊') && page.chunks.some(row => row.stream === 'stderr') ? page : null;
  });
  assert.equal(nativeChild.exitCode, null); assert.equal(early.session.stdioClosed, false);
  assert.equal(early.outputComplete, false); assert.equal(early.session.outcome, 'PENDING');
  assert.equal(early.session.descendantsExcluded, false);
  assert.match(early.chunks.filter(row => row.stream === 'stdout').map(row => row.text).join(''), /first\n🦊\n/);
  const terminal = await until(async () => {
    const page = await service.execute(READ, { sessionId: started.sessionId }); return page.session.stdioClosed ? page : null;
  }, 3000);
  assert.equal(terminal.session.state, 'CLOSED'); assert.equal(terminal.session.outcome, 'SUCCEEDED');
  assert.equal(terminal.session.rootExitObserved, true); assert.equal(terminal.outputComplete, true);
  assert.equal(terminal.session.nativeCustodyQualified, false); assert.equal(terminal.session.maintenanceCustodyReleased, false);
  assert.equal(started.session.state, 'RUNNING'); assert.equal(started.session.stdioClosed, false);
});

test('pages are stable detached snapshots and sessions are private to their handler', async t => {
  const module = await fresh(), child = childFixture();
  const service = makeService(module, child), other = makeService(module, childFixture());
  t.after(async () => { await service.dispose(); await other.dispose(); });
  const start = await service.execute(START, { profile: PROFILE });
  child.stdout.write('one\n'); child.stderr.write('two\n');
  const page1 = await service.execute(READ, { sessionId: start.sessionId, limit: 1 });
  assert.equal(page1.offset, 0); assert.equal(page1.nextOffset, 1); assert.equal(page1.hasMore, true);
  assert.equal(page1.chunks[0].sequence, 0); assert.equal(page1.chunks[0].text, 'one\n');
  child.stdout.write('three\n');
  assert.deepEqual((await service.execute(READ, { sessionId: start.sessionId, limit: 1 })).chunks, page1.chunks);
  const page2 = await service.execute(READ, { sessionId: start.sessionId, offset: 1 });
  assert.deepEqual(page2.chunks.map(row => row.text), ['two\n', 'three\n']);
  assert.equal(page1.session.nextOffset, 2); assert.equal(page1.session.stdioClosed, false);
  assert.throws(() => { page1.chunks[0].text = 'changed'; }, TypeError);
  assert.equal((await other.execute(READ, { sessionId: start.sessionId })).ok, false);
  assert.deepEqual((await other.execute(LIST, {})).sessions, []);
  const listed = await service.execute(LIST, {});
  assert.equal(listed.sessions.length, 1); assert.equal(Object.hasOwn(listed.sessions[0], 'chunks'), false);
  assert.equal((await service.execute(READ, { sessionId: start.sessionId, offset: 5 })).ok, false);
  child.finish();
});

test('root exit without close does not release global capacity or imply complete output', async t => {
  const module = await fresh(), children = [childFixture({ killCloses: false }), childFixture({ killCloses: false }), childFixture()];
  const services = children.map(child => makeService(module, child)); t.after(async () => { for (const child of children) child.finish(); for (const service of services) await service.dispose(); });
  const first = await services[0].execute(START, { profile: PROFILE });
  await services[1].execute(START, { profile: PROFILE });
  children[0].emit('exit', 0, null);
  const page = await services[0].execute(READ, { sessionId: first.sessionId });
  assert.equal(page.session.state, 'ROOT_EXITED'); assert.equal(page.session.rootExitObserved, true);
  assert.equal(page.session.stdioClosed, false); assert.equal(page.outputComplete, false);
  assert.equal((await services[2].execute(START, { profile: PROFILE })).blocker, 'SOVEREIGN_PROCESS_CAPACITY_HELD');
  children[0].emit('close', 0, null);
  assert.equal((await services[2].execute(START, { profile: PROFILE })).ok, true);
});

test('disposal discards private output and retains uncertain native capacity until actual close', async () => {
  const module = await fresh(), a = childFixture({ killCloses: false, killError: true }), b = childFixture({ killCloses: false });
  const sa = makeService(module, a), sb = makeService(module, b), c = childFixture(), sc = makeService(module, c);
  const started = await sa.execute(START, { profile: PROFILE }); await sb.execute(START, { profile: PROFILE });
  a.stdout.write('private-before-close'); await sa.dispose(); await wait(10);
  a.stdout.write('private-after-close');
  assert.equal((await sa.execute(READ, { sessionId: started.sessionId })).ok, false);
  assert.equal((await sa.execute(LIST, {})).blocker, 'SOVEREIGN_PROCESS_SESSION_CLOSED');
  assert.ok(a.kills >= 1); assert.equal((await sc.execute(START, { profile: PROFILE })).blocker, 'SOVEREIGN_PROCESS_CAPACITY_HELD');
  a.emit('close', null, 'SIGTERM'); assert.equal((await sc.execute(START, { profile: PROFILE })).ok, true);
  b.finish(); c.finish(); await sb.dispose(); await sc.dispose();
});

test('pre-spawn EMFILE with null streams releases admission; missing streams after spawn stay unknown', async () => {
  const module = await fresh();
  const failed = childFixture({ pid: undefined, missingStreams: true }); failed.pid = undefined;
  const service = makeService(module, failed, { spawnFn: () => { queueMicrotask(() => failed.emit('error', { code: 'EMFILE' })); return failed; } });
  const result = await service.execute(START, { profile: PROFILE });
  assert.equal(result.ok, false); assert.equal(result.launchState, 'NOT_STARTED'); assert.equal(result.session.state, 'FAILED_TO_START');
  const missing = childFixture({ pid: undefined, missingStreams: true, killCloses: false }); missing.pid = undefined;
  const second = makeService(module, missing);
  const unknown = await second.execute(START, { profile: PROFILE });
  assert.equal(unknown.ok, false); assert.equal(unknown.launchState, 'SPAWN_OBSERVED');
  assert.equal(unknown.blocker, 'SOVEREIGN_PROCESS_SETUP_UNPROVEN');
  missing.emit('close', null, 'SIGTERM'); await service.dispose(); await second.dispose();
});

test('post-spawn kill EPERM and timeout retain admission; neither is a no-launch refusal', async t => {
  const module = await fresh(), children = [childFixture({ killCloses: false, killError: true }), childFixture({ killCloses: false })];
  const a = makeService(module, children[0], { timeoutMs: 15 }), b = makeService(module, children[1], { timeoutMs: 15 });
  const services = [a, b];
  t.after(async () => {
    for (const child of children) child.finish(null, 'SIGTERM');
    for (const service of services) await service.dispose();
  });
  const first = await a.execute(START, { profile: PROFILE }); await b.execute(START, { profile: PROFILE });
  const state = await until(async () => {
    const observed = (await a.execute(READ, { sessionId: first.sessionId })).session;
    return observed.terminationUnproven ? observed : null;
  });
  assert.equal(state.state, 'UNKNOWN'); assert.equal(state.launchState, 'SPAWN_OBSERVED');
  assert.equal(state.terminationUnproven, true); assert.equal(state.stdioClosed, false);
  const c = makeService(module, childFixture()); services.push(c);
  assert.equal((await c.execute(START, { profile: PROFILE })).blocker, 'SOVEREIGN_PROCESS_CAPACITY_HELD');
});

test('opaque synchronous spawn throws cannot manufacture process exit or free admission', async () => {
  const module = await fresh();
  const services = Array.from({ length: 3 }, () => module.createSovereignProcessSessionsV1({ platform: 'win32', environment,
    terminationGraceMs: 1, spawnFn: () => { throw Error('opaque private native error'); } }));
  for (const service of services.slice(0, 2)) {
    const result = await service.execute(START, { profile: PROFILE });
    assert.equal(result.launchState, 'UNKNOWN'); assert.equal(result.retryAllowed, false);
    assert.equal(result.session.stdioClosed, false); assert.equal(JSON.stringify(result).includes('opaque private'), false);
    await service.dispose();
  }
  assert.equal((await services[2].execute(START, { profile: PROFILE })).blocker, 'SOVEREIGN_PROCESS_CAPACITY_HELD');
  await services[2].dispose(); await wait(5);
});

test('session capacity, terminal TTL and active expiry preserve bounded honest lifecycle', async () => {
  const module = await fresh(); let clock = 1000, current;
  const service = module.createSovereignProcessSessionsV1({ platform: 'win32', environment, nowFn: () => clock, ttlMs: 20,
    terminationGraceMs: 1, spawnFn: () => { current = childFixture(); queueMicrotask(() => current.emit('spawn')); return current; } });
  for (let i = 0; i < 4; i++) { assert.equal((await service.execute(START, { profile: PROFILE })).ok, true); current.finish(); }
  assert.equal((await service.execute(START, { profile: PROFILE })).blocker, 'SOVEREIGN_PROCESS_SESSION_CAPACITY_HELD');
  clock = 1021; assert.deepEqual((await service.execute(LIST, {})).sessions, []);
  const again = await service.execute(START, { profile: PROFILE }); assert.equal(again.ok, true);
  current.kill = () => false; clock = 1042;
  assert.deepEqual((await service.execute(LIST, {})).sessions, []);
  assert.equal((await service.execute(READ, { sessionId: again.sessionId })).ok, false);
  current.emit('close', null, 'SIGTERM'); await service.dispose();
});

test('bounded output/chunks/pages are explicit and overflow never reports complete output', async () => {
  const module = await fresh(), child = childFixture({ killCloses: false });
  const service = makeService(module, child);
  const start = await service.execute(START, { profile: PROFILE });
  child.stdout.write('\u0001'.repeat(12000));
  const page = await service.execute(READ, { sessionId: start.sessionId, limit: 50 });
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= module.SOVEREIGN_PROCESS_SESSION_LIMITS_V1.pageBytes);
  assert.equal(page.hasMore, true);
  child.stderr.write('x'.repeat(10000));
  const overflow = await service.execute(READ, { sessionId: start.sessionId, offset: page.nextOffset });
  assert.equal(overflow.outputTruncated, true); assert.equal(overflow.outputComplete, false);
  assert.ok(overflow.session.outputBytesStored <= 16384); assert.equal(overflow.session.outcome, 'UNKNOWN');
  child.emit('close', null, 'SIGTERM'); await service.dispose();
  const secondModule = await fresh(), many = childFixture({ killCloses: false }), second = makeService(secondModule, many);
  const manyStart = await second.execute(START, { profile: PROFILE });
  for (let i = 0; i < 300; i++) many.stdout.write('a');
  const limited = await second.execute(READ, { sessionId: manyStart.sessionId });
  assert.equal(limited.session.nextOffset, 256); assert.equal(limited.outputTruncated, true);
  many.emit('close', null, 'SIGTERM'); await second.dispose();
});

test('encoding errors, setup exceptions and close-before-spawn remain fixed-code uncertainty', async () => {
  const module = await fresh(), child = childFixture(); const service = makeService(module, child);
  const start = await service.execute(START, { profile: PROFILE }); child.stdout.write(Buffer.from([0xff]));
  const invalid = await service.execute(READ, { sessionId: start.sessionId });
  assert.equal(invalid.session.outcome, 'UNKNOWN'); assert.equal(invalid.outputComplete, false);
  assert.equal(invalid.session.blocker, 'SOVEREIGN_PROCESS_OUTPUT_ENCODING_INVALID'); await service.dispose();
  const early = childFixture();
  const closing = makeService(module, early, { spawnFn: () => { queueMicrotask(() => early.finish()); return early; } });
  const result = await closing.execute(START, { profile: PROFILE });
  assert.equal(result.ok, false); assert.equal(result.launchState, 'UNKNOWN'); assert.equal(result.session.stdioClosed, true);
  const setup = childFixture({ killCloses: false }); setup.stdout.on = () => { throw Error('secret setup error'); };
  const broken = makeService(module, setup);
  const setupResult = await broken.execute(START, { profile: PROFILE });
  assert.equal(setupResult.ok, false); assert.equal(setupResult.launchState, 'UNKNOWN');
  assert.equal(JSON.stringify(setupResult).includes('secret setup'), false);
  setup.emit('close', null, 'SIGTERM'); await broken.dispose(); await closing.dispose();
});

test('owned cancellation records one signal attempt and reports later root exit and close separately', async t => {
  const module = await fresh(), child = childFixture({ killCloses: false });
  const service = makeService(module, child, { terminationGraceMs: 1000 });
  t.after(async () => { child.finish(); await service.dispose(); });
  const started = await service.execute(START, { profile: PROFILE });
  // Authority is the method captured from this direct child, never a PID or a
  // method replacement obtained from subsequent requests or mutable handles.
  child.kill = () => assert.fail('replacement kill must not be called');
  const first = await service.execute(CANCEL, { sessionId: started.sessionId });
  assert.equal(first.ok, true); assert.equal(first.cancellationState, 'REQUESTED');
  assert.equal(first.requestRecorded, true); assert.equal(first.cancellationRequested, true);
  assert.equal(first.signalAttempted, true); assert.equal(first.signalAttemptResult, 'KILL_RETURNED_TRUE');
  assert.equal(first.rootExitObserved, false); assert.equal(first.stdioClosed, false);
  assert.equal(first.terminationCause, 'SOVEREIGN_PROCESS_CANCEL_REQUESTED');
  assert.equal(first.retryAllowed, false); assert.equal(child.kills, 1);
  const repeated = await service.execute(CANCEL, { sessionId: started.sessionId });
  assert.equal(repeated.cancellationState, 'REQUESTED'); assert.equal(repeated.requestRecorded, false);
  assert.equal(child.kills, 1);
  child.emit('exit', null, 'SIGTERM');
  const exited = await service.execute(CANCEL, { sessionId: started.sessionId });
  assert.equal(exited.rootExitObserved, true); assert.equal(exited.stdioClosed, false);
  assert.equal(exited.cancellationState, 'REQUESTED'); assert.equal(child.kills, 1);
  child.emit('close', null, 'SIGTERM');
  const terminal = await service.execute(CANCEL, { sessionId: started.sessionId });
  assert.equal(terminal.cancellationState, 'ROOT_EXIT_AND_STDIO_CLOSED');
  assert.equal(terminal.rootExitObserved, true); assert.equal(terminal.stdioClosed, true);
  assert.equal(terminal.requestRecorded, false); assert.equal(child.kills, 1);
  assert.equal(terminal.session.outcome, 'UNKNOWN'); assert.equal(terminal.session.outputComplete, false);
  const page = await service.execute(READ, { sessionId: started.sessionId });
  const listed = await service.execute(LIST, {});
  assert.equal(page.session.cancellationRequested, true);
  assert.equal(listed.sessions[0].signalAttemptResult, 'KILL_RETURNED_TRUE');
  assert.equal(first.session.stdioClosed, false);
  for (const receipt of [first, repeated, exited, terminal]) {
    assert.equal(receipt.operation, CANCEL);
    assert.equal(receipt.rootExitObserved, receipt.session.rootExitObserved);
    assert.equal(receipt.stdioClosed, receipt.session.stdioClosed);
    for (const key of ['nativeCustodyQualified', 'descendantsExcluded', 'maintenanceCustodyReleased']) {
      assert.equal(receipt[key], false); assert.equal(receipt.session[key], false);
    }
    assert.equal(Object.hasOwn(receipt.session, 'pid'), false);
  }
});

test('post-attempt snapshots reflect synchronous close regardless of the kill return value', async () => {
  for (const returned of [true, false]) {
    const module = await fresh(), child = childFixture();
    child.kill = () => { child.kills++; child.finish(null, 'SIGTERM'); return returned; };
    const service = makeService(module, child);
    const started = await service.execute(START, { profile: PROFILE });
    const receipt = await service.execute(CANCEL, { sessionId: started.sessionId });
    assert.equal(receipt.cancellationState, 'ROOT_EXIT_AND_STDIO_CLOSED');
    assert.equal(receipt.requestRecorded, true); assert.equal(receipt.rootExitObserved, true);
    assert.equal(receipt.stdioClosed, true);
    assert.equal(receipt.signalAttemptResult, returned ? 'KILL_RETURNED_TRUE' : 'KILL_RETURNED_FALSE');
    assert.equal(child.kills, 1);
    assert.equal((await service.execute(CANCEL, { sessionId: started.sessionId })).requestRecorded, false);
    assert.equal(child.kills, 1); await service.dispose();
  }
});

test('already-terminal and close-without-root-proof remain different cancellation observations', async () => {
  for (const mode of ['normal', 'pre-spawn-denied', 'close-unproven']) {
    const module = await fresh(), child = childFixture({ killCloses: false });
    const service = makeService(module, child, mode === 'pre-spawn-denied' ? {
      spawnFn: () => { child.pid = undefined; queueMicrotask(() => child.emit('error', { code: 'ENOENT' })); return child; },
    } : {});
    const started = await service.execute(START, { profile: PROFILE });
    if (mode === 'normal') child.finish();
    if (mode === 'close-unproven') child.emit('close', null, null);
    const receipt = await service.execute(CANCEL, { sessionId: started.sessionId });
    assert.equal(receipt.requestRecorded, false); assert.equal(receipt.cancellationRequested, false);
    assert.equal(receipt.signalAttempted, false); assert.equal(child.kills, 0);
    if (mode === 'close-unproven') {
      assert.equal(receipt.cancellationState, 'UNKNOWN'); assert.equal(receipt.ok, false);
      assert.equal(receipt.rootExitObserved, false); assert.equal(receipt.stdioClosed, true);
    } else {
      assert.equal(receipt.cancellationState, 'ALREADY_TERMINAL');
      assert.equal(receipt.terminalReason, mode === 'normal' ? 'ROOT_EXIT_AND_STDIO_CLOSED' : 'PROVEN_NO_SPAWN');
      assert.equal(receipt.rootExitObserved, mode === 'normal');
      assert.equal(receipt.terminationCause, null);
    }
    await service.dispose();
  }
});

test('false, thrown, unrecognized and error-emitting kill outcomes stay UNKNOWN without repeat signalling', async () => {
  for (const mode of ['false', 'throw', 'unrecognized', 'EPERM', 'ENOENT']) {
    const module = await fresh(), child = childFixture({ killCloses: false });
    child.kill = () => {
      child.kills++;
      if (mode === 'throw') throw Error('private-kill-error-sentinel');
      if (mode === 'EPERM' || mode === 'ENOENT') child.emit('error', { code: mode });
      return mode === 'false' ? false : mode === 'unrecognized' ? undefined : true;
    };
    const service = makeService(module, child, { terminationGraceMs: 1000 });
    const started = await service.execute(START, { profile: PROFILE });
    const receipt = await service.execute(CANCEL, { sessionId: started.sessionId });
    assert.equal(receipt.ok, false, mode); assert.equal(receipt.cancellationState, 'UNKNOWN', mode);
    assert.equal(receipt.requestRecorded, true, mode); assert.equal(receipt.signalAttempted, true, mode);
    assert.equal(receipt.signalErrorObserved, mode === 'EPERM' || mode === 'ENOENT', mode);
    assert.equal(receipt.terminationCause, 'SOVEREIGN_PROCESS_CANCEL_REQUESTED', mode);
    assert.equal(receipt.session.launchState, 'SPAWN_OBSERVED', mode);
    assert.equal(receipt.rootExitObserved, false, mode); assert.equal(receipt.stdioClosed, false, mode);
    assert.ok(!JSON.stringify(receipt).includes('private-kill-error-sentinel'));
    assert.equal((await service.execute(CANCEL, { sessionId: started.sessionId })).requestRecorded, false, mode);
    assert.equal(child.kills, 1, mode);
    child.finish(null, 'SIGTERM'); await service.dispose();
  }
});

test('grace expiry does not prove termination or free global native admission', async t => {
  const module = await fresh(), children = [childFixture({ killCloses: false }), childFixture({ killCloses: false }), childFixture()];
  const services = children.map(child => makeService(module, child, { terminationGraceMs: 5 }));
  t.after(async () => { for (const child of children) child.finish(); for (const service of services) await service.dispose(); });
  const first = await services[0].execute(START, { profile: PROFILE });
  await services[1].execute(START, { profile: PROFILE });
  assert.equal((await services[0].execute(CANCEL, { sessionId: first.sessionId })).cancellationState, 'REQUESTED');
  await until(async () => (await services[0].execute(READ, { sessionId: first.sessionId })).session.terminationUnproven);
  const uncertain = await services[0].execute(CANCEL, { sessionId: first.sessionId });
  assert.equal(uncertain.cancellationState, 'UNKNOWN'); assert.equal(uncertain.signalAttemptResult, 'KILL_RETURNED_TRUE');
  assert.equal(uncertain.retryAllowed, false); assert.equal(children[0].kills, 1);
  assert.equal((await services[2].execute(START, { profile: PROFILE })).blocker, 'SOVEREIGN_PROCESS_CAPACITY_HELD');
  children[0].emit('exit', null, 'SIGTERM');
  assert.equal((await services[2].execute(START, { profile: PROFILE })).blocker, 'SOVEREIGN_PROCESS_CAPACITY_HELD');
  children[0].emit('close', null, 'SIGTERM');
  assert.equal((await services[2].execute(START, { profile: PROFILE })).ok, true);
});

test('cancelling an exited root waits for stdio closure without another signal', async t => {
  const module = await fresh(), child = childFixture({ killCloses: false });
  const service = makeService(module, child, { terminationGraceMs: 1000 });
  t.after(async () => { child.finish(); await service.dispose(); });
  const started = await service.execute(START, { profile: PROFILE }); child.emit('exit', 0, null);
  const receipt = await service.execute(CANCEL, { sessionId: started.sessionId });
  assert.equal(receipt.cancellationState, 'REQUESTED'); assert.equal(receipt.rootExitObserved, true);
  assert.equal(receipt.stdioClosed, false); assert.equal(receipt.signalAttempted, false);
  assert.equal(receipt.signalAttemptResult, 'ROOT_ALREADY_EXITED'); assert.equal(child.kills, 0);
  assert.equal((await service.execute(CANCEL, { sessionId: started.sessionId })).requestRecorded, false);
  assert.equal(child.kills, 0); child.emit('close', 0, null);
  assert.equal((await service.execute(CANCEL, { sessionId: started.sessionId })).cancellationState, 'ROOT_EXIT_AND_STDIO_CLOSED');
});

test('prior timeout, output and setup causes retain their original attempt and grace state', async () => {
  for (const cause of ['timeout', 'output', 'setup']) {
    const module = await fresh(), child = childFixture({ killCloses: false, missingStreams: cause === 'setup' });
    const service = makeService(module, child, { timeoutMs: cause === 'timeout' ? 10 : 1000, terminationGraceMs: 5 });
    const started = await service.execute(START, { profile: PROFILE });
    if (cause === 'output') child.stdout.write('x'.repeat(20000));
    const before = await until(async () => {
      const page = await service.execute(READ, { sessionId: started.sessionId });
      return page.session.terminationUnproven ? page.session : null;
    });
    const expected = cause === 'timeout' ? 'SOVEREIGN_PROCESS_TIME_LIMIT'
      : cause === 'output' ? 'SOVEREIGN_PROCESS_OUTPUT_LIMIT' : 'SOVEREIGN_PROCESS_SETUP_UNPROVEN';
    assert.equal(before.blocker, expected); assert.equal(child.kills, 1);
    const receipt = await service.execute(CANCEL, { sessionId: started.sessionId });
    assert.equal(receipt.cancellationState, 'UNKNOWN'); assert.equal(receipt.requestRecorded, true);
    assert.equal(receipt.terminationCause, expected); assert.equal(receipt.session.blocker, expected);
    assert.equal(receipt.session.terminationUnproven, true); assert.equal(child.kills, 1);
    assert.equal((await service.execute(CANCEL, { sessionId: started.sessionId })).requestRecorded, false);
    assert.equal(child.kills, 1); child.finish(null, 'SIGTERM'); await service.dispose();
  }
});

test('opaque throw and absent returned handle preserve original uncertainty and refuse cancellation admission', async () => {
  const module = await fresh();
  const services = [
    module.createSovereignProcessSessionsV1({ platform: 'win32', environment, spawnFn() { throw Error('opaque-private'); } }),
    module.createSovereignProcessSessionsV1({ platform: 'win32', environment, spawnFn() { return undefined; }, terminationGraceMs: 1 }),
  ];
  for (const service of services) {
    const started = await service.execute(START, { profile: PROFILE });
    const receipt = await service.execute(CANCEL, { sessionId: started.sessionId });
    assert.equal(receipt.cancellationState, 'UNKNOWN'); assert.equal(receipt.requestRecorded, false);
    assert.equal(receipt.cancellationRequested, false); assert.equal(receipt.signalAttempted, false);
    assert.equal(receipt.signalAttemptResult, 'HANDLE_UNAVAILABLE');
    assert.equal(receipt.session.blocker, started.session.blocker);
    assert.equal(receipt.rootExitObserved, false); assert.equal(receipt.stdioClosed, false);
    assert.ok(!JSON.stringify(receipt).includes('opaque-private')); await service.dispose();
  }
  const third = makeService(module, childFixture());
  assert.equal((await third.execute(START, { profile: PROFILE })).blocker, 'SOVEREIGN_PROCESS_CAPACITY_HELD');
  await third.dispose(); await wait(5);
});

test('a kill method without lifecycle observation cannot admit pending caller cancellation', async () => {
  const module = await fresh(); let kills = 0;
  const opaque = module.createSovereignProcessSessionsV1({ platform: 'win32', environment,
    terminationGraceMs: 1, spawnFn: () => ({ pid: 12345, kill() { kills++; return true; } }) });
  const started = await opaque.execute(START, { profile: PROFILE });
  assert.equal(started.session.blocker, 'SOVEREIGN_PROCESS_SETUP_UNPROVEN');
  assert.equal(kills, 1);
  const receipt = await opaque.execute(CANCEL, { sessionId: started.sessionId });
  assert.equal(receipt.cancellationState, 'UNKNOWN'); assert.equal(receipt.requestRecorded, false);
  assert.equal(receipt.cancellationRequested, false); assert.equal(receipt.signalAttempted, true);
  assert.equal(receipt.signalAttemptResult, 'KILL_RETURNED_TRUE');
  assert.equal(receipt.rootExitObserved, false); assert.equal(receipt.stdioClosed, false);
  assert.equal(receipt.session.blocker, 'SOVEREIGN_PROCESS_SETUP_UNPROVEN');
  assert.equal(kills, 1);
  const child = childFixture(), second = makeService(module, child), third = makeService(module, childFixture());
  assert.equal((await second.execute(START, { profile: PROFILE })).ok, true);
  assert.equal((await third.execute(START, { profile: PROFILE })).blocker, 'SOVEREIGN_PROCESS_CAPACITY_HELD');
  await opaque.dispose(); assert.equal(kills, 1);
  child.finish(); await second.dispose(); await third.dispose(); await wait(5);
});

test('pre-spawn cancellation defers signalling until the captured child actually spawns', async t => {
  const module = await fresh(), child = childFixture({ killCloses: false }); child.pid = undefined;
  const service = makeService(module, child, { terminationGraceMs: 1000, spawnFn: () => child });
  t.after(async () => { child.finish(null, 'SIGTERM'); await service.dispose(); });
  const pendingStart = service.execute(START, { profile: PROFILE });
  const listed = await service.execute(LIST, {}), sessionId = listed.sessions[0].sessionId;
  assert.equal(listed.sessions[0].state, 'STARTING');
  const requested = await service.execute(CANCEL, { sessionId });
  assert.equal(requested.cancellationState, 'REQUESTED'); assert.equal(requested.requestRecorded, true);
  assert.equal(requested.signalAttemptResult, 'DEFERRED_UNTIL_SPAWN'); assert.equal(requested.signalAttempted, false);
  assert.equal(child.kills, 0); assert.equal((await pendingStart).launchState, 'UNKNOWN');
  assert.equal((await service.execute(CANCEL, { sessionId })).requestRecorded, false); assert.equal(child.kills, 0);
  child.pid = 24680; child.emit('spawn');
  const afterSpawn = await service.execute(CANCEL, { sessionId });
  assert.equal(afterSpawn.cancellationState, 'REQUESTED'); assert.equal(afterSpawn.requestRecorded, false);
  assert.equal(afterSpawn.signalAttemptResult, 'KILL_RETURNED_TRUE'); assert.equal(child.kills, 1);
  child.emit('spawn'); assert.equal(child.kills, 1);
});

test('authentic pre-spawn denial after deferred cancellation proves no spawn and releases admission', async () => {
  const module = await fresh(), child = childFixture({ killCloses: false }); child.pid = undefined;
  const service = makeService(module, child, { spawnFn: () => child });
  const pendingStart = service.execute(START, { profile: PROFILE });
  const sessionId = (await service.execute(LIST, {})).sessions[0].sessionId;
  assert.equal((await service.execute(CANCEL, { sessionId })).signalAttemptResult, 'DEFERRED_UNTIL_SPAWN');
  await pendingStart;
  await until(async () => (await service.execute(READ, { sessionId })).session.terminationUnproven);
  child.emit('error', { code: 'ENOENT' });
  const receipt = await service.execute(CANCEL, { sessionId });
  assert.equal(receipt.cancellationState, 'ALREADY_TERMINAL'); assert.equal(receipt.terminalReason, 'PROVEN_NO_SPAWN');
  assert.equal(receipt.cancellationRequested, true); assert.equal(receipt.signalAttempted, false);
  assert.equal(receipt.rootExitObserved, false); assert.equal(receipt.session.launchState, 'NOT_STARTED');
  assert.equal(receipt.session.terminationUnproven, false);
  assert.equal(child.kills, 0);
  const others = [childFixture(), childFixture()], otherServices = others.map(item => makeService(module, item));
  for (const other of otherServices) assert.equal((await other.execute(START, { profile: PROFILE })).ok, true);
  for (const item of others) item.finish();
  for (const other of otherServices) await other.dispose(); await service.dispose();
});

test('foreign, expired and disposed sessions cannot acquire cancellation authority or release held capacity', async () => {
  const module = await fresh(), a = childFixture({ killCloses: false }), b = childFixture({ killCloses: false }), c = childFixture();
  let clock = 1000;
  const owner = makeService(module, a, { nowFn: () => clock, ttlMs: 20 });
  const other = makeService(module, b), third = makeService(module, c);
  const first = await owner.execute(START, { profile: PROFILE }); await other.execute(START, { profile: PROFILE });
  const foreign = await other.execute(CANCEL, { sessionId: first.sessionId });
  assert.equal(foreign.cancellationState, 'NOT_STARTED'); assert.equal(foreign.blocker, 'SOVEREIGN_PROCESS_SESSION_UNAVAILABLE');
  assert.equal(a.kills, 0); assert.equal(b.kills, 0);
  clock = 1021;
  const expired = await owner.execute(CANCEL, { sessionId: first.sessionId });
  assert.equal(expired.cancellationState, 'NOT_STARTED'); assert.equal(expired.blocker, 'SOVEREIGN_PROCESS_SESSION_UNAVAILABLE');
  assert.equal(a.kills, 1);
  assert.equal((await third.execute(START, { profile: PROFILE })).blocker, 'SOVEREIGN_PROCESS_CAPACITY_HELD');
  await owner.dispose();
  assert.equal((await owner.execute(CANCEL, { sessionId: first.sessionId })).blocker, 'SOVEREIGN_PROCESS_SESSION_CLOSED');
  assert.equal(a.kills, 1);
  assert.equal((await third.execute(START, { profile: PROFILE })).blocker, 'SOVEREIGN_PROCESS_CAPACITY_HELD');
  a.finish(null, 'SIGTERM'); assert.equal((await third.execute(START, { profile: PROFILE })).ok, true);
  b.finish(); c.finish(); await other.dispose(); await third.dispose();
});

test('a real child fixture exposes cancellation and actual close without claiming Windows-native proof', async t => {
  const module = await fresh(); let nativeChild;
  const service = module.createSovereignProcessSessionsV1({ platform: 'win32', environment,
    spawnFn: () => nativeChild = spawn(process.execPath, ['-e', "process.stdout.write('ready\\n');setTimeout(()=>process.exit(0),5000)"],
      { stdio: ['ignore', 'pipe', 'pipe'] }) });
  t.after(async () => { await service.dispose(); if (nativeChild?.exitCode === null) nativeChild.kill(); });
  const started = await service.execute(START, { profile: PROFILE });
  const requested = await service.execute(CANCEL, { sessionId: started.sessionId });
  assert.equal(requested.cancellationRequested, true); assert.equal(requested.signalAttempted, true);
  assert.ok(['REQUESTED', 'ROOT_EXIT_AND_STDIO_CLOSED'].includes(requested.cancellationState));
  const terminal = await until(async () => {
    const page = await service.execute(READ, { sessionId: started.sessionId }); return page.session.stdioClosed ? page : null;
  }, 3000);
  assert.equal(terminal.session.rootExitObserved, true); assert.equal(terminal.session.cancellationRequested, true);
  assert.equal(terminal.session.nativeCustodyQualified, false); assert.equal(terminal.session.descendantsExcluded, false);
  assert.equal((await service.execute(CANCEL, { sessionId: started.sessionId })).cancellationState, 'ROOT_EXIT_AND_STDIO_CLOSED');
});

test('Windows cancellation observes the admitted captured diagnostic child without installation or mutation', { skip: process.platform !== 'win32', timeout: 20_000 }, async t => {
  const module = await fresh(), root = mkdtempSync(join(tmpdir(), 'sovereign-process-cancel-'));
  const status = join(root, 'Documents', 'Stephanos-openclaw-workspace', 'status'); mkdirSync(status, { recursive: true });
  const service = module.createSovereignProcessSessionsV1({ environment: { ...process.env, USERPROFILE: root } });
  t.after(async () => { await service.dispose(); rmSync(root, { recursive: true, force: true }); });
  const started = await service.execute(START, { profile: PROFILE }); assert.equal(started.ok, true);
  const requested = await service.execute(CANCEL, { sessionId: started.sessionId });
  assert.ok(['REQUESTED', 'ROOT_EXIT_AND_STDIO_CLOSED', 'ALREADY_TERMINAL'].includes(requested.cancellationState), JSON.stringify(requested));
  const terminal = await until(async () => {
    const page = await service.execute(READ, { sessionId: started.sessionId }); return page.session.stdioClosed ? page : null;
  }, 13_000);
  assert.equal(terminal.session.rootExitObserved, true);
  const receipt = await service.execute(CANCEL, { sessionId: started.sessionId });
  assert.equal(receipt.requestRecorded, false);
  assert.equal(receipt.cancellationState, requested.cancellationRequested ? 'ROOT_EXIT_AND_STDIO_CLOSED' : 'ALREADY_TERMINAL');
  assert.equal(receipt.nativeCustodyQualified, false); assert.equal(receipt.descendantsExcluded, false);
  assert.equal(receipt.maintenanceCustodyReleased, false); assert.equal(receipt.retryAllowed, false);
  t.diagnostic(JSON.stringify({ profile: PROFILE, initialCancellationState: requested.cancellationState,
    signalAttempted: receipt.signalAttempted, signalAttemptResult: receipt.signalAttemptResult,
    rootExitObserved: receipt.rootExitObserved, stdioClosed: receipt.stdioClosed,
    nativeCustodyQualified: false, descendantsExcluded: false }));
});

test('Windows executes both production captured helpers without installation or task mutation', { skip: process.platform !== 'win32', timeout: 35_000 }, async t => {
  const module = await fresh(), root = mkdtempSync(join(tmpdir(), 'sovereign-process-profile-'));
  const status = join(root, 'Documents', 'Stephanos-openclaw-workspace', 'status'); mkdirSync(status, { recursive: true });
  for (const name of ['battle-bridge-recovery-mesh-current.json', 'battle-bridge-worker-watchdog-current.json',
    'battle-bridge-worker-watchdog-launch-current.json', 'mission-orchestrator-worker-heartbeat.json'])
    writeFileSync(join(status, name), '\ufeff' + JSON.stringify({ fixture: 'ç安全🦊' }), 'utf8');
  const service = module.createSovereignProcessSessionsV1({ environment: { ...process.env, USERPROFILE: root } });
  t.after(async () => { await service.dispose(); rmSync(root, { recursive: true, force: true }); });
  for (const profile of Object.keys(module.SOVEREIGN_PROCESS_SESSION_PROFILES_V1)) {
    const started = await service.execute(START, { profile }); assert.equal(started.ok, true);
    const done = await until(async () => {
      const value = await service.execute(READ, { sessionId: started.sessionId, limit: 50 });
      return value.session.stdioClosed ? value : null;
    }, 13_000);
    assert.equal(done.session.outcome, 'SUCCEEDED', JSON.stringify(done)); assert.equal(done.outputComplete, true);
    const output = JSON.parse(done.chunks.filter(row => row.stream === 'stdout').map(row => row.text).join(''));
    assert.equal((output.status || output.watchdogStatus).fixture, 'ç安全🦊');
    assert.equal(done.session.nativeCustodyQualified, false);
  }
});
