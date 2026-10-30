import { prepareSupervisedR7RecoveryV1 } from './supervisedR7RecoveryPreparationV1.mjs';
import { createHash } from 'node:crypto';
import { SUPERVISED_R7_FENCE_SCHEMA, supervisedR7FenceBindsLease,
  readSupervisedRecoverySourceHead, readSupervisedRecoveryMaintenance,
  prepareRuntimeSupervisedR7, readRuntimeSupervisedR7Packet, authenticateRuntimeSupervisedR7,
  verifyRuntimeSupervisedR7Fence, supervisedRecoveryDigest } from './supervisedR7RecoveryRuntime.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readMissionRecord, appendMissionEvent, runWithMissionStatePrecondition } from './missionOrchestratorStore.js';
import { readSourceMutationLease, withOriginalSourceLeaseFenceGuard } from './programmeAuthorityService.js';
import { readExecutionReceiptHistory } from '../../shared/agents/executionReceiptV1.mjs';
import { authenticateLegacyOrphanQuarantine } from './legacyOriginalSourceOrphanQuarantineV1.js';
import { resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';
import {
  exactElasticPrHeadIdentity, originalMissionHasQueuedWork, readOriginalSourceExecutionIdV1,
} from './elasticPrHeadLeaseService.js';

export const ORIGINAL_SOURCE_FENCE_SCHEMA = 'stephanos.original-source-attempt-fence.v1';
export const LEGACY_ORPHAN_FENCE_SCHEMA = 'stephanos.original-source-attempt-legacy-orphan-fence.v2';
const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const WRITER_EXCLUSION_SCHEMA = 'stephanos.original-source-writer-exclusion.v1';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value) => String(value ?? '').trim();
const fail = (reason) => { throw new Error(reason); };

async function readTerminalSourcePair(queueRoot, adapter, sourceAction) {
  const bytes = await Promise.all(['.json', '.result.json'].map((suffix) =>
    readFile(resolve(queueRoot, adapter, 'completed', sourceAction + suffix))));
  if (bytes.some((value) => value.length > 2 * 1024 * 1024)) fail('ORIGINAL_FENCE_TERMINAL_PAIR_UNBOUNDED');
  return { item: JSON.parse(bytes[0]), result: JSON.parse(bytes[1]),
    pairDigest: digest(bytes.map((value) => value.toString('base64'))) };
}

async function proveHeldLeaseExecutionsTerminal(lease, paths, reader) {
  const history = await reader(paths.workspaceRoot, { leaseKey: lease.leaseId }, { repoRoot: paths.repoRoot });
  if (history?.ok !== true || !Array.isArray(history.receipts)) fail('ORIGINAL_FENCE_HELD_EXECUTION_HISTORY_UNKNOWN');
  const chains = new Map();
  for (const receipt of history.receipts) {
    if (receipt.leaseKey !== lease.leaseId || !text(receipt.executionId)
        || receipt.repository !== lease.repository || receipt.branch !== lease.branch
        || receipt.sourceHead !== lease.headSha || receipt.issueNumber !== lease.issueNumber
        || receipt.prNumber !== lease.prNumber) fail('ORIGINAL_FENCE_HELD_EXECUTION_IDENTITY_MISMATCH');
    chains.set(receipt.executionId, receipt);
  }
  if ([...chains.values()].some((receipt) => !['completed', 'failed', 'cancelled'].includes(receipt.state))) {
    fail('ORIGINAL_FENCE_HELD_EXECUTION_ACTIVE');
  }
  return chains.size;
}

// Uses the existing canonical mission record, not a second lease/fence database.
export async function assertOriginalSourceAttemptNotFenced(missionId, options = {}) {
  if (!/^critical-[1-9]\d*-elastic-goal$/.test(text(missionId))) return;
  const { state } = await (options.readMissionRecord || readMissionRecord)(missionId, {
    env: options.env || process.env, ...options.missionStoreOptions,
  });
  if (state.cancelled === true || state.currentPhase === 'CANCELLED'
      || state.storeMetadata?.originalSourceAttemptFence
      || state.storeMetadata?.supervisedRecoveryMaintenance) {
    fail('ORIGINAL_SOURCE_ATTEMPT_FENCED');
  }
}

