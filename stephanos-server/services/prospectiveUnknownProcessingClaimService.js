import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { appendMissionEvent, readMissionRecord } from './missionOrchestratorStore.js';
import { withOriginalSourceLeaseFenceGuard } from './programmeAuthorityService.js';
import { readExecutionReceiptHistory } from '../../shared/agents/executionReceiptV1.mjs';
import { resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';

export const PROSPECTIVE_ORPHAN_FENCE_SCHEMA = 'stephanos.original-source-attempt-prospective-orphan-fence.v1';
const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const text = value => String(value ?? '').trim();
const fail = reason => { throw new Error(reason); };

const PROSPECTIVE_SOURCE_ADAPTERS = new Set([
  'foundry-forge', 'chatgpt-github', 'desktop-commander', 'sovereign-commander',
]);

function prospectiveActionRevision(missionId, actionId) {
  const match = text(actionId).match(/^critical-([1-9]\d*)-elastic-goal-r(0|[1-9]\d*)-[a-f0-9]{12}$/);
  return match && text(missionId) === 'critical-' + match[1] + '-elastic-goal' ? Number(match[2]) : null;
}

function sameRegularFile(before, after) {
  return Boolean(before?.isFile?.() && after?.isFile?.()
    && !before.isSymbolicLink() && !after.isSymbolicLink()
    && before.nlink === 1 && after.nlink === 1
    && before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs);
}

async function optionalStat(path) {
  try { return await lstat(path); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function stableProcessingClaimBytes(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || before.size < 1 || before.size > 262144) {
    fail('PROSPECTIVE_ORPHAN_PROCESSING_CLAIM_UNSAFE');
  }
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (!sameRegularFile(before, after) || bytes.length !== before.size) {
    fail('PROSPECTIVE_ORPHAN_PROCESSING_CLAIM_CHANGED');
  }
  return bytes;
}

async function assertNoCompetingProspectiveQueueTruth(queueRoot, adapter, actionId) {
  const processing = resolve(queueRoot, adapter, 'processing');
  const names = await readdir(processing).catch(error => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  if (names.length > 512) fail('PROSPECTIVE_ORPHAN_PROCESSING_INVENTORY_UNBOUNDED');
  if (names.some(name => name !== actionId + '.json' && name.startsWith(actionId + '.json'))) {
    fail('PROSPECTIVE_ORPHAN_PROCESSING_SIDECAR_PRESENT');
  }
  for (const [stage, suffixes] of [
    ['pending', ['.json']],
    ['completed', ['.json', '.result.json']],
    ['failed', ['.json', '.result.json']],
  ]) {
    for (const suffix of suffixes) {
      if (await optionalStat(resolve(queueRoot, adapter, stage, actionId + suffix))) {
        fail('PROSPECTIVE_ORPHAN_COMPETING_QUEUE_TRUTH_PRESENT');
      }
    }
  }
}

async function readExactUnknownProcessingClaim(current, input, options = {}) {
  const queueRoot = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!queueRoot) fail('PROSPECTIVE_ORPHAN_QUEUE_ROOT_UNAVAILABLE');
  const adapter = text(current?.dispatch?.adapter);
  if (!PROSPECTIVE_SOURCE_ADAPTERS.has(adapter)) fail('PROSPECTIVE_ORPHAN_SOURCE_ADAPTER_UNPROVEN');

  const revision = prospectiveActionRevision(current.missionId, input.sourceExecutionId);
  if (revision === null
      || input.sourceExecutionLeaseKey !== current.missionId + '-r' + revision + '-lease'
      || current.revision !== revision + 1
      || current.revision !== input.expectedMissionRevision
      || current.currentPhase !== 'AGENT_IMPLEMENTATION'
      || current.dispatch?.status !== 'running'
      || current.storeMetadata?.lastEventId !== 'pickup-' + input.sourceExecutionId
      || !current.storeMetadata?.processedEventIds?.includes('pickup-' + input.sourceExecutionId)) {
    fail('PROSPECTIVE_ORPHAN_MISSION_PICKUP_IDENTITY_UNPROVEN');
  }

  await assertNoCompetingProspectiveQueueTruth(queueRoot, adapter, input.sourceExecutionId);
  const processingPath = resolve(queueRoot, adapter, 'processing', input.sourceExecutionId + '.json');
  const bytes = await stableProcessingClaimBytes(processingPath);
  const claimSha256 = createHash('sha256').update(bytes).digest('hex');
  if (claimSha256 !== text(input.processingClaimSha256).toLowerCase()) {
    fail('PROSPECTIVE_ORPHAN_PROCESSING_CLAIM_DIGEST_MISMATCH');
  }

  let item;
  try { item = JSON.parse(bytes.toString('utf8')); }
  catch { fail('PROSPECTIVE_ORPHAN_PROCESSING_CLAIM_JSON_INVALID'); }
  const grant = item?.actionGrant;
  const binding = item?.executionBinding;
  const payload = item?.payload;
  const issueNumber = Number(current.missionId.match(/^critical-([1-9]\d*)-/)?.[1]);
  if (item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'
      || item?.missionId !== current.missionId || item?.actionId !== input.sourceExecutionId
      || item?.adapter !== adapter
      || grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
      || grant?.missionId !== current.missionId || grant?.actionId !== input.sourceExecutionId
      || grant?.missionRevision !== revision || grant?.adapter !== adapter
      || binding?.schemaVersion !== 'stephanos.mission-worker-queue-execution-binding.v1'
      || binding?.executionId !== input.sourceExecutionId
      || binding?.leaseKey !== input.sourceExecutionLeaseKey
      || binding?.missionId !== current.missionId || binding?.missionRevision !== revision
      || binding?.repository !== current.repository
      || Number(binding?.issueNumber) !== issueNumber
      || binding?.branch !== current.git?.branch
      || !/^[a-f0-9]{40}$/.test(text(binding?.sourceRevision))
      || grant?.sourceRevision !== binding.sourceRevision
      || payload?.missionId !== current.missionId || payload?.actionId !== input.sourceExecutionId
      || payload?.adapter !== adapter) {
    fail('PROSPECTIVE_ORPHAN_PROCESSING_CLAIM_BINDING_INVALID');
  }

  const reader = options.readExecutionReceiptHistory || readExecutionReceiptHistory;
  const [executionHistory, leaseHistory] = await Promise.all([
    reader(options.paths.workspaceRoot, { executionId: input.sourceExecutionId }, { repoRoot: options.paths.repoRoot }),
    reader(options.paths.workspaceRoot, { leaseKey: input.sourceExecutionLeaseKey }, { repoRoot: options.paths.repoRoot }),
  ]);
  if (executionHistory?.ok !== true || leaseHistory?.ok !== true
      || !Array.isArray(executionHistory.receipts) || !Array.isArray(leaseHistory.receipts)
      || executionHistory.receipts.length !== 0 || leaseHistory.receipts.length !== 0) {
    fail('PROSPECTIVE_ORPHAN_EXECUTION_RECEIPT_HISTORY_NOT_EMPTY');
  }

  return Object.freeze({
    queueRoot, adapter, processingPath, bytes, claimSha256, item,
    sourceRevision: binding.sourceRevision, revision,
  });
}

export async function proveUnknownProcessingClaimQuarantine(current, input, options = {}) {
  if (!options.paths?.workspaceRoot || !options.paths?.repoRoot) {
    fail('PROSPECTIVE_ORPHAN_CANONICAL_PATHS_UNPROVEN');
  }
  const observed = await readExactUnknownProcessingClaim(current, input, options);
  const authenticate = options.authenticateProspectiveOrphanQuarantine;
  if (typeof authenticate !== 'function') {
    fail('PROSPECTIVE_ORPHAN_INDEPENDENT_OS_AUTHORITY_NOT_INSTALLED');
  }
  const expected = {
    repository: current.repository,
    missionId: current.missionId,
    missionRevision: current.revision,
    sourceExecutionId: input.sourceExecutionId,
    sourceExecutionLeaseKey: input.sourceExecutionLeaseKey,
    processingClaimSha256: observed.claimSha256,
    branch: current.git?.branch,
    sourceRevision: observed.sourceRevision,
    operatorSourceRevision: text(input.operatorSourceRevision),
    worktreePath: current.git?.worktreePath,
    commandId: text(input.commandId),
    requestId: text(input.operatorRequestId),
  };
  const attested = await authenticate(expected, { env: options.env || process.env });
  if (attested?.authenticated !== true
      || attested?.historicalExecutionOutcome !== 'UNKNOWN'
      || attested?.eligibilityOnly !== true
      || attested?.processingClaimQuarantineAuthority !== true
      || attested?.leaseReleaseAuthority !== false
      || !SHA256.test(text(attested.evidenceDigest))
      || !SHA256.test(text(attested.witnessDigest))) {
    fail('PROSPECTIVE_ORPHAN_CONTAINMENT_NOT_AUTHENTICATED');
  }

  const closing = await readExactUnknownProcessingClaim(current, input, options);
  if (closing.claimSha256 !== observed.claimSha256) {
    fail('PROSPECTIVE_ORPHAN_PROCESSING_CLAIM_CHANGED');
  }
  return Object.freeze({
    schemaVersion: PROSPECTIVE_ORPHAN_FENCE_SCHEMA,
    missionId: current.missionId,
    originalRevision: current.revision,
    repository: current.repository,
    issueNumber: Number(current.missionId.match(/^critical-([1-9]\d*)-/)?.[1]),
    branch: current.git?.branch,
    worktreePath: current.git?.worktreePath,
    sourceAdapter: observed.adapter,
    sourceExecutionId: input.sourceExecutionId,
    sourceExecutionRevision: observed.revision,
    sourceExecutionLeaseKey: input.sourceExecutionLeaseKey,
    sourceRevision: observed.sourceRevision,
    processingClaimSha256: observed.claimSha256,
    historicalExecutionOutcome: 'UNKNOWN',
    historicalTerminalReceiptPresent: false,
    historicalTerminalReceiptReconstructed: false,
    sourceWriterTerminalProven: false,
    prospectiveWriterExclusionAuthenticated: true,
    processingClaimQuarantineAuthorized: true,
    prospectiveEvidenceDigest: attested.evidenceDigest,
    prospectiveWitnessDigest: attested.witnessDigest,
    commandId: text(input.commandId),
    operatorRequestId: text(input.operatorRequestId),
    operatorSourceRevision: text(input.operatorSourceRevision),
    goalComplete: false,
    leaseSeizureAllowed: false,
    sourceMutationAuthority: false,
    leaseReleaseAuthority: false,
    claimReleaseAuthority: false,
  });
}

async function retireUnknownProcessingClaim(state, options = {}) {
  const fence = state?.storeMetadata?.originalSourceAttemptFence;
  if (state?.cancelled !== true || state?.currentPhase !== 'CANCELLED'
      || fence?.schemaVersion !== PROSPECTIVE_ORPHAN_FENCE_SCHEMA
      || fence.processingClaimQuarantineAuthorized !== true
      || fence.historicalExecutionOutcome !== 'UNKNOWN'
      || !SHA256.test(text(fence.processingClaimSha256))) {
    fail('PROSPECTIVE_ORPHAN_DURABLE_FENCE_REQUIRED');
  }
  const queueRoot = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!queueRoot || !PROSPECTIVE_SOURCE_ADAPTERS.has(fence.sourceAdapter)) {
    fail('PROSPECTIVE_ORPHAN_QUEUE_ROOT_UNAVAILABLE');
  }
  const sourcePath = resolve(queueRoot, fence.sourceAdapter, 'processing', fence.sourceExecutionId + '.json');
  const failedDir = resolve(queueRoot, fence.sourceAdapter, 'failed');
  const archiveName = fence.sourceExecutionId + '.retired-unknown-'
    + fence.processingClaimSha256.slice(0, 16) + '.bin';
  const archivePath = resolve(failedDir, archiveName);
  await mkdir(failedDir, { recursive: true });

  const sourceStat = await optionalStat(sourcePath);
  const archiveStat = await optionalStat(archivePath);
  if (!sourceStat) {
    if (!archiveStat) fail('PROSPECTIVE_ORPHAN_PROCESSING_CLAIM_MISSING');
    const archived = await readFile(archivePath);
    if (createHash('sha256').update(archived).digest('hex') !== fence.processingClaimSha256) {
      fail('PROSPECTIVE_ORPHAN_ARCHIVE_DIGEST_MISMATCH');
    }
    return Object.freeze({
      quarantined: true, idempotent: true, archiveName,
      processingClaimSha256: fence.processingClaimSha256,
    });
  }
  if (archiveStat) fail('PROSPECTIVE_ORPHAN_ARCHIVE_ALREADY_EXISTS');

  await assertNoCompetingProspectiveQueueTruth(queueRoot, fence.sourceAdapter, fence.sourceExecutionId);
  const bytes = await stableProcessingClaimBytes(sourcePath);
  if (createHash('sha256').update(bytes).digest('hex') !== fence.processingClaimSha256) {
    fail('PROSPECTIVE_ORPHAN_PROCESSING_CLAIM_CHANGED');
  }
  await rename(sourcePath, archivePath);
  const archived = await readFile(archivePath);
  if (createHash('sha256').update(archived).digest('hex') !== fence.processingClaimSha256
      || await optionalStat(sourcePath)) {
    fail('PROSPECTIVE_ORPHAN_ARCHIVE_POSTCONDITION_FAILED');
  }
  return Object.freeze({
    quarantined: true, idempotent: false, archiveName,
    processingClaimSha256: fence.processingClaimSha256,
  });
}

export async function quarantineUnknownProcessingClaim(input, options = {}) {
  if (!/^critical-[1-9]\d*-elastic-goal$/.test(text(input.missionId))
      || !/^[a-z0-9._-]{8,127}$/.test(text(input.commandId))
      || !REQUEST_ID.test(text(input.operatorRequestId))
      || !/^[a-f0-9]{40}$/.test(text(input.operatorSourceRevision))
      || !/^critical-[1-9]\d*-elastic-goal-r(?:0|[1-9]\d*)-[a-f0-9]{12}$/.test(text(input.sourceExecutionId))
      || !/^critical-[1-9]\d*-elastic-goal-r(?:0|[1-9]\d*)-lease$/.test(text(input.sourceExecutionLeaseKey))
      || !SHA256.test(text(input.processingClaimSha256))
      || !Number.isSafeInteger(input.expectedMissionRevision) || input.expectedMissionRevision < 1) {
    fail('PROSPECTIVE_ORPHAN_COMMAND_INVALID');
  }

  const readMission = options.readMissionRecord || readMissionRecord;
  const appender = options.appendMissionEvent || appendMissionEvent;
  const guard = operation => (options.withOriginalSourceLeaseFenceGuard
    || withOriginalSourceLeaseFenceGuard)(operation, {
    root: options.paths.workspaceRoot, repoRoot: options.paths.repoRoot, env: options.env,
  });
  const requireQuarantined = result => {
    if (result?.quarantined !== true) {
      fail('PROSPECTIVE_ORPHAN_PROCESSING_CLAIM_QUARANTINE_UNPROVEN');
    }
    return result;
  };
  const current = await readMission(input.missionId, {
    root: options.paths?.orchestratorRoot, env: options.env || process.env,
  });
  const existing = current?.state;
  if (existing?.cancelled === true
      && existing?.storeMetadata?.originalSourceAttemptFence?.schemaVersion === PROSPECTIVE_ORPHAN_FENCE_SCHEMA) {
    const durableFence = existing.storeMetadata.originalSourceAttemptFence;
    if (durableFence.commandId !== input.commandId
        || durableFence.operatorRequestId !== text(input.operatorRequestId).toLowerCase()
        || durableFence.sourceExecutionId !== input.sourceExecutionId
        || durableFence.processingClaimSha256 !== text(input.processingClaimSha256).toLowerCase()) {
      fail('PROSPECTIVE_ORPHAN_REPLAY_IDENTITY_MISMATCH');
    }
    const quarantine = requireQuarantined(await guard(
      () => retireUnknownProcessingClaim(existing, options),
    ));
    return Object.freeze({
      state: existing, duplicate: true,
      eventId: existing.storeMetadata?.lastEventId || '',
      processingClaimQuarantine: quarantine,
    });
  }
  if (!existing || existing.revision !== input.expectedMissionRevision
      || ['COMPLETE', 'CANCELLED'].includes(existing.currentPhase)) {
    fail('PROSPECTIVE_ORPHAN_MISSION_PRECONDITION_FAILED');
  }

  const normalizedInput = {
    ...input,
    operatorRequestId: text(input.operatorRequestId).toLowerCase(),
    processingClaimSha256: text(input.processingClaimSha256).toLowerCase(),
  };
  const cancelled = await appender(input.missionId, {
    eventId: 'cancel-' + input.commandId,
    eventType: 'MISSION_CANCELLED',
    expectedRevision: input.expectedMissionRevision,
    expectedCurrentPhase: existing.currentPhase,
    originalSourceQuarantineRequested: true,
    summary: input.reason,
  }, {
    ...options,
    root: options.paths?.orchestratorRoot,
    proveOriginalSourceQuarantine: currentState =>
      proveUnknownProcessingClaimQuarantine(currentState, normalizedInput, options),
    withOriginalSourceLeaseFenceGuard: guard,
  });
  if (cancelled?.preconditionFailed) return cancelled;
  const quarantine = requireQuarantined(await guard(
    () => retireUnknownProcessingClaim(cancelled.state, options),
  ));
  return Object.freeze({ ...cancelled, processingClaimQuarantine: quarantine });
}
