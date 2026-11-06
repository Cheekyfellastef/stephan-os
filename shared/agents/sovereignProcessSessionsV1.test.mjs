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
const START = 'START_PROCESS_SESSION', READ = 'READ_PROCESS_OUTPUT', LIST = 'LIST_SESSIONS';
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

test('post-spawn kill EPERM and timeout retain admission; neither is a no-launch refusal', async () => {
  const module = await fresh(), children = [childFixture({ killCloses: false, killError: true }), childFixture({ killCloses: false })];
  const a = makeService(module, children[0], { timeoutMs: 15 }), b = makeService(module, children[1], { timeoutMs: 15 });
  const first = await a.execute(START, { profile: PROFILE }); await b.execute(START, { profile: PROFILE });
  await wait(30);
  const state = (await a.execute(READ, { sessionId: first.sessionId })).session;
  assert.equal(state.state, 'UNKNOWN'); assert.equal(state.launchState, 'SPAWN_OBSERVED');
  assert.equal(state.terminationUnproven, true); assert.equal(state.stdioClosed, false);
  const c = makeService(module, childFixture());
  assert.equal((await c.execute(START, { profile: PROFILE })).blocker, 'SOVEREIGN_PROCESS_CAPACITY_HELD');
  for (const child of children) child.finish(null, 'SIGTERM');
  await a.dispose(); await b.dispose(); await c.dispose();
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