// Serialize cooperative source writes (including rollback) against this exact
// maintenance reservation. Other missions retain their existing admission path.
export async function withOriginalSourceAttemptMutationGuard(missionId, operation, options = {}) {
  if (missionId !== 'critical-2962-elastic-goal') {
    await assertOriginalSourceAttemptNotFenced(missionId, options);
    return operation();
  }
  const guarded = await runWithMissionStatePrecondition(missionId, {}, async state => {
    if (state.cancelled === true || state.currentPhase === 'CANCELLED'
        || state.storeMetadata?.originalSourceAttemptFence || state.storeMetadata?.supervisedRecoveryMaintenance)
      fail('ORIGINAL_SOURCE_ATTEMPT_FENCED');
    return operation();
  }, { env: options.env || process.env, ...options.missionStoreOptions });
  if (guarded.preconditionFailed) fail('ORIGINAL_SOURCE_ATTEMPT_FENCED');
  return guarded.result;
}

export function originalSourceFenceBindsLease(fence, lease) {
  if (fence?.schemaVersion === SUPERVISED_R7_FENCE_SCHEMA) return supervisedR7FenceBindsLease(fence, lease);
  // Exception is bound to the one verified historical gap; its schema never
  // claims an original terminal receipt. The proof is independently rechecked
  // from protected OS/operator keys before any canonical release.
  if (fence?.schemaVersion === LEGACY_ORPHAN_FENCE_SCHEMA) {
    return Boolean(
      fence.missionId === 'critical-2962-elastic-goal'
      && fence.originalRevision === 7
      && fence.originalLeaseId === 'critical-2962-elastic-goal-r7-lease'
      && fence.originalLeaseId === lease?.leaseId
      && fence.missionId === lease?.laneId
      && fence.originalLeaseDigest === digest(lease)
      && fence.repository === lease.repository && fence.issueNumber === lease.issueNumber
      && fence.prNumber === lease.prNumber && fence.branch === lease.branch
      && fence.headSha === lease.headSha
      && typeof fence.worktreePath === 'string' && fence.worktreePath.length > 0
      && /^critical-2962-elastic-goal-r(?:0|[1-9]\d*)-[a-f0-9]{12}$/.test(fence.sourceExecutionId)
      && fence.historicalExecutionOutcome === 'UNKNOWN'
      && fence.historicalTerminalReceiptPresent === false
      && fence.historicalTerminalReceiptReconstructed === false
      && fence.sourceWriterTerminalProven === false
      && fence.originalQueuesIdle === true
      && fence.prospectiveWriterExclusionAuthenticated === true
      && SHA256.test(text(fence.legacyEvidenceDigest))
      && SHA256.test(text(fence.legacyWitnessDigest))
      && /^[a-f0-9]{40}$/.test(text(fence.operatorSourceRevision))
      && /^[a-z0-9._-]{8,127}$/.test(text(fence.commandId))
      && /^[a-z0-9._:-]{8,120}$/.test(text(fence.operatorRequestId))
      && fence.goalComplete === false && fence.leaseSeizureAllowed === false
      && fence.sourceMutationAuthority === false && fence.leaseReleaseAuthority === false
    );
  }
  return Boolean(fence?.schemaVersion === ORIGINAL_SOURCE_FENCE_SCHEMA
    && fence.sourceWriterTerminalProven === true && fence.originalQueuesIdle === true
    && typeof fence.worktreePath === 'string' && fence.worktreePath.length > 0
    && fence.writerExclusionEvidence?.worktreePath === fence.worktreePath
    && fence.detachedSourceWritersExcluded === true
    && fence.writerExclusionEvidence?.schemaVersion === WRITER_EXCLUSION_SCHEMA
    && fence.writerExclusionEvidence?.missionId === lease.laneId
    && fence.writerExclusionEvidence?.leaseId === lease.leaseId
    && fence.writerExclusionEvidence?.leaseDigest === digest(lease)
    && fence.writerExclusionEvidence?.verdict === 'NO_SOURCE_WRITING_DESCENDANTS'
    && SHA256.test(fence.writerExclusionEvidenceDigest)
    && fence.writerExclusionEvidenceDigest === digest(fence.writerExclusionEvidence)
    && fence.goalComplete === false && fence.leaseSeizureAllowed === false
    && fence.originalLeaseDigest === digest(lease)
    && fence.originalLeaseId === lease.leaseId && fence.missionId === lease.laneId
    && fence.repository === lease.repository && fence.branch === lease.branch
    && fence.issueNumber === lease.issueNumber && fence.prNumber === lease.prNumber
    && fence.headSha === lease.headSha && SHA256.test(fence.originalLeaseDigest)
    && SHA256.test(fence.sourcePairDigest)
    && /^[a-f0-9]{40}$/.test(fence.operatorSourceRevision)
    && /^[a-z0-9._-]{8,127}$/.test(fence.commandId)
    && /^[a-z0-9._:-]{8,120}$/.test(fence.operatorRequestId)
    && /^critical-[1-9]\d*-elastic-goal-r(?:0|[1-9]\d*)-[a-f0-9]{12}-[1-9]\d*$/.test(fence.sourceReceiptId));
}

