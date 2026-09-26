import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyAllowlistedRecoveryAdapterBlocker } from './recoveryAdapterBlockerClassifier.mjs';

const allowlist = ['SAFE_BLOCKER_A', 'SAFE_BLOCKER_B'];

test('shared classifier accepts one whole-line or complete PowerShell blocker', () => {
  assert.equal(classifyAllowlistedRecoveryAdapterBlocker({ stdout: 'safe_blocker_a', allowlist, fallback: 'GENERIC' }), 'SAFE_BLOCKER_A');
  assert.equal(classifyAllowlistedRecoveryAdapterBlocker({ stderr: '+ FullyQualifiedErrorId : SAFE_BLOCKER_B', allowlist, fallback: 'GENERIC' }), 'SAFE_BLOCKER_B');
  assert.equal(classifyAllowlistedRecoveryAdapterBlocker({ stderr: 'request-battle-bridge-recovery.ps1 : SAFE_BLOCKER_A', allowlist, fallback: 'GENERIC' }), 'SAFE_BLOCKER_A');
  assert.equal(classifyAllowlistedRecoveryAdapterBlocker({ stderr: 'noise\r\nSAFE_BLOCKER_A\r\n', allowlist, fallback: 'GENERIC' }), 'SAFE_BLOCKER_A');
});

test('Recovery Mesh fallback admits only its fixed canonical-mailbox authority blocker', () => {
  const stderr = 'request-battle-bridge-recovery.ps1 : RECOVERY_CANONICAL_MAILBOX_AUTHORITY_INVALID';
  assert.equal(
    classifyAllowlistedRecoveryAdapterBlocker({ stderr, allowlist, fallback: 'RECOVERY_MESH_WAKE_ADAPTER_FAILED' }),
    'RECOVERY_CANONICAL_MAILBOX_AUTHORITY_INVALID',
  );
  assert.equal(classifyAllowlistedRecoveryAdapterBlocker({ stderr, allowlist, fallback: 'GENERIC' }), 'GENERIC');
  assert.equal(classifyAllowlistedRecoveryAdapterBlocker({ stderr, allowlist, fallback: '' }), '');
});

test('Recovery Mesh fallback projects only a bounded safe PowerShell runtime class', () => {
  const stderr = [
    'Test-Path : Access is denied',
    'At request-battle-bridge-recovery.ps1:265 char:9',
    '    + CategoryInfo          : PermissionDenied: (:) [Test-Path], UnauthorizedAccessException',
    '    + FullyQualifiedErrorId : UnauthorizedAccess,Microsoft.PowerShell.Commands.TestPathCommand',
  ].join('\n');
  assert.equal(
    classifyAllowlistedRecoveryAdapterBlocker({ stderr, allowlist, fallback: 'RECOVERY_MESH_WAKE_ADAPTER_FAILED' }),
    'RECOVERY_MESH_WAKE_PERMISSION_DENIED',
  );
  assert.equal(classifyAllowlistedRecoveryAdapterBlocker({ stderr, allowlist, fallback: 'GENERIC' }), 'GENERIC');
});

test('shared classifier rejects excerpts, prose, ambiguity, and unknown identifiers', () => {
  for (const stderr of [
    "throw 'SAFE_BLOCKER_A'",
    'failure mentions SAFE_BLOCKER_A in prose',
    'SAFE_BLOCKER_A\nSAFE_BLOCKER_B',
    '+ FullyQualifiedErrorId : SAFE_BLOCKER_A,RemoteException',
    '+ FullyQualifiedErrorId : UNKNOWN_BLOCKER',
    'SAFE_BLOCKER\r_A',
    'FullyQualified\rErrorId : SAFE_BLOCKER_A',
    'SAFE_BLOCKER_A\r',
  ]) assert.equal(classifyAllowlistedRecoveryAdapterBlocker({ stderr, allowlist, fallback: 'GENERIC' }), 'GENERIC');
});

test('ambiguous Recovery Mesh runtime classes remain generic', () => {
  assert.equal(
    classifyAllowlistedRecoveryAdapterBlocker({
      stderr: [
        '+ FullyQualifiedErrorId : UnauthorizedAccess,Microsoft.PowerShell.Commands.TestPathCommand',
        '+ FullyQualifiedErrorId : MethodInvocationException',
      ].join('\n'),
      allowlist,
      fallback: 'RECOVERY_MESH_WAKE_ADAPTER_FAILED',
    }),
    'RECOVERY_MESH_WAKE_ADAPTER_FAILED',
  );
});
