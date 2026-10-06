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
import {
  buildStephanosExecutionCommandEnvelopeV1,
  STEPHANOS_EXECUTION_SURFACE,
} from '../../shared/agents/stephanosExecutionCommandFabricV1.mjs';
import {
  executeSovereignCommanderCommandV1,
  SOVEREIGN_COMMANDER_OPERATION,
} from '../../shared/agents/sovereignCommanderV1.mjs';
import { resolveCriticalBacklogRuntimePaths } from './criticalBacklogConveyorServiceCore.js';
import { readMissionWorkerQueue } from './missionOrchestratorWorkerService.js';

export const SOVEREIGN_COMMANDER_CAPACITY_SCHEMA = 'stephanos.sovereign-commander-capacity.v1';
export const SOVEREIGN_COMMANDER_PROOF_SCHEMA = 'stephanos.sovereign-commander-capacity-proof.v1';
export const SOVEREIGN_COMMANDER_WORKER_ID = 'sovereign-commander-battle-bridge-01';
export const SOVEREIGN_COMMANDER_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const SOVEREIGN_COMMANDER_TASK_CLASSES = Object.freeze(['FOCUSED_REPAIR']);
export const SOVEREIGN_COMMANDER_CONSERVATIVE_START_LATENCY_SECONDS = 2;

const SHA40 = /^[0-9a-f]{40}$/i;
const RECEIPT_LIFETIME_MS = 4 * 60 * 1000;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function unavailable(reason, extra = {}) {
  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_CAPACITY_SCHEMA,
    ok: false,
    available: false,
    workerId: SOVEREIGN_COMMANDER_WORKER_ID,
    reason,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
    vendorMeterRequired: false,
    ...extra,
  });
}

