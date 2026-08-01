#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  BATTLE_BRIDGE_RECOVERY_ACTION,
  BATTLE_BRIDGE_RECOVERY_AUTH_EVIDENCE_SCHEMA,
  BATTLE_BRIDGE_RECOVERY_EXECUTOR,
  BATTLE_BRIDGE_RECOVERY_INGRESS_SCHEMA,
  BATTLE_BRIDGE_RECOVERY_ROUTE,
  BATTLE_BRIDGE_RECOVERY_ROUTES,
  adjudicateBattleBridgeRecoveryMesh,
} from '../shared/agents/battleBridgeRecoveryMeshV1.mjs';
import {
  appendWorkspaceJsonl,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';

export const BATTLE_BRIDGE_RECOVERY_MESH_RUNNER_SCHEMA = 'stephanos.battle-bridge-recovery-mesh-runner.v1';
export const BATTLE_BRIDGE_RECOVERY_MESH_TASK = 'Stephanos Battle Bridge Recovery Mesh';
export const BATTLE_BRIDGE_RECOVERY_MESH_LOCK_STALE_MS = 3 * 60 * 1000;
export const BATTLE_BRIDGE_WINDOWS_POWERSHELL_EXECUTABLE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
export const BATTLE_BRIDGE_WINDOWS_GIT_EXECUTABLE = 'C:\\Program Files\\Git\\cmd\\git.exe';
const MAX_INGRESS_BYTES = 16 * 1024;
const MAX_STATE_BYTES = 128 * 1024;
const LOCK_TOKEN = /^[a-f0-9-]{36}$/;
const AUTH_RECEIPT_SCHEMA = 'stephanos.battle-bridge-recovery-auth-receipt.v1';
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const EXACT_HEAD = /^[0-9a-f]{40}$/i;
const GITHUB_AUTHORITY_MAX_AGE_MS = 5 * 60 * 1000;

function text(value) {
  return String(value ?? '').trim();
}

function portable(value) {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase();
}

function defaultProcessIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function defaultSourceHeadReader(repoRoot) {
  const executable = process.platform === 'win32' ? BATTLE_BRIDGE_WINDOWS_GIT_EXECUTABLE : 'git';
  const result = spawnSync(executable, ['-C', path.resolve(repoRoot), 'rev-parse', 'HEAD'], {
    encoding: 'utf8', shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
  });
  const head = text(result?.stdout).toLowerCase();
  return result?.status === 0 && EXACT_HEAD.test(head) ? head : '';
}

export function createFixedRecoveryMeshMutexVerifier({ verifierScriptPath, spawnSyncFn = spawnSync } = {}) {
  const fixedPath = path.resolve(verifierScriptPath);
  return Object.freeze({
    verify({ launcherPid, nodePid = process.pid } = {}) {
      if (!Number.isSafeInteger(launcherPid) || launcherPid <= 0 || !Number.isSafeInteger(nodePid) || nodePid <= 0) {
        return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_MUTEX_ATTESTATION_PID_INVALID' });
      }
      const result = spawnSyncFn(BATTLE_BRIDGE_WINDOWS_POWERSHELL_EXECUTABLE, [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixedPath,
        '-LauncherPid', String(launcherPid), '-NodePid', String(nodePid),
      ], { encoding: 'utf8', shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
      return result?.status === 0 && text(result.stdout) === 'MUTEX_OWNERSHIP_VERIFIED=true'
        ? Object.freeze({ ok: true, blocker: '' })
        : Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_WINDOWS_MUTEX_NOT_ATTESTED' });
    },
  });
}

export function resolveRecoveryMeshPaths({ env = process.env, home = os.homedir() } = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  const repoRoot = path.resolve(userHome, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.resolve(userHome, 'Documents', 'Stephanos-openclaw-workspace');
  return Object.freeze({
    repoRoot,
    workspaceRoot,
    probeScriptPath: path.resolve(repoRoot, 'scripts', 'windows', 'probe-battle-bridge-recovery-mesh.ps1'),
    ingressRoot: path.resolve(workspaceRoot, 'requests', 'battle-bridge-recovery'),
    statePath: path.resolve(workspaceRoot, 'status', 'battle-bridge-recovery-mesh-state.json'),
    statusPath: path.resolve(workspaceRoot, 'status', 'battle-bridge-recovery-mesh-current.json'),
    lockPath: path.resolve(workspaceRoot, 'locks', 'battle-bridge-recovery-mesh.lock'),
  });
}

export function validateRecoveryMeshPaths(paths, expectedPaths) {
  for (const key of ['repoRoot', 'workspaceRoot', 'probeScriptPath', 'ingressRoot', 'statePath', 'statusPath', 'lockPath']) {
    if (portable(paths[key]) !== portable(expectedPaths[key])) return Object.freeze({ ok: false, blocker: `RECOVERY_MESH_NON_CANONICAL_${key.toUpperCase()}` });
  }
  const relative = path.relative(paths.repoRoot, paths.workspaceRoot);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_REPOSITORY_WORKSPACE_OVERLAP' });
  return Object.freeze({ ok: true, blocker: '' });
}

function ancestorPaths(target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const parts = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const ancestors = [];
  let cursor = parsed.root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    ancestors.push(cursor);
  }
  return ancestors;
}

export async function validateRecoveryMeshPathAncestors(paths, { baseline = null, additionalTargets = [] } = {}) {
  const identities = {};
  const targets = [
    paths.repoRoot,
    paths.workspaceRoot,
    paths.probeScriptPath,
    paths.ingressRoot,
    paths.statePath,
    paths.statusPath,
    paths.lockPath,
    ...additionalTargets,
  ];
  for (const pathname of [...new Set(targets.flatMap(ancestorPaths))]) {
    let info;
    try { info = await lstat(pathname); } catch (error) {
      if (error?.code === 'ENOENT') continue;
      return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_ANCESTOR_STAT_FAILED', pathname });
    }
    if (info.isSymbolicLink()) return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_LINKED_ANCESTOR_REJECTED', pathname });
    const resolvedRealPath = await realpath(pathname).catch(() => '');
    if (!resolvedRealPath || portable(resolvedRealPath) !== portable(pathname)) {
      return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_ANCESTOR_REALPATH_MISMATCH', pathname });
    }
    const identity = `${info.dev}:${info.ino}:${info.mode}`;
    if (baseline?.[pathname] && baseline[pathname] !== identity) {
      return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_ANCESTOR_IDENTITY_CHANGED', pathname });
    }
    identities[pathname] = identity;
  }
  if (baseline) {
    for (const [pathname, identity] of Object.entries(baseline)) {
      if (identities[pathname] !== identity) return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_ANCESTOR_IDENTITY_CHANGED', pathname });
    }
  }
  return Object.freeze({ ok: true, blocker: '', identities: Object.freeze(identities) });
}

export function createFixedRecoveryMeshProbeAdapter({
  probeScriptPath,
  spawnSyncFn = spawnSync,
  powershellExecutable = BATTLE_BRIDGE_WINDOWS_POWERSHELL_EXECUTABLE,
} = {}) {
  const fixedPath = path.resolve(probeScriptPath);
  return Object.freeze({
    run(mode) {
      if (!['Inspect', 'Recover'].includes(mode)) throw new Error(`Unsupported recovery mesh probe mode: ${mode}`);
      const result = spawnSyncFn(powershellExecutable, [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixedPath, '-Mode', mode,
      ], {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
      });
      if (result?.error || result?.status !== 0) {
        return Object.freeze({ ok: false, mode, blocker: 'RECOVERY_MESH_FIXED_PROBE_FAILED', exitCode: result?.status ?? null });
      }
      try {
        return Object.freeze({ ok: true, mode, data: JSON.parse(String(result.stdout || '').replace(/^\uFEFF/, '')) });
      } catch {
        return Object.freeze({ ok: false, mode, blocker: 'RECOVERY_MESH_FIXED_PROBE_JSON_INVALID' });
      }
    },
  });
}

async function readJson(pathname, fallback) {
  try { return JSON.parse((await readFile(pathname, 'utf8')).replace(/^\uFEFF/, '')); } catch { return fallback; }
}

async function readStableJsonFile(pathname, { maximumBytes, missingAllowed = false } = {}) {
  let pathInfo;
  try { pathInfo = await lstat(pathname); } catch (error) {
    if (missingAllowed && error?.code === 'ENOENT') return Object.freeze({ ok: true, missing: true, value: null });
    return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_AUTHORITY_FILE_STAT_FAILED' });
  }
  if (!pathInfo.isFile() || pathInfo.isSymbolicLink() || pathInfo.nlink !== 1 || pathInfo.size <= 0 || pathInfo.size > maximumBytes) {
    return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_AUTHORITY_FILE_UNSAFE' });
  }
  let handle;
  try {
    handle = await open(pathname, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== pathInfo.size || before.size > maximumBytes) throw new Error('unsafe-authority-handle');
    const payload = await handle.readFile('utf8');
    const after = await handle.stat();
    const finalPathInfo = await lstat(pathname);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.nlink !== 1
      || finalPathInfo.dev !== before.dev || finalPathInfo.ino !== before.ino || finalPathInfo.size !== before.size || finalPathInfo.nlink !== 1) {
      return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_AUTHORITY_FILE_CHANGED_DURING_READ' });
    }
    return Object.freeze({ ok: true, missing: false, value: JSON.parse(payload.replace(/^\uFEFF/, '')) });
  } catch {
    return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_AUTHORITY_FILE_READ_FAILED' });
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readRecoveryMeshState(statePath) {
  const result = await readStableJsonFile(statePath, { maximumBytes: MAX_STATE_BYTES, missingAllowed: true });
  if (!result.ok || result.missing) return result.missing ? Object.freeze({ ok: true, state: { consumedIdempotencyKeys: [], activeLease: null } }) : result;
  const state = result.value;
  const consumed = state?.consumedIdempotencyKeys;
  const lease = state?.activeLease;
  const acquiredAtMs = Date.parse(text(lease?.acquiredAtUtc));
  const expiresAtMs = Date.parse(text(lease?.expiresAtUtc));
  const leaseValid = lease === null || (lease
    && lease.schemaVersion === 'stephanos.battle-bridge-recovery-mesh.v1'
    && lease.executor === BATTLE_BRIDGE_RECOVERY_EXECUTOR
    && REQUEST_ID.test(text(lease.requestId))
    && lease.leaseId === `recovery-mesh:${lease.requestId}`
    && BATTLE_BRIDGE_RECOVERY_ROUTES.includes(lease.route)
    && Number.isFinite(acquiredAtMs) && Number.isFinite(expiresAtMs)
    && expiresAtMs > acquiredAtMs && expiresAtMs - acquiredAtMs === 2 * 60 * 1000
    && lease.maximumConcurrentExecutors === 1);
  if (state?.schemaVersion !== BATTLE_BRIDGE_RECOVERY_MESH_RUNNER_SCHEMA || !Array.isArray(consumed)
    || consumed.length > 500 || consumed.some((item) => typeof item !== 'string' || item.length > 260) || !leaseValid) {
    return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_STATE_LEDGER_INVALID' });
  }
  return Object.freeze({ ok: true, state });
}

function resolveBoundedWorkspaceRef(workspaceRoot, proofRef, requiredPrefix) {
  const normalized = text(proofRef).replace(/\\/g, '/');
  if (!normalized.startsWith(requiredPrefix) || normalized.includes('..') || path.isAbsolute(normalized)) return '';
  const resolved = path.resolve(workspaceRoot, ...normalized.split('/'));
  const relative = path.relative(path.resolve(workspaceRoot), resolved);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : '';
}

export async function verifyRecoveryMeshAuthenticationEvidence(paths, requests, { now = new Date(), sourceHeadReader = defaultSourceHeadReader } = {}) {
  const verified = [];
  for (const request of requests) {
    if (request.route === BATTLE_BRIDGE_RECOVERY_ROUTE.LOCAL_WINDOWS_SUPERVISOR) {
      if (request.authenticationEvidence.issuer !== 'windows-task-scheduler'
        || !request.authenticationEvidence.proofRef.startsWith('scheduled-task/')) {
        return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_LOCAL_EVIDENCE_INVALID' });
      }
      verified.push(Object.freeze({ requestId: request.requestId, route: request.route, consumerVerified: true, upstreamProofRef: request.sourceReceipt }));
      continue;
    }

    const evidencePath = resolveBoundedWorkspaceRef(paths.workspaceRoot, request.authenticationEvidence.proofRef, 'receipts/battle-bridge-recovery-auth/');
    if (!evidencePath) return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_AUTH_PROOF_REF_INVALID', route: request.route });
    const evidenceAncestors = await validateRecoveryMeshPathAncestors(paths, { additionalTargets: [evidencePath] });
    if (!evidenceAncestors.ok) return Object.freeze({ ok: false, blocker: evidenceAncestors.blocker, route: request.route });
    const evidenceRead = await readStableJsonFile(evidencePath, { maximumBytes: MAX_INGRESS_BYTES });
    if (!evidenceRead.ok) return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_AUTH_PROOF_UNREADABLE', route: request.route });
    const record = evidenceRead.value;
    const recordIssuedAtMs = Date.parse(text(record?.issuedAtUtc));
    const recordExpiresAtMs = Date.parse(text(record?.expiresAtUtc));
    if (record?.schemaVersion !== AUTH_RECEIPT_SCHEMA || record.requestId !== request.requestId || record.route !== request.route
      || record.issuer !== request.authenticationEvidence.issuer || record.subject !== request.authenticationEvidence.subject
      || record.verifiedByFixedAdapter !== true || record.upstreamProofRef !== request.sourceReceipt
      || !Number.isFinite(recordIssuedAtMs) || !Number.isFinite(recordExpiresAtMs)
      || recordIssuedAtMs > now.getTime() + 30_000 || recordExpiresAtMs <= now.getTime()
      || recordExpiresAtMs <= recordIssuedAtMs || recordExpiresAtMs - recordIssuedAtMs > 5 * 60 * 1000) {
      return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_AUTH_PROOF_MISMATCH', route: request.route });
    }

    let authorityHead = '';
    if (request.route === BATTLE_BRIDGE_RECOVERY_ROUTE.GITHUB_MAILBOX) {
      const mailboxReceiptPath = resolveBoundedWorkspaceRef(paths.workspaceRoot, record.upstreamProofRef, 'receipts/github-command-mailbox/');
      if (!mailboxReceiptPath) return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_GITHUB_AUTH_REF_INVALID' });
      const mailboxAncestors = await validateRecoveryMeshPathAncestors(paths, { additionalTargets: [mailboxReceiptPath] });
      if (!mailboxAncestors.ok) return Object.freeze({ ok: false, blocker: mailboxAncestors.blocker });
      const mailboxReceiptRead = await readStableJsonFile(mailboxReceiptPath, { maximumBytes: MAX_STATE_BYTES });
      const receipt = mailboxReceiptRead.value;
      const authorityAtMs = Date.parse(text(receipt?.state === 'DONE' ? receipt?.completedAt : receipt?.acceptedAt));
      const expectedHead = text(receipt?.expectedHead).toLowerCase();
      const observedHead = text(receipt?.result?.result?.sourceHead || receipt?.result?.result?.localHead || expectedHead).toLowerCase();
      const liveSourceHead = text(sourceHeadReader(paths.repoRoot)).toLowerCase();
      if (!mailboxReceiptRead.ok || receipt?.schemaVersion !== 'stephanos.battle-bridge-github-command-receipt.v1'
        || receipt.requestId !== record.subject || receipt.operation !== 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH'
        || !['ACCEPTED', 'DONE'].includes(receipt.state) || receipt.repository !== 'Cheekyfellastef/stephan-os' || Number(receipt.issueNumber) !== 1507
        || !Number.isFinite(authorityAtMs) || authorityAtMs > now.getTime() + 30_000 || now.getTime() - authorityAtMs > GITHUB_AUTHORITY_MAX_AGE_MS
        || !EXACT_HEAD.test(expectedHead) || observedHead !== expectedHead || text(record.authorityHead).toLowerCase() !== expectedHead
        || liveSourceHead !== expectedHead) {
        return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_GITHUB_AUTH_RECEIPT_INVALID' });
      }
      authorityHead = expectedHead;
    } else if (request.route === BATTLE_BRIDGE_RECOVERY_ROUTE.TAILSCALE_CONTROL) {
      if (!record.upstreamProofRef.startsWith('tailscale-status/')) return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_TAILSCALE_AUTH_RECEIPT_INVALID' });
    } else if (request.route === BATTLE_BRIDGE_RECOVERY_ROUTE.OPENCLAW_WHATSAPP) {
      if (!record.upstreamProofRef.startsWith('receipts/openclaw-authenticated-command/') || record.hostProofConsumed !== true) {
        return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_OPENCLAW_AUTH_RECEIPT_INVALID' });
      }
    } else if (request.route === BATTLE_BRIDGE_RECOVERY_ROUTE.AUTHENTICATED_BREAK_GLASS) {
      const nonce = request.authenticationEvidence.subject.match(/^nonce:([a-f0-9]{16})$/)?.[1] || '';
      const expectedRef = `status/battle-bridge-break-glass-nonce.json#${nonce}`;
      const nonceRead = await readStableJsonFile(path.resolve(paths.workspaceRoot, 'status', 'battle-bridge-break-glass-nonce.json'), { maximumBytes: MAX_INGRESS_BYTES });
      if (!nonce || record.upstreamProofRef !== expectedRef || !nonceRead.ok || nonceRead.value?.nonce !== nonce || nonceRead.value?.consumed !== true) {
        return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_BREAK_GLASS_AUTH_RECEIPT_INVALID' });
      }
    }
    verified.push(Object.freeze({
      requestId: request.requestId,
      route: request.route,
      consumerVerified: true,
      issuer: record.issuer,
      subject: record.subject,
      proofRef: request.authenticationEvidence.proofRef,
      upstreamProofRef: record.upstreamProofRef,
      ...(authorityHead ? { authorityHead } : {}),
    }));
  }
  return Object.freeze({ ok: true, verified: Object.freeze(verified) });
}

export function verifyRecoveryDispatchSourceHead(paths, decision, evidenceVerification, sourceHeadReader = defaultSourceHeadReader) {
  const acceptedRequestIds = new Set((decision?.accepted || []).map((request) => request.requestId));
  const authorityHeads = [...new Set((evidenceVerification?.verified || [])
    .filter((evidence) => evidence.route === BATTLE_BRIDGE_RECOVERY_ROUTE.GITHUB_MAILBOX
      && acceptedRequestIds.has(evidence.requestId))
    .map((evidence) => text(evidence.authorityHead).toLowerCase()))];
  if (authorityHeads.length === 0) return Object.freeze({ ok: true, required: false, blocker: '' });
  if (authorityHeads.length !== 1 || !EXACT_HEAD.test(authorityHeads[0])) {
    return Object.freeze({ ok: false, required: true, blocker: 'RECOVERY_MESH_GITHUB_DISPATCH_HEAD_AMBIGUOUS' });
  }
  const liveSourceHead = text(sourceHeadReader(paths.repoRoot)).toLowerCase();
  return liveSourceHead === authorityHeads[0]
    ? Object.freeze({ ok: true, required: true, blocker: '', authorityHead: authorityHeads[0], liveSourceHead })
    : Object.freeze({ ok: false, required: true, blocker: 'RECOVERY_MESH_GITHUB_DISPATCH_HEAD_CHANGED', authorityHead: authorityHeads[0], liveSourceHead });
}

export async function readRecoveryMeshIngressFiles(paths) {
  const requests = [];
  const rejected = [];
  for (const route of BATTLE_BRIDGE_RECOVERY_ROUTES.filter((value) => value !== BATTLE_BRIDGE_RECOVERY_ROUTE.LOCAL_WINDOWS_SUPERVISOR)) {
    const pathname = path.resolve(paths.ingressRoot, `${route.toLowerCase()}.json`);
    let pathInfo;
    try { pathInfo = await lstat(pathname); } catch (error) {
      if (error?.code !== 'ENOENT') rejected.push({ route, blocker: 'RECOVERY_INGRESS_FILE_STAT_FAILED' });
      continue;
    }
    if (!pathInfo.isFile() || pathInfo.isSymbolicLink() || pathInfo.nlink !== 1 || pathInfo.size <= 0 || pathInfo.size > MAX_INGRESS_BYTES) {
      rejected.push({ route, blocker: 'RECOVERY_INGRESS_FILE_UNSAFE' });
      continue;
    }
    let handle;
    let payload = '';
    let before;
    let after;
    try {
      handle = await open(pathname, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size !== pathInfo.size || before.size > MAX_INGRESS_BYTES) throw new Error('unsafe-ingress-handle');
      payload = await handle.readFile('utf8');
      after = await handle.stat();
    } catch {
      rejected.push({ route, blocker: 'RECOVERY_INGRESS_FILE_READ_FAILED' });
      continue;
    } finally {
      await handle?.close().catch(() => {});
    }
    const finalPathInfo = await lstat(pathname).catch(() => null);
    if (!finalPathInfo || finalPathInfo.isSymbolicLink()
      || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.nlink !== 1
      || finalPathInfo.dev !== before.dev || finalPathInfo.ino !== before.ino || finalPathInfo.size !== before.size || finalPathInfo.nlink !== 1) {
      rejected.push({ route, blocker: 'RECOVERY_INGRESS_FILE_CHANGED_DURING_READ' });
      continue;
    }
    try {
      const request = JSON.parse(payload.replace(/^\uFEFF/, ''));
      if (request.route !== route) rejected.push({ route, blocker: 'RECOVERY_INGRESS_FILE_ROUTE_MISMATCH' });
      else requests.push(request);
    } catch {
      rejected.push({ route, blocker: 'RECOVERY_INGRESS_FILE_JSON_INVALID' });
    }
  }
  return Object.freeze({ requests, rejected });
}

export function buildLocalSupervisorIngress(now = new Date()) {
  const issuedAtUtc = now.toISOString();
  const minute = issuedAtUtc.replace(/[-:.TZ]/g, '').slice(0, 12);
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_RECOVERY_INGRESS_SCHEMA,
    requestId: `recovery-local-${minute}`,
    route: BATTLE_BRIDGE_RECOVERY_ROUTE.LOCAL_WINDOWS_SUPERVISOR,
    action: BATTLE_BRIDGE_RECOVERY_ACTION,
    issuedAtUtc,
    expiresAtUtc: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    sourceReceipt: `scheduled-task/${BATTLE_BRIDGE_RECOVERY_MESH_TASK.replaceAll(' ', '-').toLowerCase()}/${minute}`,
    authenticationEvidence: Object.freeze({
      schemaVersion: BATTLE_BRIDGE_RECOVERY_AUTH_EVIDENCE_SCHEMA,
      route: BATTLE_BRIDGE_RECOVERY_ROUTE.LOCAL_WINDOWS_SUPERVISOR,
      issuer: 'windows-task-scheduler',
      subject: 'scheduled-task:stephanos-battle-bridge-recovery-mesh',
      proofRef: `scheduled-task/${BATTLE_BRIDGE_RECOVERY_MESH_TASK.replaceAll(' ', '-').toLowerCase()}/${minute}`,
      verified: true,
    }),
  });
}

async function acquireLock(paths, now, processIsAliveFn) {
  await mkdir(path.dirname(paths.lockPath), { recursive: true });
  try {
    const token = randomUUID();
    const handle = await open(paths.lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, token, acquiredAtUtc: now.toISOString() })}\n`);
    await handle.close();
    return Object.freeze({ ok: true, token, recoveredStaleLock: false });
  } catch (error) {
    if (error?.code !== 'EEXIST') return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_LOCK_FAILED' });
    const existing = await readJson(paths.lockPath, {});
    const acquiredAtMs = Date.parse(text(existing?.acquiredAtUtc));
    const stale = Number.isFinite(acquiredAtMs) && now.getTime() - acquiredAtMs > BATTLE_BRIDGE_RECOVERY_MESH_LOCK_STALE_MS;
    const ownerAlive = processIsAliveFn(Number(existing?.pid));
    if (!stale || ownerAlive) return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_ALREADY_RUNNING', ownerAlive });
    return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_STALE_LOCK_REQUIRES_SERIAL_RECLAIM', ownerAlive: false });
  }
}

async function releaseOwnedLock(paths, lock) {
  if (!lock?.ok || !LOCK_TOKEN.test(text(lock.token))) return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_LOCK_OWNERSHIP_INVALID' });
  const observed = await readStableJsonFile(paths.lockPath, { maximumBytes: 4096, missingAllowed: false });
  if (!observed.ok || observed.value?.token !== lock.token || Number(observed.value?.pid) !== process.pid) {
    return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_LOCK_OWNERSHIP_LOST' });
  }
  await rm(paths.lockPath);
  return Object.freeze({ ok: true });
}

function probeHealth(data = {}) {
  return Object.freeze({
    workerHealthy: data?.worker?.healthy === true,
    mailboxHealthy: data?.mailbox?.healthy === true,
    backendHealthy: data?.backend?.healthy === true,
    gatewayHealthy: data?.openclawGateway?.healthy === true,
    sourceHead: /^[0-9a-f]{40}$/i.test(text(data?.sourceHead)) ? text(data.sourceHead).toLowerCase() : '',
    branch: text(data?.branch),
  });
}

async function publishRecoveryMesh({ paths, now, decision, evidenceVerification, initial, final, recoveryAttempted, recoveryProbeCount, ingressFileRejections }) {
  const timestampUtc = now.toISOString();
  const classification = final.workerHealthy && final.mailboxHealthy
    ? (final.backendHealthy && final.gatewayHealthy ? 'RECOVERY_MESH_ALL_SERVICES_HEALTHY' : 'RECOVERY_MESH_CORE_HEALTHY_RUNTIME_DEGRADED')
    : 'RECOVERY_MESH_CORE_UNHEALTHY';
  const proofRef = `receipts/battle-bridge-recovery-mesh/${timestampUtc.replace(/[:.]/g, '-')}.json`;
  const common = Object.freeze({
    meshSchema: BATTLE_BRIDGE_RECOVERY_MESH_RUNNER_SCHEMA,
    classification,
    selectedRoute: decision?.selected?.route || '',
    coalescedRoutes: decision?.coalescedRoutes || [],
    acceptedRouteEvidence: (decision?.accepted || []).map((request) => Object.freeze({
      requestId: request.requestId,
      route: request.route,
      failureDomain: request.failureDomain,
      sourceReceipt: request.sourceReceipt,
      authenticationEvidence: request.authenticationEvidence,
      consumerVerification: evidenceVerification?.verified?.find((item) => item.requestId === request.requestId) || null,
    })),
    initial,
    final,
    recoveryAttempted,
    recoveryProbeCount,
    ingressFileRejections,
    oneExecutorEnforced: true,
    duplicateWorkerAllowed: false,
    arbitraryShellAllowed: false,
    arbitraryTaskNameAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    proofRefs: [proofRef],
  });
  const summary = `Battle Bridge recovery mesh completed with ${classification}.`;
  const receipt = {
    ...createSharedWorkspaceProofRecord({ proofId: `recovery-mesh-${timestampUtc.replace(/[:.]/g, '-')}`, timestampUtc, status: classification, summary, refs: [proofRef] }),
    correlationId: 'issue-1291-battle-bridge-recovery-mesh',
    relatedIssue: '#1291',
    receiptType: 'battle-bridge-recovery-mesh',
    ...common,
  };
  const receiptWrite = await writeAtomicJson(paths.workspaceRoot, proofRef.split('/'), receipt, { repoRoot: paths.repoRoot, nowMs: now.getTime() });
  const status = {
    ...createSharedWorkspaceStatusRecord({ statusId: 'battle-bridge-recovery-mesh-current', timestampUtc, status: classification, summary, proofRefs: [proofRef] }),
    ...common,
  };
  const statusWrite = await writeAtomicJson(paths.workspaceRoot, ['status', 'battle-bridge-recovery-mesh-current.json'], status, { repoRoot: paths.repoRoot, nowMs: now.getTime() });
  const eventWrite = await appendWorkspaceJsonl(paths.workspaceRoot, ['events', 'battle-bridge-recovery-mesh.jsonl'], {
    ...createSharedWorkspaceEventRecord({ eventId: `recovery-mesh-${timestampUtc.replace(/[:.]/g, '-')}`, timestampUtc, eventKind: 'battle-bridge-recovery-mesh-run', summary }),
    classification,
    selectedRoute: common.selectedRoute,
    recoveryAttempted,
    proofRefs: [proofRef],
  }, { repoRoot: paths.repoRoot, nowMs: now.getTime() });
  return Object.freeze({ ok: receiptWrite.ok && statusWrite.ok && eventWrite.ok, classification, proofRef, receiptWrite, statusWrite, eventWrite });
}

async function writeStateAtomically(statePath, value) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporaryPath, statePath);
}

export async function runBattleBridgeRecoveryMesh({
  env = process.env,
  now = new Date(),
  paths = resolveRecoveryMeshPaths({ env }),
  expectedPaths = resolveRecoveryMeshPaths({ env }),
  probeAdapter = createFixedRecoveryMeshProbeAdapter({ probeScriptPath: paths.probeScriptPath }),
  ingressRequests = null,
  processIsAliveFn = defaultProcessIsAlive,
  sleep = (delayMs) => new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs)),
  recoveryProbeDelayMs = 5_000,
  maximumRecoveryProbes = 3,
  sourceHeadReader = defaultSourceHeadReader,
} = {}) {
  const pathValidation = validateRecoveryMeshPaths(paths, expectedPaths);
  if (!pathValidation.ok) return Object.freeze({ ok: false, classification: 'RECOVERY_MESH_BLOCKED', pathValidation });
  const initialAncestorValidation = await validateRecoveryMeshPathAncestors(paths);
  if (!initialAncestorValidation.ok) return Object.freeze({ ok: false, classification: initialAncestorValidation.blocker, pathValidation: initialAncestorValidation });
  await mkdir(paths.workspaceRoot, { recursive: true });
  await Promise.all([
    mkdir(paths.ingressRoot, { recursive: true }),
    mkdir(path.dirname(paths.statePath), { recursive: true }),
    mkdir(path.dirname(paths.lockPath), { recursive: true }),
  ]);
  const ancestorValidation = await validateRecoveryMeshPathAncestors(paths);
  if (!ancestorValidation.ok) return Object.freeze({ ok: false, classification: ancestorValidation.blocker, pathValidation: ancestorValidation });
  const lock = await acquireLock(paths, now, processIsAliveFn);
  if (!lock.ok) return Object.freeze({ ok: false, classification: lock.blocker, lock });
  try {
    const stableAncestors = await validateRecoveryMeshPathAncestors(paths, { baseline: ancestorValidation.identities });
    if (!stableAncestors.ok) return Object.freeze({ ok: false, classification: stableAncestors.blocker, pathValidation: stableAncestors, lock });
    const stateRead = await readRecoveryMeshState(paths.statePath);
    if (!stateRead.ok) return Object.freeze({ ok: false, classification: stateRead.blocker, stateRead, lock });
    const state = stateRead.state;
    const files = ingressRequests === null ? await readRecoveryMeshIngressFiles(paths) : { requests: ingressRequests, rejected: [] };
    const requests = [buildLocalSupervisorIngress(now), ...files.requests];
    const preliminaryDecision = adjudicateBattleBridgeRecoveryMesh({
      ingressRequests: requests,
      consumedIdempotencyKeys: state.consumedIdempotencyKeys || [],
      activeLease: state.activeLease || null,
      nowMs: now.getTime(),
    });
    if (!preliminaryDecision.dispatchAllowed) {
      return Object.freeze({ ok: preliminaryDecision.ok, classification: preliminaryDecision.finalVerdict, decision: preliminaryDecision, lock });
    }

    const verifiedIngress = [];
    const verifiedEvidence = [];
    const evidenceRejected = [];
    for (const request of preliminaryDecision.accepted) {
      const verification = await verifyRecoveryMeshAuthenticationEvidence(paths, [request], { now, sourceHeadReader });
      if (verification.ok) {
        verifiedIngress.push(request);
        verifiedEvidence.push(...verification.verified);
      } else {
        evidenceRejected.push(Object.freeze({ requestId: request.requestId, route: request.route, blocker: verification.blocker }));
      }
    }
    const verifiedDecision = adjudicateBattleBridgeRecoveryMesh({
      ingressRequests: verifiedIngress,
      consumedIdempotencyKeys: state.consumedIdempotencyKeys || [],
      activeLease: state.activeLease || null,
      nowMs: now.getTime(),
    });
    const decision = Object.freeze({
      ...verifiedDecision,
      rejected: Object.freeze([...preliminaryDecision.rejected, ...evidenceRejected, ...verifiedDecision.rejected]),
    });
    if (!decision.dispatchAllowed) return Object.freeze({ ok: false, classification: 'RECOVERY_MESH_NO_CONSUMER_VERIFIED_INGRESS', decision, lock });
    const evidenceVerification = Object.freeze({ ok: true, verified: Object.freeze(verifiedEvidence) });

    const preLeaseAncestors = await validateRecoveryMeshPathAncestors(paths, { baseline: ancestorValidation.identities });
    if (!preLeaseAncestors.ok) return Object.freeze({ ok: false, classification: preLeaseAncestors.blocker, pathValidation: preLeaseAncestors, lock });
    await writeStateAtomically(paths.statePath, {
      schemaVersion: BATTLE_BRIDGE_RECOVERY_MESH_RUNNER_SCHEMA,
      updatedAtUtc: now.toISOString(),
      activeLease: decision.lease,
      consumedIdempotencyKeys: state.consumedIdempotencyKeys || [],
    });

    const initialProbe = probeAdapter.run('Inspect');
    if (!initialProbe.ok) return Object.freeze({ ok: false, classification: initialProbe.blocker, decision, initialProbe, lock });
    const initial = probeHealth(initialProbe.data);
    let final = initial;
    let recoveryAttempted = false;
    let recoveryProbeCount = 0;
    if (!(initial.workerHealthy && initial.mailboxHealthy && initial.backendHealthy && initial.gatewayHealthy)) {
      recoveryAttempted = true;
      // This synchronous check is deliberately adjacent to the only mutating
      // recovery dispatch. GitHub authority must still bind the live checkout
      // after adjudication, lease persistence, and the initial inspection.
      const dispatchHeadVerification = verifyRecoveryDispatchSourceHead(paths, decision, evidenceVerification, sourceHeadReader);
      if (!dispatchHeadVerification.ok) {
        return Object.freeze({ ok: false, classification: dispatchHeadVerification.blocker, decision, initial, dispatchHeadVerification, lock });
      }
      const recovery = probeAdapter.run('Recover');
      if (!recovery.ok) return Object.freeze({ ok: false, classification: recovery.blocker, decision, initial, recovery, lock });
      for (let index = 0; index < maximumRecoveryProbes; index += 1) {
        if (recoveryProbeDelayMs > 0) await sleep(recoveryProbeDelayMs);
        recoveryProbeCount += 1;
        const probe = probeAdapter.run('Inspect');
        if (!probe.ok) continue;
        final = probeHealth(probe.data);
        if (final.workerHealthy && final.mailboxHealthy && final.backendHealthy && final.gatewayHealthy) break;
      }
    }
    const prePublicationAncestors = await validateRecoveryMeshPathAncestors(paths, { baseline: ancestorValidation.identities });
    if (!prePublicationAncestors.ok) return Object.freeze({ ok: false, classification: prePublicationAncestors.blocker, pathValidation: prePublicationAncestors, lock });
    const publication = await publishRecoveryMesh({
      paths, now, decision, evidenceVerification, initial, final, recoveryAttempted, recoveryProbeCount, ingressFileRejections: files.rejected,
    });
    const consumedIdempotencyKeys = [...new Set([
      ...(state.consumedIdempotencyKeys || []),
      ...decision.accepted.map((request) => request.idempotencyKey),
    ])].slice(-500);
    await writeStateAtomically(paths.statePath, { schemaVersion: BATTLE_BRIDGE_RECOVERY_MESH_RUNNER_SCHEMA, updatedAtUtc: now.toISOString(), activeLease: null, consumedIdempotencyKeys });
    const coreHealthy = final.workerHealthy && final.mailboxHealthy;
    return Object.freeze({
      ok: coreHealthy && publication.ok,
      classification: publication.classification,
      decision,
      initial,
      final,
      recoveryAttempted,
      recoveryProbeCount,
      publication,
      lock,
      acceptsRuntimeWork: coreHealthy,
      bulletproofAcceptanceClaimed: false,
    });
  } finally {
    await releaseOwnedLock(paths, lock).catch(() => {});
  }
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  return Boolean(argv1) && path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
}

if (isDirectCliEntrypoint()) {
  const verifierScriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'windows', 'verify-battle-bridge-recovery-mesh-mutex.ps1');
  const mutexVerification = process.env.STEPHANOS_RECOVERY_MESH_MUTEX_HELD === '1'
    ? createFixedRecoveryMeshMutexVerifier({ verifierScriptPath }).verify({ launcherPid: Number(process.env.STEPHANOS_RECOVERY_MESH_LAUNCHER_PID) })
    : { ok: false, blocker: 'RECOVERY_MESH_WINDOWS_MUTEX_REQUIRED' };
  const result = mutexVerification.ok
    ? await runBattleBridgeRecoveryMesh()
    : { ok: false, classification: mutexVerification.blocker };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
