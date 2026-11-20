// Original #1802 / #2961: pure, fail-closed classification for an accidental
// draft-state interleave during a protected one-use READY review. This helper
// does NOT dispatch a review, change a PR, approve a merge or mint an owner grant.
export const READY_REVIEW_RECOVERY_SCHEMA = 'stephanos.protected-ready-review-recovery.v1';
export const READY_REVIEW_DRAFT_INTERLEAVE_CODE = 'CURRENT_PR_HEAD_TREE_BASE_OR_DRAFT_CHANGED';
export const READY_REVIEW_RECOVERY_STEP = 'Review ready head with the unchanged engine and qualified escalation';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAILBOX_ISSUE = 3258;
const OPERATOR = 'Cheekyfellastef';
const MAX_AUTHOR_WINDOW_MS = 10 * 60 * 1000;

function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}
const integer = n => Number.isSafeInteger(n) && n > 0;
const sha = s => typeof s === 'string' && SHA40.test(s);
const digest = s => typeof s === 'string' && SHA256.test(s);
const own = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);
function refusal(code) {
  return Object.freeze({ schemaVersion: READY_REVIEW_RECOVERY_SCHEMA,
    ok: false, blocker: 'READY_REVIEW_RECOVERY_' + code, priorRunId: 0,
    reviewLaunchAllowed: false, sourceMutationAllowed: false,
    reviewApprovalGranted: false, mergeAuthority: false });
}

/**
 * A deliberately narrow source-owner preflight. All inputs must be separately
 * authenticated GitHub readbacks, not a caller's claim or a copied issue body.
 * It is NOT sufficient for the actual publisher: the existing protected runtime
 * must also authenticate full prior-run logs, one-use owner grant and a final
 * current-head/lease check before any single dispatch.
 */
export function classifyProtectedReadyReviewDraftRecoveryV1({
  identity, currentPr, mainSha, priorRuns, priorJob, priorFailure,
  timeline, ownerComment, nowUtc,
} = {}) {
  if (!identity || identity.repository !== REPOSITORY || !integer(identity.prNumber)
    || !sha(identity.sourceHead) || !sha(identity.sourceTree) || !sha(identity.baseSha)
    || typeof identity.branch !== 'string' || !/^[A-Za-z0-9][\w./-]{0,239}$/.test(identity.branch))
    return refusal('IDENTITY_INVALID');
  if (!currentPr || currentPr.state !== 'open' || currentPr.draft !== false
    || currentPr.merged !== false || currentPr.number !== identity.prNumber
    || currentPr.repository !== REPOSITORY || currentPr.branch !== identity.branch
    || currentPr.headSha !== identity.sourceHead || currentPr.headTree !== identity.sourceTree
    || currentPr.baseSha !== identity.baseSha || mainSha !== identity.baseSha)
    return refusal('CURRENT_SOURCE_OR_READY_UNPROVEN');
  if (!Array.isArray(priorRuns) || priorRuns.length !== 1)
    return refusal('EXACT_TUPLE_RUN_COUNT_UNSAFE');
  const prior = priorRuns[0];
  if (!prior || !integer(prior.id) || prior.repository !== REPOSITORY
    || prior.prNumber !== identity.prNumber || prior.sourceHead !== identity.sourceHead
    || prior.baseSha !== identity.baseSha || prior.status !== 'completed'
    || prior.conclusion !== 'failure' || prior.runAttempt !== 1
    || !Number.isFinite(time(prior.startedAtUtc)) || !Number.isFinite(time(prior.completedAtUtc))
    || time(prior.startedAtUtc) > time(prior.completedAtUtc))
    return refusal('PRIOR_TERMINAL_FAILURE_UNPROVEN');
  if (!priorJob || !integer(priorJob.id) || priorJob.runId !== prior.id || priorJob.runAttempt !== 1
    || priorJob.name !== 'exact-head-review' || priorJob.status !== 'completed'
    || priorJob.conclusion !== 'failure' || !Array.isArray(priorJob.steps)
    || priorJob.steps.filter(step => step.conclusion === 'failure').length !== 1
    || priorJob.steps.find(step => step.conclusion === 'failure')?.name !== READY_REVIEW_RECOVERY_STEP)
    return refusal('PRIOR_FAILED_STEP_UNPROVEN');
  // A typed failure is required from the authenticated original job log, never
  // accepted from a mutable issue comment or a caller-supplied inference.
  if (!priorFailure || priorFailure.jobId !== priorJob.id || priorFailure.runId !== prior.id
    || priorFailure.source !== 'authenticated-github-job-log'
    || priorFailure.code !== READY_REVIEW_DRAFT_INTERLEAVE_CODE)
    return refusal('EXACT_DRAFT_FAILURE_UNPROVEN');
  // Require the complete observed READY -> accidental DRAFT -> restored READY
  // sequence. A caller must not hide the first READY by projecting only two
  // convenient events from the authenticated GitHub issue timeline.
  if (!Array.isArray(timeline) || timeline.length !== 3)
    return refusal('DRAFT_RESTORATION_EVENTS_UNPROVEN');
  const [originalReady, draft, ready] = timeline;
  const firstReadyAt = time(originalReady?.createdAtUtc);
  const draftAt = time(draft?.createdAtUtc);
  const restoredAt = time(ready?.createdAtUtc);
  if (!originalReady || originalReady.event !== 'ready_for_review' || !integer(originalReady.id)
    || originalReady.actor !== 'github-actions[bot]'
    || !Number.isFinite(firstReadyAt) || firstReadyAt >= time(prior.startedAtUtc)
    || !draft || draft.event !== 'convert_to_draft' || !integer(draft.id)
    || draft.id === originalReady.id || draft.actor !== OPERATOR || !Number.isFinite(draftAt)
    || draftAt < time(prior.startedAtUtc) || draftAt > time(prior.completedAtUtc)
    || !ready || ready.event !== 'ready_for_review' || !integer(ready.id)
    || ready.id === originalReady.id || ready.id === draft.id || ready.actor !== 'github-actions[bot]'
    || !Number.isFinite(restoredAt) || restoredAt <= time(prior.completedAtUtc))
    return refusal('DRAFT_RESTORATION_EVENTS_UNPROVEN');
  const authored = time(ownerComment?.createdAtUtc), expiry = time(ownerComment?.expiresAtUtc), now = time(nowUtc);
  if (!ownerComment || ownerComment.author !== OPERATOR || ownerComment.issueNumber !== MAILBOX_ISSUE
    || ownerComment.operation !== 'MARK_PROTECTED_PR_READY' || ownerComment.scope !== 'review-recovery-only'
    || ownerComment.prNumber !== identity.prNumber || ownerComment.headSha !== identity.sourceHead
    || ownerComment.treeSha !== identity.sourceTree || ownerComment.baseSha !== identity.baseSha
    || !integer(ownerComment.id) || !digest(ownerComment.bodySha256)
    || !Number.isFinite(authored) || !Number.isFinite(expiry) || !Number.isFinite(now)
    || authored <= time(ready.createdAtUtc) || authored >= expiry
    || expiry - authored > MAX_AUTHOR_WINDOW_MS || now < authored || now >= expiry)
    return refusal('FRESH_OWNER_RECOVERY_AUTHORITY_UNPROVEN');
  return Object.freeze({ schemaVersion: READY_REVIEW_RECOVERY_SCHEMA,
    ok: true, blocker: '', priorRunId: prior.id, reviewLaunchAllowed: true,
    sourceMutationAllowed: false, reviewApprovalGranted: false, mergeAuthority: false });
}


