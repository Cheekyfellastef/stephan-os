import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeOpenClawExactHead,
  readOpenClawExactHeadUpdateStatusFromOwnerHandler,
  runBattleBridgeExactHeadOwnerLaneStateMachineForTests,
  sanitizeOpenClawBattleBridgeUpdateResult,
} from './recovery-update.mjs';
import { BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS } from '../../../../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../../../../shared/agents/battleBridgeWindowsHosts.mjs';
import {
  OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
  buildOpenClawUpdateAuthorization,
} from './recovery-update-receipt.mjs';

const HEAD = 'a'.repeat(40);
const RECEIPT_ID = '1'.repeat(32);
const HOST_PID = 4321;
const NOW = new Date('2026-08-20T00:00:00.000Z');
const OWNER = Object.freeze({
  authenticatedByHost: true,
  commandName: 'stephanos-ignite',
  command: 'update',
  senderIsOwner: true,
});
const runBattleBridgeExactHeadFromOpenClawOwnerHandler = runBattleBridgeExactHeadOwnerLaneStateMachineForTests;

function receiptPath(profile, suffix = '.json', receiptId = RECEIPT_ID) {
  return path.join(profile, 'Documents', 'Stephanos-openclaw-workspace', 'receipts', 'exact-head-update', `${receiptId}${suffix}`);
}

function exactSync() {
  return { ok: true, status: 'DONE', afterHead: HEAD, expectedHeadMatch: true, updated: true, restartRequired: false };
}

function exactRuntime() {
  return {
    ok: true,
    status: 'DONE',
    finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD',
    blocker: '',
    sourceHead: HEAD,
    sourceInstalled: true,
    expectedHeadMatch: true,
    runtimeProofPassed: true,
    servedUiProof: { exactHead: true },
  };
}

function invocation(profile, overrides = {}) {
  mkdirSync(path.join(profile, 'Documents', 'GitHub', 'stephan-os', '.git'), { recursive: true });
  const { testDependencies = {}, ...rest } = overrides;
  return {
    expectedHead: HEAD,
    authenticatedContext: OWNER,
    platform: 'win32',
    env: { USERPROFILE: profile, NODE_OPTIONS: '--require C:\\attacker.js', GIT_SSH_COMMAND: 'attacker.exe' },
    nonce: RECEIPT_ID,
    now: NOW,
    hostPid: HOST_PID,
    testDependencies: {
      awaitCompletion: true,
      syncFn: async () => exactSync(),
      runtimeUpdateFn: async () => exactRuntime(),
      ...testDependencies,
    },
    ...rest,
  };
}

test('exact-head parser accepts only one canonical SHA value', () => {
  assert.equal(normalizeOpenClawExactHead(HEAD.toUpperCase()), HEAD);
  assert.equal(normalizeOpenClawExactHead('main'), '');
  assert.equal(normalizeOpenClawExactHead(`${HEAD} extra`), '');
  assert.equal(normalizeOpenClawExactHead(`../${HEAD}`), '');
});

test('non-owner update is rejected before receipt, claim, sync, or ignition authority', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-owner-'));
  let calls = 0;
  const result = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    authenticatedContext: { ...OWNER, senderIsOwner: false },
    testDependencies: {
      syncFn: async () => { calls += 1; return exactSync(); },
      runtimeUpdateFn: async () => { calls += 1; return exactRuntime(); },
    },
  }));
  assert.equal(result.blocker, 'OWNER_AUTH_REQUIRED');
  assert.equal(calls, 0);
  assert.throws(() => readFileSync(receiptPath(profile)), /ENOENT/);
});

