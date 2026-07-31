import { createHash } from 'node:crypto';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceReceiptRecord,
  createSharedWorkspaceStatusRecord,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import { validateExecutionReceipt } from './executionReceiptV1.mjs';
import {
  MONITOR_MODES,
  MONITOR_NOTIFICATION_POLICIES,
  createMonitorDefinition,
} from './monitorMultiplexer.mjs';
import { validateProtectedApprovalReceipt } from './operatorMergeApprovalGate.mjs';

export const CANONICAL_IMPLEMENTATION_LANE_SCHEMA = 'stephanos.canonical-implementation-lane.v1';
export const SOURCE_MUTATION_LEASE_SCHEMA = 'stephanos.source-mutation-lease.v1';
export const SOURCE_MUTATION_LEASE_RELEASE_SCHEMA = 'stephanos.source-mutation-lease-release.v1';
export const PROGRAMME_CONTROLLER_HEARTBEAT_SCHEMA = 'stephanos.programme-controller-heartbeat.v1';
export const TERMINAL_LANE_FINALIZATION_SCHEMA = 'stephanos.terminal-lane-finalization.v1';
export const PROGRAMME_STALL_DIAGNOSIS_SCHEMA = 'stephanos.programme-stall-diagnosis.v1';
export const AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA = 'stephanos.authoritative-programme-projection.v1';
export const PROGRAMME_STALL_MONITOR_ID = 'programme-stall-monitor';
export const PROGRAMME_STALL_MONITOR_HANDLER_ID = 'programme-stall-diagnosis';
export const SOURCE_MUTATION_LEASE_STATUS_ID = 'source-mutation-lease-current';
export const PROGRAMME_CONTROLLER_HEARTBEAT_STATUS_ID = 'programme-controller-heartbeat';
export const DEFAULT_SOURCE_MUTATION_LEASE_MS = 2 * 60 * 60 * 1000;
export const MAX_SOURCE_MUTATION_LEASE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CONTROLLER_HEARTBEAT_MAX_AGE_MS = 20 * 60 * 1000;
export const DEFAULT_PROGRAMME_STALL_AFTER_MS = 30 * 60 * 1000;
export const MAX_PROGRAMME_PROGRESS_FUTURE_SKEW_MS = 60 * 1000;

const SHA_40 = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const SAFE_BRANCH = /^[a-z0-9][a-z0-9._/-]{0,239}$/i;
const SAFE_REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const ACTIVE_PR_STATES = new Set(['OPEN']);
const TERMINAL_PR_STATES = new Set(['CLOSED', 'MERGED']);
const CONTROLLER_CYCLE_STATES = new Set([
  'STARTING',
  'RECONCILING',
  'HOLD',
  'IDLE',
  'ACTIVE_LANE',
  'FINALIZING',
  'STOPPED',
]);
const EXECUTION_TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE_LANE_CONTROLLER_STATES = new Set(['ACTIVE_LANE']);
const IDLE_SELECTION_CONTROLLER_STATES = new Set(['IDLE', 'RECONCILING']);
const TERMINAL_LANE_CONTROLLER_STATES = new Set(['FINALIZING', 'RECONCILING']);
const ACTIVE_EXECUTION_RECEIPT_STATES = new Set(['queued', 'accepted', 'started', 'progress']);
const FAILED_EXECUTION_RECEIPT_STATES = new Set(['failed', 'cancelled']);
const AFFIRMATIVE_PROGRESS_PROOF_STATUSES = new Set([
  'COMPLETE',
  'COMPLETED',
  'MERGED',
  'PASS',
  'PASSED',
  'PROVED',
  'SUCCEEDED',
  'SUCCESS',
  'VERIFIED',
]);

export const PROGRAMME_AUTHORITY_COMPONENTS = Object.freeze([
  Object.freeze({ componentId: 'github-pr-evidence', source: 'stephanos-server/services/githubPrEvidenceService.js', ownership: 'github-lane-truth', reuse: true }),
  Object.freeze({ componentId: 'shared-agent-workspace', source: 'shared/agents/sharedAgentWorkspaceStore.mjs', ownership: 'durable-record-store', reuse: true }),
  Object.freeze({ componentId: 'battle-bridge-publisher', source: 'shared/agents/battleBridgePublisher.mjs', ownership: 'runtime-proof-publication', reuse: true }),
  Object.freeze({ componentId: 'execution-receipts', source: 'shared/agents/executionReceiptV1.mjs', ownership: 'worker-execution-truth', reuse: true }),
  Object.freeze({ componentId: 'source-mutation-lease', source: 'shared/agents/programmeAuthorityV1.mjs', ownership: 'source-mutation-authority', reuse: false }),
  Object.freeze({ componentId: 'programme-controller-heartbeat', source: 'shared/agents/programmeAuthorityV1.mjs', ownership: 'controller-liveness', reuse: false }),
  Object.freeze({ componentId: 'mission-worker-heartbeat', source: 'scripts/mission-orchestrator-worker-heartbeat.mjs', ownership: 'worker-liveness', reuse: true }),
  Object.freeze({ componentId: 'mission-scheduler', source: 'shared/runtime/missionScheduler.mjs', ownership: 'goal-selection', reuse: true }),
  Object.freeze({ componentId: 'critical-backlog-conveyor', source: 'shared/agents/criticalBacklogConveyor.mjs', ownership: 'critical-mission-admission', reuse: true }),
  Object.freeze({ componentId: 'monitor-multiplexer', source: 'shared/agents/monitorMultiplexer.mjs', ownership: 'bounded-monitor-runtime', reuse: true }),
  Object.freeze({ componentId: 'programme-stall-diagnosis', source: 'shared/agents/programmeAuthorityV1.mjs', ownership: 'diagnosis-only', reuse: false }),
  Object.freeze({ componentId: 'exact-head-review-dispatch', source: 'shared/agents/exactHeadReviewDispatchCoordinator.mjs', ownership: 'review-coordination', reuse: true }),
  Object.freeze({ componentId: 'codex-dispatch-queue', source: 'shared/agents/codexDispatchQueue.mjs', ownership: 'dispatch-queue', reuse: true }),
  Object.freeze({ componentId: 'automated-codex-dispatcher', source: 'shared/agents/automatedCodexDispatcher.mjs', ownership: 'dispatch', reuse: true }),
  Object.freeze({ componentId: 'battle-bridge-github-command-mailbox', source: 'shared/agents/battleBridgeGitHubCommandMailbox.mjs', ownership: 'bounded-command-transport', reuse: true }),
  Object.freeze({ componentId: 'mission-worker-watchdog', source: 'scripts/battle-bridge-worker-watchdog-policy.mjs', ownership: 'worker-supervision', reuse: true }),
  Object.freeze({ componentId: 'unattended-github-sync', source: 'scripts/battle-bridge-github-sync-executor.mjs', ownership: 'main-fast-forward', reuse: true }),
  Object.freeze({ componentId: 'pr-estate-reconciler', source: 'shared/agents/prEstateReconciler.mjs', ownership: 'pr-family-reconciliation', reuse: true }),
]);