/**
 * Source-owned read-only adapter for ACTUAL GitHub REST provenance. A trusted
 * transport must supply complete bounded lists and the authenticated job log.
 * The returned eligibility is evidence for future QUALIFIED source admission,
 * NEVER permission to dispatch or approve a second one-use review.
 */
export function classifyProtectedReadyReviewGitHubReadbackV1({
  identity, pull, main, commit, workflow, runs, runInventoryTotalCount,
  job, log, events, eventInventoryTotalCount,
  ownerComment = null, nowUtc,
} = {}) {
  const held = code => Object.freeze({
    ...refusal(code), eligibleForOwnerQualifiedRecovery: false,
    readOnly: true,
  });
  try {
    if (!identity || identity.repository !== REPOSITORY || !integer(identity.prNumber)
      || !sha(identity.sourceHead) || !sha(identity.sourceTree) || !sha(identity.baseSha)
      || !pull || pull.number !== identity.prNumber || pull.state !== 'open'
      || pull.merged !== false || pull.draft !== false
      || pull.head?.repo?.full_name !== REPOSITORY || pull.base?.repo?.full_name !== REPOSITORY
      || pull.head.ref !== identity.branch || pull.head.sha !== identity.sourceHead
      || pull.base.ref !== 'main' || pull.base.sha !== identity.baseSha
      || main?.object?.sha !== identity.baseSha
      || commit?.sha !== identity.sourceHead || commit.tree?.sha !== identity.sourceTree)
      return held('GITHUB_SOURCE_NOT_PROVEN');
    if (!workflow || !integer(workflow.id)
      || workflow.path !== '.github/workflows/stephanos-exact-head-review.yml'
      || workflow.name !== 'Stephanos Exact-Head Review' || workflow.state !== 'active'
      || !Array.isArray(runs) || !integer(runInventoryTotalCount)
      || runInventoryTotalCount !== runs.length || runInventoryTotalCount > 600)
      return held('GITHUB_RUN_INVENTORY_UNPROVEN');
    const allNames = /^protected-ready-review-pr-([1-9][0-9]*)-head-([a-f0-9]{40})-ready-([1-9][0-9]*)-binding-([a-f0-9]{64})$/;
    const matched = [], seenRuns = new Set();
    for (const candidate of runs) {
      const name = allNames.exec(String(candidate?.display_title || ''));
      if (!integer(candidate?.id) || seenRuns.has(candidate.id) || !name
        || candidate.workflow_id !== workflow.id || candidate.path !== workflow.path
        || candidate.event !== 'workflow_dispatch' || candidate.head_sha !== identity.baseSha)
        return held('GITHUB_RUN_INVENTORY_UNPROVEN');
      seenRuns.add(candidate.id);
      if (Number(name[1]) === identity.prNumber && name[2] === identity.sourceHead)
        matched.push(candidate);
    }
    if (matched.length !== 1) return held('GITHUB_RUN_INVENTORY_UNPROVEN');
    const run = matched[0];
    const ownerActor = actor => (actor?.login === OPERATOR && actor?.id === 267490109)
      || (actor?.login === 'github-actions[bot]' && actor?.id === 41898282);
    if (!integer(run?.id) || run.workflow_id !== workflow.id
      || run.event !== 'workflow_dispatch' || run.path !== workflow.path
      || run.head_sha !== identity.baseSha || run.head_branch !== 'main'
      || run.repository?.full_name !== REPOSITORY
      || run.head_repository?.full_name !== REPOSITORY
      || !ownerActor(run.actor) || !ownerActor(run.triggering_actor)
      || run.run_attempt !== 1 || run.status !== 'completed'
      || run.conclusion !== 'failure' || !Number.isFinite(time(run.run_started_at)))
      return held('GITHUB_PRIOR_RUN_UNPROVEN');
    if (!job || !integer(job.id) || job.run_id !== run.id
      || job.run_attempt !== 1 || job.name !== 'exact-head-review'
      || job.status !== 'completed' || job.conclusion !== 'failure'
      || !Number.isFinite(time(job.started_at)) || !Number.isFinite(time(job.completed_at))
      || time(job.started_at) < time(run.run_started_at)
      || time(job.completed_at) < time(job.started_at)
      || !Array.isArray(job.steps) || job.steps.length === 0)
      return held('GITHUB_PRIOR_JOB_UNPROVEN');
    if (typeof log !== 'string' || log.length === 0 || log.length > 250000)
      return held('GITHUB_JOB_LOG_UNPROVEN');
    const codes = [...log.matchAll(/PROTECTED_READY_REVIEW_BLOCKED:([A-Z_]+)/g)];
    if (codes.length !== 1 || codes[0][1] !== READY_REVIEW_DRAFT_INTERLEAVE_CODE)
      return held('GITHUB_TERMINAL_FAILURE_UNPROVEN');
    if (!Array.isArray(events) || !integer(eventInventoryTotalCount)
      || events.length !== eventInventoryTotalCount || events.length > 600)
      return held('GITHUB_TIMELINE_UNPROVEN');
    const ids = new Set(), timeline = [];
    for (const event of events) {
      if (!integer(event?.id) || ids.has(event.id)) return held('GITHUB_TIMELINE_UNPROVEN');
      ids.add(event.id);
      if (event.event === 'ready_for_review' || event.event === 'convert_to_draft') {
        if (!ownerActor(event.actor) || !Number.isFinite(time(event.created_at)))
          return held('GITHUB_TIMELINE_UNPROVEN');
        timeline.push({ id: event.id, event: event.event,
          actor: event.actor.login, createdAtUtc: event.created_at });
      }
    }
    // Unknown, partial or duplicated READY history is refused by the original
    // three-event classifier; this layer never projects a convenient subset.
    if (timeline.length !== 3) return held('GITHUB_TIMELINE_UNPROVEN');
    // Raw owner data must be authenticated, expiry-checked and digest-bound by
    // the original protected mailbox transport before being supplied here.
    // An object with matching fields alone can never dispatch a review.
    const result = classifyProtectedReadyReviewDraftRecoveryV1({
      identity, currentPr: { repository: REPOSITORY, number: pull.number,
        state: pull.state, draft: pull.draft, merged: pull.merged,
        branch: pull.head.ref, headSha: pull.head.sha, headTree: commit.tree.sha,
        baseSha: pull.base.sha }, mainSha: main.object.sha,
      priorRuns: [{ id: run.id, repository: REPOSITORY, prNumber: identity.prNumber,
        sourceHead: identity.sourceHead, baseSha: identity.baseSha,
        status: run.status, conclusion: run.conclusion, runAttempt: run.run_attempt,
        startedAtUtc: run.run_started_at, completedAtUtc: job.completed_at }],
      priorJob: { id: job.id, runId: job.run_id, runAttempt: job.run_attempt,
        name: job.name, status: job.status, conclusion: job.conclusion,
        steps: job.steps.map(step => ({ name: step.name, conclusion: step.conclusion })) },
      priorFailure: { source: 'authenticated-github-job-log',
        jobId: job.id, runId: run.id, code: codes[0][1] },
      timeline, ownerComment, nowUtc,
    });
    return Object.freeze({ ...result,
      eligibleForOwnerQualifiedRecovery: result.ok,
      readOnly: true, reviewLaunchAllowed: false,
      sourceMutationAllowed: false, reviewApprovalGranted: false,
      mergeAuthority: false });
  } catch {
    return held('GITHUB_EVIDENCE_INVALID');
  }
}
