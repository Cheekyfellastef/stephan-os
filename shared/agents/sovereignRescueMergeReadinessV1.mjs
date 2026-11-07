// Read-only preparation for the existing protected merge workflow. Input data
// cannot authenticate itself; this module grants no dispatch or merge authority.
import { createHash } from 'node:crypto';
import {
  INDEPENDENT_REVIEW_ARTIFACT_FILE,
  INDEPENDENT_REVIEW_ARTIFACT_SPECIALIST_SCHEMA_VERSION,
  validateIndependentReviewArtifact,
  validateIndependentReviewArtifactSet,
} from './operatorMergeReviewArtifactV1.mjs';
import { validateIndependentReviewWorkflowRun } from './operatorMergeApprovalGate.mjs';
import {
  extractPersonalRepositoryArtifactZip,
  validatePersonalRepositoryReadOnlyPriorFailure,
} from './operatorPersonalRepositoryMergeV1.mjs';
import { validateProtectedMergeCheckRows } from './protectedMergeCheckClassifierV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
// Only this immutable, read-only parent source is eligible for a plain v1
// review. Every other Rescue Island head is conservatively high risk.
const REVIEWED_READ_ONLY_PARENT = Object.freeze({
  number: 3104,
  head: '4637edd199611659f434c4e142231f9f634b4efc',
});
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const stringSha = value => typeof value === 'string' && SHA.test(value);
const uniqueIds = items => items.every(item => typeof item?.id === 'string' && item.id)
  && new Set(items.map(item => item.id)).size === items.length;
const inventory = (value, cap) => value && typeof value === 'object'
  && value.hasMore === false && Array.isArray(value.items)
  && Number.isSafeInteger(value.totalCount) && value.totalCount === value.items.length
  && value.items.length <= cap;