function text(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function number(value) {
  const normalized = typeof value === 'number' ? String(value) : text(value).replace(/^#/, '');
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function hasOwn(object, key) {
  return Boolean(object && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key));
}

function sha(value) {
  const normalized = text(value).toLowerCase();
  return SHA_40.test(normalized) ? normalized : null;
}

function timestamp(value) {
  const normalized = text(value);
  if (!normalized || !EXPLICIT_TIMEZONE.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedState(value) {
  return text(value).toUpperCase();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function ownValueOr(object, key, fallback) {
  return object && Object.prototype.hasOwnProperty.call(object, key)
    ? object[key]
    : fallback;
}

function unique(values) {
  return [...new Set(values)];
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function laneIdentityFromId(laneId) {
  const normalized = text(laneId);
  const match = /(?:^|-)goal-([1-9]\d*)-pr-([1-9]\d*)(?:-|$)/i.exec(normalized);
  return match
    ? Object.freeze({ issueNumber: number(match[1]), prNumber: number(match[2]) })
    : Object.freeze({ issueNumber: null, prNumber: null });
}

function identityConflict(name, values, blockers) {
  const present = unique(values.filter((value) => value !== null && value !== ''));
  if (present.length > 1) blockers.push(`${name}-identity-conflict`);
  return present[0] ?? null;
}

function canonicalSuppliedAliases(source, keys, normalizer, derivedValues = []) {
  const values = [];
  let valid = true;
  for (const key of keys) {
    if (!hasOwn(source, key)) continue;
    const normalized = normalizer(source[key]);
    if (normalized === null || normalized === '') valid = false;
    else values.push(normalized);
  }
  values.push(...derivedValues.filter((value) => value !== null && value !== ''));
  const canonicalValues = unique(values);
  return freeze({
    valid: valid && canonicalValues.length <= 1,
    value: canonicalValues[0] ?? null,
    supplied: values.length > 0,
  });
}

function canonicalApprovalReceipt(receipt, expected = {}) {
  if (receipt === null || receipt === undefined) {
    return freeze({ valid: true, value: null });
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return freeze({ valid: false, value: null });
  }
  const issue = canonicalSuppliedAliases(receipt, ['issue', 'issueNumber', 'relatedIssue'], number);
  const pr = canonicalSuppliedAliases(receipt, ['activePr', 'pr', 'prNumber', 'relatedPr'], number);
  const head = canonicalSuppliedAliases(receipt, ['headSha', 'sourceHead'], sha);
  const repository = canonicalSuppliedAliases(
      receipt,
      ['repository', 'repositoryFullName'],
      (value) => text(value).toLowerCase(),
    );
  const branch = canonicalSuppliedAliases(receipt, ['branch', 'headBranch'], text);
  const identities = [pr, head, repository, branch];
  const canonicalIssue = issue.supplied ? issue.value : number(expected.issueNumber);
  const canonical = {
    ...receipt,
    issue: canonicalIssue,
    activePr: pr.value,
    headSha: head.value,
    repository: repository.value,
    branch: branch.value,
    prNumber: pr.value,
    sourceHead: head.value,
  };
  const provenance = validateProtectedApprovalReceipt(canonical, {
    nowUtc: expected.nowUtc,
  });
  const valid = identities.every((identity) => identity.valid && identity.supplied)
    && issue.valid
    && Boolean(canonicalIssue)
    && (!expected.issueNumber || canonicalIssue === expected.issueNumber)
    && provenance.valid;
  return freeze({
    valid,
    value: valid ? canonical : null,
  });
}

function mergeEvidence(github = {}, expected = {}) {
  github = github && typeof github === 'object' && !Array.isArray(github) ? github : {};
  const blockers = [];
  const prNumber = number(github.prNumber ?? github.number);
  const headSha = sha(github.headSha ?? github.head?.sha);
  const prState = normalizedState(github.prState ?? github.state);
  const merged = github.merged === true;
  const mergedAt = text(github.mergedAt ?? github.merged_at);
  const mergedAtMs = timestamp(mergedAt);
  const mergeCommitSha = sha(github.mergeCommitSha ?? github.merge_commit_sha ?? github.mergeCommit?.oid);
  if (!prNumber) blockers.push('github-pr-number-invalid');
  if (!headSha) blockers.push('github-head-invalid');
  if (!ACTIVE_PR_STATES.has(prState) && !TERMINAL_PR_STATES.has(prState)) blockers.push('github-pr-state-invalid');
  if (expected.prNumber && prNumber !== expected.prNumber) blockers.push('github-pr-number-mismatch');
  if (expected.headSha && headSha !== expected.headSha) blockers.push('github-head-mismatch');
  if (merged && (!TERMINAL_PR_STATES.has(prState) || mergedAtMs === null || !mergeCommitSha)) blockers.push('github-merge-evidence-incomplete');
  const observedAtMs = timestamp(expected.nowUtc);
  if (
    mergedAtMs !== null
    && (
      observedAtMs === null
      || mergedAtMs - observedAtMs > MAX_PROGRAMME_PROGRESS_FUTURE_SKEW_MS
    )
  ) blockers.push('github-merged-at-in-future');
  // GitHub may expose a provisional/test merge commit SHA while an open PR is
  // still unmerged. Only affirmative merge state makes that SHA authoritative.
  if (!merged && (mergedAt || prState === 'MERGED')) blockers.push('github-merge-evidence-contradictory');
  if (prState === 'OPEN' && merged) blockers.push('github-open-pr-cannot-be-merged');
  const affirmativelyMerged = blockers.length === 0
    && merged
    && TERMINAL_PR_STATES.has(prState)
    && mergedAtMs !== null
    && Boolean(mergeCommitSha);
  return freeze({
    valid: blockers.length === 0,
    blockers,
    prNumber,
    headSha,
    prState,
    merged,
    mergedAt: mergedAtMs === null ? null : new Date(mergedAtMs).toISOString(),
    mergeCommitSha,
    affirmativelyMerged,
    active: blockers.length === 0 && ACTIVE_PR_STATES.has(prState) && !merged,
  });
}

export function buildCanonicalImplementationLaneProjection(input = {}) {
  const blockers = [];
  const laneId = text(input.laneId ?? input.id);
  const encoded = laneIdentityFromId(laneId);
  const lease = input.mutationLease ?? null;
  for (const [name, keys, normalize] of [
    ['issue', ['issueNumber', 'issue'], number],
    ['pr', ['prNumber', 'pr'], number],
    ['head', ['headSha'], sha],
    ['branch', ['branch'], text],
    ['repository', ['repository'], text],
  ]) {
    for (const key of keys) {
      if (hasOwn(input, key) && !normalize(input[key])) {
        blockers.push(`${name}-explicit-identity-invalid`);
      }
    }
  }
  const explicitIssue = number(input.issueNumber ?? input.issue);
  const explicitPr = number(input.prNumber ?? input.pr);
  const githubPr = number(input.github?.prNumber ?? input.github?.number);
  const githubBranch = text(input.github?.headBranch);
  const githubRepository = text(input.github?.repository);
  const leaseIssue = number(lease?.issueNumber);
  const leasePr = number(lease?.prNumber);
  const issueNumber = identityConflict('issue', [encoded.issueNumber, explicitIssue, leaseIssue], blockers);
  const prNumber = identityConflict('pr', [encoded.prNumber, explicitPr, leasePr, githubPr], blockers);
  const headSha = identityConflict('head', [
    sha(input.headSha),
    sha(lease?.headSha),
    sha(input.github?.headSha ?? input.github?.head?.sha),
  ], blockers);
  const branch = identityConflict('branch', [text(input.branch), text(lease?.branch), githubBranch], blockers);
  const repository = identityConflict('repository', [text(input.repository), text(lease?.repository), githubRepository], blockers);
  if (!laneId || !SAFE_ID.test(laneId)) blockers.push('lane-id-invalid');
  if (!issueNumber) blockers.push('lane-issue-invalid');
  if (!prNumber) blockers.push('lane-pr-invalid');
  if (!headSha) blockers.push('lane-head-invalid');
  if (!branch || !SAFE_BRANCH.test(branch) || branch.includes('..')) blockers.push('lane-branch-invalid');
  if (!repository || !SAFE_REPOSITORY.test(repository)) blockers.push('lane-repository-invalid');
  if (!githubBranch || !SAFE_BRANCH.test(githubBranch) || githubBranch.includes('..')) {
    blockers.push('github-head-branch-invalid');
  } else if (branch && githubBranch !== branch) {
    blockers.push('github-head-branch-mismatch');
  }
  if (!githubRepository || !SAFE_REPOSITORY.test(githubRepository)) {
    blockers.push('github-head-repository-invalid');
  } else if (repository && githubRepository.toLowerCase() !== repository.toLowerCase()) {
    blockers.push('github-head-repository-mismatch');
  }
  const github = mergeEvidence(input.github, { prNumber, headSha, nowUtc: input.nowUtc });
  blockers.push(...github.blockers);

  let mutationLeaseIdentity = null;
  if (lease) {
    const leaseValidation = validateSourceMutationLease(lease, {
      nowUtc: input.nowUtc,
      expected: { laneId, issueNumber, prNumber, headSha, branch, repository },
    });
    if (!leaseValidation.valid) blockers.push(...leaseValidation.errors.map((error) => `lease:${error}`));
    mutationLeaseIdentity = {
      leaseId: text(lease.leaseId),
      ownerId: text(lease.ownerId),
      active: leaseValidation.active,
      stale: leaseValidation.stale,
    };
  }

  const executionReceiptRefs = [];
  const executionReceipts = input.executionReceipt
    ? [input.executionReceipt]
    : list(input.executionReceipts);
  for (const receipt of executionReceipts) {
    const validation = validateExecutionReceipt(receipt, {
      repository,
      issueNumber,
      branch,
      expectedHead: headSha,
    });
    if (!validation.valid) {
      blockers.push(`execution-receipt:${validation.refusalReason || 'invalid'}`);
      continue;
    }
    if (receipt.prNumber !== prNumber) {
      blockers.push('execution-receipt:pr-mismatch');
      continue;
    }
    executionReceiptRefs.push(receipt.receiptId);
  }

  const proofReferences = unique([
    ...list(input.proofReferences),
    ...list(input.proofRefs),
  ].map((value) => text(value)).filter(Boolean));
  const active = blockers.length === 0 && github.active;
  const terminal = blockers.length === 0 && github.affirmativelyMerged;
  if (!active && !terminal && github.prState === 'CLOSED' && !github.affirmativelyMerged) {
    blockers.push('github-pr-closed-without-affirmative-merge');
  }
  return freeze({
    schemaVersion: CANONICAL_IMPLEMENTATION_LANE_SCHEMA,
    valid: blockers.length === 0,
    finalVerdict: blockers.length ? 'CANONICAL_IMPLEMENTATION_LANE_HOLD' : 'CANONICAL_IMPLEMENTATION_LANE_PASS',
    blockers: unique(blockers),
    laneId,
    issueNumber,
    goalNumber: issueNumber,
    prNumber,
    branch,
    repository,
    headSha,
    prState: github.prState,
    merged: github.affirmativelyMerged,
    mergeEvidence: github,
    status: terminal ? 'TERMINAL' : active ? 'ACTIVE' : 'HOLD',
    active,
    terminal,
    executionReceiptRefs,
    proofReferences,
    mutationLeaseIdentity,
    chatMemoryAuthoritative: false,
  });
}

function boundedLeaseDuration(value) {
  const duration = Number.isFinite(value) && value > 0 ? Math.trunc(value) : DEFAULT_SOURCE_MUTATION_LEASE_MS;
  return Math.min(duration, MAX_SOURCE_MUTATION_LEASE_MS);
}

export function createSourceMutationLeaseRecord(input = {}) {
  const acquiredAtUtc = text(input.acquiredAtUtc ?? input.nowUtc);
  const acquiredAtMs = timestamp(acquiredAtUtc);
  const durationMs = boundedLeaseDuration(input.durationMs);
  const expiresAtUtc = text(
    input.expiresAtUtc,
    acquiredAtMs === null ? '' : new Date(acquiredAtMs + durationMs).toISOString(),
  );
  const laneId = text(input.laneId);
  const leaseId = text(input.leaseId, `${laneId}-lease`);
  return freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: SOURCE_MUTATION_LEASE_STATUS_ID,
      participantId: 'source-mutation-lease-authority',
      timestampUtc: acquiredAtUtc,
      status: 'ACTIVE',
      summary: `Source mutation lease ${leaseId || 'invalid'} is bound to ${laneId || 'unknown lane'}.`,
      proofRefs: list(input.proofRefs),
    }),
    schema: SOURCE_MUTATION_LEASE_SCHEMA,
    leaseId,
    laneId,
    repository: text(input.repository),
    issueNumber: number(input.issueNumber),
    prNumber: number(input.prNumber),
    branch: text(input.branch),
    headSha: sha(input.headSha),
    ownerId: text(input.ownerId),
    acquiredAtUtc,
    renewedAtUtc: text(input.renewedAtUtc, acquiredAtUtc),
    expiresAtUtc,
    executionReceiptLeaseKeyIsCorrelationOnly: true,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
}

export function createSourceMutationLeaseReleaseRecord(lease = {}, input = {}) {
  const headSha = sha(lease.headSha);
  const prNumber = number(lease.prNumber);
  const leaseId = text(lease.leaseId);
  const releaseIdentityDigest = createHash('sha256').update(JSON.stringify([
    leaseId,
    text(lease.laneId),
    text(lease.repository).toLowerCase(),
    number(lease.issueNumber),
    prNumber,
    text(lease.branch),
    headSha,
    text(lease.ownerId),
  ])).digest('hex').slice(0, 32);
  const statusId = `source-lease-release-${releaseIdentityDigest}`;
  return freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId,
      participantId: 'source-mutation-lease-authority',
      timestampUtc: text(input.timestampUtc),
      status: 'RELEASED',
      summary: `Source mutation lease ${leaseId || 'invalid'} was released from ${text(lease.laneId, 'unknown lane')}.`,
      proofRefs: list(input.proofRefs ?? lease.proofRefs),
    }),
    schema: SOURCE_MUTATION_LEASE_RELEASE_SCHEMA,
    leaseId,
    laneId: text(lease.laneId),
    repository: text(lease.repository),
    issueNumber: number(lease.issueNumber),
    prNumber,
    branch: text(lease.branch),
    headSha,
    ownerId: text(lease.ownerId),
    acquiredAtUtc: text(lease.acquiredAtUtc),
    renewedAtUtc: text(lease.renewedAtUtc, lease.acquiredAtUtc),
    releasedAtUtc: text(input.timestampUtc),
    releaseOnlyExactLease: true,
    executionReceiptLeaseKeyIsCorrelationOnly: true,
    mergeAuthority: false,
  });
}