// Called inside appendMissionEvent's EXISTING mission lock. A queue claim that
// races cancellation must obtain that same lock before it can invoke a writer.
export async function proveOriginalSourceQuarantine(current, input, options = {}) {
  const env = options.env || process.env;
  const paths = options.paths;
  const nowUtc = (options.now instanceof Date ? options.now : new Date()).toISOString();
  if (!paths?.workspaceRoot || !paths.repoRoot) fail('ORIGINAL_FENCE_CANONICAL_PATHS_UNPROVEN');
  const readLease = options.readSourceMutationLease || readSourceMutationLease;
  const leaseRead = await readLease({ root: paths.workspaceRoot, repoRoot: paths.repoRoot, nowUtc });
  const lease = leaseRead.record;
  const identity = exactElasticPrHeadIdentity(current);
  if (leaseRead.ok !== true || leaseRead.validation?.valid !== true
      || leaseRead.validation?.active !== false || leaseRead.validation?.stale !== true
      || !identity || current.currentPhase !== 'REPAIR_REQUIRED'
      || current.dispatch?.status !== 'complete' || current.revision !== input.expectedMissionRevision
      || input.originalLeaseId !== lease?.leaseId || input.originalLeaseDigest !== digest(lease)
      || lease.ownerId !== 'mission-worker' || lease.laneId !== current.missionId
      || lease.leaseId !== `${current.missionId}-r${current.revision}-lease`
      || lease.repository !== identity.repository || lease.issueNumber !== identity.issueNumber
      || lease.prNumber !== identity.prNumber || lease.branch !== identity.branch
      || lease.headSha !== identity.headSha) fail('ORIGINAL_FENCE_EXACT_STALE_LEASE_UNPROVEN');
  // Missing historical #2962 r7 terminal evidence is never silently treated
  // as completed. An exceptional prospective quarantine can be prepared only
  // with separately privileged current OS denial and exact signed approval.
  if (input.legacyOrphanQuarantineRequested === true) {
    if (current.missionId !== 'critical-2962-elastic-goal'
        || current.revision !== 7
        || lease.leaseId !== 'critical-2962-elastic-goal-r7-lease') {
      fail('LEGACY_ORPHAN_EXACT_REVISION_REQUIRED');
    }
    const sourceAction = await (options.readOriginalSourceExecutionId || readOriginalSourceExecutionIdV1)(current, paths, env);
    if (!/^critical-2962-elastic-goal-r(?:0|[1-9]\d*)-[a-f0-9]{12}$/.test(sourceAction)) {
      fail('LEGACY_ORPHAN_CONSUMED_EXECUTION_UNPROVEN');
    }
    const readHistory = options.readExecutionReceiptHistory || readExecutionReceiptHistory;
    const held = await readHistory(paths.workspaceRoot, {
      leaseKey: lease.leaseId, expectedHead: lease.headSha,
    }, { repoRoot: paths.repoRoot });
    if (held?.ok !== true || !Array.isArray(held.receipts)
        || held.receipts.length !== 0) {
      fail('LEGACY_ORPHAN_HISTORICALLY_MISSING_RECEIPT_NOT_PROVEN');
    }
    const inspectQueues = options.originalMissionHasQueuedWork || originalMissionHasQueuedWork;
    if (!resolveMissionWorkerQueueRoot(env)
        || await inspectQueues({ missionId: current.missionId, leaseId: lease.leaseId, env }) !== false) {
      fail('LEGACY_ORPHAN_QUEUE_STILL_ACTIVE_OR_UNKNOWN');
    }
    const authenticate = options.authenticateLegacyOrphanQuarantine;
    if (typeof authenticate !== 'function') fail('LEGACY_ORPHAN_INDEPENDENT_OS_AUTHORITY_NOT_INSTALLED');
    const expected = {
      repository: lease.repository, missionId: current.missionId,
      leaseId: lease.leaseId, revision: 7, originalLeaseDigest: digest(lease),
      branch: lease.branch, headSha: lease.headSha,
      sourceExecutionId: sourceAction, sourceRevision: input.operatorSourceRevision,
      worktreePath: current.git?.worktreePath,
      commandId: text(input.commandId), requestId: text(input.operatorRequestId),
    };
    const attested = await authenticate(expected, { env, now: () => Date.parse(nowUtc) });
    if (attested?.authenticated !== true
        || attested?.historicalExecutionOutcome !== 'UNKNOWN'
        || attested?.eligibilityOnly !== true
        || attested?.leaseReleaseAuthority !== false
        || !SHA256.test(text(attested.evidenceDigest))
        || !SHA256.test(text(attested.witnessDigest))) {
      fail('LEGACY_ORPHAN_PROSPECTIVE_CONTAINMENT_NOT_AUTHENTICATED');
    }
    const again = await readLease({ root: paths.workspaceRoot, repoRoot: paths.repoRoot, nowUtc });
    if (again.ok !== true || digest(again.record) !== input.originalLeaseDigest
        || again.validation?.stale !== true) fail('LEGACY_ORPHAN_LEASE_CHANGED');
    return Object.freeze({
      schemaVersion: LEGACY_ORPHAN_FENCE_SCHEMA,
      missionId: current.missionId, originalRevision: 7,
      originalLeaseId: lease.leaseId, originalLeaseDigest: digest(lease),
      repository: lease.repository, issueNumber: lease.issueNumber,
      prNumber: lease.prNumber, branch: lease.branch, headSha: lease.headSha,
      worktreePath: current.git?.worktreePath, sourceExecutionId: sourceAction,
      historicalExecutionOutcome: 'UNKNOWN',
      historicalTerminalReceiptPresent: false,
      historicalTerminalReceiptReconstructed: false,
      sourceWriterTerminalProven: false, originalQueuesIdle: true,
      prospectiveWriterExclusionAuthenticated: true,
      legacyEvidenceDigest: attested.evidenceDigest,
      legacyWitnessDigest: attested.witnessDigest,
      commandId: text(input.commandId), operatorRequestId: text(input.operatorRequestId),
      operatorSourceRevision: text(input.operatorSourceRevision),
      goalComplete: false, leaseSeizureAllowed: false,
      sourceMutationAuthority: false, leaseReleaseAuthority: false,
    });
  }
  const receiptReader = options.readExecutionReceiptHistory || readExecutionReceiptHistory;
  const heldExecutionCount = await proveHeldLeaseExecutionsTerminal(lease, paths, receiptReader);
  const sourceAction = await (options.readOriginalSourceExecutionId || readOriginalSourceExecutionIdV1)(current, paths, env);
  const prefix = `${current.missionId}-r`;
  const revision = sourceAction.startsWith(prefix)
    ? sourceAction.slice(prefix.length).match(/^(0|[1-9]\d*)-[a-f0-9]{12}$/)?.[1] : null;
  if (revision === null || revision === undefined) fail('ORIGINAL_FENCE_CONSUMED_SOURCE_BINDING_UNPROVEN');
  const history = await receiptReader(
    paths.workspaceRoot, { executionId: sourceAction }, { repoRoot: paths.repoRoot });
  const terminal = history.latestReceipt;
  if (!history.ok || !history.receipts?.length || terminal?.state !== 'completed'
      || terminal.executionId !== sourceAction || terminal.leaseKey !== `${prefix}${revision}-lease`
      || terminal.repository !== lease.repository || terminal.branch !== lease.branch
      || terminal.issueNumber !== lease.issueNumber) fail('ORIGINAL_FENCE_SOURCE_WRITER_TERMINAL_UNPROVEN');
  // Terminal queue movement occurs only after source edits, tests, escrow and
  // the authentic completed receipt. No future source write follows movement.
  const queueRoot = resolveMissionWorkerQueueRoot(env);
  if (!queueRoot) fail('ORIGINAL_FENCE_QUEUE_UNAVAILABLE');
  const adapter = text(current.dispatch.adapter);
  if (!['foundry-forge', 'chatgpt-github', 'sovereign-commander'].includes(adapter)) fail('ORIGINAL_FENCE_SOURCE_ADAPTER_UNPROVEN');
  const queue = options.readTerminalSourcePair ? await options.readTerminalSourcePair()
    : await readTerminalSourcePair(queueRoot, adapter, sourceAction);
  const binding = queue.item?.executionBinding;
  // Canonical pre-PR queue binding has null PR/headSha and sourceRevision;
  // createExecutionReceipt encodes that same identity as PR 0/sourceHead.
  // Preserve that explicit schema state, without rebinding it to r7's PR head.
  const sourceHeadBound = terminal.prNumber === 0
    ? binding?.prNumber === null && binding?.headSha === ''
      && binding?.sourceRevision === terminal.sourceHead
      && queue.item?.actionGrant?.sourceRevision === terminal.sourceHead
    : binding?.prNumber === terminal.prNumber && binding?.headSha === terminal.sourceHead;
  // The terminal pair comes from processNextProviderNeutralSourceBuild,
  // not mission-worker-consumption-result. Preserve its exact source escrow
  // and offline outbox identity before accepting source-writer completion.
  if (queue.item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'
      || binding?.schemaVersion !== 'stephanos.mission-worker-queue-execution-binding.v1'
      || queue.item?.actionGrant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
      || queue.item?.actionGrant?.missionId !== current.missionId
      || queue.item?.actionGrant?.actionId !== sourceAction
      || queue.item?.actionGrant?.missionRevision !== Number(revision)
      || queue.item?.actionGrant?.repository !== terminal.repository
      || queue.item?.actionGrant?.branch !== terminal.branch
      || queue.item?.actionGrant?.issueNumber !== terminal.issueNumber
      || binding?.missionRevision !== Number(revision) || Number(revision) > current.revision
      || queue.item?.adapter !== adapter || queue.item?.actionGrant?.adapter !== adapter
      || queue.result?.schemaVersion !== 'stephanos.provider-neutral-source-builder.v1'
      || queue.result?.adapter !== adapter || queue.result?.providerAdapter !== adapter
      || queue.result?.providerInvoked !== true || queue.result?.providerCompleted !== true
      || queue.result?.failureStage !== '' || !sourceHeadBound
      || queue.item?.missionId !== current.missionId || queue.item?.actionId !== sourceAction
      || queue.item?.executionBinding?.leaseKey !== terminal.leaseKey
      || queue.item?.executionBinding?.executionId !== sourceAction
      || queue.item?.executionBinding?.missionId !== current.missionId
      || queue.item?.executionBinding?.repository !== terminal.repository
      || queue.item?.executionBinding?.branch !== terminal.branch
      || queue.item?.executionBinding?.issueNumber !== terminal.issueNumber
      || queue.result?.processed !== true || queue.result?.success !== true
      || queue.result?.testsPassed !== true
      || !Array.isArray(queue.result?.changedFiles) || queue.result.changedFiles.length === 0
      || !text(queue.result?.sourceArtifactRef)
      || !text(queue.result?.offlinePublicationOutboxId)
      || queue.result?.preservationVerdict !== 'PROVIDER_NEUTRAL_SOURCE_ESCROWED_FOR_OFFLINE_PUBLICATION'
      || queue.result?.finalVerdict !== 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED'
      || queue.result?.actionId !== sourceAction || queue.result?.missionId !== current.missionId
      || !SHA256.test(queue.pairDigest)) fail('ORIGINAL_FENCE_TERMINAL_PAIR_UNPROVEN');
  const inFlight = options.originalMissionHasQueuedWork || originalMissionHasQueuedWork;
  if (await inFlight({ missionId: current.missionId, leaseId: lease.leaseId, env }) !== false) fail('ORIGINAL_FENCE_WORK_IN_FLIGHT_OR_UNKNOWN');
  // A terminal direct child and empty queues say nothing about detached
  // descendants. Only an existing authority adapter may authenticate positive,
  // exact-identity writer-exclusion evidence. No local process inference or
  // timestamp fallback is permitted here.
  const authenticateExclusion = options.authenticateOriginalWriterExclusionEvidence;
  if (typeof authenticateExclusion !== 'function') fail('ORIGINAL_FENCE_WRITER_EXCLUSION_UNAVAILABLE');
  const exclusion = await authenticateExclusion(input.writerExclusionEvidence, {
    missionId: current.missionId, sourceExecutionId: sourceAction,
    leaseId: lease.leaseId, leaseDigest: digest(lease), repository: lease.repository,
    branch: lease.branch, headSha: lease.headSha,
    worktreePath: current.git?.worktreePath,
  });
  const exclusionEvidence = exclusion?.evidence;
  if (exclusion?.authenticated !== true
      || exclusionEvidence?.schemaVersion !== WRITER_EXCLUSION_SCHEMA
      || exclusionEvidence?.missionId !== current.missionId
      || exclusionEvidence?.sourceExecutionId !== sourceAction
      || exclusionEvidence?.leaseId !== lease.leaseId
      || exclusionEvidence?.leaseDigest !== digest(lease)
      || exclusionEvidence?.repository !== lease.repository
      || exclusionEvidence?.branch !== lease.branch
      || exclusionEvidence?.headSha !== lease.headSha
      || exclusionEvidence?.worktreePath !== current.git?.worktreePath
      || exclusionEvidence?.verdict !== 'NO_SOURCE_WRITING_DESCENDANTS'
      || !text(exclusionEvidence?.authorityReceiptId)
      || !SHA256.test(text(exclusionEvidence?.authorityReceiptSha256))) {
    fail('ORIGINAL_FENCE_WRITER_EXCLUSION_UNPROVEN');
  }
  // Whole-record compare immediately before committing the fence. Renewal and
  // old claim paths must consume canonical cancellation; release still uses
  // Programme Authority's own exact-lease operation guard after this transition.
  const again = await readLease({ root: paths.workspaceRoot, repoRoot: paths.repoRoot, nowUtc });
  if (again.ok !== true || digest(again.record) !== input.originalLeaseDigest) fail('ORIGINAL_FENCE_LEASE_CHANGED');
  return Object.freeze({
    schemaVersion: ORIGINAL_SOURCE_FENCE_SCHEMA, missionId: current.missionId,
    originalRevision: current.revision, originalLeaseId: lease.leaseId,
    originalLeaseDigest: digest(lease), repository: lease.repository,
    branch: lease.branch, issueNumber: lease.issueNumber, prNumber: lease.prNumber,
    headSha: lease.headSha, worktreePath: current.git?.worktreePath,
    sourceReceiptId: terminal.receiptId,
    sourceExecutionId: sourceAction, sourcePairDigest: queue.pairDigest,
    sourceAdapter: adapter, heldExecutionCount,
    detachedSourceWritersExcluded: true,
    writerExclusionEvidence: Object.freeze({ ...exclusionEvidence }),
    writerExclusionEvidenceDigest: digest(exclusionEvidence),
    commandId: text(input.commandId), operatorSourceRevision: text(input.operatorSourceRevision),
    operatorRequestId: text(input.operatorRequestId),
    sourceWriterTerminalProven: true, originalQueuesIdle: true,
    goalComplete: false, leaseSeizureAllowed: false,
  });
}

