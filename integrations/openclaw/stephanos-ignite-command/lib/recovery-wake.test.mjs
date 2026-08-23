import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildFixedRecoveryWakeInvocation, wakeBattleBridgeRecoveryMesh } from './recovery-wake.mjs';

const authenticatedContext = { authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'wake' };
const identityFetch = async () => ({ ok: true, async json() { return { product: 'OpenClaw', runtimeId: 'openclaw-runtime-001' }; } });
const htmlControlPageFetch = async () => ({
  ok: true,
  headers: { get(name) { return String(name).toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : ''; } },
  async json() { throw new SyntaxError('Unexpected token < in JSON'); },
});

test('wake invocation is fully fixed and cannot accept a command, task or route', () => {
  const invocation = buildFixedRecoveryWakeInvocation({
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    hostProofId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
  });
  assert.equal(invocation.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.ok(invocation.args.includes('-OpenClawHostProofId'));
  assert.ok(invocation.args.includes('aaaaaaaabbbbccccddddeeeeeeeeeeee'));
  assert.ok(!invocation.args.includes('OPENCLAW_WHATSAPP'));
  assert.match(invocation.args[5], /request-battle-bridge-recovery-openclaw\.ps1$/);
  assert.equal(invocation.arbitraryShellAllowed, false);
  assert.equal(invocation.arbitraryArgumentsAllowed, false);
});

test('host proof writer rejects a linked workspace ancestor', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openclaw-recovery-proof-'));
  const victim = path.join(root, 'victim');
  mkdirSync(victim);
  mkdirSync(path.join(root, 'Documents'));
  symlinkSync(victim, path.join(root, 'Documents', 'Stephanos-openclaw-workspace'), 'dir');
  const result = await wakeBattleBridgeRecoveryMesh({ platform: 'win32', env: { USERPROFILE: root }, authenticatedContext,
    now: new Date('2026-08-01T03:00:00.000Z'), nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fetchFn: identityFetch });
  assert.equal(result.blocker, 'RECOVERY_WAKE_HOST_PROOF_LINKED_ANCESTOR');
});

