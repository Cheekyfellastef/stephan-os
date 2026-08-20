import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BATTLE_BRIDGE_WINDOWS_HOST } from '../../../../../shared/agents/battleBridgeWindowsHosts.mjs';
import { executeQueuedOpenClawUpdate } from './recovery-update-executor.mjs';
import {
  normalizeOpenClawExactHead,
  queueBattleBridgeExactHeadFromOpenClaw,
  recoverBattleBridgeExactHeadFromOpenClaw,
  sanitizeOpenClawBattleBridgeUpdateResult,
} from './recovery-update.mjs';

const HEAD = 'a'.repeat(40);
const OWNER = Object.freeze({
  authenticatedByHost: true,
  commandName: 'stephanos-ignite',
  command: 'update',
  senderIsOwner: true,
});

function receiptPath(profile, receiptId) {
  return path.join(profile, 'Documents', 'Stephanos-openclaw-workspace', 'receipts', 'exact-head-update', `${receiptId}.json`);
}

function successfulDetachedSpawn(calls = []) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.unref = () => calls.push({ unref: true });
    calls.push({ command, args, options });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
}

test('exact-head parser accepts only one canonical SHA value', () => {
  assert.equal(normalizeOpenClawExactHead(HEAD.toUpperCase()), HEAD);
  assert.equal(normalizeOpenClawExactHead('main'), '');
  assert.equal(normalizeOpenClawExactHead(`${HEAD} extra`), '');
  assert.equal(normalizeOpenClawExactHead('../' + HEAD), '');
});

test('fixed recovery update requires authenticated owner identity before any updater call', async () => {
  let calls = 0;
  const updateFn = async () => { calls += 1; return { ok: true }; };
  for (const authenticatedContext of [null, { ...OWNER, senderIsOwner: false }, { ...OWNER, command: 'wake' }]) {
    const result = await recoverBattleBridgeExactHeadFromOpenClaw({
      expectedHead: HEAD,
      authenticatedContext,
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      updateFn,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'OWNER_AUTH_REQUIRED');
  }
  assert.equal(calls, 0);
});

test('fixed recovery update binds canonical main, exact head and operator approval without caller-selected path', async () => {
  let captured;
  let syncCaptured;
  const result = await recoverBattleBridgeExactHeadFromOpenClaw({
    expectedHead: HEAD,
    authenticatedContext: OWNER,
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    exactSyncFn: (input) => {
      syncCaptured = input;
      return { ok: true, branch: 'main', remoteHead: HEAD, afterHead: HEAD, updated: true };
    },
    updateFn: async (input) => {
      captured = input;
      const sync = input.syncFn({ repoRoot: input.repoRoot, expectedBranch: input.expectedBranch, operatorApproval: input.operatorApproval });
      assert.equal(sync.ok, true);
      return {
        ok: true,
        status: 'DONE',
        finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD',
        sourceHead: HEAD,
        sourceInstalled: true,
        expectedHeadMatch: true,
        runtimeProofPassed: true,
        runtimeProofPending: false,
        servedUiProof: { exactHead: true },
      };
    },
  });
  assert.equal(captured.expectedBranch, 'main');
  assert.equal(captured.expectedHead, HEAD);
  assert.equal(captured.operatorApproval, 'operator-approved');
  assert.match(captured.repoRoot.replace(/\\/g, '/'), /Users\/Stephan Callear\/Documents\/GitHub\/stephan-os$/i);
  assert.equal(syncCaptured.expectedHead, HEAD);
  assert.equal(result.ok, true);
  assert.equal(result.expectedHeadMatch, true);
  assert.equal(result.runtimeProofPassed, false);
  assert.equal(result.servedUiExactHead, false);
  assert.equal(result.pluginReloadProofPending, true);
  assert.equal(result.finalVerdict, 'PLUGIN_RELOAD_PROOF_PENDING');
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.callerSelectedPathAllowed, false);
  assert.equal(result.pcRestartAllowed, false);
});

test('WhatsApp projection strips raw sync, diagnostics, status paths and stderr', () => {
  const result = sanitizeOpenClawBattleBridgeUpdateResult({
    ok: false,
    status: 'BLOCKED',
    finalVerdict: 'FAST_FORWARD_FAILED',
    blocker: 'FAST_FORWARD_FAILED',
    sourceHead: HEAD,
    expectedHeadMatch: true,
    sourceInstalled: true,
    sync: {
      statusBefore: ' M private/source.js',
      fastForward: { stderr: 'C:\\Users\\Stephan Callear\\secret path' },
    },
    preDiagnostics: { completeGitStatus: 'private' },
    ignition: { stderr: 'private' },
  }, HEAD);
  assert.deepEqual(Object.keys(result).sort(), [
    'arbitraryShellAllowed',
    'blocker',
    'callerSelectedExecutableAllowed',
    'callerSelectedPathAllowed',
    'destructiveGitAllowed',
    'expectedHead',
    'expectedHeadMatch',
    'finalVerdict',
    'ok',
    'pcRestartAllowed',
    'pluginReloadProofPending',
    'route',
    'runtimeProofPassed',
    'runtimeProofPending',
    'servedUiExactHead',
    'sourceHead',
    'sourceInstalled',
    'status',
  ].sort());
  assert.doesNotMatch(JSON.stringify(result), /private|Stephan|secret|statusBefore|stderr/i);
});

