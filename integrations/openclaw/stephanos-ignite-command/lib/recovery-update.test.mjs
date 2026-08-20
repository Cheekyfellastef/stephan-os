import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

test('owner update queues a fixed detached executor and returns a durable receipt without awaiting recovery', () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'ignite-update-'));
  const calls = [];
  const result = queueBattleBridgeExactHeadFromOpenClaw({
    expectedHead: HEAD,
    authenticatedContext: OWNER,
    platform: 'win32',
    env: { USERPROFILE: profile },
    nonce: '1'.repeat(32),
    now: new Date('2026-08-20T00:00:00.000Z'),
    spawnFn: (command, args, options) => {
      calls.push({ command, args, options });
      return { unref() { calls.push({ unref: true }); } };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'QUEUED');
  assert.equal(result.runtimeProofPassed, false);
  assert.equal(result.pluginReloadProofPending, true);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args.slice(1), ['1'.repeat(32), HEAD]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[1], { unref: true });
  const receipt = JSON.parse(readFileSync(path.join(profile, 'Documents', 'Stephanos-openclaw-workspace', 'receipts', 'exact-head-update', `${'1'.repeat(32)}.json`), 'utf8'));
  assert.equal(receipt.status, 'QUEUED');
  assert.equal(receipt.pluginReloadProof, 'PENDING');
});