test('owner callback exclusively claims before sync, checkpoints exact source before ignition, and uses fixed identities', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-success-'));
  const order = [];
  const result = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      syncFn: async (input) => {
        order.push('sync');
        assert.equal(JSON.parse(readFileSync(receiptPath(profile), 'utf8')).status, 'EXECUTING');
        assert.equal(JSON.parse(readFileSync(receiptPath(profile, '.claim.json'), 'utf8')).status, 'CLAIMED');
        assert.equal(input.nodeCommand, BATTLE_BRIDGE_WINDOWS_HOST.node);
        return exactSync();
      },
      runtimeUpdateFn: async (input) => {
        order.push('ignition');
        const checkpoint = JSON.parse(readFileSync(receiptPath(profile), 'utf8'));
        assert.equal(checkpoint.status, 'SOURCE_INSTALLED_RUNTIME_REFRESH_PENDING');
        assert.equal(checkpoint.sourceHead, HEAD);
        assert.equal(input.gitCommand, BATTLE_BRIDGE_WINDOWS_HOST.git);
        assert.equal(input.nodeCommand, BATTLE_BRIDGE_WINDOWS_HOST.node);
        assert.deepEqual(input.gitArgsPrefix.slice(0, BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS.length), BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS);
        assert.deepEqual(input.gitArgsPrefix.slice(-2), [
          `--git-dir=${path.resolve(profile, 'Documents', 'GitHub', 'stephan-os', '.git')}`,
          `--work-tree=${path.resolve(profile, 'Documents', 'GitHub', 'stephan-os')}`,
        ]);
        assert.equal(input.gitEnv.GIT_NO_REPLACE_OBJECTS, '1');
        assert.equal(input.nodeEnv.NODE_OPTIONS, undefined);
        return exactRuntime();
      },
    },
  }));
  assert.deepEqual(order, ['sync', 'ignition']);
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'PLUGIN_RELOAD_PROOF_PENDING');
  assert.equal(result.pluginReloadProofPending, true);
  assert.equal(result.runtimeProofPassed, true);
  const receipt = JSON.parse(readFileSync(receiptPath(profile), 'utf8'));
  assert.equal(receipt.status, 'PLUGIN_RELOAD_PROOF_PENDING');
  assert.equal(receipt.authorization.senderIsOwner, true);
  assert.equal(receipt.authorization.hostPid, HOST_PID);
  assert.throws(() => readFileSync(path.join(path.dirname(receiptPath(profile)), 'active-owner-update.json'), 'utf8'), /ENOENT/);
});

test('failed exact sync terminalizes durably and never invokes ignition', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-sync-fail-'));
  let ignitionCalls = 0;
  const result = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      syncFn: async () => ({ ok: false, status: 'BLOCKED', blocker: 'CANONICAL_CHECKOUT_DIRTY' }),
      runtimeUpdateFn: async () => { ignitionCalls += 1; return exactRuntime(); },
    },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CANONICAL_CHECKOUT_DIRTY');
  assert.equal(ignitionCalls, 0);
  assert.equal(JSON.parse(readFileSync(receiptPath(profile), 'utf8')).status, 'FAILED');
  assert.equal(JSON.parse(readFileSync(receiptPath(profile, '.claim.json'), 'utf8')).status, 'FAILED');
  assert.throws(() => readFileSync(path.join(path.dirname(receiptPath(profile)), 'active-owner-update.json'), 'utf8'), /ENOENT/);
});

test('merge-installed exact source remains durable truth when later verification fails', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-post-merge-fail-'));
  let ignitionCalls = 0;
  const result = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      syncFn: async () => ({
        ok: false,
        status: 'BLOCKED',
        blocker: 'POST_SYNC_VERIFICATION_FAILED',
        afterHead: HEAD,
        branch: 'main',
        sourceInstalled: true,
        expectedHeadMatch: true,
        mutationAttempted: true,
      }),
      runtimeUpdateFn: async () => { ignitionCalls += 1; return exactRuntime(); },
    },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'POST_SYNC_VERIFICATION_FAILED');
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.sourceInstalled, true);
  assert.equal(result.expectedHeadMatch, true);
  assert.equal(ignitionCalls, 0);
  const receipt = JSON.parse(readFileSync(receiptPath(profile), 'utf8'));
  assert.equal(receipt.status, 'FAILED');
  assert.equal(receipt.sourceHead, HEAD);
  assert.equal(receipt.sourceInstalled, true);
  assert.equal(receipt.expectedHeadMatch, true);
});