export function inspectSovereignRescueMergeReadinessV1(input = {}) {
  const blockers = [];
  const pr = input.pullRequest || {};
  const head = pr.head?.sha;
  const base = input.mainHead;
  const now = typeof input.nowUtc === 'string' ? Date.parse(input.nowUtc) : NaN;
  const seen = typeof input.observedAtUtc === 'string' ? Date.parse(input.observedAtUtc) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(seen) || seen > now || now - seen > 90_000)
    blockers.push('FRESH_PRIMARY_OBSERVATIONS_REQUIRED');
  if (input.repository !== REPOSITORY || !Number.isSafeInteger(pr.number) || pr.number < 1
      || typeof pr.title !== 'string' || !pr.title.trim()
      || pr.head?.repo?.full_name !== REPOSITORY || pr.base?.repo?.full_name !== REPOSITORY
      || typeof pr.head?.ref !== 'string' || !pr.head.ref || pr.head.ref === 'main'
      || !stringSha(head) || !stringSha(base) || head === base)
    blockers.push('EXACT_REPOSITORY_PR_AND_HEAD_REQUIRED');
  if (pr.base?.ref !== 'main' || pr.base?.sha !== base)
    blockers.push('REQUALIFY_AGAINST_CURRENT_MAIN_REQUIRED');
  if (pr.state !== 'open' || pr.merged !== false || pr.draft !== false
      || pr.mergeable !== true || !['clean', 'unstable'].includes(pr.mergeable_state))
    blockers.push('LIVE_MERGEABILITY_UNPROVEN');
  if (!inventory(input.threads, 200)
      || !uniqueIds(input.threads.items)
      || input.threads.items.some(t => typeof t?.id !== 'string' || !t.id || t.is_resolved !== true))
    blockers.push('COMPLETE_RESOLVED_TECHNICAL_THREADS_REQUIRED');
  if (!Array.isArray(input.checkRows) || input.checkRows.some(c => c?.sourceHead !== head)
      || !validateProtectedMergeCheckRows(input.checkRows))
    blockers.push('CANONICAL_EXACT_HEAD_CI_REQUIRED');

  const artifact = input.reviewArtifact || {};
  const reviewOptions = {
    repository: REPOSITORY, prNumber: pr.number, branch: pr.head?.ref,
    expectedHead: head, expectedBaseSha: base,
    workflowRunId: artifact.workflowRunId, workflowRunAttempt: artifact.workflowRunAttempt,
  };
  const metadata = validateIndependentReviewArtifactSet(input.reviewArtifactMetadata || {}, reviewOptions);
  // API metadata is not the archive. The caller must separately obtain the
  // actual ZIP bytes from the canonical run and prove its SHA-256 and payload.
  let archivedArtifact = null;
  const bytes = input.reviewArchiveBytes;
  const archiveValid = (Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)
    && bytes.length > 0 && bytes.length <= 256 * 1024
    && metadata.valid && bytes.length === metadata.sizeInBytes
    && SHA256.test(metadata.archiveDigest)
    && `sha256:${createHash('sha256').update(bytes).digest('hex')}` === metadata.archiveDigest;
  if (archiveValid) {
    try {
      archivedArtifact = JSON.parse(extractPersonalRepositoryArtifactZip(
        bytes, INDEPENDENT_REVIEW_ARTIFACT_FILE,
      ).toString('utf8'));
    } catch {
      // A malformed, truncated, or substituted archive is a hold, not proof.
    }
  }
  if (!archivedArtifact || archivedArtifact.payloadSha256 !== artifact.payloadSha256)
    blockers.push('DIGEST_VERIFIED_REVIEW_ARCHIVE_REQUIRED');
  const review = validateIndependentReviewArtifact(archivedArtifact || {}, reviewOptions);
  const suppliedReview = validateIndependentReviewArtifact(artifact, reviewOptions);
  if (!review.valid || !suppliedReview.valid
      || archivedArtifact?.reviewMode !== 'clean-independent' || !metadata.valid)
    blockers.push('EXACT_HEAD_BASE_CLEAN_REVIEW_ARTIFACT_REQUIRED');

  // The immutable artifact must also belong to a successful, exact PR-bound
  // workflow run and its successful specialist-review job. Never infer this
  // merely from a valid artifact created before a workflow subsequently failed.
  const jobInventory = input.reviewWorkflowJobsInventory;
  const workflow = validateIndependentReviewWorkflowRun(
    input.reviewWorkflowRun || {}, inventory(jobInventory, 100) ? jobInventory.items : [], {
      repository: REPOSITORY,
      prNumber: pr.number,
      expectedHead: head,
      expectedBranch: pr.head?.ref,
      expectedBaseBranch: 'main',
      expectedBaseSha: base,
      expectedWorkflowId: input.reviewWorkflowId,
      workflowRunId: artifact.workflowRunId,
      workflowRunAttempt: artifact.workflowRunAttempt,
    },
  );
  if (!inventory(jobInventory, 100) || !workflow.valid)
    blockers.push('EXACT_SUCCESSFUL_REVIEW_RUN_AND_JOBS_REQUIRED');

  const knownReadOnlyParent = pr.number === REVIEWED_READ_ONLY_PARENT.number
    && head === REVIEWED_READ_ONLY_PARENT.head;
  if (!knownReadOnlyParent
    && (archivedArtifact?.schemaVersion !== INDEPENDENT_REVIEW_ARTIFACT_SPECIALIST_SCHEMA_VERSION
      || review.specialist?.valid !== true)) {
    blockers.push('QUALIFIED_SPECIALIST_REVIEW_REQUIRED');
  }

  if (!inventory(input.priorRuns, 200) || !Array.isArray(input.priorJobSets)
      || input.priorJobSets.length > 8) {
    blockers.push('COMPLETE_PROTECTED_ATTEMPT_HISTORY_REQUIRED');
  } else {
    const title = `Protected operator merge ${head}`;
    for (const run of input.priorRuns.items) {
      if (run?.display_title !== title && run?.name !== title) continue;
      if (!Number.isSafeInteger(run.id) || run.id < 1 || run.run_attempt !== 1
          || run.repository?.full_name !== REPOSITORY || run.event !== 'workflow_dispatch'
          || run.head_branch !== 'main' || !stringSha(run.head_sha)
          || run.path !== `${REPOSITORY}/.github/workflows/operator-merge-approval-gate.yml@refs/heads/main`
          || run.display_title !== title || run.name !== title) {
        blockers.push('PRIOR_PROTECTED_ATTEMPT_IDENTITY_UNPROVEN');
        continue;
      }
      if (run.status !== 'completed') {
        blockers.push('MATCHING_PROTECTED_ATTEMPT_STILL_ACTIVE');
        continue;
      }
      if (run.conclusion !== 'failure') {
        blockers.push('MATCHING_PROTECTED_ATTEMPT_NOT_A_FAILED_RUN');
        continue;
      }
      // The existing protected gate owns different-base continuation. A new
      // base still requires new source ancestry, CI, review and authorization.
      if (run.head_sha !== base) continue;
      const sets = input.priorJobSets.filter(s => s?.runId === run.id);
      if (sets.length !== 1 || !validatePersonalRepositoryReadOnlyPriorFailure(run, sets[0].jobs).valid)
        blockers.push('SAME_BASE_PROTECTED_REPLAY_HELD');
    }
  }
  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-rescue-merge-readiness.v1',
    verdict: blockers.length ? 'HELD' : 'STRUCTURALLY_READY_FOR_PROTECTED_REVALIDATION',
    blockers: Object.freeze([...new Set(blockers)]),
    readOnly: true, observationsAuthenticated: false,
    dispatchAllowed: false, mergeAllowed: false, runtimeMutationAllowed: false,
    reviewThreadResolutionAllowed: false, leaseAccessAllowed: false,
    productionIslandCommissioningAllowed: false,
  });
}
