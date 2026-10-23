import { createHash } from 'node:crypto';

export const SEED_PARALLEL_AUTHORITY_SCHEMA = 'stephanos.seed-parallel-exact-task-approval.v1';
const text = (value) => typeof value === 'string' ? value.trim() : '';
const safeTask = (value) => /^[a-z0-9][a-z0-9-]{2,79}$/.test(text(value));
const safeHash = (value) => /^[a-f0-9]{64}$/.test(text(value));
const safeCommit = (value) => /^[a-f0-9]{40}$/.test(text(value));
const safeUtc = (value) => {
  const t = Date.parse(value);
  return Number.isFinite(t) && new Date(t).toISOString() === value;
};

export function parallelSeedManifestHashV1(rawBytes) {
  if (typeof rawBytes !== 'string' || !rawBytes || Buffer.byteLength(rawBytes) > 16384)
    throw new Error('INVALID_OR_UNBOUNDED_MANIFEST_BYTES');
  return createHash('sha256').update(rawBytes).digest('hex');
}

// This authorization must be issued by the operator on the local computer, not by a seed agent.
// A hash of the exact request prevents subsequent proposal or scope substitution.
export function makeParallelSeedExactApprovalV1({ request, manifestSha256, nowUtc, expiryUtc }) {
  if (!safeTask(request?.taskId) || !safeHash(manifestSha256)
    || !safeUtc(nowUtc) || !safeUtc(expiryUtc))
    throw new Error('INVALID_EXACT_TASK_APPROVAL_FIELDS');
  const issued = Date.parse(nowUtc), expires = Date.parse(expiryUtc);
  if (expires <= issued || expires - issued > 24 * 3600 * 1000)
    throw new Error('APPROVAL_WINDOW_TOO_WIDE');
  return Object.freeze({
    schemaVersion: SEED_PARALLEL_AUTHORITY_SCHEMA,
    taskId: request.taskId,
    seedId: request.seedId,
    ownerIssue: request.ownerIssue,
    targetPath: request.targetPath,
    baseSha: request.baseSha,
    manifestSha256,
    issuedAtUtc: nowUtc,
    expiresAtUtc: expiryUtc,
    mode: 'ONE_EXACT_ISOLATED_SOURCE_PROPOSAL',
    grant: 'NO_MERGE_NO_DEPLOY_NO_RUNTIME_MUTATION',
  });
}

export function evaluateParallelSeedExactApprovalV1({ request, manifestSha256, approval, nowMs }) {
  const problems = [];
  if (approval?.schemaVersion !== SEED_PARALLEL_AUTHORITY_SCHEMA
    || approval?.mode !== 'ONE_EXACT_ISOLATED_SOURCE_PROPOSAL'
    || approval?.grant !== 'NO_MERGE_NO_DEPLOY_NO_RUNTIME_MUTATION')
    problems.push('AUTHORITY_SCHEMA_MISMATCH');
  for (const key of ['taskId', 'seedId', 'ownerIssue', 'targetPath', 'baseSha']) {
    if (approval?.[key] !== request?.[key]) problems.push('AUTHORITY_' + key.toUpperCase() + '_MISMATCH');
  }
  if (!safeHash(manifestSha256) || approval?.manifestSha256 !== manifestSha256)
    problems.push('MANIFEST_HASH_MISMATCH');
  const issued = Date.parse(approval?.issuedAtUtc), expires = Date.parse(approval?.expiresAtUtc);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || !Number.isFinite(nowMs)
    || issued > nowMs || expires <= nowMs || expires <= issued
    || expires - issued > 86400000) problems.push('APPROVAL_EXPIRED_OR_INVALID');
  return Object.freeze({ ok: problems.length === 0, reasons: Object.freeze(problems) });
}

// Authenticate source-path custody across task IDs before selecting a writer.
// An unapproved, unclaimed inbox row must not starve unrelated safe work.
function conflictingParallelSeedTargetsV1(candidates, nowMs) {
  const ownersByPath = new Map();
  for (const entry of Array.isArray(candidates) ? candidates : []) {
    const id = entry?.request?.taskId;
    const path = entry?.request?.targetPath;
    if (!safeTask(id) || typeof path !== 'string' || !path) continue;
    if (!entry.existingClaim && !entry.existingReceipt
      && !evaluateParallelSeedExactApprovalV1({ ...entry, nowMs }).ok) continue;
    if (!ownersByPath.has(path)) ownersByPath.set(path, new Set());
    ownersByPath.get(path).add(id);
  }
  return new Set([...ownersByPath].filter(([, owners]) => owners.size > 1)
    .map(([path]) => path));
}

