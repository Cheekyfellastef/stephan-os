import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyBackendStartupFailureText,
  classifyLatestBackendStartupFailure,
} from './backendColdStartFailureClassifierV1.mjs';
import {
  BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
  executeApprovedBackendRestartOnBattleBridge,
} from './battleBridgeApprovedBackendRestartMailboxV1.mjs';

const HEAD = 'a'.repeat(40);

function command() {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'backend-cold-start-proof-0001',
    operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-09-11T23:00:00.000Z',
  };
}

test('backend startup text maps exact cold-start failures without publishing raw evidence', () => {
  assert.equal(
    classifyBackendStartupFailureText('Error: BACKEND_CHILD_EXACT_HEAD_MODULE_BLOB_FAILED path=stephanos-server/server.js'),
    'BACKEND_CHILD_EXACT_HEAD_MODULE_BLOB_FAILED',
  );
  assert.equal(
    classifyBackendStartupFailureText('Backend startup requires source-tracked files to be unmodified at exact head.'),
    'BACKEND_START_SOURCE_DIRTY',
  );
  assert.equal(classifyBackendStartupFailureText('something unknown happened'), '');
});

test('latest startup classifier reads only bounded canonical backend-start logs from the current attempt', () => {
  const reads = [];
  const attemptStartedAtMs = 1_000_000;
  const result = classifyLatestBackendStartupFailure('C:\\Users\\Stef\\Documents\\GitHub\\stephan-os', {
    attemptStartedAtMs,
    nowMs: attemptStartedAtMs + 90_000,
    readdirSyncFn: () => [
      'backend-start-20260911-210000.stderr.log',
      'secret.log',
      '..\\outside.log',
    ],
    statSyncFn: () => ({ mtimeMs: attemptStartedAtMs + 1_000, size: 120, isFile: () => true }),
    readFileSyncFn: (file) => {
      reads.push(file);
      return 'Error: BACKEND_CHILD_EXPECTED_HEAD_MISMATCH expected=aaa observed=bbb';
    },
  });

  assert.equal(result.classified, true);
  assert.equal(result.blocker, 'BACKEND_CHILD_EXPECTED_HEAD_MISMATCH');
  assert.equal(result.rawEvidencePublished, false);
  assert.equal(reads.length, 1);
  assert.match(reads[0], /\\logs\\battle-bridge\\backend-start-20260911-210000\.stderr\.log$/i);
  assert.doesNotMatch(JSON.stringify(result), /expected=|observed=|Users\\Stef/i);
});

test('approved backend restart replaces opaque health timeout with bounded startup classification', async () => {
  const result = await executeApprovedBackendRestartOnBattleBridge(command(), {
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stef', SystemRoot: 'C:\\Windows' },
    existsSyncFn: () => true,
    nowMsFn: () => 1_000_000,
    startupFailureClassifier: (_repoRoot, options) => {
      assert.equal(options.attemptStartedAtMs, 1_000_000);
      return { blocker: 'BACKEND_CHILD_EXACT_HEAD_MODULE_BLOB_FAILED', classified: true, rawEvidencePublished: false };
    },
    spawnSyncFn: () => ({
      status: 2,
      stdout: `${JSON.stringify({ ok: false, blocker: 'BACKEND_HEALTH_TIMEOUT' })}\n`,
      stderr: '',
      error: null,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BACKEND_CHILD_EXACT_HEAD_MODULE_BLOB_FAILED');
  assert.equal(result.finalVerdict, 'APPROVED_BACKEND_RESTART_BLOCKED');
  assert.equal(result.expectedHead, HEAD);
  assert.doesNotMatch(JSON.stringify(result), /path=|stderr|raw/i);
});

test('approved backend restart preserves timeout when no bounded classification exists', async () => {
  const result = await executeApprovedBackendRestartOnBattleBridge(command(), {
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stef', SystemRoot: 'C:\\Windows' },
    existsSyncFn: () => true,
    nowMsFn: () => 1_000_000,
    startupFailureClassifier: () => ({ blocker: '', classified: false, rawEvidencePublished: false }),
    spawnSyncFn: () => ({
      status: 2,
      stdout: `${JSON.stringify({ ok: false, blocker: 'BACKEND_HEALTH_TIMEOUT' })}\n`,
      stderr: '',
      error: null,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BACKEND_HEALTH_TIMEOUT');
});