export async function quarantineOriginalSourceAttempt(input, options = {}) {
  if (!SHA256.test(text(input.originalLeaseDigest)) || !text(input.originalLeaseId)
      || !/^[a-f0-9]{40}$/.test(text(input.operatorSourceRevision))
      || !/^[a-z0-9._-]{8,127}$/.test(text(input.commandId))
      || !REQUEST_ID.test(text(input.operatorRequestId))
      || !Number.isSafeInteger(input.expectedMissionRevision) || input.expectedMissionRevision < 0
      || !/^critical-[1-9]\d*-elastic-goal$/.test(text(input.missionId))) fail('ORIGINAL_FENCE_COMMAND_INVALID');
  if (input.legacyOrphanQuarantineRequested !== undefined
      && (input.legacyOrphanQuarantineRequested !== true
          || input.missionId !== 'critical-2962-elastic-goal'
          || input.expectedMissionRevision !== 7
          || input.originalLeaseId !== 'critical-2962-elastic-goal-r7-lease')) {
    fail('LEGACY_ORPHAN_COMMAND_SCOPE_FORBIDDEN');
  }
  const normalizedInput = { ...input, operatorRequestId: text(input.operatorRequestId).toLowerCase() };
  return appendMissionEvent(input.missionId, {
    eventId: `cancel-${input.commandId}`, eventType: 'MISSION_CANCELLED',
    expectedRevision: input.expectedMissionRevision, expectedCurrentPhase: 'REPAIR_REQUIRED',
    originalSourceQuarantineRequested: true,
    summary: input.reason,
  }, { ...options,
    proveOriginalSourceQuarantine: (current) => proveOriginalSourceQuarantine(current, normalizedInput, options),
    withOriginalSourceLeaseFenceGuard: (operation) => (options.withOriginalSourceLeaseFenceGuard
      || withOriginalSourceLeaseFenceGuard)(operation, {
      root: options.paths.workspaceRoot, repoRoot: options.paths.repoRoot, env: options.env,
    }),
  });
}