test('unproven sync process state retains the durable active lease and blocks retry', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-sync-unproven-'));
  let ignitionCalls = 0;
  const result = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      syncFn: async () => ({ ok: false, blocker: 'POST_SYNC_VERIFICATION_FAILED', executionStateUnproven: true }),
      runtimeUpdateFn: async () => { ignitionCalls += 1; return exactRuntime(); },
    },
  }));
  assert.equal(result.executionStateUnproven, true);
  assert.equal(ignitionCalls, 0);
  const activePath = path.join(path.dirname(receiptPath(profile)), 'active-owner-update.json');
  assert.equal(JSON.parse(readFileSync(activePath, 'utf8')).status, 'EXECUTION_STATE_UNPROVEN');
  const retry = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    nonce: '7'.repeat(32),
  }));
  assert.equal(retry.blocker, 'PREVIOUS_UPDATE_EXECUTION_UNPROVEN');
});

test('unproven ignition process state preserves exact source and retains the active lease', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-ignition-unproven-'));
  const result = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      syncFn: async () => exactSync(),
      runtimeUpdateFn: async () => ({
        ok: false,
        status: 'PENDING',
        blocker: 'IGNITION_EXECUTION_STATE_UNPROVEN',
        sourceHead: HEAD,
        sourceInstalled: true,
        expectedHeadMatch: true,
        executionStateUnproven: true,
      }),
    },
  }));
  assert.equal(result.executionStateUnproven, true);
  assert.equal(result.sourceInstalled, true);
  const activePath = path.join(path.dirname(receiptPath(profile)), 'active-owner-update.json');
  assert.equal(JSON.parse(readFileSync(activePath, 'utf8')).status, 'EXECUTION_STATE_UNPROVEN');
});

test('duplicate receipt and concurrent callback can execute authority only once', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-concurrency-'));
  let release;
  let runtimeCalls = 0;
  const runtimeGate = new Promise((resolve) => { release = resolve; });
  const firstPromise = runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      syncFn: async () => exactSync(),
      runtimeUpdateFn: async () => { runtimeCalls += 1; await runtimeGate; return exactRuntime(); },
    },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.parse(readFileSync(receiptPath(profile), 'utf8')).status, 'SOURCE_INSTALLED_RUNTIME_REFRESH_PENDING');
  const second = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    nonce: '2'.repeat(32),
    testDependencies: {
      syncFn: async () => { throw new Error('must not execute'); },
      runtimeUpdateFn: async () => { throw new Error('must not execute'); },
    },
  }));
  assert.equal(second.blocker, 'UPDATE_ALREADY_EXECUTING');
  release();
  assert.equal((await firstPromise).ok, true);
  assert.equal(runtimeCalls, 1);

  let duplicateCalls = 0;
  const duplicate = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      syncFn: async () => { duplicateCalls += 1; return exactSync(); },
      runtimeUpdateFn: async () => { duplicateCalls += 1; return exactRuntime(); },
    },
  }));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.blocker, 'UPDATE_QUEUE_FAILED');
  assert.equal(duplicateCalls, 0);
});