export function validateSourceMutationLease(record = {}, options = {}) {
  const errors = [];
  const nowUtc = text(options.nowUtc);
  const nowMs = timestamp(nowUtc);
  const workspaceValidation = validateSharedWorkspaceRecord(record, {
    nowMs: nowMs ?? undefined,
  });
  for (const error of workspaceValidation.errors) errors.push(`workspace:${error}`);
  const acquiredAtMs = timestamp(record?.acquiredAtUtc);
  const renewedAtMs = timestamp(record?.renewedAtUtc);
  const expiresAtMs = timestamp(record?.expiresAtUtc);
  if (!record || typeof record !== 'object' || Array.isArray(record)) errors.push('invalid-record');
  if (record?.schema !== SOURCE_MUTATION_LEASE_SCHEMA) errors.push('invalid-schema');
  if (record?.schemaVersion !== 'shared-agent-workspace-record.v1') errors.push('invalid-workspace-schema');
  if (record?.kind !== 'stephanos.shared_workspace.status') errors.push('invalid-workspace-kind');
  if (record?.statusId !== SOURCE_MUTATION_LEASE_STATUS_ID) errors.push('invalid-status-id');
  if (record?.participantId !== 'source-mutation-lease-authority') errors.push('invalid-participant-id');
  if (record?.status !== 'ACTIVE') errors.push('lease-status-not-active');
  if (record?.timestampUtc !== record?.acquiredAtUtc) errors.push('lease-status-timestamp-mismatch');
  if (!Array.isArray(record?.proofRefs)) errors.push('invalid-proof-refs');
  if (!SAFE_ID.test(text(record?.leaseId))) errors.push('invalid-lease-id');
  if (!SAFE_ID.test(text(record?.laneId))) errors.push('invalid-lane-id');
  const encodedLaneIdentity = laneIdentityFromId(record?.laneId);
  if (encodedLaneIdentity.issueNumber && encodedLaneIdentity.issueNumber !== number(record?.issueNumber)) {
    errors.push('lane-id-issue-mismatch');
  }
  if (encodedLaneIdentity.prNumber && encodedLaneIdentity.prNumber !== number(record?.prNumber)) {
    errors.push('lane-id-pr-mismatch');
  }
  if (!SAFE_REPOSITORY.test(text(record?.repository))) errors.push('invalid-repository');
  if (!number(record?.issueNumber)) errors.push('invalid-issue-number');
  if (!number(record?.prNumber)) errors.push('invalid-pr-number');
  if (!SAFE_BRANCH.test(text(record?.branch)) || text(record?.branch).includes('..')) errors.push('invalid-branch');
  if (!sha(record?.headSha)) errors.push('invalid-head-sha');
  if (!SAFE_ID.test(text(record?.ownerId))) errors.push('invalid-owner-id');
  if (acquiredAtMs === null) errors.push('invalid-acquired-at');
  if (renewedAtMs === null) errors.push('invalid-renewed-at');
  if (expiresAtMs === null) errors.push('invalid-expires-at');
  if (acquiredAtMs !== null && renewedAtMs !== null && renewedAtMs < acquiredAtMs) errors.push('renewed-before-acquired');
  if (renewedAtMs !== null && expiresAtMs !== null && expiresAtMs <= renewedAtMs) errors.push('expiry-not-after-renewal');
  if (acquiredAtMs !== null && expiresAtMs !== null && expiresAtMs - acquiredAtMs > MAX_SOURCE_MUTATION_LEASE_MS) {
    errors.push('lease-lifetime-exceeds-maximum');
  }
  if (record?.executionReceiptLeaseKeyIsCorrelationOnly !== true) errors.push('lease-key-correlation-boundary-missing');
  if (record?.mergeAuthority !== false) errors.push('merge-authority-forbidden');
  if (record?.leaseSeizureAllowed !== false) errors.push('lease-seizure-forbidden');
  if (nowMs === null) errors.push('invalid-observation-time');
  if (nowMs !== null && acquiredAtMs !== null && acquiredAtMs - nowMs > 60_000) errors.push('future-acquisition');

  const expected = options.expected ?? {};
  for (const [field, normalize] of [
    ['leaseId', text],
    ['laneId', text],
    ['repository', text],
    ['issueNumber', number],
    ['prNumber', number],
    ['branch', text],
    ['headSha', sha],
    ['ownerId', text],
  ]) {
    if (!hasOwn(expected, field)) continue;
    const wanted = normalize(expected[field]);
    if (!wanted) errors.push(`${field}-expected-invalid`);
    else if (normalize(record?.[field]) !== wanted) errors.push(`${field}-mismatch`);
  }
  const valid = errors.length === 0;
  const active = valid && expiresAtMs > nowMs;
  return freeze({
    valid,
    active,
    stale: valid && !active,
    errors: unique(errors),
    finalVerdict: !valid
      ? 'SOURCE_MUTATION_LEASE_BLOCKED'
      : active
        ? 'SOURCE_MUTATION_LEASE_ACTIVE'
        : 'SOURCE_MUTATION_LEASE_STALE',
  });
}

