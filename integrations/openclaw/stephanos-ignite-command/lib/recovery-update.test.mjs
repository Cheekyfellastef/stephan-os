import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeOpenClawExactHead,
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
  assert.equal(result.runtimeProofPassed, true);
  assert.equal(result.servedUiExactHead, true);
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