test('production-shaped callback returns bounded EXECUTING admission while its caught task continues', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-admission-'));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const admitted = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      awaitCompletion: false,
      syncFn: async () => { await gate; return exactSync(); },
      runtimeUpdateFn: async () => exactRuntime(),
    },
  }));
  assert.equal(admitted.ok, true);
  assert.equal(admitted.status, 'EXECUTING');
  assert.equal(admitted.finalVerdict, 'UPDATE_EXECUTION_RUNNING');
  assert.equal(JSON.parse(readFileSync(receiptPath(profile), 'utf8')).status, 'EXECUTING');
  const liveStatus = readOpenClawExactHeadUpdateStatusFromOwnerHandler({
    receiptId: RECEIPT_ID,
    authenticatedContext: { ...OWNER, command: 'update-status' },
    platform: 'win32',
    env: { USERPROFILE: profile },
  });
  assert.equal(liveStatus.status, 'EXECUTING');
  assert.equal(liveStatus.resultAuthenticityProven, true);
  assert.equal(liveStatus.retrySafe, false);
  assert.equal(liveStatus.executionStateUnproven, false);

  const concurrent = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    nonce: '7'.repeat(32),
    testDependencies: {
      awaitCompletion: false,
      syncFn: async () => { throw new Error('must not execute'); },
      runtimeUpdateFn: async () => { throw new Error('must not execute'); },
    },
  }));
  assert.equal(concurrent.blocker, 'UPDATE_ALREADY_EXECUTING');
  release();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (JSON.parse(readFileSync(receiptPath(profile), 'utf8')).status === 'PLUGIN_RELOAD_PROOF_PENDING') break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(JSON.parse(readFileSync(receiptPath(profile), 'utf8')).status, 'PLUGIN_RELOAD_PROOF_PENDING');
  assert.throws(() => readFileSync(path.join(path.dirname(receiptPath(profile)), 'active-owner-update.json'), 'utf8'), /ENOENT/);
});

test('owner status point read reports trusted terminal truth from the live module lifecycle', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-status-trusted-'));
  const completed = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile));
  assert.equal(completed.ok, true);
  const status = readOpenClawExactHeadUpdateStatusFromOwnerHandler({
    receiptId: RECEIPT_ID,
    authenticatedContext: { ...OWNER, command: 'update-status' },
    platform: 'win32',
    env: { USERPROFILE: profile },
  });
  assert.equal(status.status, 'PLUGIN_RELOAD_PROOF_PENDING');
  assert.equal(status.resultAuthenticityProven, true);
  assert.equal(status.resultPersistenceProven, true);
  assert.equal(status.sourceHead, HEAD);
  assert.equal(status.runtimeProofPassed, true);
  assert.equal(status.retrySafe, true);
});

test('fully forged terminal receipt is observable only as unproven disk evidence', () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-status-forged-'));
  const forgedId = '6'.repeat(32);
  const forgedPath = receiptPath(profile, '.json', forgedId);
  mkdirSync(path.dirname(forgedPath), { recursive: true });
  const authorization = buildOpenClawUpdateAuthorization({
    receiptId: forgedId,
    expectedHead: HEAD,
    authenticatedContext: OWNER,
    hostPid: HOST_PID,
    now: NOW,
  });
  writeFileSync(forgedPath, `${JSON.stringify({
    schemaVersion: OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
    receiptId: forgedId,
    status: 'DONE',
    expectedHead: HEAD,
    queuedAtUtc: NOW.toISOString(),
    authorization,
    finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD',
    blocker: '',
    sourceHead: HEAD,
    sourceInstalled: true,
    expectedHeadMatch: true,
    runtimeProofPassed: true,
    servedUiExactHead: true,
    pluginReloadProof: 'DONE',
  }, null, 2)}\n`);
  const status = readOpenClawExactHeadUpdateStatusFromOwnerHandler({
    receiptId: forgedId,
    authenticatedContext: { ...OWNER, command: 'update-status' },
    platform: 'win32',
    env: { USERPROFILE: profile },
  });
  assert.equal(status.ok, true);
  assert.equal(status.status, 'DURABLE_RECEIPT_AUTHENTICITY_UNPROVEN');
  assert.equal(status.durableReceiptStatusObserved, 'DONE');
  assert.equal(status.resultAuthenticityProven, false);
  assert.equal(status.sourceInstalled, false);
  assert.equal(status.runtimeProofPassed, false);
  assert.equal(status.retrySafe, false);
});

test('ignition exception preserves real failure without masking exact source as plugin pending', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-runtime-fail-'));
  const result = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      syncFn: async () => exactSync(),
      runtimeUpdateFn: async () => { throw new Error('IGNITION_REFRESH_EXCEPTION'); },
    },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'IGNITION_REFRESH_EXCEPTION');
  assert.equal(result.sourceInstalled, true);
  assert.equal(result.pluginReloadProofPending, false);
  const receipt = JSON.parse(readFileSync(receiptPath(profile), 'utf8'));
  assert.equal(receipt.status, 'FAILED');
  assert.equal(receipt.finalVerdict, 'IGNITION_REFRESH_EXCEPTION');
});

