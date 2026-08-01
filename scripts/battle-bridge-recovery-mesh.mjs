#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  BATTLE_BRIDGE_RECOVERY_ACTION,
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
const MAX_INGRESS_BYTES = 16 * 1024;

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

export function createFixedRecoveryMeshProbeAdapter({
  probeScriptPath,
  spawnSyncFn = spawnSync,
  powershellExecutable = 'powershell.exe',
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
    scheduledTaskVerified: true,
  });
}

async function acquireLock(paths, now, processIsAliveFn) {
  await mkdir(path.dirname(paths.lockPath), { recursive: true });
  try {
    const handle = await open(paths.lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAtUtc: now.toISOString() })}\n`);
    await handle.close();
    return Object.freeze({ ok: true, recoveredStaleLock: false });
  } catch (error) {
    if (error?.code !== 'EEXIST') return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_LOCK_FAILED' });
    const existing = await readJson(paths.lockPath, {});
    const acquiredAtMs = Date.parse(text(existing?.acquiredAtUtc));
    const stale = Number.isFinite(acquiredAtMs) && now.getTime() - acquiredAtMs > BATTLE_BRIDGE_RECOVERY_MESH_LOCK_STALE_MS;
    const ownerAlive = processIsAliveFn(Number(existing?.pid));
    if (!stale || ownerAlive) return Object.freeze({ ok: false, blocker: 'RECOVERY_MESH_ALREADY_RUNNING', ownerAlive });
    await rm(paths.lockPath, { force: true });
    const recovered = await acquireLock(paths, now, processIsAliveFn);
    return Object.freeze({ ...recovered, recoveredStaleLock: recovered.ok });
  }
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

async function publishRecoveryMesh({ paths, now, decision, initial, final, recoveryAttempted, recoveryProbeCount, ingressFileRejections }) {
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
} = {}) {
  const pathValidation = validateRecoveryMeshPaths(paths, expectedPaths);
  if (!pathValidation.ok) return Object.freeze({ ok: false, classification: 'RECOVERY_MESH_BLOCKED', pathValidation });
  await mkdir(paths.workspaceRoot, { recursive: true });
  const lock = await acquireLock(paths, now, processIsAliveFn);
  if (!lock.ok) return Object.freeze({ ok: false, classification: lock.blocker, lock });
  try {
    const state = await readJson(paths.statePath, { consumedIdempotencyKeys: [] });
    const files = ingressRequests === null ? await readRecoveryMeshIngressFiles(paths) : { requests: ingressRequests, rejected: [] };
    const requests = [buildLocalSupervisorIngress(now), ...files.requests];
    const decision = adjudicateBattleBridgeRecoveryMesh({
      ingressRequests: requests,
      consumedIdempotencyKeys: state.consumedIdempotencyKeys || [],
      activeLease: state.activeLease || null,
      nowMs: now.getTime(),
    });
    if (!decision.dispatchAllowed) return Object.freeze({ ok: decision.ok, classification: decision.finalVerdict, decision, lock });

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
    const publication = await publishRecoveryMesh({
      paths, now, decision, initial, final, recoveryAttempted, recoveryProbeCount, ingressFileRejections: files.rejected,
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
    await rm(paths.lockPath, { force: true });
  }
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  return Boolean(argv1) && path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
}

if (isDirectCliEntrypoint()) {
  const result = await runBattleBridgeRecoveryMesh();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