function requiredLeaseIdentity(input = {}) {
  const identity = {
    leaseId: text(input.leaseId),
    laneId: text(input.laneId),
    repository: text(input.repository),
    issueNumber: number(input.issueNumber),
    prNumber: number(input.prNumber),
    branch: text(input.branch),
    headSha: sha(input.headSha),
    ownerId: text(input.ownerId),
  };
  const errors = [];
  if (!SAFE_ID.test(identity.leaseId)) errors.push('expected-lease-id-invalid');
  if (!SAFE_ID.test(identity.laneId)) errors.push('expected-lane-id-invalid');
  if (!SAFE_REPOSITORY.test(identity.repository)) errors.push('expected-repository-invalid');
  if (!identity.issueNumber) errors.push('expected-issue-number-invalid');
  if (!identity.prNumber) errors.push('expected-pr-number-invalid');
  if (!SAFE_BRANCH.test(identity.branch) || identity.branch.includes('..')) errors.push('expected-branch-invalid');
  if (!identity.headSha) errors.push('expected-head-sha-invalid');
  if (!SAFE_ID.test(identity.ownerId)) errors.push('expected-owner-id-invalid');
  return freeze({ valid: errors.length === 0, errors, identity });
}

export function renewSourceMutationLeaseRecord(record = {}, input = {}) {
  const expected = requiredLeaseIdentity(input);
  if (!expected.valid) {
    return freeze({
      ok: false,
      reason: expected.errors[0],
      validation: null,
      record: null,
    });
  }
  const validation = validateSourceMutationLease(record, {
    nowUtc: input.nowUtc,
    expected: expected.identity,
  });
  if (!validation.valid || !validation.active) {
    return freeze({
      ok: false,
      reason: validation.valid ? 'SOURCE_MUTATION_LEASE_EXPIRED' : validation.errors[0],
      validation,
      record: null,
    });
  }
  const nowMs = timestamp(input.nowUtc);
  const acquiredAtMs = timestamp(record.acquiredAtUtc);
  const maximumExpiryMs = acquiredAtMs + MAX_SOURCE_MUTATION_LEASE_MS;
  const requestedExpiryMs = nowMs + boundedLeaseDuration(input.durationMs);
  const expiresAtMs = Math.min(requestedExpiryMs, maximumExpiryMs);
  if (expiresAtMs <= nowMs) {
    return freeze({
      ok: false,
      reason: 'SOURCE_MUTATION_LEASE_MAXIMUM_LIFETIME_REACHED',
      validation,
      record: null,
    });
  }
  const renewed = createSourceMutationLeaseRecord({
    ...record,
    acquiredAtUtc: record.acquiredAtUtc,
    renewedAtUtc: input.nowUtc,
    expiresAtUtc: new Date(expiresAtMs).toISOString(),
  });
  const renewedValidation = validateSourceMutationLease(renewed, {
    nowUtc: input.nowUtc,
    expected: expected.identity,
  });
  if (!renewedValidation.valid || !renewedValidation.active) {
    return freeze({
      ok: false,
      reason: renewedValidation.valid
        ? 'SOURCE_MUTATION_LEASE_RENEWAL_NOT_ACTIVE'
        : renewedValidation.errors[0],
      validation: renewedValidation,
      record: null,
    });
  }
  return freeze({ ok: true, reason: 'SOURCE_MUTATION_LEASE_RENEWED', validation: renewedValidation, record: renewed });
}

export function validateExecutionReceiptAgainstMutationLease(receipt, lease, options = {}) {
  const leaseValidation = validateSourceMutationLease(lease, {
    nowUtc: options.nowUtc,
    expected: options.expectedLease,
  });
  if (!leaseValidation.valid || !leaseValidation.active) {
    return freeze({
      valid: false,
      errors: leaseValidation.valid
        ? ['lease:expired']
        : leaseValidation.errors.map((error) => `lease:${error}`),
      leaseAuthorityDerivedFromReceipt: false,
      finalVerdict: 'EXECUTION_RECEIPT_MUTATION_AUTHORITY_BLOCKED',
    });
  }
  const receiptValidation = validateExecutionReceipt(receipt, {
    repository: lease.repository,
    issueNumber: lease.issueNumber,
    branch: lease.branch,
    expectedHead: lease.headSha,
  });
  const errors = [...receiptValidation.errors];
  if (receipt?.prNumber !== lease.prNumber) errors.push('pr-mismatch');
  if (receipt?.workerId !== lease.ownerId) errors.push('worker-owner-mismatch');
  if (receipt?.leaseKey !== lease.leaseId) errors.push('lease-correlation-mismatch');
  const receiptHeartbeatExpiresAtMs = timestamp(receipt?.heartbeatExpiresAtUtc);
  const receiptTimestampMs = timestamp(receipt?.timestampUtc);
  const nowMs = timestamp(options.nowUtc);
  if (
    ACTIVE_EXECUTION_RECEIPT_STATES.has(receipt?.state)
    && receiptTimestampMs !== null
    && nowMs !== null
    && receiptTimestampMs - nowMs > MAX_PROGRAMME_PROGRESS_FUTURE_SKEW_MS
  ) {
    errors.push('receipt-timestamp-in-future');
  }
  if (
    ACTIVE_EXECUTION_RECEIPT_STATES.has(receipt?.state)
    && receiptHeartbeatExpiresAtMs !== null
    && nowMs !== null
    && receiptHeartbeatExpiresAtMs <= nowMs
  ) {
    errors.push('receipt-heartbeat-expired');
  }
  return freeze({
    valid: errors.length === 0,
    errors: unique(errors),
    leaseAuthorityDerivedFromReceipt: false,
    finalVerdict: errors.length
      ? 'EXECUTION_RECEIPT_MUTATION_AUTHORITY_BLOCKED'
      : 'EXECUTION_RECEIPT_BOUND_TO_MUTATION_LEASE',
  });
}

export function createProgrammeControllerHeartbeat(input = {}) {
  const timestampUtc = text(input.timestampUtc);
  const cycleState = normalizedState(input.cycleState);
  return freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: PROGRAMME_CONTROLLER_HEARTBEAT_STATUS_ID,
      participantId: text(input.controllerId, 'programme-controller'),
      timestampUtc,
      status: cycleState || 'UNKNOWN',
      summary: text(input.summary, `Programme controller is ${cycleState || 'UNKNOWN'}.`),
      proofRefs: list(input.proofRefs),
    }),
    schema: PROGRAMME_CONTROLLER_HEARTBEAT_SCHEMA,
    controllerId: text(input.controllerId),
    sourceRevision: sha(input.sourceRevision),
    cycleState,
    activeLaneId: text(input.activeLaneId),
    lastSuccessfulReconciliationUtc: text(input.lastSuccessfulReconciliationUtc),
    lastPublishedReceiptId: text(input.lastPublishedReceiptId),
    boundedMutationSteps: input.boundedMutationSteps === 1 ? 1 : 0,
    workerHeartbeatAuthority: false,
    chatMemoryAuthoritative: false,
  });
}

