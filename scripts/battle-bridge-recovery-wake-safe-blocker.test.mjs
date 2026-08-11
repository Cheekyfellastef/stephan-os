import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRecoveryMeshWakeAdapterFailure,
  createSanitizedMailboxReceiptProjection,
} from './battle-bridge-github-command-mailbox.mjs';

const GENERIC = 'RECOVERY_MESH_WAKE_ADAPTER_FAILED';

test('projects one exact allowlisted Recovery Mesh adapter blocker', () => {
  assert.equal(
    classifyRecoveryMeshWakeAdapterFailure({
      stderr: 'At request-battle-bridge-recovery.ps1: throw RECOVERY_MESH_TASK_SETTINGS_INVALID',
    }),
    'RECOVERY_MESH_TASK_SETTINGS_INVALID',
  );
});

test('projects a known blocker from the bounded process error field', () => {
  assert.equal(
    classifyRecoveryMeshWakeAdapterFailure({ error: 'RECOVERY_GITHUB_RECEIPT_AUTHORITY_INVALID' }),
    'RECOVERY_GITHUB_RECEIPT_AUTHORITY_INVALID',
  );
});

test('unknown adapter failures remain generic and do not echo sensitive text', () => {
  const sensitive = 'C:\\Users\\Stephan Callear\\.ssh\\id_ed25519 token=do-not-project';
  const blocker = classifyRecoveryMeshWakeAdapterFailure({ stderr: `Native failure ${sensitive}` });
  assert.equal(blocker, GENERIC);
  assert.equal(blocker.includes('Stephan'), false);
  assert.equal(blocker.includes('token'), false);
});

test('ambiguous multiple allowlisted blockers remain generic', () => {
  assert.equal(
    classifyRecoveryMeshWakeAdapterFailure({
      stderr: 'RECOVERY_MESH_TASK_ACTION_INVALID RECOVERY_MESH_TASK_SETTINGS_INVALID',
    }),
    GENERIC,
  );
});

test('sanitized mailbox projection retains only the classified blocker, never raw adapter stderr', () => {
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'wake-safe-blocker-test',
    operation: 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH',
    state: 'BLOCKED',
    blocker: 'RECOVERY_MESH_TASK_ACTION_INVALID',
    result: {
      ok: false,
      verdict: 'COMMAND_EXECUTION_BLOCKED',
      operation: 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH',
      requestId: 'wake-safe-blocker-test',
      result: {
        ok: false,
        blocker: 'RECOVERY_MESH_TASK_ACTION_INVALID',
        stderr: 'C:\\Users\\Stephan Callear\\secret.txt token=do-not-project',
      },
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.blocker, 'RECOVERY_MESH_TASK_ACTION_INVALID');
  assert.equal(projected.operationResult.blocker, 'RECOVERY_MESH_TASK_ACTION_INVALID');
  assert.equal(Object.hasOwn(projected.operationResult, 'stderr'), false);
  assert.equal(JSON.stringify(projected).includes('secret.txt'), false);
  assert.equal(JSON.stringify(projected).includes('do-not-project'), false);
});
