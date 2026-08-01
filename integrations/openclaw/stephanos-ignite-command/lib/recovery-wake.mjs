import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const OPENCLAW_RECOVERY_ROUTE = 'OPENCLAW_WHATSAPP';

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
  const scriptPath = path.resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os', 'scripts', 'windows', 'request-battle-bridge-recovery.ps1');
  if (!/^[a-f0-9]{32}$/.test(String(hostProofId || ''))) throw new Error('RECOVERY_WAKE_HOST_PROOF_REQUIRED');
  return Object.freeze({
    executable: 'powershell.exe',
    args: Object.freeze([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      '-Route', OPENCLAW_RECOVERY_ROUTE,
      '-OpenClawHostProofId', hostProofId,
    ]),
    cwd: path.resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os'),
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryArgumentsAllowed: false,
    sourceMutationAllowed: false,
  });
}

async function readOpenClawGatewayIdentity(fetchFn) {
  const response = await fetchFn('http://127.0.0.1:18789/identity', { signal: AbortSignal.timeout(5_000) });
  if (!response?.ok) throw new Error('RECOVERY_WAKE_GATEWAY_IDENTITY_REQUIRED');
  const identity = await response.json();
  if (identity?.product !== 'OpenClaw' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/.test(String(identity?.runtimeId || ''))) {
    throw new Error('RECOVERY_WAKE_GATEWAY_IDENTITY_REQUIRED');
  }
  return Object.freeze({ runtimeId: String(identity.runtimeId) });
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
    const identity = await readOpenClawGatewayIdentity(fetchFn);
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