test('authenticated adapter binds live gateway identity and returns only a sanitized queued receipt', async () => {
  let writtenProof;
  const result = await wakeBattleBridgeRecoveryMesh({
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    authenticatedContext,
    now: new Date('2026-08-01T03:00:00.000Z'),
    nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    fetchFn: identityFetch,
    writeHostProofFn: ({ proof }) => { writtenProof = proof; return { proofId: proof.proofId }; },
    spawnSyncFn: (executable, args, options) => {
      assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.ok(args.includes('-OpenClawHostProofId'));
      assert.ok(!args.includes('OPENCLAW_WHATSAPP'));
      return { status: 0, stdout: JSON.stringify({ queued: true, requestId: 'recovery-openclaw-0001', route: 'OPENCLAW_WHATSAPP', coordinatorTask: 'Stephanos Battle Bridge Recovery Mesh' }) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.requestId, 'recovery-openclaw-0001');
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(writtenProof.runtimeId, 'openclaw-runtime-001');
  assert.equal(writtenProof.hostPid, process.pid);
});

test('authenticated OpenClaw plugin host is a bounded fallback when /identity serves the HTML control page', async () => {
  let writtenProof;
  const result = await wakeBattleBridgeRecoveryMesh({
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    authenticatedContext,
    hostPid: 4321,
    now: new Date('2026-08-01T03:00:00.000Z'),
    nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    fetchFn: htmlControlPageFetch,
    writeHostProofFn: ({ proof }) => { writtenProof = proof; return { proofId: proof.proofId }; },
    spawnSyncFn: () => ({ status: 0, stdout: JSON.stringify({ queued: true, requestId: 'recovery-openclaw-0002', route: 'OPENCLAW_WHATSAPP', coordinatorTask: 'Stephanos Battle Bridge Recovery Mesh' }) }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.requestId, 'recovery-openclaw-0002');
  assert.equal(writtenProof.runtimeId, 'openclaw-plugin-host:4321');
  assert.equal(writtenProof.hostPid, 4321);
});

test('failed fixed adapter projects only an allowlisted blocker code and never raw stderr', async () => {
  const specific = await wakeBattleBridgeRecoveryMesh({
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    authenticatedContext,
    nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    fetchFn: identityFetch,
    writeHostProofFn: ({ proof }) => ({ proofId: proof.proofId }),
    spawnSyncFn: () => ({
      status: 1,
      stderr: 'RECOVERY_MESH_TASK_NOT_INSTALLED',
    }),
  });
  assert.deepEqual(specific, {
    ok: false,
    blocker: 'RECOVERY_MESH_TASK_NOT_INSTALLED',
    exitCode: 1,
  });

  const opaque = await wakeBattleBridgeRecoveryMesh({
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    authenticatedContext,
    nonce: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
    fetchFn: identityFetch,
    writeHostProofFn: ({ proof }) => ({ proofId: proof.proofId }),
    spawnSyncFn: () => ({ status: 5, stderr: 'C:\\private\\credential-shaped-path access denied' }),
  });
  assert.deepEqual(opaque, {
    ok: false,
    blocker: 'RECOVERY_WAKE_FIXED_ADAPTER_FAILED',
    exitCode: 5,
  });
  assert.doesNotMatch(JSON.stringify(opaque), /private|credential|Stephan/i);
});

test('failed fixed adapter accepts a complete PowerShell FullyQualifiedErrorId', async () => {
  const result = await wakeBattleBridgeRecoveryMesh({
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    authenticatedContext,
    nonce: 'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa',
    fetchFn: identityFetch,
    writeHostProofFn: ({ proof }) => ({ proofId: proof.proofId }),
    spawnSyncFn: () => ({ status: 1, stderr: '+ FullyQualifiedErrorId : OPENCLAW_HOST_PROOF_REQUIRED' }),
  });
  assert.deepEqual(result, { ok: false, blocker: 'OPENCLAW_HOST_PROOF_REQUIRED', exitCode: 1 });
});

test('quoted source, prose, ambiguous codes, and malformed qualified identifiers fail to the generic blocker', async () => {
  const outputs = [
    "At adapter.ps1:27 throw 'OPENCLAW_HOST_PROOF_REQUIRED'",
    'adapter failed because OPENCLAW_HOST_PROOF_REQUIRED was mentioned in prose',
    'OPENCLAW_HOST_PROOF_REQUIRED\nRECOVERY_MESH_TASK_NOT_INSTALLED',
    'FullyQualifiedErrorId : OPENCLAW_HOST_PROOF_REQUIRED,RemoteException',
  ];
  for (const [index, stderr] of outputs.entries()) {
    const result = await wakeBattleBridgeRecoveryMesh({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      authenticatedContext,
      nonce: `${String(index + 1).repeat(8)}-bbbb-cccc-dddd-eeeeeeeeeeee`,
      fetchFn: identityFetch,
      writeHostProofFn: ({ proof }) => ({ proofId: proof.proofId }),
      spawnSyncFn: () => ({ status: 1, stderr }),
    });
    assert.deepEqual(result, { ok: false, blocker: 'RECOVERY_WAKE_FIXED_ADAPTER_FAILED', exitCode: 1 });
  }
});

test('non-Windows, unauthenticated, identity-less and failed adapter calls fail closed', async () => {
  assert.equal((await wakeBattleBridgeRecoveryMesh({ platform: 'linux' })).blocker, 'RECOVERY_WAKE_WINDOWS_REQUIRED');
  assert.equal((await wakeBattleBridgeRecoveryMesh({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\Stephan Callear' }, fetchFn: identityFetch })).blocker, 'RECOVERY_WAKE_OPENCLAW_AUTH_REQUIRED');
  assert.equal((await wakeBattleBridgeRecoveryMesh({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\Stephan Callear' }, authenticatedContext, hostPid: 0, fetchFn: async () => ({ ok: false }) })).blocker, 'RECOVERY_WAKE_GATEWAY_IDENTITY_REQUIRED');
  assert.equal((await wakeBattleBridgeRecoveryMesh({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\Stephan Callear' }, authenticatedContext, nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fetchFn: identityFetch, writeHostProofFn: ({ proof }) => ({ proofId: proof.proofId }), spawnSyncFn: () => ({ status: 5 }) })).blocker, 'RECOVERY_WAKE_FIXED_ADAPTER_FAILED');
});