export async function verifyOriginalSourceAttemptFence(mission, lease, paths, env) {
  const fence = mission.storeMetadata?.originalSourceAttemptFence;
  if (!originalSourceFenceBindsLease(fence, lease)
      || fence.worktreePath !== mission.git?.worktreePath
      || mission.cancelled !== true
      || mission.currentPhase !== 'CANCELLED' || mission.revision !== fence.originalRevision + 1) return false;
  const record = await readMissionRecord(mission.missionId, { root: paths.orchestratorRoot, env });
  const log = await readFile(record.eventPath, 'utf8');
  if (Buffer.byteLength(log) > 2 * 1024 * 1024) return false;
  const lines = log.split('\n').filter(Boolean);
  if (lines.length > 2048) return false;
  const eventId = mission.storeMetadata.lastEventId;
  const events = lines.map((line) => JSON.parse(line)).filter((event) => event.eventId === eventId);
  if (events.length !== 1 || !mission.storeMetadata.processedEventIds.includes(eventId)
      || events[0].missionId !== mission.missionId || events[0].eventType !== 'MISSION_CANCELLED'
      || events[0].originalSourceQuarantineRequested !== true
      || digest(events[0].originalSourceAttemptFence) !== digest(fence)) return false;
  if (fence.schemaVersion === SUPERVISED_R7_FENCE_SCHEMA) {
    return verifyRuntimeSupervisedR7Fence(fence, lease, paths, env);
  }
  if (fence.schemaVersion === LEGACY_ORPHAN_FENCE_SCHEMA) {
    const sourceAction = await readOriginalSourceExecutionIdV1(mission, paths, env);
    if (sourceAction !== fence.sourceExecutionId || !resolveMissionWorkerQueueRoot(env)) return false;
    const historical = await readExecutionReceiptHistory(paths.workspaceRoot, {
      leaseKey: lease.leaseId, expectedHead: lease.headSha,
    }, { repoRoot: paths.repoRoot });
    if (historical?.ok !== true || !Array.isArray(historical.receipts)
        || historical.receipts.length !== 0) return false;
    if (await originalMissionHasQueuedWork({ missionId: mission.missionId,
      leaseId: lease.leaseId, env }) !== false) return false;
    const verified = await authenticateLegacyOrphanQuarantine({
      repository: lease.repository, missionId: mission.missionId,
      leaseId: lease.leaseId, revision: 7, originalLeaseDigest: digest(lease),
      branch: lease.branch, headSha: lease.headSha,
      sourceExecutionId: sourceAction, sourceRevision: fence.operatorSourceRevision,
      worktreePath: mission.git?.worktreePath,
      commandId: fence.commandId, requestId: fence.operatorRequestId,
    }, { env });
    return verified?.authenticated === true
      && verified.eligibilityOnly === true
      && verified.leaseReleaseAuthority === false
      && verified.historicalExecutionOutcome === 'UNKNOWN'
      && verified.evidenceDigest === fence.legacyEvidenceDigest
      && verified.witnessDigest === fence.legacyWitnessDigest;
  }
  const sourceAction = await readOriginalSourceExecutionIdV1(mission, paths, env);
  if (sourceAction !== fence.sourceExecutionId) return false;
  const history = await readExecutionReceiptHistory(paths.workspaceRoot,
    { executionId: sourceAction }, { repoRoot: paths.repoRoot });
  if (!history.ok || history.latestReceipt?.state !== 'completed'
      || history.latestReceipt?.receiptId !== fence.sourceReceiptId) return false;
  await proveHeldLeaseExecutionsTerminal(lease, paths, readExecutionReceiptHistory);
  if (!['foundry-forge', 'chatgpt-github', 'sovereign-commander'].includes(fence.sourceAdapter)) return false;
  const pair = await readTerminalSourcePair(resolveMissionWorkerQueueRoot(env), fence.sourceAdapter, sourceAction);
  if (pair.pairDigest !== fence.sourcePairDigest) return false;
  return await originalMissionHasQueuedWork({ missionId: mission.missionId,
    leaseId: lease.leaseId, env }) === false;
}

