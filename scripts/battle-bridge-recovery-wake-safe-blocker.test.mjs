import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRecoveryMeshWakeAdapterFailure,
  createSanitizedMailboxReceiptProjection,
} from './battle-bridge-github-command-mailbox.mjs';

const GENERIC = 'RECOVERY_MESH_WAKE_ADAPTER_FAILED';

test('projects one exact whole-line Recovery Mesh adapter blocker', () => {
  assert.equal(
    classifyRecoveryMeshWakeAdapterFailure({
      stderr: 'RECOVERY_MESH_TASK_SETTINGS_INVALID\r\nAt request-battle-bridge-recovery.ps1:327 char:5',
    }),
    'RECOVERY_MESH_TASK_SETTINGS_INVALID',
  );
});

test('projects the normal PowerShell script-prefixed allowlisted blocker form', () => {
  assert.equal(
    classifyRecoveryMeshWakeAdapterFailure({
      stderr: 'request-battle-bridge-recovery.ps1 : RECOVERY_MESH_TASK_SETTINGS_INVALID',
    }),
    'RECOVERY_MESH_TASK_SETTINGS_INVALID',
  );
});

test('projects an allowlisted PowerShell FullyQualifiedErrorId token', () => {
  assert.equal(
    classifyRecoveryMeshWakeAdapterFailure({
      stderr: '    + FullyQualifiedErrorId : RECOVERY_GITHUB_RECEIPT_AUTHORITY_INVALID',
    }),
    'RECOVERY_GITHUB_RECEIPT_AUTHORITY_INVALID',
  );
});

test('does not treat a blocker quoted only in a PowerShell source excerpt as emitted evidence', () => {
  assert.equal(
    classifyRecoveryMeshWakeAdapterFailure({
      stderr: [
        'Test-Path : Access is denied',
        'At request-battle-bridge-recovery.ps1:265 char:9',
        "+ if (-not (Test-Path -LiteralPath $gitExe -PathType Leaf)) { throw 'RECOVERY_CANONICAL_GIT_EXECUTABLE_MISSING' }",
        '+         ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
        '    + CategoryInfo          : PermissionDenied: (:) [Test-Path], UnauthorizedAccessException',
        '    + FullyQualifiedErrorId : UnauthorizedAccess,Microsoft.PowerShell.Commands.TestPathCommand',
      ].join('\n'),
    }),
    GENERIC,
  );
});

test('never promotes a process-spawn error field into Recovery Mesh runtime evidence', () => {
  assert.equal(
    classifyRecoveryMeshWakeAdapterFailure({ error: 'RECOVERY_MESH_TASK_NOT_INSTALLED' }),
    GENERIC,
  );
});

test('unknown adapter failures remain generic and do not echo sensitive text', () => {
  const sensitive = 'C:\\Users\\Stephan Callear\\.ssh\\id_ed25519 token=do-not-project';
  const blocker = classifyRecoveryMeshWakeAdapterFailure({ stderr: `Native failure ${sensitive}` });
  assert.equal(blocker, GENERIC);
  assert.equal(blocker.includes('Stephan'), false);
  assert.equal(blocker.includes('token'), false);
});

test('ambiguous multiple discrete allowlisted blockers remain generic', () => {
  assert.equal(
    classifyRecoveryMeshWakeAdapterFailure({
      stderr: 'RECOVERY_MESH_TASK_ACTION_INVALID\nRECOVERY_MESH_TASK_SETTINGS_INVALID',
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
