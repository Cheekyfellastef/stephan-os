import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readMissionRecord, appendMissionEvent } from './missionOrchestratorStore.js';
import { readSourceMutationLease, withOriginalSourceLeaseFenceGuard } from './programmeAuthorityService.js';
import { readExecutionReceiptHistory } from '../../shared/agents/executionReceiptV1.mjs';
import { resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';
import {
  exactElasticPrHeadIdentity, originalMissionHasQueuedWork, readOriginalSourceExecutionIdV1,
} from './elasticPrHeadLeaseService.js';

export const ORIGINAL_SOURCE_FENCE_SCHEMA = 'stephanos.original-source-attempt-fence.v1';
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
      || state.storeMetadata?.originalSourceAttemptFence) {
    fail('ORIGINAL_SOURCE_ATTEMPT_FENCED');
  }
}

export function originalSourceFenceBindsLease(fence, lease) {
  return Boolean(fence?.schemaVersion === ORIGINAL_SOURCE_FENCE_SCHEMA
    && fence.sourceWriterTerminalProven === true && fence.originalQueuesIdle === true
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
    headSha: lease.headSha, sourceReceiptId: terminal.receiptId,
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
  if (!originalSourceFenceBindsLease(fence, lease) || mission.cancelled !== true
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