// Read-only first slice of the operator-approved supervised recovery pivot.
// Request data never carries a reader, approval callback or mutation permission.
export async function prepareSupervisedOriginalSourceRecovery(input, options = {}) {
  const paths = options.paths;
  if (!paths?.workspaceRoot || !paths.repoRoot || !paths.orchestratorRoot) {
    fail('SUPERVISED_R7_CANONICAL_PATHS_UNPROVEN');
  }
  const readHead = options.readRepositorySourceHead || readSupervisedRecoverySourceHead;
  const readMaintenance = options.readSupervisedRecoveryMaintenance || readSupervisedRecoveryMaintenance;
  if (typeof readHead !== 'function' || typeof readMaintenance !== 'function') {
    fail('SUPERVISED_R7_OBSERVATION_ADAPTER_NOT_INSTALLED');
  }
  const env = options.env || process.env;
  const now = options.now || Date.now;
  return prepareSupervisedR7RecoveryV1(input, {
    now,
    readSnapshot: async () => {
      const sourceRevision = await readHead(paths.repoRoot);
      const { state: mission } = await (options.readMissionRecord || readMissionRecord)(
        'critical-2962-elastic-goal', { root: paths.orchestratorRoot, env });
      const leaseRead = await (options.readSourceMutationLease || readSourceMutationLease)({
        root: paths.workspaceRoot, repoRoot: paths.repoRoot, nowUtc: new Date(now()).toISOString(),
      });
      const queuesIdle = Boolean(resolveMissionWorkerQueueRoot(env))
        && await (options.originalMissionHasQueuedWork || originalMissionHasQueuedWork)({
          missionId: 'critical-2962-elastic-goal',
          leaseId: 'critical-2962-elastic-goal-r7-lease', env,
        }) === false;
      const maintenance = await readMaintenance({ paths, env });
      return { sourceRevision, mission, leaseRead, queuesIdle, maintenance };
    },
  });
}

