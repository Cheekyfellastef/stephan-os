import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { BATTLE_BRIDGE_WINDOWS_HOST } from '../../../../shared/agents/battleBridgeWindowsHosts.mjs';
import { classifyAllowlistedRecoveryAdapterBlocker } from '../../../../shared/agents/recoveryAdapterBlockerClassifier.mjs';

export const OPENCLAW_RECOVERY_ROUTE = 'OPENCLAW_WHATSAPP';

const FIXED_RECOVERY_ADAPTER_BLOCKERS = Object.freeze([
  'RECOVERY_PATH_REPARSE_ANCESTOR_REJECTED',
  'RECOVERY_PATH_ANCESTOR_IDENTITY_CHANGED',
  'OPENCLAW_HOST_PROOF_REQUIRED',
  'OPENCLAW_HOST_PROOF_INVALID',
  'OPENCLAW_HOST_PROCESS_IDENTITY_INVALID',
  'OPENCLAW_GATEWAY_PROCESS_OWNERSHIP_INVALID',
  'OPENCLAW_GATEWAY_RUNTIME_IDENTITY_INVALID',
  'OPENCLAW_HOST_PROOF_ALREADY_CONSUMED',
  'RECOVERY_MESH_TASK_NOT_INSTALLED',
  'RECOVERY_MESH_TASK_ACTION_INVALID',
  'RECOVERY_MESH_TASK_PRINCIPAL_INVALID',
  'RECOVERY_MESH_TASK_SETTINGS_INVALID',
  'RECOVERY_MESH_TASK_START_FAILED',
]);

function fixedRecoveryAdapterBlocker(result = {}) {
  return classifyAllowlistedRecoveryAdapterBlocker({
    stdout: result?.stdout,
    stderr: result?.stderr,
    allowlist: FIXED_RECOVERY_ADAPTER_BLOCKERS,
    fallback: '',
  });
}