export function projectProgrammeControllerHeartbeat(record = {}, options = {}) {
  const errors = [];
  const nowMs = timestamp(options.nowUtc);
  const heartbeatMs = timestamp(record?.timestampUtc);
  const reconciliationMs = timestamp(record?.lastSuccessfulReconciliationUtc);
  const cycleState = normalizedState(record?.cycleState);
  const activeLaneId = text(record?.activeLaneId);
  const expectedSourceRevisionProvided = Object.hasOwn(options, 'expectedSourceRevision');
  const expectedSourceRevision = sha(options.expectedSourceRevision);
  const maxAgeMs = Number.isFinite(options.maxAgeMs) && options.maxAgeMs > 0
    ? options.maxAgeMs
    : DEFAULT_CONTROLLER_HEARTBEAT_MAX_AGE_MS;
  if (!record || typeof record !== 'object' || Array.isArray(record)) errors.push('invalid-record');
  const workspaceValidation = record && typeof record === 'object' && !Array.isArray(record)
    ? validateSharedWorkspaceRecord(record, { nowMs: nowMs ?? undefined })
    : { valid: false, errors: ['invalid-record'] };
  if (!workspaceValidation.valid) {
    errors.push(...workspaceValidation.errors.map((error) => `workspace:${error}`));
  }
  if (record?.schema !== PROGRAMME_CONTROLLER_HEARTBEAT_SCHEMA) errors.push('invalid-controller-heartbeat-schema');
  if (record?.schemaVersion !== 'shared-agent-workspace-record.v1') errors.push('invalid-workspace-schema');
  if (record?.kind !== 'stephanos.shared_workspace.status') errors.push('invalid-workspace-kind');
  if (record?.statusId !== PROGRAMME_CONTROLLER_HEARTBEAT_STATUS_ID) errors.push('invalid-status-id');
  if (!SAFE_ID.test(text(record?.controllerId))) errors.push('invalid-controller-id');
  if (record?.participantId !== text(record?.controllerId)) errors.push('controller-participant-id-mismatch');
  if (!sha(record?.sourceRevision)) errors.push('invalid-source-revision');
  if (expectedSourceRevisionProvided && !expectedSourceRevision) errors.push('expected-source-revision-invalid');
  if (
    expectedSourceRevisionProvided
    && expectedSourceRevision
    && sha(record?.sourceRevision) !== expectedSourceRevision
  ) {
    errors.push('controller-source-revision-mismatch');
  }
  if (!CONTROLLER_CYCLE_STATES.has(cycleState)) errors.push('invalid-cycle-state');
  if (normalizedState(record?.status) !== cycleState) errors.push('controller-status-cycle-state-mismatch');
  if (activeLaneId && !SAFE_ID.test(activeLaneId)) errors.push('invalid-active-lane-id');
  if (['ACTIVE_LANE', 'FINALIZING'].includes(cycleState) && !SAFE_ID.test(activeLaneId)) errors.push('active-lane-id-required');
  if (heartbeatMs === null) errors.push('invalid-heartbeat-time');
  if (reconciliationMs === null) errors.push('invalid-reconciliation-time');
  if (!SAFE_ID.test(text(record?.lastPublishedReceiptId))) errors.push('invalid-last-receipt');
  if (![0, 1].includes(record?.boundedMutationSteps)) errors.push('invalid-bounded-mutation-step');
  if (record?.workerHeartbeatAuthority !== false) errors.push('worker-heartbeat-authority-forbidden');
  if (record?.chatMemoryAuthoritative !== false) errors.push('chat-memory-authority-forbidden');
  if (nowMs === null) errors.push('invalid-observation-time');
  if (nowMs !== null && heartbeatMs !== null && heartbeatMs - nowMs > 60_000) errors.push('future-heartbeat');
  if (heartbeatMs !== null && reconciliationMs !== null && reconciliationMs - heartbeatMs > 60_000) errors.push('reconciliation-after-heartbeat');
  const ageMs = nowMs !== null && heartbeatMs !== null ? Math.max(0, nowMs - heartbeatMs) : null;
  const valid = errors.length === 0;
  const fresh = valid && ageMs <= maxAgeMs;
  return freeze({
    valid,
    fresh,
    stale: valid && !fresh,
    ageMs,
    controllerId: text(record?.controllerId),
    sourceRevision: sha(record?.sourceRevision),
    expectedSourceRevision: expectedSourceRevision || null,
    cycleState,
    activeLaneId: activeLaneId || null,
    lastSuccessfulReconciliationUtc: reconciliationMs === null ? null : new Date(reconciliationMs).toISOString(),
    lastPublishedReceiptId: text(record?.lastPublishedReceiptId),
    timestampUtc: heartbeatMs === null ? null : new Date(heartbeatMs).toISOString(),
    authority: 'programme-controller-only',
    workerHeartbeatAuthority: false,
    chatMemoryAuthoritative: false,
    errors: unique(errors),
    finalVerdict: !valid
      ? 'PROGRAMME_CONTROLLER_HEARTBEAT_BLOCKED'
      : fresh
        ? 'PROGRAMME_CONTROLLER_HEARTBEAT_FRESH'
        : 'PROGRAMME_CONTROLLER_HEARTBEAT_STALE',
  });
}

export function buildSchedulerGoalsFromProgrammeSources(input = {}) {
  const blockers = [];
  const lane = input.lane ?? null;
  const nowUtc = text(input.nowUtc);
  if (timestamp(nowUtc) === null) blockers.push('scheduler-goal-observation-time-invalid');
  const records = list(input.goalRecords);
  const goals = [];
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      blockers.push(`goal-record-${index}-invalid`);
      continue;
    }
    const envelope = validateSharedWorkspaceRecord(record, {
      nowMs: timestamp(nowUtc) ?? Date.now(),
    });
    if (
      record.schemaVersion !== SHARED_WORKSPACE_RECORD_SCHEMA_VERSION
      || record.kind !== SHARED_WORKSPACE_RECORD_KINDS.GOAL
      || !SAFE_ID.test(text(record.goalId))
      || !envelope.valid
    ) {
      blockers.push(`goal-record-${index}-not-canonical-goal`);
      continue;
    }
    const canonicalGoalId = /^goal-([1-9]\d*)$/i.exec(text(record.goalId));
    const goalIdIssue = number(canonicalGoalId?.[1]);
    const issueAliases = canonicalSuppliedAliases(
      record,
      ['issueNumber', 'issue', 'relatedIssue'],
      number,
      [goalIdIssue],
    );
    const issueNumber = issueAliases.valid ? issueAliases.value : null;
    if (!issueNumber) {
      blockers.push(`goal-record-${index}-issue-invalid`);
      continue;
    }
    const prAliases = canonicalSuppliedAliases(
      record,
      ['activePr', 'prNumber', 'relatedPr'],
      number,
    );
    if (!prAliases.valid) {
      blockers.push(`goal-record-${index}-pr-invalid`);
      continue;
    }
    const approvalReceipt = canonicalApprovalReceipt(
      ownValueOr(record, 'operatorApprovalReceipt', null),
      { issueNumber, nowUtc },
    );
    if (!approvalReceipt.valid) {
      blockers.push(`goal-record-${index}-approval-receipt-invalid`);
      continue;
    }
    goals.push({
      issue: issueNumber,
      title: text(record.title, `Goal #${issueNumber}`),
      state: normalizedState(record.state ?? record.status ?? 'WAITING_FOR_EXTERNAL_CONDITION'),
      prerequisites: ownValueOr(record, 'prerequisites', []),
      priority: Number.isFinite(record.priority) ? record.priority : 0,
      criticalPathWeight: Number.isFinite(record.criticalPathWeight) ? record.criticalPathWeight : 0,
      reversibility: text(record.reversibility, 'UNKNOWN').toUpperCase(),
      route: ownValueOr(record, 'route', 'WAITING_FOR_EXTERNAL_CONDITION'),
      activePr: prAliases.value,
      repository: text(record.repository) || null,
      branch: text(record.branch) || null,
      headSha: sha(record.headSha),
      proofState: text(record.proofState, 'UNKNOWN'),
      approvalRequired: ownValueOr(record, 'approvalRequired', false),
      operatorPriority: ownValueOr(record, 'operatorPriority', false),
      operatorApprovalReceipt: approvalReceipt.value,
      evidenceAt: ownValueOr(record, 'evidenceAt', record.timestampUtc),
      resultProofRefs: ownValueOr(record, 'resultProofRefs', []),
      reusableCapabilityId: text(record.reusableCapabilityId) || null,
      sharedLessonId: text(record.sharedLessonId) || null,
      repairCycleCount: ownValueOr(record, 'repairCycleCount', 0),
      structuralReviewProofRefs: ownValueOr(record, 'structuralReviewProofRefs', []),
      modelTestProofRefs: ownValueOr(record, 'modelTestProofRefs', []),
      duplicateOf: record.duplicateOf ?? null,
      supersededBy: record.supersededBy ?? null,
    });
  }
  if (lane?.valid && lane.active) {
    const existing = goals.find((goal) => goal.issue === lane.issueNumber);
    if (existing && (
      (existing.activePr !== null && existing.activePr !== lane.prNumber)
      || (existing.repository !== null && existing.repository.toLowerCase() !== lane.repository.toLowerCase())
      || (existing.branch !== null && existing.branch !== lane.branch)
      || (existing.headSha !== null && existing.headSha !== lane.headSha)
    )) {
      blockers.push('active-goal-canonical-lane-identity-conflict');
    }
    const activeGoal = {
      issue: lane.issueNumber,
      title: existing?.title ?? `Goal #${lane.issueNumber}`,
      state: 'ACTIVE',
      prerequisites: ownValueOr(existing, 'prerequisites', []),
      priority: existing?.priority ?? 0,
      criticalPathWeight: existing?.criticalPathWeight ?? 0,
      reversibility: existing?.reversibility ?? 'UNKNOWN',
      route: existing
        ? ownValueOr(existing, 'route', 'WAITING_FOR_EXTERNAL_CONDITION')
        : 'CHATGPT_GITHUB',
      activePr: lane.prNumber,
      repository: lane.repository,
      branch: lane.branch,
      headSha: lane.headSha,
      proofState: existing?.proofState ?? 'UNKNOWN',
      approvalRequired: ownValueOr(existing, 'approvalRequired', false),
      operatorPriority: ownValueOr(existing, 'operatorPriority', false),
      operatorApprovalReceipt: ownValueOr(existing, 'operatorApprovalReceipt', null),
      evidenceAt: ownValueOr(existing, 'evidenceAt', nowUtc),
      resultProofRefs: ownValueOr(existing, 'resultProofRefs', []),
      reusableCapabilityId: existing?.reusableCapabilityId ?? null,
      sharedLessonId: existing?.sharedLessonId ?? null,
      repairCycleCount: ownValueOr(existing, 'repairCycleCount', 0),
      structuralReviewProofRefs: ownValueOr(existing, 'structuralReviewProofRefs', []),
      modelTestProofRefs: ownValueOr(existing, 'modelTestProofRefs', []),
      duplicateOf: existing?.duplicateOf ?? null,
      supersededBy: existing?.supersededBy ?? null,
    };
    if (existing) goals[goals.indexOf(existing)] = activeGoal;
    else goals.push(activeGoal);
  }
  const duplicates = goals.map((goal) => goal.issue).filter((issue, index, all) => all.indexOf(issue) !== index);
  if (duplicates.length) blockers.push('duplicate-scheduler-goal-identity');
  return freeze({
    valid: blockers.length === 0,
    blockers: unique(blockers),
    goals,
    finalVerdict: blockers.length ? 'PROGRAMME_SCHEDULER_GOALS_HOLD' : 'PROGRAMME_SCHEDULER_GOALS_READY',
  });
}