// Explicit alternative only; ordinary strict quarantine is unchanged. The
// preparation packet is read from its durable artifact, never from request JSON.
export async function retireSupervisedOriginalSourceRecovery(input, approvalCommentId, options = {}) {
  const prepared = await readRuntimeSupervisedR7Packet(input, options);
  return appendMissionEvent('critical-2962-elastic-goal', {
    eventId: `cancel-${input.commandId}`, eventType: 'MISSION_CANCELLED',
    expectedRevision: 7, expectedCurrentPhase: 'REPAIR_REQUIRED',
    originalSourceQuarantineRequested: true,
    summary: 'Operator-approved cooperative recovery; historical execution outcome remains UNKNOWN.',
  }, { ...options, root: options.paths.orchestratorRoot,
    withOriginalSourceLeaseFenceGuard: operation => withOriginalSourceLeaseFenceGuard(operation, {
      root: options.paths.workspaceRoot, repoRoot: options.paths.repoRoot, env: options.env }),
    proveOriginalSourceQuarantine: async current => {
      const fresh = await prepareRuntimeSupervisedR7(input, options);
      if (supervisedRecoveryDigest(fresh.packet.target) !== supervisedRecoveryDigest(prepared.packet.target)
          || supervisedRecoveryDigest(fresh.packet.maintenanceEvidence) !== supervisedRecoveryDigest(prepared.packet.maintenanceEvidence))
        fail('SUPERVISED_R7_APPROVED_EVIDENCE_CHANGED');
      const approval = await authenticateRuntimeSupervisedR7(prepared, approvalCommentId, options);
      // Authentication is awaited under both canonical locks. Re-read the real
      // preservation/maintenance/lease estate after that potentially slow IO.
      const closing = await prepareRuntimeSupervisedR7(input, options);
      if (supervisedRecoveryDigest(closing.packet.target) !== supervisedRecoveryDigest(prepared.packet.target)
          || supervisedRecoveryDigest(closing.packet.maintenanceEvidence) !== supervisedRecoveryDigest(prepared.packet.maintenanceEvidence))
        fail('SUPERVISED_R7_APPROVED_EVIDENCE_CHANGED');
      const consumedAt = (options.now || Date.now)();
      if (Date.parse(prepared.packet.expiresAtUtc) <= consumedAt
          || Date.parse(approval.approvalExpiresAtUtc) <= consumedAt) fail('SUPERVISED_R7_APPROVAL_EXPIRED');
      const t = prepared.packet.target;
      return { schemaVersion: SUPERVISED_R7_FENCE_SCHEMA, missionId: current.missionId,
        originalRevision: 7, originalLeaseId: t.leaseId, originalLeaseDigest: t.originalLeaseDigest,
        repository: t.repository, issueNumber: t.issueNumber, prNumber: t.prNumber,
        branch: t.branch, headSha: t.headSha, worktreePath: t.worktreePath,
        prepared, approvalCommentId, approvalEvidenceDigest: approval.approvalEvidenceDigest,
        approvalConsumedAtUtc: new Date(consumedAt).toISOString(),
        approvalConsumed: true, commandId: input.commandId, operatorRequestId: input.requestId,
        operatorSourceRevision: input.sourceRevision,
        recoveryDisposition: 'OPERATOR_APPROVED_SUPERVISED_RETIREMENT',
        historicalExecutionOutcome: 'UNKNOWN', historicalTerminalReceiptReconstructed: false,
        hostileWriterExclusionProven: false, witnessCommissioned: false,
        goalComplete: false, leaseSeizureAllowed: false, sourceMutationAuthority: false, leaseReleaseAuthority: false };
    },
  });
}
