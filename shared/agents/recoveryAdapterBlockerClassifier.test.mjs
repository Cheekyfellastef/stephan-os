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
