import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const OPENCLAW_RECOVERY_ROUTE = 'OPENCLAW_WHATSAPP';

export function buildFixedRecoveryWakeInvocation({ env = process.env } = {}) {
  if (!env.USERPROFILE) throw new Error('RECOVERY_WAKE_USERPROFILE_REQUIRED');
  const scriptPath = path.resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os', 'scripts', 'windows', 'request-battle-bridge-recovery.ps1');
  return Object.freeze({
    executable: 'powershell.exe',
    args: Object.freeze([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Route', OPENCLAW_RECOVERY_ROUTE,
    ]),
    cwd: path.resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os'),
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryArgumentsAllowed: false,
    sourceMutationAllowed: false,
  });
}

export function wakeBattleBridgeRecoveryMesh({
  platform = process.platform,
  env = process.env,
  spawnSyncFn = spawnSync,
} = {}) {
  if (platform !== 'win32') return Object.freeze({ ok: false, blocker: 'RECOVERY_WAKE_WINDOWS_REQUIRED' });
  let invocation;
  try { invocation = buildFixedRecoveryWakeInvocation({ env }); } catch (error) {
    return Object.freeze({ ok: false, blocker: error?.message || 'RECOVERY_WAKE_INVOCATION_INVALID' });
  }
  const result = spawnSyncFn(invocation.executable, invocation.args, {
    cwd: invocation.cwd,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  if (result?.error || result?.status !== 0) {
    return Object.freeze({ ok: false, blocker: 'RECOVERY_WAKE_FIXED_ADAPTER_FAILED', exitCode: result?.status ?? null });
  }
  let receipt;
  try { receipt = JSON.parse(String(result.stdout || '').replace(/^\uFEFF/, '')); } catch {
    return Object.freeze({ ok: false, blocker: 'RECOVERY_WAKE_RECEIPT_INVALID' });
  }
  return Object.freeze({
    ok: receipt?.queued === true && receipt?.route === OPENCLAW_RECOVERY_ROUTE,
    blocker: receipt?.queued === true ? '' : 'RECOVERY_WAKE_NOT_QUEUED',
    requestId: String(receipt?.requestId || ''),
    route: String(receipt?.route || ''),
    coordinatorTask: String(receipt?.coordinatorTask || ''),
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
  });
}