function defaultReadSourceHead(repoRoot, options = {}) {
  const result = (options.spawnSyncFn || spawnSync)(
    options.gitCommand || 'git',
    ['-C', repoRoot, 'rev-parse', 'HEAD'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) return '';
  const head = text(result.stdout).toLowerCase();
  return SHA40.test(head) ? head : '';
}

async function defaultProbeSovereignCommander(paths, options = {}) {
  const envelope = buildStephanosExecutionCommandEnvelopeV1({
    repositoryRoot: paths.repoRoot,
    sharedWorkspaceRoot: paths.workspaceRoot,
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: 'sovereign-capacity-probe-current',
    missionId: 'sovereign-capacity-probe',
    operation: SOVEREIGN_COMMANDER_OPERATION.GET_CONFIG,
    targetPaths: [],
    proofRefs: ['proof/sovereign-commander-capacity-probe.json'],
  });
  if (!envelope.dispatchAllowed) {
    return Object.freeze({ ok: false, reason: envelope.blockers?.[0] || 'SOVEREIGN_COMMANDER_ENVELOPE_BLOCKED' });
  }
  const execute = options.executeSovereignCommanderCommand || executeSovereignCommanderCommandV1;
  const startedAtMs = Date.now();
  const result = await execute(envelope, {
    ...(options.sovereignCommanderOptions || {}),
    repoRoot: paths.repoRoot,
  });
  const config = result?.structuredContent || {};
  if (
    result?.ok !== true
    || !/^[0-9a-f]{64}$/i.test(text(result?.proofHash))
    || config.canEditFiles !== true
    || config.vendorMeterRequired !== false
    || config.externalSaasRelayRequired !== false
    || config.arbitraryUnboundedCommandAllowed !== false
    || config.mergeAuthority !== false
  ) {
    return Object.freeze({
      ok: false,
      reason: text(result?.blocker || result?.finalVerdict, 'SOVEREIGN_COMMANDER_CAPABILITY_PROBE_FAILED'),
    });
  }
  return Object.freeze({
    ok: true,
    proofHash: text(result.proofHash).toLowerCase(),
    probeLatencyMs: Math.max(1, Date.now() - startedAtMs),
    canEditFiles: true,
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
  });
}

export async function refreshSovereignCommanderCapacity(options = {}) {
  const env = options.env || process.env;
  const paths = options.paths || resolveCriticalBacklogRuntimePaths({ env });
  const readSourceHead = options.readSourceHead || ((root) => defaultReadSourceHead(root, options));
  const sourceHead = text(await readSourceHead(paths.repoRoot)).toLowerCase();
  if (!SHA40.test(sourceHead)) return unavailable('SOVEREIGN_COMMANDER_SOURCE_HEAD_UNPROVEN');

  const probe = options.probeSovereignCommander || defaultProbeSovereignCommander;
  const probeResult = await probe(paths, options);
  if (probeResult?.ok !== true) {
    return unavailable(text(probeResult?.reason, 'SOVEREIGN_COMMANDER_CAPABILITY_PROBE_FAILED'), { sourceHead });
  }

  const readQueue = options.readQueue || readMissionWorkerQueue;
  const queue = await readQueue({ env });
  const queueDepth = Array.isArray(queue)
    ? queue.filter((entry) => text(entry?.adapter).toLowerCase() === 'sovereign-commander').length
    : 0;
  if (!Number.isSafeInteger(queueDepth) || queueDepth < 0 || queueDepth > 64) {
    return unavailable('SOVEREIGN_COMMANDER_QUEUE_DEPTH_INVALID', { sourceHead });
  }

  const observedAt = options.now instanceof Date ? options.now : new Date();
  const observedAtUtc = observedAt.toISOString();
  const expiresAtUtc = new Date(observedAt.getTime() + RECEIPT_LIFETIME_MS).toISOString();
  const proofRef = `proof/sovereign-commander-capacity-${sourceHead}.json`;
  const proofFile = proofRef.replace(/^proof\//, '');
  const proofId = `sovereign-commander-capacity-${sourceHead}`;
  const proof = Object.freeze({
    ...createSharedWorkspaceProofRecord({
      proofId,
      participantId: SOVEREIGN_COMMANDER_WORKER_ID,
      timestampUtc: observedAtUtc,
      correlationId: proofId,
      relatedIssue: '#1622',
      status: 'PASS',
      summary: `Sovereign Commander proved local meter-free guarded file mutation capability on exact source ${sourceHead}; queue depth ${queueDepth}.`,
      refs: [proofRef],
      proofRefs: [proofRef],
    }),
    schema: SOVEREIGN_COMMANDER_PROOF_SCHEMA,
    sourceHead,
    repository: SOVEREIGN_COMMANDER_REPOSITORY,
    workerId: SOVEREIGN_COMMANDER_WORKER_ID,
    queueDepth,
    probeLatencyMs: Number(probeResult.probeLatencyMs || 0),
    commandProofHash: text(probeResult.proofHash),
    sourceConstructionAllowed: true,
    focusedTestsAllowed: true,
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
    expiresAtUtc,
    finalVerdict: 'SOVEREIGN_COMMANDER_CAPACITY_PROVEN',
  });

  const writeProof = options.writeProof || (async (record) => writeAtomicJson(
    paths.workspaceRoot,
    ['proof', proofFile],
    record,
    { repoRoot: paths.repoRoot, nowMs: observedAt.getTime() },
  ));
  const proofWrite = await writeProof(proof);
  if (proofWrite?.ok !== true) {
    return unavailable(`SOVEREIGN_COMMANDER_PROOF_PUBLICATION_FAILED:${text(proofWrite?.reason, 'unknown')}`, { sourceHead });
  }

  const receiptSeed = `${sourceHead}\n${observedAtUtc}\n${queueDepth}\n${probeResult.proofHash}`;
  const receipt = Object.freeze({
    schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    receiptId: `sovereign-commander-${sha256(receiptSeed).slice(0, 24)}`,
    route: MISSION_CONTROLLER_ROUTE.SOVEREIGN_COMMANDER,
    repository: SOVEREIGN_COMMANDER_REPOSITORY,
    sourceHead,
    workerId: SOVEREIGN_COMMANDER_WORKER_ID,
    state: 'READY',
    supportedOperations: Object.freeze(['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS']),
    supportedTaskClasses: SOVEREIGN_COMMANDER_TASK_CLASSES,
    observedAtUtc,
    expiresAtUtc,
    queueDepth,
    p95StartLatencySeconds: SOVEREIGN_COMMANDER_CONSERVATIVE_START_LATENCY_SECONDS,
    authorityReceiptIds: Object.freeze([]),
    proofRefs: Object.freeze([proofRef]),
  });
  const validation = validateBuildLaneCapacityReceipt(receipt, {
    repository: SOVEREIGN_COMMANDER_REPOSITORY,
    taskClass: SOVEREIGN_COMMANDER_TASK_CLASSES[0],
    nowUtc: observedAtUtc,
    sourceHead,
  });
  if (!validation.valid) return unavailable('SOVEREIGN_COMMANDER_CAPACITY_RECEIPT_INVALID', { sourceHead });

  const publishCapacity = options.publishCapacity || (async (candidate) => publishBuildLaneCapacityToSharedWorkspace(
    paths.workspaceRoot,
    candidate,
    { repoRoot: paths.repoRoot, nowUtc: observedAtUtc },
  ));
  const publication = await publishCapacity(receipt);
  if (publication?.ok !== true) {
    return unavailable(`SOVEREIGN_COMMANDER_CAPACITY_PUBLICATION_FAILED:${text(publication?.reason, 'unknown')}`, {
      sourceHead,
      proofWrite,
    });
  }

  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_CAPACITY_SCHEMA,
    ok: true,
    available: true,
    repository: SOVEREIGN_COMMANDER_REPOSITORY,
    sourceHead,
    workerId: SOVEREIGN_COMMANDER_WORKER_ID,
    queueDepth,
    observedAtUtc,
    expiresAtUtc,
    proofRef,
    proofWrite,
    publication,
    commandProofHash: text(probeResult.proofHash),
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_CAPACITY_PUBLISHED',
  });
}
