import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import {
  BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
  MISSION_CONTROLLER_ROUTE,
  publishBuildLaneCapacityToSharedWorkspace,
  validateBuildLaneCapacityReceipt,
} from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import {
  createSharedWorkspaceProofRecord,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { resolveCriticalBacklogRuntimePaths } from './criticalBacklogConveyorServiceCore.js';
import { readMissionWorkerQueue } from './missionOrchestratorWorkerService.js';

export const DESKTOP_COMMANDER_CAPACITY_SCHEMA = 'stephanos.desktop-commander-capacity.v1';
export const DESKTOP_COMMANDER_PROOF_SCHEMA = 'stephanos.desktop-commander-capacity-proof.v1';
export const DESKTOP_COMMANDER_WORKER_ID = 'desktop-commander-battle-bridge-01';
export const DESKTOP_COMMANDER_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const DESKTOP_COMMANDER_TASK_CLASSES = Object.freeze(['FOCUSED_REPAIR']);
export const DESKTOP_COMMANDER_CONSERVATIVE_START_LATENCY_SECONDS = 30;

const SHA40 = /^[0-9a-f]{40}$/i;
const RECEIPT_LIFETIME_MS = 4 * 60 * 1000;
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const HEALTH_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$processes=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'desktop-commander' -and $_.CommandLine -match 'dist[\\\\/]index\\.js' -and $_.CommandLine -match '\\bremote\\b' })",
  "$task=Get-ScheduledTask -TaskName 'Stephanos Commander Watchdog' -ErrorAction Stop",
  "$healthy=($processes.Count -ge 1 -and [string]$task.State -eq 'Running')",
  "[ordered]@{ healthy=$healthy; commanderProcessCount=$processes.Count; watchdogTaskState=[string]$task.State } | ConvertTo-Json -Compress",
].join('; ');

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function unavailable(reason, extra = {}) {
  return Object.freeze({
    schemaVersion: DESKTOP_COMMANDER_CAPACITY_SCHEMA,
    ok: false,
    available: false,
    workerId: DESKTOP_COMMANDER_WORKER_ID,
    reason,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
    ...extra,
  });
}

function defaultReadSourceHead(repoRoot, options = {}) {
  const result = (options.spawnSyncFn || spawnSync)('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return '';
  const head = text(result.stdout).toLowerCase();
  return SHA40.test(head) ? head : '';
}

function defaultProbeDesktopCommander(options = {}) {
  if (process.platform !== 'win32' && options.allowNonWindowsForTest !== true) {
    return Object.freeze({ ok: false, reason: 'DESKTOP_COMMANDER_WINDOWS_REQUIRED' });
  }
  const startedAtMs = Date.now();
  const result = (options.spawnSyncFn || spawnSync)(POWERSHELL, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    HEALTH_SCRIPT,
  ], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  });
  if (result.error || result.status !== 0) {
    return Object.freeze({ ok: false, reason: 'DESKTOP_COMMANDER_HEALTH_PROBE_FAILED' });
  }
  let payload;
  try { payload = JSON.parse(String(result.stdout || '').trim()); }
  catch { return Object.freeze({ ok: false, reason: 'DESKTOP_COMMANDER_HEALTH_PROBE_INVALID_JSON' }); }
  if (payload?.healthy !== true
    || !Number.isSafeInteger(Number(payload?.commanderProcessCount))
    || Number(payload.commanderProcessCount) < 1
    || text(payload?.watchdogTaskState) !== 'Running') {
    return Object.freeze({ ok: false, reason: 'DESKTOP_COMMANDER_NOT_HEALTHY' });
  }
  return Object.freeze({
    ok: true,
    commanderProcessCount: Number(payload.commanderProcessCount),
    watchdogTaskState: 'Running',
    probeLatencyMs: Math.max(1, Date.now() - startedAtMs),
  });
}

