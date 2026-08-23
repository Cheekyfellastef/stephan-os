import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
  BATTLE_BRIDGE_CANONICAL_REMOTE_URL,
  battleBridgeCanonicalRepositoryArgs,
} from './battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import {
  BATTLE_BRIDGE_IGNITION_PIPE_APPROVAL_SCHEMA,
  createBattleBridgeAsyncCommandRunner,
  createBattleBridgeNestedGitChildEnvironment,
  syncBattleBridgeExactHeadAsyncV1,
} from './battleBridgeExactHeadAsyncUpdateV1.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const RECEIPT_ID = 'c'.repeat(32);
const CONFIG = `core.repositoryformatversion\n0\0remote.origin.url\n${BATTLE_BRIDGE_CANONICAL_REMOTE_URL}\0remote.origin.fetch\n+refs/heads/main:refs/remotes/origin/main\0`;
const TEST_TOPOLOGY = () => ({ ok: true, blocker: '', stableIdentities: {} });

function scriptedSpawn({ initialStatus = '', laterStatus = initialStatus, finalHead = HEAD, trackedVisibility = 'H shared/agents/source.mjs\n' } = {}) {
  const calls = [];
  let statusReads = 0;
  let headReads = 0;
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 2000 + calls.length;
    child.stdio = [null, child.stdout, child.stderr];
    child.kill = () => {};
    const tail = command === BATTLE_BRIDGE_WINDOWS_HOST.git
      ? args.slice(BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS.length + 2)
      : args;
    calls.push({ command, args: [...args], tail, options });
    let status = 0;
    let stdout = '';
    if (tail[0] === 'config') stdout = CONFIG;
    else if (tail[0] === 'for-each-ref') stdout = '';
    else if (tail[0] === 'branch') stdout = 'main\n';
    else if (tail[0] === 'rev-parse' && tail[1] === 'HEAD') {
      const read = headReads++;
      stdout = `${read === 0 ? OLD : (read === 1 ? HEAD : finalHead)}\n`;
    } else if (tail[0] === 'rev-parse' && tail[1] === 'origin/main') stdout = `${HEAD}\n`;
    else if (tail[0] === 'status') stdout = `${statusReads++ === 0 ? initialStatus : laterStatus}`;
    else if (tail[0] === 'ls-files') stdout = trackedVisibility;
    else if (tail[0] === 'fetch') stdout = '';
    else if (tail[0] === 'rev-list') stdout = '0\t1\n';
    else if (tail[0] === 'merge') stdout = 'Fast-forward\n';
    else if (tail[0] === 'diff') stdout = 'shared/agents/source.mjs\n';
    else if (command === BATTLE_BRIDGE_WINDOWS_HOST.node) stdout = 'ok\n';
    else status = 1;
    setImmediate(() => {
      child.emit('spawn');
      child.stdout.end(stdout);
      child.stderr.end('');
      child.emit('close', status, null);
    });
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

test('async exact-head lane uses fixed URL/config/env and yields while commands run', async () => {
  const spawnFn = scriptedSpawn();
  let timerFired = false;
  setImmediate(() => { timerFired = true; });
  const result = await syncBattleBridgeExactHeadAsyncV1({
    repoRoot: 'C:\\repo',
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    platform: 'win32',
    spawnFn,
    testTopologyProofFn: TEST_TOPOLOGY,
    environment: { USERPROFILE: 'C:\\Users\\Stephan', NODE_OPTIONS: '--require C:\\attacker.js', GIT_REPLACE_REF_BASE: 'refs/evil' },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(timerFired, true);
  const fetch = spawnFn.calls.find((call) => call.tail[0] === 'fetch');
  assert.deepEqual(fetch.tail, ['fetch', '--prune', BATTLE_BRIDGE_CANONICAL_REMOTE_URL, 'main:refs/remotes/origin/main']);
  assert.equal(fetch.options.env.GIT_NO_REPLACE_OBJECTS, '1');
  assert.equal(fetch.options.env.GIT_REPLACE_REF_BASE, undefined);
  const node = spawnFn.calls.find((call) => call.command === BATTLE_BRIDGE_WINDOWS_HOST.node);
  assert.equal(node.options.env.NODE_OPTIONS, undefined);
});

test('async exact-head lane preserves approved runtime dirt while source sync proceeds', async () => {
  const spawnFn = scriptedSpawn({ initialStatus: '?? data/activity/events.json\n' });
  const result = await syncBattleBridgeExactHeadAsyncV1({
    repoRoot: 'C:\\repo',
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    platform: 'win32',
    spawnFn,
    testTopologyProofFn: TEST_TOPOLOGY,
    environment: { USERPROFILE: 'C:\\Users\\Stephan' },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.mutationAttempted, true);
  assert.equal(spawnFn.calls.some((call) => call.tail[0] === 'fetch'), true);
  assert.equal(spawnFn.calls.some((call) => call.command === BATTLE_BRIDGE_WINDOWS_HOST.node), true);
});

test('async exact-head lane blocks ignored checkout dirt before fetch/test/merge', async () => {
  const spawnFn = scriptedSpawn({ initialStatus: '!! data/runtime-secret.json\n' });
  const result = await syncBattleBridgeExactHeadAsyncV1({
    repoRoot: 'C:\\repo',
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    platform: 'win32',
    spawnFn,
    testTopologyProofFn: TEST_TOPOLOGY,
    environment: { USERPROFILE: 'C:\\Users\\Stephan' },
  });
  assert.equal(result.blocker, 'CANONICAL_CHECKOUT_DIRTY');
  assert.equal(result.mutationAttempted, false);
  assert.equal(spawnFn.calls.some((call) => ['fetch', 'merge'].includes(call.tail[0])), false);
});

test('async exact-head lane blocks hidden tracked paths before fetch', async () => {
  for (const trackedVisibility of ['S hidden-source.mjs\n', 'h assumed-source.mjs\n']) {
    const spawnFn = scriptedSpawn({ trackedVisibility });
    const result = await syncBattleBridgeExactHeadAsyncV1({
      repoRoot: 'C:\\repo',
      expectedHead: HEAD,
      operatorApproval: 'operator-approved',
      platform: 'win32',
      spawnFn,
      testTopologyProofFn: TEST_TOPOLOGY,
      environment: { USERPROFILE: 'C:\\Users\\Stephan' },
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'HIDDEN_TRACKED_PATHS_PRESENT');
    assert.equal(result.mutationAttempted, false);
    assert.equal(spawnFn.calls.some((call) => call.tail[0] === 'fetch'), false);
  }
});

test('async exact-head lane rejects repository graft topology before any Git execution', async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'battle-bridge-async-grafts-'));
  const graftPath = path.join(repoRoot, '.git', 'info', 'grafts');
  mkdirSync(path.join(repoRoot, '.git', 'objects'), { recursive: true });
  mkdirSync(path.join(repoRoot, '.git', 'refs'), { recursive: true });
  writeFileSync(path.join(repoRoot, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
  writeFileSync(path.join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  mkdirSync(path.dirname(graftPath), { recursive: true });
  writeFileSync(graftPath, `${OLD} ${HEAD}\n`);
  const spawnFn = scriptedSpawn();
  const result = await syncBattleBridgeExactHeadAsyncV1({
    repoRoot,
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    platform: 'win32',
    spawnFn,
    environment: { USERPROFILE: 'C:\\Users\\Stephan' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'GIT_GRAFTS_PRESENT');
  assert.equal(spawnFn.calls.length, 0);
});

test('async exact-head lane reports fetch mutation truth when later source dirt blocks merge', async () => {
  const spawnFn = scriptedSpawn({ initialStatus: '', laterStatus: ' M shared/agents/changed-source.mjs\n' });
  const result = await syncBattleBridgeExactHeadAsyncV1({
    repoRoot: 'C:\\repo',
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    platform: 'win32',
    spawnFn,
    testTopologyProofFn: TEST_TOPOLOGY,
    environment: { USERPROFILE: 'C:\\Users\\Stephan' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CANONICAL_CHECKOUT_DIRTY');
  assert.equal(result.mutationAttempted, true);
  assert.equal(spawnFn.calls.some((call) => call.tail[0] === 'merge'), false);
});

test('async exact-head lane rejects a clean HEAD switch during verification', async () => {
  const spawnFn = scriptedSpawn({ finalHead: 'c'.repeat(40) });
  const result = await syncBattleBridgeExactHeadAsyncV1({
    repoRoot: 'C:\\repo',
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    platform: 'win32',
    spawnFn,
    testTopologyProofFn: TEST_TOPOLOGY,
    environment: { USERPROFILE: 'C:\\Users\\Stephan' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'POST_VERIFICATION_HEAD_MISMATCH');
  assert.equal(result.mutationAttempted, true);
});

test('async command timeout waits for child close within the bounded kill-ack window', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4040;
  let killed = false;
  child.kill = () => { killed = true; };
  const runner = createBattleBridgeAsyncCommandRunner({
    spawnFn: () => {
      setImmediate(() => child.emit('spawn'));
      return child;
    },
    environment: { USERPROFILE: 'C:\\Users\\Stephan' },
  });
  let settled = false;
  const pending = runner(BATTLE_BRIDGE_WINDOWS_HOST.git, [
    ...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
    ...battleBridgeCanonicalRepositoryArgs('C:\\repo'),
    'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching',
  ], { cwd: 'C:\\repo', timeout: 1 }).then((value) => { settled = true; return value; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(killed, true);
  assert.equal(settled, false);
  child.emit('close', null, 'SIGTERM');
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error, 'BATTLE_BRIDGE_COMMAND_TIMEOUT');
  assert.equal(result.processTreeClosureProven, false);
  assert.equal(result.executionStateUnproven, true);
});

test('async command timeout settles unproven after bounded kill wait when child never closes', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4141;
  let killed = false;
  child.kill = () => { killed = true; };
  const runner = createBattleBridgeAsyncCommandRunner({
    spawnFn: () => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    environment: { USERPROFILE: 'C:\\Users\\Stephan' },
  });
  const result = await runner(BATTLE_BRIDGE_WINDOWS_HOST.git, [
    ...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
    ...battleBridgeCanonicalRepositoryArgs('C:\\repo'),
    'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching',
  ], { cwd: 'C:\\repo', timeout: 1, killAckTimeoutMs: 5 });

  assert.equal(killed, true);
  assert.equal(result.spawnObserved, true);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'BATTLE_BRIDGE_COMMAND_TIMEOUT');
  assert.equal(result.processTreeClosureProven, false);
  assert.equal(result.executionStateUnproven, true);
});

test('data after the exact output cap fails closed instead of hiding later source dirt', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4242;
  let killed = false;
  child.kill = () => { killed = true; };
  const runner = createBattleBridgeAsyncCommandRunner({
    spawnFn: () => {
      setImmediate(() => {
        child.emit('spawn');
        child.stdout.write(Buffer.alloc(1024 * 1024, 0x0a));
        child.stdout.write(' M shared/agents/hidden-source.mjs\n');
        child.emit('close', 0, null);
      });
      return child;
    },
    environment: { USERPROFILE: 'C:\\Users\\Stephan' },
  });
  const result = await runner(BATTLE_BRIDGE_WINDOWS_HOST.git, [
    ...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
    ...battleBridgeCanonicalRepositoryArgs('C:\\repo'),
    'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching',
  ], { cwd: 'C:\\repo', timeout: 1000, killAckTimeoutMs: 5 });

  assert.equal(killed, true);
  assert.equal(result.ok, false);
  assert.equal(result.stdout, '');
  assert.equal(result.error, 'BATTLE_BRIDGE_COMMAND_OUTPUT_TOO_LARGE');
  assert.equal(result.processTreeClosureProven, false);
  assert.equal(result.executionStateUnproven, true);
});

test('sync result propagates unproven execution state after an abnormal post-spawn termination', async () => {
  const base = scriptedSpawn();
  const spawnFn = (command, args, options) => {
    const tail = command === BATTLE_BRIDGE_WINDOWS_HOST.git
      ? args.slice(BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS.length + 2)
      : args;
    if (tail[0] !== 'fetch') return base(command, args, options);
    const child = new EventEmitter();
    child.pid = 6060;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    setImmediate(() => {
      child.emit('spawn');
      child.stdout.end(Buffer.alloc(1024 * 1024 + 1, 120));
      child.stderr.end();
      setImmediate(() => child.emit('close', null, 'SIGTERM'));
    });
    return child;
  };
  const result = await syncBattleBridgeExactHeadAsyncV1({
    repoRoot: 'C:\\repo',
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    platform: 'win32',
    spawnFn,
    testTopologyProofFn: TEST_TOPOLOGY,
    environment: { USERPROFILE: 'C:\\Users\\Stephan' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'ORIGIN_FETCH_FAILED');
  assert.equal(result.executionStateUnproven, true);
  assert.equal(result.fetchResult.processTreeClosureProven, false);
  assert.equal(result.fetchResult.executionStateUnproven, true);
});

test('missing ignition approval fd stays pending without close and settles unproven after close', async () => {
  const child = new EventEmitter();
  child.pid = 7070;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdio = [null, child.stdout, child.stderr];
  let killed = false;
  child.kill = () => { killed = true; };
  const runner = createBattleBridgeAsyncCommandRunner({
    environment: { USERPROFILE: 'C:\\Users\\Stephan' },
    spawnFn: () => {
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  });
  const cwd = 'C:\\repo';
  const ignitionScript = path.resolve(cwd, 'scripts', 'run-battle-bridge-ignition.mjs');
  let settled = false;
  const pending = runner(BATTLE_BRIDGE_WINDOWS_HOST.node, [ignitionScript], {
    cwd,
    timeout: 5,
    ignitionApproval: Object.freeze({ expectedHead: HEAD, receiptId: RECEIPT_ID }),
  }).then((value) => { settled = true; return value; });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(killed, true);
  assert.equal(settled, false);

  child.emit('close', null, 'SIGTERM');
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error, 'BATTLE_BRIDGE_IGNITION_APPROVAL_PIPE_UNAVAILABLE');
  assert.equal(result.processTreeClosureProven, false);
  assert.equal(result.executionStateUnproven, true);
});

test('synchronous ignition approval write failure settles unproven after child close', async () => {
  const child = new EventEmitter();
  child.pid = 8080;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const approvalPipe = new EventEmitter();
  approvalPipe.end = () => { throw new Error('IGNITION_APPROVAL_WRITE_FAILED'); };
  child.stdio = [null, child.stdout, child.stderr, approvalPipe];
  let killed = false;
  child.kill = () => { killed = true; };
  const runner = createBattleBridgeAsyncCommandRunner({
    environment: { USERPROFILE: 'C:\\Users\\Stephan' },
    spawnFn: () => {
      setImmediate(() => {
        child.emit('spawn');
        child.emit('close', null, 'SIGTERM');
      });
      return child;
    },
  });
  const cwd = 'C:\\repo';
  const ignitionScript = path.resolve(cwd, 'scripts', 'run-battle-bridge-ignition.mjs');
  const result = await runner(BATTLE_BRIDGE_WINDOWS_HOST.node, [ignitionScript], {
    cwd,
    timeout: 1000,
    ignitionApproval: Object.freeze({ expectedHead: HEAD, receiptId: RECEIPT_ID }),
  });

  assert.equal(killed, true);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'IGNITION_APPROVAL_WRITE_FAILED');
  assert.equal(result.processTreeClosureProven, false);
  assert.equal(result.executionStateUnproven, true);
});

test('fixed ignition child receives one-use approval only over fd 3 and nested Git is isolated', async () => {
  const child = new EventEmitter();
  child.pid = 5050;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const approvalPipe = new PassThrough();
  child.stdio = [null, child.stdout, child.stderr, approvalPipe];
  child.kill = () => {};
  let spawnOptions = null;
  let approvalText = '';
  approvalPipe.on('data', (chunk) => { approvalText += String(chunk); });
  approvalPipe.once('end', () => {
    child.stdout.end('ignition complete\n');
    child.stderr.end();
    child.emit('close', 0, null);
  });
  const runner = createBattleBridgeAsyncCommandRunner({
    environment: {
      USERPROFILE: 'C:\\Users\\Stephan',
      NODE_OPTIONS: '--require C:\\attacker.js',
      GIT_CONFIG_GLOBAL: 'C:\\attacker.gitconfig',
    },
    spawnFn: (_command, _args, options) => {
      spawnOptions = options;
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  });
  const cwd = 'C:\\repo';
  const ignitionScript = path.resolve(cwd, 'scripts', 'run-battle-bridge-ignition.mjs');
  const result = await runner(BATTLE_BRIDGE_WINDOWS_HOST.node, [ignitionScript], {
    cwd,
    timeout: 1000,
    ignitionApproval: Object.freeze({ expectedHead: HEAD, receiptId: RECEIPT_ID }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(spawnOptions.stdio, ['ignore', 'pipe', 'pipe', 'pipe']);
  assert.equal(spawnOptions.env.NODE_OPTIONS, undefined);
  assert.equal(spawnOptions.env.GIT_CONFIG_GLOBAL, process.platform === 'win32' ? 'NUL' : '/dev/null');
  assert.equal(Number(spawnOptions.env.GIT_CONFIG_COUNT) > 0, true);
  const approval = JSON.parse(approvalText);
  assert.equal(approval.schemaVersion, BATTLE_BRIDGE_IGNITION_PIPE_APPROVAL_SCHEMA);
  assert.equal(approval.expectedHead, HEAD);
  assert.equal(approval.receiptId, RECEIPT_ID);
  assert.equal(approval.parentPid, process.pid);
  assert.equal(approval.childPid, child.pid);
  assert.match(approval.nonce, /^[0-9a-f]{32}$/);
  const nestedEnv = createBattleBridgeNestedGitChildEnvironment({ NODE_OPTIONS: '--require attacker.js' });
  assert.equal(nestedEnv.NODE_OPTIONS, undefined);
  assert.equal(nestedEnv.GIT_NO_REPLACE_OBJECTS, '1');
});
