import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { freemem, homedir } from 'node:os';
import { resolve } from 'node:path';

import {
  BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
  MISSION_CONTROLLER_ROUTE,
  publishBuildLaneCapacityToSharedWorkspace,
  validateBuildLaneCapacityReceipt,
} from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import { probeStephanosNativeOllamaV1 } from '../../shared/agents/stephanosNativeCapacityPublisherV1.mjs';
import {
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { resolveCriticalBacklogRuntimePaths } from './criticalBacklogConveyorServiceCore.js';
import { readMissionWorkerQueue } from './missionOrchestratorWorkerService.js';

export const SOVEREIGN_BUILDER8_STATUS_ID = 'sovereign-commander-build-capacity-current';
export const SOVEREIGN_BUILDER8_WORKER_ID = 'stephanos-sovereign-builder-08';
export const SOVEREIGN_BUILDER8_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const SOVEREIGN_BUILDER8_SCHEMA = 'stephanos.sovereign-builder8-capacity.v1';
const SHA40 = /^[0-9a-f]{40}$/;
const SAFE_MODEL = /^[a-zA-Z0-9_.:-]{1,128}$/;
const BASE_ENDPOINTS = new Set(['http://127.0.0.1:11434', 'http://localhost:11434']);
const GOVERNOR_STATE = resolve(homedir(), 'Documents', 'Stephanos-openclaw-workspace', 'vr', 'vr-resource-governor-current.json');
const HEALTH_URL = 'http://127.0.0.1:18791/health';
const MIN_FREE_RAM = 4 * 1024 ** 3;
const MIN_FREE_VRAM_MIB = 4096;
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const PROCESS_PROBE = [
  "$ErrorActionPreference='Stop'",
  "$p=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'mission-orchestrator-worker' })",
  "[ordered]@{ workerCount=$p.Count } | ConvertTo-Json -Compress",
].join('; ');

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function reject(reason, extra = {}) {
  return Object.freeze({
    schemaVersion: SOVEREIGN_BUILDER8_SCHEMA,
    ok: false, available: false, reason,
    workerId: SOVEREIGN_BUILDER8_WORKER_ID,
    mergeAuthority: false, leaseSeizureAllowed: false, arbitraryCommandAllowed: false,
    ...extra,
  });
}
function localEndpoint(value) {
  const normalized = (text(value) || 'http://127.0.0.1:11434').replace(/\\/+$/, '').replace(/\\/api\\/chat$/, '');
  return BASE_ENDPOINTS.has(normalized) ? normalized : '';
}
function defaultReadHead(repoRoot, options) {
  const result = (options.spawnSyncFn || spawnSync)('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    cwd: repoRoot, encoding: 'utf8', shell: false, windowsHide: true, timeout: 5000,
  });
  const head = text(result.stdout).toLowerCase();
  return result.error || result.status !== 0 || !SHA40.test(head) ? '' : head;
}
async function defaultProbeEnvironment(options = {}) {
  if (process.platform !== 'win32' && options.allowNonWindowsForTest !== true) {
    return { ok: false, reason: 'SOVEREIGN_BUILDER8_WINDOWS_REQUIRED' };
  }
  const run = options.spawnSyncFn || spawnSync;
  const worker = run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', PROCESS_PROBE], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 12000,
  });
  let workerRecord;
  try { workerRecord = JSON.parse(text(worker.stdout)); } catch { workerRecord = null; }
  if (worker.error || worker.status !== 0 || !Number.isSafeInteger(workerRecord?.workerCount)
    || workerRecord.workerCount !== 1) {
    return { ok: false, reason: 'SOVEREIGN_BUILDER8_CANONICAL_WORKER_NOT_UNIQUE_AND_RUNNING' };
  }
  let governor;
  try { governor = JSON.parse(await readFile(GOVERNOR_STATE, 'utf8')); }
  catch { return { ok: false, reason: 'SOVEREIGN_BUILDER8_GAMING_GOVERNOR_UNPROVEN' }; }
  if (governor?.schemaVersion !== 'stephanos.vr-resource-governor.v1'
    || governor.active !== false || governor.localModelAllowed === false) {
    return { ok: false, reason: 'SOVEREIGN_BUILDER8_GAMING_ACTIVE_OR_UNKNOWN' };
  }
  const gameProbe = run(POWERSHELL, [
    '-NoProfile', '-NonInteractive', '-Command',
    "@(Get-Process -Name 'Starfield','Cyberpunk2077','NMS','SkyrimVR','RDR2','vrcompositor','OculusClient' -ErrorAction SilentlyContinue).Count",
  ], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 12000 });
  if (gameProbe.error || gameProbe.status !== 0 || !/^0$/.test(text(gameProbe.stdout))) {
    return { ok: false, reason: 'SOVEREIGN_BUILDER8_GAME_OR_VR_PROCESS_PRESENT' };
  }
  if (freemem() < MIN_FREE_RAM) return { ok: false, reason: 'SOVEREIGN_BUILDER8_RAM_PRESSURE' };
  const gpu = run('nvidia-smi.exe', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000,
  });
  const freeVramMib = Number(text(gpu.stdout).split(/\\r?\\n/)[0]);
  if (gpu.error || gpu.status !== 0 || !Number.isFinite(freeVramMib) || freeVramMib < MIN_FREE_VRAM_MIB) {
    return { ok: false, reason: 'SOVEREIGN_BUILDER8_VRAM_PRESSURE_OR_UNKNOWN' };
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  try {
    const response = await fetchImpl(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    const health = await response.json();
    if (!response.ok || health?.ok !== true || health?.service !== 'stephanos-sovereign-commander') {
      return { ok: false, reason: 'SOVEREIGN_BUILDER8_COMMANDER_UNHEALTHY' };
    }
  } catch { return { ok: false, reason: 'SOVEREIGN_BUILDER8_COMMANDER_UNREACHABLE' }; }
  return { ok: true, workerCount: 1, freeVramMib, governorState: 'NORMAL' };
}

// An unavailable/unknown result is visible in Shared Workspace, and cannot
// accidentally preserve an older READY receipt.
export async function refreshSovereignBuilder8Capacity(options = {}) {
  const env = options.env || process.env;
  const paths = options.paths || resolveCriticalBacklogRuntimePaths({ env });
  const now = options.now instanceof Date ? options.now : new Date();
  const observedAtUtc = now.toISOString();
  const proofIdPrefix = 'sovereign-builder8-capacity-';
  const statusPath = ['status', SOVEREIGN_BUILDER8_STATUS_ID + '.json'];
  const writeStatus = options.writeStatus || ((record) => writeAtomicJson(
    paths.workspaceRoot, statusPath, record, { repoRoot: paths.repoRoot, nowMs: now.getTime() },
  ));
  const clearStatus = options.clearStatus || (async () => {
    const { resolveSharedWorkspacePath } = await import('../../shared/agents/sharedAgentWorkspaceStore.mjs');
    const resolved = resolveSharedWorkspacePath({ root: paths.workspaceRoot, repoRoot: paths.repoRoot, segments: statusPath });
    if (!resolved.ok) return;
    try { await unlink(resolved.path); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  });
  async function blocked(reason) {
    const record = createSharedWorkspaceStatusRecord({
      statusId: SOVEREIGN_BUILDER8_STATUS_ID, participantId: SOVEREIGN_BUILDER8_WORKER_ID,
      timestampUtc: observedAtUtc, relatedIssue: '#3002',
      status: 'BLOCKED', summary: reason, proofRefs: [],
    });
    try { const result = await writeStatus(record); if (result?.ok !== true) await clearStatus(); }
    catch { try { await clearStatus(); } catch {} }
    return reject(reason);
  }

  const headReader = options.readSourceHead || ((root) => defaultReadHead(root, options));
  const originalHead = text(await headReader(paths.repoRoot)).toLowerCase();
  if (!SHA40.test(originalHead)) return blocked('SOVEREIGN_BUILDER8_SOURCE_HEAD_UNPROVEN');
  const endpoint = localEndpoint(options.endpoint || env.STEPHANOS_OLLAMA_ENDPOINT);
  const model = text(options.model || env.STEPHANOS_LOCAL_BUILDER_MODEL || 'qwen3-coder:30b');
  if (!endpoint || !SAFE_MODEL.test(model)) return blocked('SOVEREIGN_BUILDER8_LOCAL_MODEL_IDENTITY_INVALID');

  const environment = await (options.probeEnvironment || defaultProbeEnvironment)(options);
  if (environment?.ok !== true || environment.workerCount !== 1 || environment.governorState !== 'NORMAL') {
    return blocked(text(environment?.reason) || 'SOVEREIGN_BUILDER8_ENVIRONMENT_UNPROVEN');
  }
  const probe = await (options.probeModel || probeStephanosNativeOllamaV1)({
    endpoint, model, fetchImpl: options.fetchImpl, timeoutMs: options.probeTimeoutMs || 30000,
  });
  if (probe?.ok !== true || probe.model !== model || probe.loadState !== 'READY'
    || !/^[a-f0-9]{64}$/.test(text(probe.requestSha256))
    || !/^[a-f0-9]{64}$/.test(text(probe.responseSha256))) {
    return blocked(text(probe?.reason) || 'SOVEREIGN_BUILDER8_MODEL_QUALIFICATION_UNPROVEN');
  }

  const queue = await (options.readQueue || readMissionWorkerQueue)({ env });
  if (!Array.isArray(queue)) return blocked('SOVEREIGN_BUILDER8_QUEUE_UNPROVEN');
  const queueDepth = queue.filter((item) => item?.adapter === 'sovereign-commander').length;
  if (queueDepth > 64) return blocked('SOVEREIGN_BUILDER8_QUEUE_FULL');
  const latestHead = text(await headReader(paths.repoRoot)).toLowerCase();
  if (latestHead !== originalHead) return blocked('SOVEREIGN_BUILDER8_SOURCE_HEAD_MOVED');

  const authorityId = 'sovereign-builder8-source-' + originalHead;
  const proofId = proofIdPrefix + originalHead;
  const proofRef = 'proof/' + proofId + '.json';
  const expiresAtUtc = new Date(now.getTime() + 4 * 60 * 1000).toISOString();
  const proof = {
    ...createSharedWorkspaceProofRecord({
      proofId, participantId: SOVEREIGN_BUILDER8_WORKER_ID, timestampUtc: observedAtUtc,
      correlationId: authorityId, relatedIssue: '#3002', status: 'PASS',
      summary: 'Exact-head Sovereign source worker, gaming governor, RAM/VRAM and local model qualified.',
      refs: [proofRef], proofRefs: [proofRef],
    }),
    schema: 'stephanos.sovereign-builder8-runtime-proof.v1',
    repository: SOVEREIGN_BUILDER8_REPOSITORY, sourceHead: originalHead,
    workerId: SOVEREIGN_BUILDER8_WORKER_ID, model, endpoint,
    modelRequestSha256: probe.requestSha256, modelResponseSha256: probe.responseSha256,
    workerCount: environment.workerCount, governorState: environment.governorState,
    freeVramMib: environment.freeVramMib, queueDepth,
    latencySemantics: 'conservative routing ceiling; not measured p95',
    sourceConstructionAllowed: true, mergeAuthority: false, leaseSeizureAllowed: false,
    expiresAtUtc, finalVerdict: 'SOVEREIGN_BUILDER8_CAPACITY_PROVEN',
  };
  const proofWrite = await (options.writeProof || ((record) => writeAtomicJson(
    paths.workspaceRoot, ['proof', proofId + '.json'], record, { repoRoot: paths.repoRoot, nowMs: now.getTime() },
  )))(proof);
  if (proofWrite?.ok !== true) return blocked('SOVEREIGN_BUILDER8_PROOF_WRITE_FAILED');

  const receipt = Object.freeze({
    schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    receiptId: 'sovereign-builder8-' + sha256([originalHead, observedAtUtc, probe.responseSha256].join(':')).slice(0, 24),
    route: MISSION_CONTROLLER_ROUTE.SOVEREIGN_COMMANDER,
    repository: SOVEREIGN_BUILDER8_REPOSITORY, sourceHead: originalHead,
    workerId: SOVEREIGN_BUILDER8_WORKER_ID, state: 'READY',
    supportedOperations: Object.freeze(['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS']),
    supportedTaskClasses: Object.freeze(['FOCUSED_REPAIR']),
    observedAtUtc, expiresAtUtc, queueDepth, p95StartLatencySeconds: 90,
    authorityReceiptIds: Object.freeze([authorityId]),
    proofRefs: Object.freeze([proofRef]),
  });
  if (!validateBuildLaneCapacityReceipt(receipt, {
    repository: SOVEREIGN_BUILDER8_REPOSITORY,
    taskClass: 'FOCUSED_REPAIR', nowUtc: observedAtUtc, sourceHead: latestHead,
  }).valid) return blocked('SOVEREIGN_BUILDER8_RECEIPT_INVALID');

  const result = await (options.publishCapacity || ((candidate) => publishBuildLaneCapacityToSharedWorkspace(
    paths.workspaceRoot, candidate, { repoRoot: paths.repoRoot, nowUtc: observedAtUtc },
  )))(receipt);
  if (result?.ok !== true) return blocked('SOVEREIGN_BUILDER8_STATUS_PUBLISH_FAILED');
  return Object.freeze({
    schemaVersion: SOVEREIGN_BUILDER8_SCHEMA, ok: true, available: true,
    sourceHead: originalHead, model, workerId: SOVEREIGN_BUILDER8_WORKER_ID,
    receiptId: receipt.receiptId, proofRef, queueDepth, expiresAtUtc,
    mergeAuthority: false, leaseSeizureAllowed: false, arbitraryCommandAllowed: false,
    finalVerdict: 'SOVEREIGN_BUILDER8_CAPACITY_PUBLISHED',
  });
}
