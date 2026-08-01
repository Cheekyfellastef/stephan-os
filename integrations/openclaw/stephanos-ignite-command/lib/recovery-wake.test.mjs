import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFixedRecoveryWakeInvocation, wakeBattleBridgeRecoveryMesh } from './recovery-wake.mjs';

test('wake invocation is fully fixed and cannot accept a command, task or route', () => {
  const invocation = buildFixedRecoveryWakeInvocation({
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    authenticatedByHost: true,
    now: new Date('2026-08-01T03:00:00.000Z'),
    nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  });
  assert.equal(invocation.executable, 'powershell.exe');
  assert.ok(invocation.args.includes('OPENCLAW_WHATSAPP'));
  assert.ok(invocation.args.includes('openclaw-authenticated-command'));
  assert.ok(invocation.args.includes('openclaw:authenticated-operator'));
  assert.match(invocation.args[5], /request-battle-bridge-recovery\.ps1$/);
  assert.equal(invocation.arbitraryShellAllowed, false);
  assert.equal(invocation.arbitraryArgumentsAllowed, false);
});

test('authenticated adapter returns only a sanitized queued receipt', () => {
  const result = wakeBattleBridgeRecoveryMesh({
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    authenticatedByHost: true,
    now: new Date('2026-08-01T03:00:00.000Z'),
    nonce: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    spawnSyncFn: (executable, args, options) => {
      assert.equal(executable, 'powershell.exe');
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.ok(args.includes('OPENCLAW_WHATSAPP'));
      assert.ok(args.includes('openclaw-authenticated-command'));
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
  assert.equal(wakeBattleBridgeRecoveryMesh({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\Stephan Callear' }, authenticatedByHost: true, spawnSyncFn: () => ({ status: 5 }) }).blocker, 'RECOVERY_WAKE_FIXED_ADAPTER_FAILED');
});