test('owner update queues canonical detached executor only after observing successful spawn', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-'));
  const calls = [];
  const result = await queueBattleBridgeExactHeadFromOpenClaw({
    expectedHead: HEAD,
    authenticatedContext: OWNER,
    platform: 'win32',
    env: { USERPROFILE: profile },
    nonce: '1'.repeat(32),
    now: new Date('2026-08-20T00:00:00.000Z'),
    spawnFn: successfulDetachedSpawn(calls),
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'QUEUED');
  assert.equal(result.runtimeProofPassed, false);
  assert.equal(result.pluginReloadProofPending, true);
  assert.equal(calls[0].command, BATTLE_BRIDGE_WINDOWS_HOST.node);
  assert.deepEqual(calls[0].args.slice(1), ['1'.repeat(32), HEAD]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[1], { unref: true });
  const receipt = JSON.parse(readFileSync(receiptPath(profile, '1'.repeat(32)), 'utf8'));
  assert.equal(receipt.status, 'QUEUED');
  assert.equal(receipt.pluginReloadProof, 'PENDING');
});

test('owner update fails durably when detached executor emits launch error', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-error-'));
  const child = new EventEmitter();
  child.unref = () => assert.fail('failed launch must not detach');
  const resultPromise = queueBattleBridgeExactHeadFromOpenClaw({
    expectedHead: HEAD,
    authenticatedContext: OWNER,
    platform: 'win32',
    env: { USERPROFILE: profile },
    nonce: '2'.repeat(32),
    now: new Date('2026-08-20T00:01:00.000Z'),
    launchTimeoutMs: 100,
    spawnFn: (command) => {
      assert.equal(command, BATTLE_BRIDGE_WINDOWS_HOST.node);
      queueMicrotask(() => child.emit('error', Object.assign(new Error('missing cwd'), { code: 'ENOENT' })));
      return child;
    },
  });
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.status, 'LAUNCH_FAILED');
  assert.equal(result.blocker, 'UPDATE_EXECUTOR_LAUNCH_FAILED');
  const receipt = JSON.parse(readFileSync(receiptPath(profile, '2'.repeat(32)), 'utf8'));
  assert.equal(receipt.status, 'LAUNCH_FAILED');
  assert.equal(receipt.blocker, 'UPDATE_EXECUTOR_LAUNCH_FAILED');
  assert.notEqual(receipt.status, 'QUEUED');
});

test('queued executor atomically claims receipt so a second executor cannot mutate concurrently', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-claim-'));
  const receiptId = '3'.repeat(32);
  const queued = await queueBattleBridgeExactHeadFromOpenClaw({
    expectedHead: HEAD,
    authenticatedContext: OWNER,
    platform: 'win32',
    env: { USERPROFILE: profile },
    nonce: receiptId,
    now: new Date('2026-08-20T00:02:00.000Z'),
    spawnFn: successfulDetachedSpawn(),
  });
  assert.equal(queued.ok, true);

  let releaseRecovery;
  let recoveryCalls = 0;
  let enteredRecovery;
  const recoveryEntered = new Promise((resolve) => { enteredRecovery = resolve; });
  const first = executeQueuedOpenClawUpdate({
    receiptId,
    expectedHead: HEAD,
    env: { USERPROFILE: profile },
    now: () => new Date('2026-08-20T00:03:00.000Z'),
    recoverFn: async () => {
      recoveryCalls += 1;
      enteredRecovery();
      await new Promise((resolve) => { releaseRecovery = resolve; });
      return {
        ok: true,
        status: 'DONE',
        finalVerdict: 'SOURCE_CURRENT',
        blocker: '',
        sourceHead: HEAD,
        sourceInstalled: false,
      };
    },
  });
  await recoveryEntered;

  const claimedReceipt = JSON.parse(readFileSync(receiptPath(profile, receiptId), 'utf8'));
  assert.equal(claimedReceipt.status, 'CLAIMED');
  const second = await executeQueuedOpenClawUpdate({
    receiptId,
    expectedHead: HEAD,
    env: { USERPROFILE: profile },
    recoverFn: async () => {
      recoveryCalls += 1;
      return { ok: true };
    },
  });
  assert.equal(second.ok, false);
  assert.equal(second.blocker, 'QUEUED_UPDATE_ALREADY_CLAIMED');
  assert.equal(recoveryCalls, 1);

  releaseRecovery();
  const completed = await first;
  assert.equal(completed.status, 'DONE');
  assert.equal(completed.sourceHead, HEAD);
  assert.equal(recoveryCalls, 1);
});
