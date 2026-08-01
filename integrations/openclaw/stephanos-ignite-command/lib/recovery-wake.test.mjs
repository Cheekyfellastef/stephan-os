import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildFixedRecoveryWakeInvocation, buildOpenClawHostProof, wakeBattleBridgeRecoveryMesh, writeOpenClawHostProof } from './recovery-wake.mjs';

test('wake invocation is fully fixed and cannot accept a command, task or route', () => {
  const invocation = buildFixedRecoveryWakeInvocation({
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    hostProofId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
  });
  assert.equal(invocation.executable, 'powershell.exe');
  assert.ok(invocation.args.includes('OPENCLAW_WHATSAPP'));
  assert.ok(invocation.args.includes('-OpenClawHostProofId'));
  assert.ok(invocation.args.includes('aaaaaaaabbbbccccddddeeeeeeeeeeee'));
  assert.match(invocation.args[5], /request-battle-bridge-recovery\.ps1$/);
  assert.equal(invocation.arbitraryShellAllowed, false);
  assert.equal(invocation.arbitraryArgumentsAllowed, false);
});

test('host proof is bound to the authenticated fixed OpenClaw command', () => {
  const proof = buildOpenClawHostProof({
    authenticatedContext: { authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'wake' },
    now: new Date('2026-08-01T03:00:00.000Z'), nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', hostPid: 1234,
  });
  assert.equal(proof.proofId, 'aaaaaaaabbbbccccddddeeeeeeeeeeee');
  assert.equal(proof.hostPid, 1234);
  assert.equal(proof.authenticatedByHost, true);
  assert.throws(() => buildOpenClawHostProof({ authenticatedContext: { authenticatedByHost: true, commandName: 'other', command: 'wake' } }), /AUTH_REQUIRED/);
});

test('host proof writer rejects a linked workspace ancestor', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openclaw-recovery-proof-'));
  const victim = path.join(root, 'victim');
  mkdirSync(victim);
  mkdirSync(path.join(root, 'Documents'));
  symlinkSync(victim, path.join(root, 'Documents', 'Stephanos-openclaw-workspace'), 'dir');
  const proof = buildOpenClawHostProof({
    authenticatedContext: { authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'wake' },
    now: new Date('2026-08-01T03:00:00.000Z'), nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', hostPid: 1234,
  });
  assert.throws(() => writeOpenClawHostProof({ env: { USERPROFILE: root }, proof }), /LINKED_ANCESTOR/);
});

test('authenticated adapter returns only a sanitized queued receipt', () => {
  const result = wakeBattleBridgeRecoveryMesh({
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    authenticatedContext: { authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'wake' },
    now: new Date('2026-08-01T03:00:00.000Z'),
    nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    writeHostProofFn: ({ proof }) => ({ proofId: proof.proofId }),
    spawnSyncFn: (executable, args, options) => {
      assert.equal(executable, 'powershell.exe');
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.ok(args.includes('OPENCLAW_WHATSAPP'));
      assert.ok(args.includes('-OpenClawHostProofId'));
      return { status: 0, stdout: JSON.stringify({ queued: true, requestId: 'recovery-openclaw-0001', route: 'OPENCLAW_WHATSAPP', coordinatorTask: 'Stephanos Battle Bridge Recovery Mesh' }) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.requestId, 'recovery-openclaw-0001');
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.sourceMutationAllowed, false);
});

test('non-Windows and failed fixed adapter calls fail closed', () => {
  assert.equal(wakeBattleBridgeRecoveryMesh({ platform: 'linux' }).blocker, 'RECOVERY_WAKE_WINDOWS_REQUIRED');
  assert.equal(wakeBattleBridgeRecoveryMesh({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\Stephan Callear' } }).blocker, 'RECOVERY_WAKE_OPENCLAW_AUTH_REQUIRED');
  assert.equal(wakeBattleBridgeRecoveryMesh({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\Stephan Callear' }, authenticatedContext: { authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'wake' }, nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', writeHostProofFn: ({ proof }) => ({ proofId: proof.proofId }), spawnSyncFn: () => ({ status: 5 }) }).blocker, 'RECOVERY_WAKE_FIXED_ADAPTER_FAILED');
});
