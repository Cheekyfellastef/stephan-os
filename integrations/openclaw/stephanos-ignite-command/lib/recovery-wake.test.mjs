import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildFixedRecoveryWakeInvocation, wakeBattleBridgeRecoveryMesh } from './recovery-wake.mjs';

const authenticatedContext = { authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'wake' };

test('wake invocation is fully fixed and cannot accept a command, task or route', () => {
  const invocation = buildFixedRecoveryWakeInvocation({
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    hostProofId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
  });
  assert.equal(invocation.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.ok(invocation.args.includes('OPENCLAW_WHATSAPP'));
  assert.ok(invocation.args.includes('-OpenClawHostProofId'));
  assert.ok(invocation.args.includes('aaaaaaaabbbbccccddddeeeeeeeeeeee'));
  assert.match(invocation.args[5], /request-battle-bridge-recovery\.ps1$/);
  assert.equal(invocation.arbitraryShellAllowed, false);
  assert.equal(invocation.arbitraryArgumentsAllowed, false);
});

test('host proof writer rejects a linked workspace ancestor', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openclaw-recovery-proof-'));
  const victim = path.join(root, 'victim');
  mkdirSync(victim);
  mkdirSync(path.join(root, 'Documents'));
  symlinkSync(victim, path.join(root, 'Documents', 'Stephanos-openclaw-workspace'), 'dir');
  const result = await wakeBattleBridgeRecoveryMesh({
    platform: 'win32',
    env: { USERPROFILE: root },
    authenticatedContext,
    now: new Date('2026-08-01T03:00:00.000Z'),
    nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    hostPid: 18789,
  });
  assert.equal(result.blocker, 'RECOVERY_WAKE_HOST_PROOF_LINKED_ANCESTOR');
});

test('authenticated adapter binds the OpenClaw host process identity and returns only a sanitized queued receipt', async () => {
  let writtenProof;
  const result = await wakeBattleBridgeRecoveryMesh({
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    authenticatedContext,
    now: new Date('2026-08-01T03:00:00.000Z'),
    nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    hostPid: 4242,
    writeHostProofFn: ({ proof }) => { writtenProof = proof; return { proofId: proof.proofId }; },
    spawnSyncFn: (executable, args, options) => {
      assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
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
  assert.equal(writtenProof.runtimeId, 'openclaw-host-pid:4242');
  assert.equal(writtenProof.hostPid, 4242);
});

test('wake path does not query the OpenClaw Control UI identity route', async () => {
  const source = readFileSync(new URL('./recovery-wake.mjs', import.meta.url), 'utf8');
  const recoveryScript = readFileSync(new URL('../../../../scripts/windows/request-battle-bridge-recovery.ps1', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /127\.0\.0\.1:18789\/identity|\.json\(\)/);
  assert.doesNotMatch(recoveryScript, /127\.0\.0\.1:18789\/identity|Invoke-RestMethod/);
  assert.match(source, /openclaw-host-pid:\$\{hostPid\}/);
  assert.match(recoveryScript, /OPENCLAW_HOST_RUNTIME_BINDING_INVALID/);
  assert.match(recoveryScript, /Get-NetTCPConnection -State Listen -LocalPort 18789/);
  assert.match(recoveryScript, /OwningProcess -eq \[int\]\$hostProof\.hostPid/);
});

test('non-Windows, unauthenticated, invalid host pid and failed adapter calls fail closed', async () => {
  assert.equal((await wakeBattleBridgeRecoveryMesh({ platform: 'linux' })).blocker, 'RECOVERY_WAKE_WINDOWS_REQUIRED');
  assert.equal((await wakeBattleBridgeRecoveryMesh({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\Stephan Callear' } })).blocker, 'RECOVERY_WAKE_OPENCLAW_AUTH_REQUIRED');
  assert.equal((await wakeBattleBridgeRecoveryMesh({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\Stephan Callear' }, authenticatedContext, hostPid: 0 })).blocker, 'RECOVERY_WAKE_GATEWAY_PROCESS_ID_REQUIRED');
  assert.equal((await wakeBattleBridgeRecoveryMesh({
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    authenticatedContext,
    hostPid: 4242,
    nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    writeHostProofFn: ({ proof }) => ({ proofId: proof.proofId }),
    spawnSyncFn: () => ({ status: 5 }),
  })).blocker, 'RECOVERY_WAKE_FIXED_ADAPTER_FAILED');
});