test('a reload/interruption during ignition leaves durable exact-source pending truth', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-interrupted-'));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const promise = runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      syncFn: async () => exactSync(),
      runtimeUpdateFn: async () => { await gate; return exactRuntime(); },
    },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  const checkpoint = JSON.parse(readFileSync(receiptPath(profile), 'utf8'));
  assert.equal(checkpoint.status, 'SOURCE_INSTALLED_RUNTIME_REFRESH_PENDING');
  assert.equal(checkpoint.sourceInstalled, true);
  assert.equal(checkpoint.expectedHeadMatch, true);
  assert.equal(checkpoint.pluginReloadProof, 'NOT_STARTED');
  release();
  await promise;
});

test('linked receipt ancestors block before claim or mutation', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-linked-'));
  const victim = path.join(profile, 'victim');
  mkdirSync(victim);
  mkdirSync(path.join(profile, 'Documents'));
  symlinkSync(victim, path.join(profile, 'Documents', 'Stephanos-openclaw-workspace'), 'dir');
  let calls = 0;
  const result = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      syncFn: async () => { calls += 1; return exactSync(); },
      runtimeUpdateFn: async () => { calls += 1; return exactRuntime(); },
    },
  }));
  assert.equal(result.blocker, 'UPDATE_RECEIPT_LINKED_ANCESTOR');
  assert.equal(calls, 0);
});

test('pre-existing claim collision terminalizes this callback receipt without mutation', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-claim-collision-'));
  const claimPath = receiptPath(profile, '.claim.json');
  mkdirSync(path.dirname(claimPath), { recursive: true });
  writeFileSync(claimPath, '{}\n', { flag: 'wx' });
  let calls = 0;
  const result = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      syncFn: async () => { calls += 1; return exactSync(); },
      runtimeUpdateFn: async () => { calls += 1; return exactRuntime(); },
    },
  }));
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
  assert.equal(JSON.parse(readFileSync(receiptPath(profile), 'utf8')).status, 'FAILED');
  assert.equal(JSON.parse(readFileSync(claimPath, 'utf8')).schemaVersion, undefined);
  assert.throws(() => readFileSync(path.join(path.dirname(claimPath), 'active-owner-update.json'), 'utf8'), /ENOENT/);
});

test('result projection never masks a failed exact-source result as plugin reload pending', () => {
  const failed = sanitizeOpenClawBattleBridgeUpdateResult({
    ok: false,
    status: 'FAILED',
    finalVerdict: 'IGNITION_REFRESH_FAILED',
    blocker: 'IGNITION_REFRESH_FAILED',
    sourceHead: HEAD,
    sourceInstalled: true,
    expectedHeadMatch: true,
  }, HEAD);
  assert.equal(failed.finalVerdict, 'IGNITION_REFRESH_FAILED');
  assert.equal(failed.pluginReloadProofPending, false);
  assert.equal(failed.expectedHeadMatch, true);
});