function componentInventory(input = {}) {
  const declared = list(input.machineryInventory?.capabilities).map((capability) => ({
    componentId: text(capability?.capabilityId),
    source: text(capability?.statusSource),
    ownership: text(capability?.category),
    reuse: true,
  })).filter((component) => component.componentId);
  const byId = new Map([...PROGRAMME_AUTHORITY_COMPONENTS, ...declared].map((component) => [component.componentId, component]));
  return [...byId.values()].sort((left, right) => left.componentId.localeCompare(right.componentId));
}

export function buildAuthoritativeProgrammeProjection(input = {}) {
  const blockers = list(input.additionalBlockers).map((blocker) => text(blocker)).filter(Boolean);
  const nowUtc = text(input.nowUtc);
  const sourceConstructionMode = input.sourceConstructionMode === 'production-contracts'
    ? 'production-contracts'
    : 'deterministic-testing-seam';
  if (timestamp(nowUtc) === null) blockers.push('programme-observation-time-invalid');
  const workspace = input.workspaceFeed;
  if (!workspace || typeof workspace !== 'object') blockers.push('shared-workspace-source-missing');
  else if (!['ready', 'stale'].includes(text(workspace.state).toLowerCase())) blockers.push(`shared-workspace-${text(workspace.reason, 'unavailable').toLowerCase()}`);
  else if (text(workspace.state).toLowerCase() === 'stale') blockers.push('shared-workspace-stale');

  const lane = input.lane ?? null;
  const lease = input.mutationLease ?? null;
  if (lease && !lane) blockers.push('mutation-lease-without-lane-projection');
  if (lane && !lane.valid) blockers.push(...list(lane.blockers).map((blocker) => `lane:${blocker}`));
  if (lane?.active && !lease) blockers.push('active-lane-without-source-mutation-lease');
  if (!lane && input.executionReceipt) blockers.push('execution-receipt-cannot-create-lane-authority');

  const controllerHeartbeat = input.controllerHeartbeatProjection;
  if (!controllerHeartbeat?.valid || !controllerHeartbeat?.fresh) {
    blockers.push(`controller-heartbeat-${controllerHeartbeat?.valid ? 'stale' : 'invalid-or-missing'}`);
  }
  if (lane?.active && controllerHeartbeat?.activeLaneId !== lane.laneId) {
    blockers.push('controller-heartbeat-active-lane-mismatch');
  }
  if (lane?.active && !ACTIVE_LANE_CONTROLLER_STATES.has(controllerHeartbeat?.cycleState)) {
    blockers.push('controller-heartbeat-cycle-state-does-not-authorize-active-lane');
  }
  if (lane?.terminal && !TERMINAL_LANE_CONTROLLER_STATES.has(controllerHeartbeat?.cycleState)) {
    blockers.push('controller-heartbeat-cycle-state-does-not-authorize-terminal-reconciliation');
  }
  if (lane?.terminal && controllerHeartbeat?.activeLaneId !== lane.laneId) {
    blockers.push('controller-heartbeat-terminal-lane-mismatch');
  }
  const workerHeartbeat = input.workerHeartbeatProjection;
  if (!workerHeartbeat?.valid || !workerHeartbeat?.fresh) {
    blockers.push(`worker-heartbeat-${workerHeartbeat?.valid ? 'stale' : 'invalid-or-missing'}`);
  }
  if (lane?.active) {
    if (!input.executionReceipt) blockers.push('active-lane-execution-receipt-missing');
    else if (!lease) blockers.push('execution-receipt-without-source-mutation-lease');
    else {
      const executionBinding = validateExecutionReceiptAgainstMutationLease(input.executionReceipt, lease, { nowUtc });
      if (!executionBinding.valid) blockers.push(...executionBinding.errors.map((error) => `execution:${error}`));
      else if (!ACTIVE_EXECUTION_RECEIPT_STATES.has(input.executionReceipt.state)) {
        blockers.push('active-lane-execution-receipt-state-not-executable');
      }
    }
  }

  const scheduler = input.scheduler;
  if (!scheduler || typeof scheduler !== 'object') blockers.push('mission-scheduler-source-missing');
  else if (scheduler.failClosed === true) blockers.push(...list(scheduler.contradictions).map((item) => `scheduler:${text(item.code, 'contradiction')}`));
  if (!lane && scheduler?.decisionReceipt?.status === 'ACTIVE_LANE') blockers.push('scheduler-active-lane-without-canonical-projection');
  if (lane?.active && scheduler?.decisionReceipt?.status !== 'ACTIVE_LANE') blockers.push('scheduler-active-lane-status-mismatch');
  if (lane?.active && number(scheduler?.decisionReceipt?.activeIssue) !== lane.issueNumber) blockers.push('scheduler-active-lane-identity-mismatch');

  const conveyor = input.criticalBacklog;
  if (!conveyor || typeof conveyor !== 'object') blockers.push('critical-backlog-source-missing');
  if (lane?.active) {
    if (!['WAIT_ACTIVE_MISSION', 'WAIT_EXTERNAL_ACTIVE_MISSION'].includes(conveyor?.decision)) {
      blockers.push('critical-backlog-active-lane-status-mismatch');
    }
    if (conveyor?.finalVerdict !== 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE') {
      blockers.push('critical-backlog-active-lane-not-affirmative');
    }
    const activeMissionIdentity = laneIdentityFromId(conveyor?.activeMission?.missionId);
    const selectedIssues = [
      ...list(conveyor?.selectedItem?.issueNumbers),
      ...list(conveyor?.activeMission?.issueNumbers),
    ].map((value) => number(value)).filter(Boolean);
    const missionIssueAliases = canonicalSuppliedAliases(
      conveyor?.activeMission,
      ['issueNumber', 'issue', 'relatedIssue'],
      number,
      [activeMissionIdentity.issueNumber],
    );
    if (
      !missionIssueAliases.valid
      || (
        !selectedIssues.includes(lane.issueNumber)
        && missionIssueAliases.value !== lane.issueNumber
      )
      || (
        missionIssueAliases.value !== null
        && missionIssueAliases.value !== lane.issueNumber
      )
    ) {
      blockers.push('critical-backlog-active-lane-identity-mismatch');
    }
    const activeMission = conveyor?.activeMission;
    const nestedPullRequestSupplied = hasOwn(activeMission, 'pullRequest');
    const nestedPullRequestNumber = nestedPullRequestSupplied
      ? number(activeMission?.pullRequest?.number)
      : null;
    const nestedPullRequestValid = !nestedPullRequestSupplied || Boolean(nestedPullRequestNumber);
    const missionPrAliases = canonicalSuppliedAliases(
      activeMission,
      ['prNumber', 'relatedPr'],
      number,
      [nestedPullRequestNumber],
    );
    if (!nestedPullRequestValid || !missionPrAliases.valid) {
      blockers.push('critical-backlog-active-lane-pr-mismatch');
    } else if (!missionPrAliases.supplied) {
      blockers.push('critical-backlog-active-lane-pr-missing');
    } else if (missionPrAliases.value !== lane.prNumber) {
      blockers.push('critical-backlog-active-lane-pr-mismatch');
    }
    if (activeMissionIdentity.prNumber && activeMissionIdentity.prNumber !== lane.prNumber) {
      blockers.push('critical-backlog-active-lane-pr-mismatch');
    }
    const missionRepositories = unique([
      text(conveyor?.activeMission?.repository).toLowerCase(),
      text(conveyor?.activeMission?.git?.repository).toLowerCase(),
    ].filter(Boolean));
    if (!missionRepositories.length) {
      blockers.push('critical-backlog-active-lane-repository-missing');
    } else if (missionRepositories.some((value) => value !== text(lane.repository).toLowerCase())) {
      blockers.push('critical-backlog-active-lane-repository-mismatch');
    }
    const missionBranches = unique([
      text(conveyor?.activeMission?.branch),
      text(conveyor?.activeMission?.git?.branch),
    ].filter(Boolean));
    if (!missionBranches.length) {
      blockers.push('critical-backlog-active-lane-branch-missing');
    } else if (missionBranches.some((value) => value !== lane.branch)) {
      blockers.push('critical-backlog-active-lane-branch-mismatch');
    }
  }
  const idleSelection = !lane && Boolean(scheduler?.selectedGoal);
  if (idleSelection && conveyor?.decision !== 'CREATE_NEXT_MISSION') blockers.push('critical-backlog-did-not-authorize-idle-selection');
  if (idleSelection && !IDLE_SELECTION_CONTROLLER_STATES.has(controllerHeartbeat?.cycleState)) {
    blockers.push('controller-heartbeat-cycle-state-does-not-authorize-idle-selection');
  }
  if (idleSelection) {
    const selectedIssue = number(scheduler?.decisionReceipt?.selectedIssue ?? scheduler?.selectedGoal);
    const conveyorIssues = list(conveyor?.selectedItem?.issueNumbers).map((value) => number(value)).filter(Boolean);
    if (!selectedIssue || !conveyorIssues.includes(selectedIssue)) {
      blockers.push('critical-backlog-idle-selection-identity-mismatch');
    }
  }

  if (!input.machineryInventory?.validation?.valid) blockers.push('machinery-inventory-invalid-or-missing');
  if (!Array.isArray(input.battleBridgeProofs)) blockers.push('battle-bridge-proof-source-missing');
  if (!Array.isArray(input.runtimeHealthRecords)) blockers.push('runtime-health-source-missing');
  const components = componentInventory(input);
  const duplicateComponents = components.map((item) => item.componentId).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateComponents.length) blockers.push('duplicate-machinery-component');

  const finalBlockers = unique(blockers);
  const status = finalBlockers.length
    ? 'HOLD'
    : lane?.terminal
      ? 'TERMINAL_RECONCILIATION_REQUIRED'
      : lane?.active
        ? 'ACTIVE'
        : idleSelection
          ? 'READY'
          : 'IDLE';
  const receiptId = text(input.receiptId, `programme-projection-${nowUtc.replace(/[^0-9]/g, '').slice(0, 14) || 'invalid'}`);
  const projectionReceipt = freeze({
    schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
    receiptId,
    observedAtUtc: nowUtc,
    status,
    sourceCount: components.length,
    components,
    laneId: lane?.laneId ?? null,
    issueNumber: lane?.issueNumber ?? null,
    prNumber: lane?.prNumber ?? null,
    headSha: lane?.headSha ?? null,
    blockers: finalBlockers,
    chatMemoryAuthoritative: false,
    sourceConstructionMode,
    authorityInjectedByCaller: sourceConstructionMode !== 'production-contracts',
    mergeAuthority: false,
    schedulerAuthorityOwnedByController: false,
    workerAuthorityOwnedByController: false,
    monitorRuntimeOwnedByController: false,
    boundedMutationStepsPerCycle: 1,
  });
  const projection = {
    schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
    status,
    finalVerdict: status === 'HOLD' ? 'AUTHORITATIVE_PROGRAMME_PROJECTION_HOLD' : 'AUTHORITATIVE_PROGRAMME_PROJECTION_READY',
    observedAtUtc: nowUtc,
    blockers: finalBlockers,
    chatMemoryAuthoritative: false,
    sourceConstructionMode,
    lane,
    mutationLease: lease,
    controllerHeartbeat,
    workerHeartbeat,
    executionReceipt: input.executionReceipt ?? null,
    battleBridgeProofs: list(input.battleBridgeProofs),
    runtimeHealthRecords: list(input.runtimeHealthRecords),
    scheduler,
    criticalBacklog: conveyor,
    machineryInventory: input.machineryInventory,
    terminalReconciliationState: lane?.terminal ? 'REQUIRED' : 'NOT_REQUIRED',
    projectionReceipt,
  };
  projection.stallDiagnosis = diagnoseProgrammeStall(projection, {
    nowUtc,
    stallAfterMs: input.stallAfterMs,
  });
  return freeze(projection);
}