export function selectParallelSeedApprovedTaskV1(candidates, nowMs,
  conflictingTargets = conflictingParallelSeedTargetsV1(candidates, nowMs)) {
  // Independent short batch selection: one eligible task, never a global lease.
  // All entries are pre-parsed exact manifest/approval combinations.
  const eligible = [];
  const blocked = [];
  // A malformed persisted inbox row must not crash selection and suppress a
  // completely separate approved seed. Duplicate task IDs are ambiguous
  // custody, never an invitation to choose one version of the manifest.
  const entries = Array.isArray(candidates) ? candidates : [];
  const ids = new Map();
  for (const entry of entries) {
    const id = entry?.request?.taskId;
    if (safeTask(id)) ids.set(id, (ids.get(id) || 0) + 1);
  }
  for (const entry of entries) {
    const taskId = safeTask(entry?.request?.taskId) ? entry.request.taskId : '';
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || !entry.request || typeof entry.request !== 'object' || Array.isArray(entry.request)
        || !taskId) {
      blocked.push({ taskId, reason: 'INVALID_INBOX_TASK_ENVELOPE' });
      continue;
    }
    if (ids.get(taskId) > 1) {
      blocked.push({ taskId, reason: 'DUPLICATE_TASK_ID_OWNERSHIP_AMBIGUOUS' });
      continue;
    }
    const verdict = evaluateParallelSeedExactApprovalV1({ ...entry, nowMs });
    if (conflictingTargets.has(entry.request.targetPath))
      blocked.push({ taskId, reason: 'RESOURCE_PATH_OWNERSHIP_AMBIGUOUS' });
    else if (entry.existingClaim || entry.existingReceipt)
      blocked.push({ taskId, reason: 'PRESERVED_SOURCE_CUSTODY' });
    else if (!verdict.ok)
      blocked.push({ taskId, reason: verdict.reasons.join(',') });
    else eligible.push(entry);
  }
  eligible.sort((a, b) => (a.request.taskId < b.request.taskId ? -1 : 1));
  return Object.freeze({
    selected: eligible[0] || null,
    eligibleCount: eligible.length,
    blocked: Object.freeze(blocked),
    selectionTruth: eligible.length ? 'EXACT_MANIFEST_APPROVED' : 'NO_ELIGIBLE_PROVEN_TASK',
  });
}

// Source-only bounded fail-forward selection for separately approved inventory
// tasks. A blocked task may not monopolise the next invocation. The caller
// tracks attempted IDs across this *one* operator-invoked bounded batch; no
// original conveyor lease, model access or new scheduler is implied.
export function selectParallelSeedInventoryBatchTaskV1(candidates, nowMs, attemptedTaskIds = []) {
  const attempted = new Set(Array.isArray(attemptedTaskIds) ? attemptedTaskIds : []);
  const inventory = Array.isArray(candidates)
    ? candidates.filter((entry) => entry?.request?.generationMode === 'CANONICAL_INVENTORY_V1'
        && !attempted.has(entry?.request?.taskId))
    : [];
  // Preserve custody from other modes and already attempted tasks when
  // selecting a deterministic-only source inventory batch.
  return selectParallelSeedApprovedTaskV1(inventory, nowMs,
    conflictingParallelSeedTargetsV1(candidates, nowMs));
}

export function projectParallelSeedReceiptStatusV1(claims = [], receipts = [], nowMs = Date.now()) {
  // A duplicate task/receipt identity cannot select a winner by array order.
  // Park only the ambiguous task; retain visibility of independent candidates.
  const safeClaims = Array.isArray(claims) ? claims : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];
  const countByTask = (items) => {
    const counts = new Map();
    for (const item of items) {
      if (safeTask(item?.taskId)) counts.set(item.taskId, (counts.get(item.taskId) || 0) + 1);
    }
    return counts;
  };
  const claimCounts = countByTask(safeClaims);
  const receiptCounts = countByTask(safeReceipts);
  const receiptsByTask = new Map(safeReceipts.filter((r) => safeTask(r?.taskId)
    && receiptCounts.get(r.taskId) === 1).map((r) => [r.taskId, r]));
  const tasks = [];
  for (const claim of safeClaims) {
    if (!safeTask(claim?.taskId)) continue;
    const ambiguous = claimCounts.get(claim.taskId) > 1 || (receiptCounts.get(claim.taskId) || 0) > 1;
    const receipt = ambiguous ? null : receiptsByTask.get(claim.taskId);
    const timestamp = Date.parse(receipt?.recordedAtUtc || claim?.createdAtUtc);
    const stale = ambiguous || !Number.isFinite(timestamp) || timestamp > nowMs || nowMs - timestamp > 2 * 3600 * 1000;
    tasks.push(Object.freeze({
      taskId: claim.taskId,
      seedId: claim.seedId,
      targetPath: claim.targetPath,
      stage: ambiguous ? 'AMBIGUOUS_SOURCE_CUSTODY' : receipt?.stage || 'CLAIM_ONLY_UNKNOWN',
      sourceTruth: stale ? 'STALE_OR_UNKNOWN' : 'CURRENT',
      // Local Git readback is observable and useful for diagnosis, but the
      // receipt and candidate branch are both mutable by the same account.
      // Neither can authenticate its own author/physical worker identity.
      localCommitReadbackMatched: Boolean(receipt?.stage === 'COMMITTED'
        && safeCommit(receipt?.commitSha) && receipt?.independentGitHeadVerified === true),
      candidateCommitted: false,
      candidateTrustBlocker: 'INDEPENDENT_CANDIDATE_PROVENANCE_NOT_COMMISSIONED',
      merged: false,
      deployed: false,
      requiresReview: true,
      recovery: ambiguous || (stale && receipt?.stage !== 'COMMITTED')
        ? 'INSPECT_TASK_WORKTREE_NO_AUTO_RELEASE' : 'NONE',
    }));
  }
  return Object.freeze({
    schemaVersion: 'stephanos.seed-parallel-supervisor-status.v1',
    taskCount: tasks.length,
    tasks: Object.freeze(tasks),
    doesNotDependOnCanonicalConveyor: true,
    // A Git readback and its receipt belong to the SAME local mutation
    // boundary. Until a distinct, protected host reviewer signs candidate
    // provenance, no local file can upgrade this signal to independently proven.
    localCommitReadbackMatchedUntrusted: tasks.some((task) =>
      task.localCommitReadbackMatched && task.sourceTruth === 'CURRENT'),
    localSourceCandidateProven: false,
    candidateTrustBlocker: 'INDEPENDENT_CANDIDATE_PROVENANCE_NOT_COMMISSIONED',
    liveBuildProven: false,
  });
}