test('runtime proof pending remains distinct from later plugin reload proof pending', () => {
  const pending = sanitizeOpenClawBattleBridgeUpdateResult({
    ok: true,
    status: 'PENDING',
    finalVerdict: 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING',
    sourceHead: HEAD,
    sourceInstalled: true,
    expectedHeadMatch: true,
    runtimeProofPassed: false,
    runtimeProofPending: true,
    servedUiProof: { exactHead: false },
  }, HEAD);
  assert.equal(pending.ok, true);
  assert.equal(pending.finalVerdict, 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING');
  assert.equal(pending.runtimeProofPending, true);
  assert.equal(pending.pluginReloadProofPending, false);
});

test('checkpoint persistence failures preserve already-proven source and runtime observations', async () => {
  const sourceProfile = mkdtempSync(path.join(tmpdir(), 'ignite-update-source-persist-'));
  const sourceFailure = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(sourceProfile, {
    testDependencies: {
      syncFn: async () => exactSync(),
      runtimeUpdateFn: async () => { throw new Error('must not ignite'); },
      persistFn: () => { throw new Error('disk unavailable'); },
    },
  }));
  assert.equal(sourceFailure.blocker, 'UPDATE_SOURCE_CHECKPOINT_PERSIST_FAILED');
  assert.equal(sourceFailure.sourceInstalled, true);
  assert.equal(sourceFailure.sourceHead, HEAD);
  assert.equal(sourceFailure.resultPersistenceProven, false);

  const runtimeProfile = mkdtempSync(path.join(tmpdir(), 'ignite-update-result-persist-'));
  let persistCalls = 0;
  const runtimeFailure = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(runtimeProfile, {
    testDependencies: {
      syncFn: async () => exactSync(),
      runtimeUpdateFn: async () => exactRuntime(),
      persistFn: () => {
        persistCalls += 1;
        if (persistCalls === 2) throw new Error('final disk unavailable');
      },
    },
  }));
  assert.equal(runtimeFailure.blocker, 'UPDATE_RESULT_PERSIST_FAILED');
  assert.equal(runtimeFailure.runtimeProofPassed, true);
  assert.equal(runtimeFailure.servedUiExactHead, true);
  assert.equal(runtimeFailure.observedFinalVerdict, 'PLUGIN_RELOAD_PROOF_PENDING');
  assert.equal(runtimeFailure.resultPersistenceProven, false);
});

test('active-lease release failure preserves proven runtime truth and blocks retry', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-release-fail-'));
  const result = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    testDependencies: {
      syncFn: async () => exactSync(),
      runtimeUpdateFn: async () => exactRuntime(),
      releaseFn: () => { const error = new Error('release failed'); error.code = 'UPDATE_ACTIVE_RELEASE_FAILED'; throw error; },
    },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'UPDATE_ACTIVE_RELEASE_FAILED');
  assert.equal(result.runtimeProofPassed, true);
  assert.equal(result.sourceInstalled, true);
  assert.equal(JSON.parse(readFileSync(path.join(path.dirname(receiptPath(profile)), 'active-owner-update.json'), 'utf8')).status, 'PLUGIN_RELOAD_PROOF_PENDING');
});

test('durable nonterminal execution evidence suppresses mutation after a host-generation interruption', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-previous-active-'));
  const root = path.dirname(receiptPath(profile));
  mkdirSync(root, { recursive: true });
  const activePath = path.join(root, 'active-owner-update.json');
  const previousId = '9'.repeat(32);
  writeFileSync(activePath, `${JSON.stringify({
    schemaVersion: 'stephanos.openclaw-exact-head-update-owner-handler-claim.v1',
    receiptId: previousId,
    expectedHead: HEAD,
    claimantPid: 999,
    status: 'SOURCE_INSTALLED_RUNTIME_REFRESH_PENDING',
  }, null, 2)}\n`);
  let calls = 0;
  const result = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
    nonce: '8'.repeat(32),
    testDependencies: {
      syncFn: async () => { calls += 1; return exactSync(); },
      runtimeUpdateFn: async () => { calls += 1; return exactRuntime(); },
    },
  }));
  assert.equal(result.blocker, 'PREVIOUS_UPDATE_EXECUTION_UNPROVEN');
  assert.equal(calls, 0);
  assert.equal(JSON.parse(readFileSync(activePath, 'utf8')).receiptId, previousId);
});

test('in-memory owner task keeps the host event loop available during sync and ignition awaits', async () => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/health`;
  try {
    const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-responsive-'));
    const result = await runBattleBridgeExactHeadFromOpenClawOwnerHandler(invocation(profile, {
      testDependencies: {
        syncFn: async () => { assert.equal((await fetch(url)).ok, true); return exactSync(); },
        runtimeUpdateFn: async () => { assert.equal((await fetch(url)).ok, true); return exactRuntime(); },
      },
    }));
    assert.equal(result.ok, true);
    assert.equal(requests, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