function everySuppliedRecordAliasMatches(record, keys, normalizer, expected) {
  const supplied = [];
  for (const key of keys) {
    if (!hasOwn(record, key)) continue;
    const value = record[key];
    if (value === undefined || value === null || !String(value).trim()) return false;
    supplied.push(value);
  }
  return supplied.length > 0 && supplied.every((value) => normalizer(value) === expected);
}

function boundedProgressTimestamp(value, nowMs) {
  const valueMs = timestamp(value);
  return valueMs !== null
    && nowMs !== null
    && valueMs - nowMs <= MAX_PROGRAMME_PROGRESS_FUTURE_SKEW_MS
    ? valueMs
    : null;
}

function isAffirmativeLaneProgressProof(proof, lane, nowMs) {
  if (!lane?.active || !proof || typeof proof !== 'object' || Array.isArray(proof)) return false;
  if (proof.kind !== SHARED_WORKSPACE_RECORD_KINDS.PROOF) return false;
  if (!validateSharedWorkspaceRecord(proof, { nowMs: nowMs ?? undefined }).valid) return false;
  if (boundedProgressTimestamp(proof.timestampUtc ?? proof.at, nowMs) === null) return false;
  if (!AFFIRMATIVE_PROGRESS_PROOF_STATUSES.has(text(proof.status).toUpperCase())) return false;
  if (!everySuppliedRecordAliasMatches(proof, ['issueNumber', 'relatedIssue'], number, lane.issueNumber)) return false;
  if (!everySuppliedRecordAliasMatches(proof, ['prNumber', 'relatedPr'], number, lane.prNumber)) return false;
  if (!everySuppliedRecordAliasMatches(proof, ['headSha', 'sourceHead'], sha, lane.headSha)) return false;
  if (!everySuppliedRecordAliasMatches(
    proof,
    ['repository', 'repositoryFullName'],
    (value) => text(value).toLowerCase(),
    text(lane.repository).toLowerCase(),
  )) return false;
  if (!everySuppliedRecordAliasMatches(
    proof,
    ['branch', 'headBranch'],
    text,
    lane.branch,
  )) return false;
  return true;
}

export function diagnoseProgrammeStall(projection = {}, options = {}) {
  const safeProjection = projection && typeof projection === 'object' && !Array.isArray(projection)
    ? projection
    : {};
  const nowMs = timestamp(options.nowUtc ?? safeProjection.observedAtUtc);
  const threshold = Number.isFinite(options.stallAfterMs) && options.stallAfterMs > 0
    ? options.stallAfterMs
    : DEFAULT_PROGRAMME_STALL_AFTER_MS;
  const blockers = [];
  if (nowMs === null) blockers.push('stall-observation-time-invalid');
  if (safeProjection !== projection) blockers.push('programme-projection-missing');
  const lane = safeProjection.lane;
  const proofProgressTimes = list(safeProjection.battleBridgeProofs)
    .filter((proof) => isAffirmativeLaneProgressProof(proof, lane, nowMs))
    .map((proof) => boundedProgressTimestamp(proof.timestampUtc ?? proof.at, nowMs));
  const progressTimes = [
    boundedProgressTimestamp(safeProjection.executionReceipt?.timestampUtc, nowMs),
    boundedProgressTimestamp(safeProjection.mutationLease?.renewedAtUtc, nowMs),
    ...proofProgressTimes,
  ].filter(Number.isFinite);
  const lastProgressMs = progressTimes.length ? Math.max(...progressTimes) : null;
  const progressAgeMs = lastProgressMs === null || nowMs === null ? null : Math.max(0, nowMs - lastProgressMs);
  if (safeProjection.lane?.active && safeProjection.controllerHeartbeat?.fresh !== true) blockers.push('controller-heartbeat-not-fresh');
  if (safeProjection.lane?.active && safeProjection.workerHeartbeat?.fresh !== true) blockers.push('worker-heartbeat-not-fresh');
  if (safeProjection.lane?.active && safeProjection.executionReceipt?.state === 'stalled') blockers.push('execution-receipt-reports-stall');
  if (safeProjection.lane?.active && FAILED_EXECUTION_RECEIPT_STATES.has(safeProjection.executionReceipt?.state)) {
    blockers.push('execution-receipt-terminal-failure');
  }
  if (safeProjection.lane?.active && lastProgressMs === null) blockers.push('active-lane-progress-evidence-missing');
  if (safeProjection.lane?.active && !EXECUTION_TERMINAL_STATES.has(safeProjection.executionReceipt?.state) && progressAgeMs !== null && progressAgeMs > threshold) blockers.push('active-lane-progress-stale');
  if (safeProjection.lane?.terminal && safeProjection.mutationLease) blockers.push('terminal-lane-cleanup-pending');
  const stalled = blockers.length > 0;
  return freeze({
    schemaVersion: PROGRAMME_STALL_DIAGNOSIS_SCHEMA,
    status: stalled ? 'STALL_DETECTED' : safeProjection.status === 'HOLD' ? 'AUTHORITY_HOLD' : 'NO_STALL_DETECTED',
    stalled,
    blockers: unique(blockers),
    lastProgressAtUtc: lastProgressMs === null ? null : new Date(lastProgressMs).toISOString(),
    progressAgeMs,
    diagnosisOnly: true,
    schedulingAllowed: false,
    dispatchAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    monitorRuntime: 'monitor-multiplexer',
    finalVerdict: stalled ? 'PROGRAMME_STALL_ATTENTION_REQUIRED' : 'PROGRAMME_STALL_DIAGNOSIS_PASS',
  });
}

