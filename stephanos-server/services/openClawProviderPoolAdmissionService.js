import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import {
  OPENCLAW_PROVIDER_CAPACITY_SCHEMA,
  OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA,
  validateOpenClawProviderCapacity,
  validateOpenClawProviderQualification,
  validateOpenClawQualificationAuthorityChain,
} from '../../shared/agents/openClawProviderPoolQualificationV1.mjs';
import {
  adjudicateOpenClawTaskClassPromotionCandidateV1,
} from '../../shared/agents/openClawTaskClassPromotionCandidateV1.mjs';
import {
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  OPENCLAW_ELASTIC_PROVIDER_POOL_SCHEMA,
  OPENCLAW_ELASTIC_PROVIDER_POOL_STATUS_FILE,
} from './elasticOpenClawProviderPoolService.js';
import { resolveCriticalBacklogRuntimePaths } from './criticalBacklogConveyorServiceCore.js';
import { readMissionWorkerQueue } from './missionOrchestratorWorkerService.js';

export const OPENCLAW_PROVIDER_POOL_ADMISSION_SCHEMA = 'stephanos.openclaw-provider-pool-admission.v1';
export const OPENCLAW_PROVIDER_POOL_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const OPENCLAW_PROVIDER_POOL_TASK_CLASS = 'OC1_REPOSITORY_SCOUT';
export const OPENCLAW_PROVIDER_POOL_CONSERVATIVE_START_LATENCY_SECONDS = 30;

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const RECEIPT_LIFETIME_MS = 4 * 60 * 1000;
const MAX_PROOF_FILES = 128;
const OC1_PROOF_DIRECTORY = Object.freeze(['proofs', 'openclaw-oc1']);
const SUPERVISOR_STATUS_SEGMENTS = Object.freeze(['status', 'battle-bridge-ignition-supervisor-current.json']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function unavailable(reason, extra = {}) {
  return Object.freeze({
    schemaVersion: OPENCLAW_PROVIDER_POOL_ADMISSION_SCHEMA,
    ok: false,
    available: false,
    reason,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
    ...extra,
  });
}

function expectedWorkerId(runtimeId) {
  return `openclaw-${sha256(runtimeId).slice(0, 24)}`;
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

async function readJsonFile(pathValue, readFileImpl = readFile) {
  try {
    return JSON.parse(await readFileImpl(pathValue, 'utf8'));
  } catch {
    return null;
  }
}

function providerResultFromProof(record = {}) {
  if (record?.channel !== 'openclaw-provider-qualification' || typeof record?.body !== 'string') return null;
  try {
    const parsed = JSON.parse(record.body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function receiptIdFromProviderResult(result = {}) {
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const match = artifacts.find((value) => /^receipts\/oc1-receipt-[a-f0-9]{32}\.json$/i.test(text(value)));
  if (!match) return '';
  return text(match).slice('receipts/'.length, -'.json'.length);
}

async function readLatestPromotionCandidate(paths, sourceHead, nowUtc, options = {}) {
  const resolved = resolveSharedWorkspacePath({
    root: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    segments: OC1_PROOF_DIRECTORY,
  });
  if (!resolved.ok) return null;

  let entries;
  try {
    entries = await (options.readdirImpl || readdir)(resolved.path, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = entries
    .filter((entry) => entry?.isFile?.() && /^oc1-[a-f0-9]{32}\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .slice(0, MAX_PROOF_FILES);

  const candidates = [];
  for (const fileName of files) {
    const proofPath = resolveSharedWorkspacePath({
      root: paths.workspaceRoot,
      repoRoot: paths.repoRoot,
      segments: [...OC1_PROOF_DIRECTORY, fileName],
    });
    if (!proofPath.ok) continue;
    const proofRecord = await readJsonFile(proofPath.path, options.readFileImpl || readFile);
    const providerResult = providerResultFromProof(proofRecord);
    if (!providerResult
      || text(providerResult.taskClass) !== OPENCLAW_PROVIDER_POOL_TASK_CLASS
      || text(providerResult.observedSourceHead).toLowerCase() !== sourceHead) continue;

    const receiptId = receiptIdFromProviderResult(providerResult);
    if (!receiptId) continue;
    const receiptPath = resolveSharedWorkspacePath({
      root: paths.workspaceRoot,
      repoRoot: paths.repoRoot,
      segments: ['receipts', `${receiptId}.json`],
    });
    if (!receiptPath.ok) continue;
    const workspaceReceipt = await readJsonFile(receiptPath.path, options.readFileImpl || readFile);
    const executionReceipt = workspaceReceipt?.executionReceipt;
    const promotion = adjudicateOpenClawTaskClassPromotionCandidateV1({
      executionReceipt,
      providerProofRecord: proofRecord,
      observedAtUtc: nowUtc,
    });
    if (promotion?.ok !== true) continue;
    const observedMs = Date.parse(text(promotion.qualificationReceipt?.observedAtUtc));
    if (!Number.isFinite(observedMs)) continue;
    candidates.push({ promotion, observedMs });
  }
  candidates.sort((left, right) => right.observedMs - left.observedMs);
  return candidates[0]?.promotion || null;
}

async function readExactHeadSupervisor(paths, sourceHead, options = {}) {
  const resolved = resolveSharedWorkspacePath({
    root: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    segments: SUPERVISOR_STATUS_SEGMENTS,
  });
  if (!resolved.ok) return null;
  const record = await readJsonFile(resolved.path, options.readFileImpl || readFile);
  if (record?.schema !== 'stephanos.battle-bridge-ignition-supervisor.v1'
    || record?.sourceTruthVerdict?.state !== 'ready'
    || text(record?.sourceTruthVerdict?.expectedHead).toLowerCase() !== sourceHead
    || record?.services?.openClaw18789?.ready !== true) return null;
  return record;
}

async function defaultProbeOpenClawGateway(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(options.probeTimeoutMs) ? Math.max(100, options.probeTimeoutMs) : 5_000;
  const startedAtMs = Date.now();
  try {
    const healthResponse = await fetchImpl('http://127.0.0.1:18789/health', {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!healthResponse?.ok) return Object.freeze({ ok: false, reason: 'OPENCLAW_PROVIDER_POOL_HEALTH_HTTP_FAILED' });
    const health = await healthResponse.json();
    const healthState = text(health?.status || health?.state).toLowerCase();
    if (health?.ok !== true && healthState !== 'ok' && healthState !== 'live') {
      return Object.freeze({ ok: false, reason: 'OPENCLAW_PROVIDER_POOL_HEALTH_NOT_READY' });
    }
    const identityResponse = await fetchImpl('http://127.0.0.1:18789/identity', {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!identityResponse?.ok) return Object.freeze({ ok: false, reason: 'OPENCLAW_PROVIDER_POOL_IDENTITY_HTTP_FAILED' });
    const identity = await identityResponse.json();
    const runtimeId = text(identity?.runtimeId);
    if (identity?.product !== 'OpenClaw' || !SAFE_RUNTIME_ID.test(runtimeId)) {
      return Object.freeze({ ok: false, reason: 'OPENCLAW_PROVIDER_POOL_IDENTITY_INVALID' });
    }
    return Object.freeze({
      ok: true,
      runtimeId,
      probeLatencyMs: Math.max(1, Date.now() - startedAtMs),
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error?.name === 'TimeoutError'
        ? 'OPENCLAW_PROVIDER_POOL_PROBE_TIMEOUT'
        : `OPENCLAW_PROVIDER_POOL_PROBE_FAILED:${text(error?.message, 'unknown')}`,
    });
  }
}

async function publishEmptyPool(paths, now, options = {}) {
  const record = Object.freeze({
    schemaVersion: OPENCLAW_ELASTIC_PROVIDER_POOL_SCHEMA,
    generatedAtUtc: now.toISOString(),
    hostContexts: Object.freeze([]),
  });
  const publish = options.publishPool || (async (candidate) => writeAtomicJson(
    paths.workspaceRoot,
    ['status', OPENCLAW_ELASTIC_PROVIDER_POOL_STATUS_FILE],
    candidate,
    { repoRoot: paths.repoRoot, nowMs: now.getTime() },
  ));
  return publish(record);
}

export async function refreshOpenClawProviderPoolCapacity(options = {}) {
  const env = options.env || process.env;
  const paths = options.paths || resolveCriticalBacklogRuntimePaths({ env });
  const now = options.now instanceof Date ? options.now : new Date();
  const nowUtc = now.toISOString();

  const readSourceHead = options.readSourceHead || ((root) => defaultReadSourceHead(root, options));
  const sourceHead = text(await readSourceHead(paths.repoRoot)).toLowerCase();
  if (!SHA40.test(sourceHead)) {
    await publishEmptyPool(paths, now, options);
    return unavailable('OPENCLAW_PROVIDER_POOL_SOURCE_HEAD_UNPROVEN');
  }

  const supervisor = await readExactHeadSupervisor(paths, sourceHead, options);
  if (!supervisor) {
    await publishEmptyPool(paths, now, options);
    return unavailable('OPENCLAW_PROVIDER_POOL_EXACT_HEAD_SUPERVISOR_UNPROVEN', { sourceHead });
  }

  const probe = options.probeOpenClawGateway || defaultProbeOpenClawGateway;
  const probeResult = await probe(options);
  if (probeResult?.ok !== true) {
    await publishEmptyPool(paths, now, options);
    return unavailable(text(probeResult?.reason, 'OPENCLAW_PROVIDER_POOL_LIVE_PROBE_FAILED'), { sourceHead });
  }

  const promotion = await readLatestPromotionCandidate(paths, sourceHead, nowUtc, options);
  if (!promotion) {
    await publishEmptyPool(paths, now, options);
    return unavailable('OPENCLAW_PROVIDER_POOL_FRESH_REAL_WORK_QUALIFICATION_MISSING', { sourceHead });
  }

  const qualification = validateOpenClawProviderQualification(promotion.qualificationReceipt, {
    repository: OPENCLAW_PROVIDER_POOL_REPOSITORY,
    taskClass: OPENCLAW_PROVIDER_POOL_TASK_CLASS,
    sourceHead,
    nowUtc,
  });
  if (!qualification.valid) {
    await publishEmptyPool(paths, now, options);
    return unavailable(qualification.reason, { sourceHead });
  }

  if (qualification.receipt.providerInstance !== expectedWorkerId(probeResult.runtimeId)) {
    await publishEmptyPool(paths, now, options);
    return unavailable('OPENCLAW_PROVIDER_POOL_RUNTIME_IDENTITY_DRIFT', { sourceHead });
  }

  const readQueue = options.readQueue || readMissionWorkerQueue;
  const queue = await readQueue({ env });
  const queueDepth = Array.isArray(queue)
    ? queue.filter((entry) => text(entry?.adapter).toLowerCase() === 'openclaw-readonly').length
    : 0;
  if (!Number.isSafeInteger(queueDepth) || queueDepth < 0 || queueDepth > 64) {
    await publishEmptyPool(paths, now, options);
    return unavailable('OPENCLAW_PROVIDER_POOL_QUEUE_DEPTH_INVALID', { sourceHead });
  }

  const expiresAtUtc = new Date(now.getTime() + RECEIPT_LIFETIME_MS).toISOString();
  const proofRefs = Object.freeze([...new Set([
    ...(Array.isArray(qualification.receipt.proofRefs) ? qualification.receipt.proofRefs : []),
    'status/battle-bridge-ignition-supervisor-current.json',
  ])]);
  const capacityReceipt = Object.freeze({
    schemaVersion: OPENCLAW_PROVIDER_CAPACITY_SCHEMA,
    receiptId: `openclaw-capacity-${sha256(`${qualification.receipt.qualificationId}\n${nowUtc}`).slice(0, 24)}`,
    provider: 'openclaw-standalone',
    repository: OPENCLAW_PROVIDER_POOL_REPOSITORY,
    workerId: qualification.receipt.providerInstance,
    state: 'READY',
    supportedOperations: Object.freeze(['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS']),
    supportedTaskClasses: Object.freeze([OPENCLAW_PROVIDER_POOL_TASK_CLASS]),
    observedAtUtc: nowUtc,
    expiresAtUtc,
    queueDepth,
    p95StartLatencySeconds: OPENCLAW_PROVIDER_POOL_CONSERVATIVE_START_LATENCY_SECONDS,
    qualificationIds: Object.freeze([qualification.receipt.qualificationId]),
    qualificationAuthorityReceiptId: qualification.receipt.authorityReceiptId,
    proofRefs,
  });

  const hostContext = Object.freeze({
    schemaVersion: OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA,
    qualificationReceipt: promotion.qualificationReceipt,
    capacityReceipt,
    realWorkExecutionReceipt: promotion.realWorkWorkspaceReceipt.executionReceipt,
    realWorkWorkspaceReceipt: promotion.realWorkWorkspaceReceipt,
    qualificationAuthorityReceipt: promotion.qualificationAuthorityReceipt,
  });

  const authority = validateOpenClawQualificationAuthorityChain(
    qualification.receipt,
    hostContext,
    {
      repository: OPENCLAW_PROVIDER_POOL_REPOSITORY,
      taskClass: OPENCLAW_PROVIDER_POOL_TASK_CLASS,
      sourceHead,
      nowUtc,
    },
  );
  const capacity = authority.valid
    ? validateOpenClawProviderCapacity(capacityReceipt, {
        repository: OPENCLAW_PROVIDER_POOL_REPOSITORY,
        taskClass: OPENCLAW_PROVIDER_POOL_TASK_CLASS,
        qualificationId: qualification.receipt.qualificationId,
        authorityReceiptId: authority.authorityReceiptId,
        workerId: qualification.receipt.providerInstance,
        nowUtc,
      })
    : Object.freeze({ valid: false, reason: authority.reason });
  if (!authority.valid || !capacity.valid) {
    await publishEmptyPool(paths, now, options);
    return unavailable(!authority.valid ? authority.reason : capacity.reason, { sourceHead });
  }

  const record = Object.freeze({
    schemaVersion: OPENCLAW_ELASTIC_PROVIDER_POOL_SCHEMA,
    generatedAtUtc: nowUtc,
    hostContexts: Object.freeze([hostContext]),
  });
  const publishPool = options.publishPool || (async (candidate) => writeAtomicJson(
    paths.workspaceRoot,
    ['status', OPENCLAW_ELASTIC_PROVIDER_POOL_STATUS_FILE],
    candidate,
    { repoRoot: paths.repoRoot, nowMs: now.getTime() },
  ));
  const publication = await publishPool(record);
  if (publication?.ok !== true) {
    return unavailable(`OPENCLAW_PROVIDER_POOL_PUBLICATION_FAILED:${text(publication?.reason, 'unknown')}`, { sourceHead });
  }

  return Object.freeze({
    schemaVersion: OPENCLAW_PROVIDER_POOL_ADMISSION_SCHEMA,
    ok: true,
    available: true,
    repository: OPENCLAW_PROVIDER_POOL_REPOSITORY,
    sourceHead,
    workerId: qualification.receipt.providerInstance,
    taskClass: OPENCLAW_PROVIDER_POOL_TASK_CLASS,
    qualificationId: qualification.receipt.qualificationId,
    authorityReceiptId: qualification.receipt.authorityReceiptId,
    capacityReceiptId: capacityReceipt.receiptId,
    observedAtUtc: nowUtc,
    expiresAtUtc,
    queueDepth,
    p95StartLatencySeconds: OPENCLAW_PROVIDER_POOL_CONSERVATIVE_START_LATENCY_SECONDS,
    publication,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
    finalVerdict: 'OPENCLAW_PROVIDER_POOL_CAPACITY_PUBLISHED',
  });
}