function buildOpenClawHostProof({ authenticatedContext, runtimeId, now = new Date(), nonce = randomUUID(), hostPid = process.pid } = {}) {
  if (authenticatedContext?.authenticatedByHost !== true || authenticatedContext?.commandName !== 'stephanos-ignite'
    || authenticatedContext?.command !== 'wake') throw new Error('RECOVERY_WAKE_OPENCLAW_AUTH_REQUIRED');
  const proofId = String(nonce).replace(/[^a-f0-9]/gi, '').toLowerCase().slice(0, 32);
  if (!/^[a-f0-9]{32}$/.test(proofId)) throw new Error('RECOVERY_WAKE_EVIDENCE_ID_INVALID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/.test(String(runtimeId || ''))) throw new Error('RECOVERY_WAKE_GATEWAY_IDENTITY_REQUIRED');
  return Object.freeze({
    schemaVersion: 'stephanos.openclaw-authenticated-recovery-command.v1',
    proofId,
    route: OPENCLAW_RECOVERY_ROUTE,
    command: 'wake',
    subject: 'openclaw:authenticated-operator',
    authenticatedByHost: true,
    commandSurface: 'openclaw.plugin-sdk.authenticated-command',
    hostPid,
    runtimeId: String(runtimeId),
    issuedAtUtc: now.toISOString(),
    expiresAtUtc: new Date(now.getTime() + 60_000).toISOString(),
  });
}

function writeOpenClawHostProof({ env = process.env, proof } = {}) {
  if (!env.USERPROFILE) throw new Error('RECOVERY_WAKE_USERPROFILE_REQUIRED');
  const root = path.resolve(env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace', 'receipts', 'openclaw-authenticated-command');
  const existingAncestorIdentities = new Map();
  let cursor = path.parse(root).root;
  for (const part of root.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const info = lstatSync(cursor);
      if (info.isSymbolicLink() || path.resolve(realpathSync(cursor)).toLowerCase() !== path.resolve(cursor).toLowerCase()) {
        throw new Error('RECOVERY_WAKE_HOST_PROOF_LINKED_ANCESTOR');
      }
      existingAncestorIdentities.set(cursor, `${info.dev}:${info.ino}:${info.mode}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  mkdirSync(root, { recursive: true });
  for (const [pathname, identity] of existingAncestorIdentities) {
    const info = lstatSync(pathname);
    if (info.isSymbolicLink() || `${info.dev}:${info.ino}:${info.mode}` !== identity
      || path.resolve(realpathSync(pathname)).toLowerCase() !== path.resolve(pathname).toLowerCase()) {
      throw new Error('RECOVERY_WAKE_HOST_PROOF_ANCESTOR_CHANGED');
    }
  }
  const proofPath = path.resolve(root, `${proof.proofId}.json`);
  const relative = path.relative(root, proofPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('RECOVERY_WAKE_HOST_PROOF_PATH_INVALID');
  const descriptor = openSync(proofPath, 'wx', 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(proof, null, 2)}\n`, 'utf8'); } finally { closeSync(descriptor); }
  return Object.freeze({ proofId: proof.proofId, proofPath });
}

export function buildFixedRecoveryWakeInvocation({ env = process.env, hostProofId } = {}) {
  if (!env.USERPROFILE) throw new Error('RECOVERY_WAKE_USERPROFILE_REQUIRED');
  const scriptPath = path.resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os', 'scripts', 'windows', 'request-battle-bridge-recovery-openclaw.ps1');
  if (!/^[a-f0-9]{32}$/.test(String(hostProofId || ''))) throw new Error('RECOVERY_WAKE_HOST_PROOF_REQUIRED');
  return Object.freeze({
    executable: BATTLE_BRIDGE_WINDOWS_HOST.powershell,
    args: Object.freeze([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      '-OpenClawHostProofId', hostProofId,
    ]),
    cwd: path.resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os'),
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryArgumentsAllowed: false,
    sourceMutationAllowed: false,
  });
}

function authenticatedOpenClawHostRuntimeId(authenticatedContext, hostPid) {
  if (authenticatedContext?.authenticatedByHost !== true || authenticatedContext?.commandName !== 'stephanos-ignite'
    || authenticatedContext?.command !== 'wake') throw new Error('RECOVERY_WAKE_OPENCLAW_AUTH_REQUIRED');
  if (!Number.isSafeInteger(hostPid) || hostPid < 1) throw new Error('RECOVERY_WAKE_GATEWAY_IDENTITY_REQUIRED');
  return `openclaw-plugin-host:${hostPid}`;
}

async function readOpenClawGatewayIdentity(fetchFn, { authenticatedContext, hostPid = process.pid } = {}) {
  try {
    const response = await fetchFn('http://127.0.0.1:18789/identity', { signal: AbortSignal.timeout(5_000) });
    if (response?.ok) {
      const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
      if (!contentType || contentType.includes('json')) {
        try {
          const identity = await response.json();
          if (identity?.product === 'OpenClaw' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/.test(String(identity?.runtimeId || ''))) {
            return Object.freeze({ runtimeId: String(identity.runtimeId), source: 'gateway-identity-endpoint' });
          }
        } catch {
          // Older/current OpenClaw builds may serve the control page at /identity.
          // The authenticated plugin host remains a live, bounded runtime identity source.
        }
      }
    }
  } catch {
    // The identity endpoint is optional. The command is already executing inside
    // the authenticated OpenClaw plugin host, so use that live process identity.
  }
  return Object.freeze({
    runtimeId: authenticatedOpenClawHostRuntimeId(authenticatedContext, hostPid),
    source: 'authenticated-plugin-host',
  });
}

export async function wakeBattleBridgeRecoveryMesh({
  platform = process.platform,
  env = process.env,
  spawnSyncFn = spawnSync,
  authenticatedContext = null,
  now = new Date(),
  nonce,
  hostPid = process.pid,
  writeHostProofFn = writeOpenClawHostProof,
  fetchFn = fetch,
} = {}) {
  if (platform !== 'win32') return Object.freeze({ ok: false, blocker: 'RECOVERY_WAKE_WINDOWS_REQUIRED' });
  let invocation;
  try {
    const identity = await readOpenClawGatewayIdentity(fetchFn, { authenticatedContext, hostPid });
    const proof = buildOpenClawHostProof({ authenticatedContext, runtimeId: identity.runtimeId, now, nonce, hostPid });
    const written = writeHostProofFn({ env, proof });
    invocation = buildFixedRecoveryWakeInvocation({ env, hostProofId: written.proofId });
  } catch (error) {
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
    const adapterBlocker = fixedRecoveryAdapterBlocker(result);
    return Object.freeze({
      ok: false,
      blocker: adapterBlocker || 'RECOVERY_WAKE_FIXED_ADAPTER_FAILED',
      exitCode: result?.status ?? null,
    });
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