export async function refreshDesktopCommanderCapacity(options = {}) {
  const env = options.env || process.env;
  const paths = options.paths || resolveCriticalBacklogRuntimePaths({ env });
  const readSourceHead = options.readSourceHead || ((root) => defaultReadSourceHead(root, options));
  const sourceHead = text(await readSourceHead(paths.repoRoot)).toLowerCase();
  if (!SHA40.test(sourceHead)) return unavailable('DESKTOP_COMMANDER_SOURCE_HEAD_UNPROVEN');

  const probe = options.probeDesktopCommander || defaultProbeDesktopCommander;
  const probeResult = await probe(options);
  if (probeResult?.ok !== true) {
    return unavailable(text(probeResult?.reason, 'DESKTOP_COMMANDER_HEALTH_PROBE_FAILED'), { sourceHead });
  }

  const readQueue = options.readQueue || readMissionWorkerQueue;
  const queue = await readQueue({ env });
  const queueDepth = Array.isArray(queue)
    ? queue.filter((entry) => text(entry?.adapter).toLowerCase() === 'desktop-commander').length
    : 0;
  if (!Number.isSafeInteger(queueDepth) || queueDepth < 0 || queueDepth > 64) {
    return unavailable('DESKTOP_COMMANDER_QUEUE_DEPTH_INVALID', { sourceHead });
  }

  const observedAt = options.now instanceof Date ? options.now : new Date();
  const observedAtUtc = observedAt.toISOString();
  const expiresAtUtc = new Date(observedAt.getTime() + RECEIPT_LIFETIME_MS).toISOString();
  const proofRef = `proof/desktop-commander-capacity-${sourceHead}.json`;
  const proofFile = proofRef.replace(/^proof\//, '');
  const proofId = `desktop-commander-capacity-${sourceHead}`;
  const proof = Object.freeze({
    ...createSharedWorkspaceProofRecord({
      proofId,
      participantId: DESKTOP_COMMANDER_WORKER_ID,
      timestampUtc: observedAtUtc,
      correlationId: proofId,
      relatedIssue: '#1622',
      status: 'PASS',
      summary: `Desktop Commander remote worker is live under the canonical watchdog on exact source ${sourceHead}; queue depth ${queueDepth}.`,
      refs: [proofRef],
      proofRefs: [proofRef],
    }),
    schema: DESKTOP_COMMANDER_PROOF_SCHEMA,
    sourceHead,
    repository: DESKTOP_COMMANDER_REPOSITORY,
    workerId: DESKTOP_COMMANDER_WORKER_ID,
    commanderProcessCount: probeResult.commanderProcessCount,
    watchdogTaskState: probeResult.watchdogTaskState,
    queueDepth,
    probeLatencyMs: Number(probeResult.probeLatencyMs || 0),
    routingLatencySeconds: DESKTOP_COMMANDER_CONSERVATIVE_START_LATENCY_SECONDS,
    latencySemantics: 'conservative routing ceiling; not an empirical p95 claim',
    sourceConstructionAllowed: true,
    focusedTestsAllowed: true,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
    expiresAtUtc,
    finalVerdict: 'DESKTOP_COMMANDER_CAPACITY_PROVEN',
  });

  const writeProof = options.writeProof || (async (record) => writeAtomicJson(
    paths.workspaceRoot,
    ['proof', proofFile],
    record,
    { repoRoot: paths.repoRoot, nowMs: observedAt.getTime() },
  ));
  const proofWrite = await writeProof(proof);
  if (proofWrite?.ok !== true) {
    return unavailable(`DESKTOP_COMMANDER_PROOF_PUBLICATION_FAILED:${text(proofWrite?.reason, 'unknown')}`, { sourceHead });
  }

  const receiptSeed = `${sourceHead}\n${observedAtUtc}\n${queueDepth}\n${probeResult.commanderProcessCount}`;
  const receipt = Object.freeze({
    schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    receiptId: `desktop-commander-${sha256(receiptSeed).slice(0, 24)}`,
    route: MISSION_CONTROLLER_ROUTE.DESKTOP_COMMANDER,
    repository: DESKTOP_COMMANDER_REPOSITORY,
    sourceHead,
    workerId: DESKTOP_COMMANDER_WORKER_ID,
    state: 'READY',
    supportedOperations: Object.freeze(['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS']),
    supportedTaskClasses: DESKTOP_COMMANDER_TASK_CLASSES,
    observedAtUtc,
    expiresAtUtc,
    queueDepth,
    p95StartLatencySeconds: DESKTOP_COMMANDER_CONSERVATIVE_START_LATENCY_SECONDS,
    authorityReceiptIds: Object.freeze([]),
    proofRefs: Object.freeze([proofRef]),
  });
  const validation = validateBuildLaneCapacityReceipt(receipt, {
    repository: DESKTOP_COMMANDER_REPOSITORY,
    taskClass: DESKTOP_COMMANDER_TASK_CLASSES[0],
    nowUtc: observedAtUtc,
    sourceHead,
  });
  if (!validation.valid) return unavailable('DESKTOP_COMMANDER_CAPACITY_RECEIPT_INVALID', { sourceHead });

  const publishCapacity = options.publishCapacity || (async (candidate) => publishBuildLaneCapacityToSharedWorkspace(
    paths.workspaceRoot,
    candidate,
    { repoRoot: paths.repoRoot, nowUtc: observedAtUtc },
  ));
  const publication = await publishCapacity(receipt);
  if (publication?.ok !== true) {
    return unavailable(`DESKTOP_COMMANDER_CAPACITY_PUBLICATION_FAILED:${text(publication?.reason, 'unknown')}`, {
      sourceHead,
      proofWrite,
    });
  }

  return Object.freeze({
    schemaVersion: DESKTOP_COMMANDER_CAPACITY_SCHEMA,
    ok: true,
    available: true,
    repository: DESKTOP_COMMANDER_REPOSITORY,
    sourceHead,
    workerId: DESKTOP_COMMANDER_WORKER_ID,
    queueDepth,
    observedAtUtc,
    expiresAtUtc,
    proofRef,
    proofWrite,
    publication,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
    finalVerdict: 'DESKTOP_COMMANDER_CAPACITY_PUBLISHED',
  });
}