export function buildProgrammeStallMonitorDefinition(input = {}) {
  return createMonitorDefinition({
    monitorId: PROGRAMME_STALL_MONITOR_ID,
    handlerId: PROGRAMME_STALL_MONITOR_HANDLER_ID,
    mode: MONITOR_MODES.RECURRING,
    intervalMs: input.intervalMs,
    maxRuntimeMs: input.maxRuntimeMs,
    nextDueUtc: text(input.nextDueUtc, new Date(0).toISOString()),
    notificationPolicy: MONITOR_NOTIFICATION_POLICIES.STATE_CHANGE,
    relatedIssue: text(input.relatedIssue, '#1497'),
    relatedPr: text(input.relatedPr),
    summary: 'Diagnose durable programme progress without scheduling or mutation.',
    proofRefs: list(input.proofRefs).length ? input.proofRefs : ['proof/programme-stall-monitor.json'],
  }, { timestampUtc: text(input.nextDueUtc, new Date(0).toISOString()) });
}

export function createProgrammeStallMonitorHandler({ loadProjection, stallAfterMs } = {}) {
  if (typeof loadProjection !== 'function') throw new TypeError('loadProjection must be a function');
  return async function programmeStallMonitorHandler(context = {}) {
    const projection = await loadProjection({ nowUtc: context.timestampUtc });
    const diagnosis = diagnoseProgrammeStall(projection, {
      nowUtc: context.timestampUtc,
      stallAfterMs,
    });
    return freeze({
      state: diagnosis.stalled ? 'FAIL' : projection?.status === 'HOLD' ? 'BLOCKED' : 'PASS',
      summary: diagnosis.stalled
        ? `Programme stall detected: ${diagnosis.blockers.join(', ')}.`
        : `Programme stall diagnosis: ${diagnosis.status}.`,
      blocker: diagnosis.blockers[0] ?? (projection?.status === 'HOLD' ? 'PROGRAMME_AUTHORITY_HOLD' : ''),
      nextAction: diagnosis.stalled
        ? 'Publish the diagnosis and reconcile the owning authority; do not schedule from the monitor.'
        : 'Continue through the existing controller and scheduler authorities.',
      proofRefs: ['proof/programme-stall-monitor.json'],
      diagnosis,
      notify: diagnosis.stalled || projection.status === 'HOLD',
    });
  };
}

export function buildTerminalLaneFinalizationPlan(input = {}) {
  const blockers = [];
  const lane = input.lane;
  const lease = input.mutationLease;
  if (!lane?.valid || !lane?.terminal || !lane?.mergeEvidence?.affirmativelyMerged) blockers.push('terminal-lane-merge-evidence-invalid');
  const merge = mergeEvidence(input.github ?? lane?.mergeEvidence, {
    prNumber: lane?.prNumber,
    headSha: lane?.headSha,
    nowUtc: input.nowUtc,
  });
  if (!merge.affirmativelyMerged) blockers.push(...merge.blockers, 'github-merge-not-affirmative');
  const leaseValidation = validateSourceMutationLease(lease, {
    nowUtc: input.nowUtc,
    expected: {
      leaseId: input.leaseId,
      laneId: lane?.laneId,
      repository: lane?.repository,
      issueNumber: lane?.issueNumber,
      prNumber: lane?.prNumber,
      branch: lane?.branch,
      headSha: lane?.headSha,
      ownerId: input.ownerId,
    },
  });
  if (!leaseValidation.valid) blockers.push(...leaseValidation.errors.map((error) => `lease:${error}`));
  const finalBlockers = unique(blockers);
  return freeze({
    schemaVersion: TERMINAL_LANE_FINALIZATION_SCHEMA,
    valid: finalBlockers.length === 0,
    blockers: finalBlockers,
    lane,
    mutationLease: lease,
    mergeEvidence: merge,
    publishTerminalEvidenceFirst: true,
    releaseOnlyExactLease: true,
    schedulesWork: false,
    dispatchesWork: false,
    mergeAuthority: false,
    finalVerdict: finalBlockers.length ? 'TERMINAL_LANE_FINALIZATION_HOLD' : 'TERMINAL_LANE_FINALIZATION_READY',
  });
}

export function createTerminalLaneEvidenceId(lane = {}, lease = {}) {
  const digest = createHash('sha256').update(JSON.stringify([
    text(lane.repository).toLowerCase(),
    text(lane.laneId),
    number(lane.issueNumber),
    number(lane.prNumber),
    text(lane.branch),
    sha(lane.headSha),
    text(lease.leaseId),
    text(lease.ownerId),
  ])).digest('hex').slice(0, 32);
  return `terminal-lane-${digest}`;
}

export function createTerminalLaneEvidenceRecords(plan, input = {}) {
  if (!plan?.valid) throw new TypeError('valid terminal finalization plan is required');
  const timestampUtc = text(input.timestampUtc);
  const evidenceId = createTerminalLaneEvidenceId(plan.lane, plan.mutationLease);
  const proofRef = `proof/${evidenceId}.json`;
  const proof = freeze({
    ...createSharedWorkspaceProofRecord({
      proofId: evidenceId,
      participantId: 'terminal-lane-finalizer',
      timestampUtc,
      correlationId: plan.mutationLease.leaseId,
      relatedIssue: `#${plan.lane.issueNumber}`,
      relatedPr: `#${plan.lane.prNumber}`,
      status: 'MERGED',
      summary: `GitHub affirmatively merged PR #${plan.lane.prNumber} at exact head ${plan.lane.headSha}.`,
      refs: [proofRef],
      proofRefs: [proofRef],
    }),
    schema: TERMINAL_LANE_FINALIZATION_SCHEMA,
    laneId: plan.lane.laneId,
    repository: plan.lane.repository,
    issueNumber: plan.lane.issueNumber,
    prNumber: plan.lane.prNumber,
    branch: plan.lane.branch,
    headSha: plan.lane.headSha,
    leaseId: plan.mutationLease.leaseId,
    ownerId: plan.mutationLease.ownerId,
    mergeCommitSha: plan.mergeEvidence.mergeCommitSha,
    mergedAtUtc: plan.mergeEvidence.mergedAt,
    releaseOnlyExactLease: true,
    mergeAuthority: false,
  });
  const receipt = freeze({
    ...createSharedWorkspaceReceiptRecord({
      receiptId: evidenceId,
      participantId: 'terminal-lane-finalizer',
      timestampUtc,
      correlationId: plan.mutationLease.leaseId,
      relatedIssue: `#${plan.lane.issueNumber}`,
      relatedPr: `#${plan.lane.prNumber}`,
      receivedRecordId: evidenceId,
      disposition: 'terminal-evidence-published',
      summary: `Terminal evidence published for ${plan.lane.laneId}; release is limited to ${plan.mutationLease.leaseId}.`,
      proofRefs: [proofRef],
    }),
    schema: TERMINAL_LANE_FINALIZATION_SCHEMA,
    laneId: plan.lane.laneId,
    repository: plan.lane.repository,
    issueNumber: plan.lane.issueNumber,
    prNumber: plan.lane.prNumber,
    branch: plan.lane.branch,
    headSha: plan.lane.headSha,
    leaseId: plan.mutationLease.leaseId,
    ownerId: plan.mutationLease.ownerId,
    releaseOnlyExactLease: true,
    schedulesWork: false,
    dispatchesWork: false,
    mergeAuthority: false,
  });
  return freeze({ evidenceId, proofRef, proof, receipt });
}
