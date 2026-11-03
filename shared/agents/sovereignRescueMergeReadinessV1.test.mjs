import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { inspectSovereignRescueMergeReadinessV1 as inspect } from './sovereignRescueMergeReadinessV1.mjs';
import { buildIndependentReviewArtifact } from './operatorMergeReviewArtifactV1.mjs';
import { PROTECTED_MERGE_REQUIRED_WORKFLOWS } from './protectedMergeCheckClassifierV1.mjs';

const repo = 'Cheekyfellastef/stephan-os';
const head = '4637edd199611659f434c4e142231f9f634b4efc', base = 'b'.repeat(40), now = '2026-10-14T10:00:00.000Z';
const crcTable = Array.from({ length: 256 }, (_, initial) => {
  let crc = initial;
  for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function storedReviewZip(payload) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const name = Buffer.from('independent-review-result.json');
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(10, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4);
  central.writeUInt16LE(10, 6); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28); name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + data.length, 16);
  return Buffer.concat([local, data, central, end]);
}
const fixture = () => {
  const reviewArtifact = buildIndependentReviewArtifact({ repository: repo, prNumber: 3104,
    branch: 'rescue-island/preflight-v1-3103', sourceHead: head, baseSha: base,
    workflowRunId: 100, workflowRunAttempt: 1, createdAtUtc: now,
    analysis: { findings: [], counts: { P0: 0, P1: 0, P2: 0 }, verdict: 'clean',
      proofRefs: ['proofs/diff/complete'], finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_CLEAN' } });
  const reviewArchiveBytes = storedReviewZip(reviewArtifact);
  const reviewArchiveDigest = `sha256:${createHash('sha256').update(reviewArchiveBytes).digest('hex')}`;
  return { repository: repo, nowUtc: now, observedAtUtc: now, mainHead: base,
    pullRequest: { number: 3104, title: 'Rescue Island preflight', state: 'open', merged: false,
      draft: false, mergeable: true, mergeable_state: 'unstable',
      head: { sha: head, ref: 'rescue-island/preflight-v1-3103', repo: { full_name: repo } },
      base: { sha: base, ref: 'main', repo: { full_name: repo } } },
    threads: { hasMore: false, totalCount: 1, items: [{ id: 'thread-1', is_resolved: true }] },
    checkRows: PROTECTED_MERGE_REQUIRED_WORKFLOWS.map(workflow => ({ workflow, name: 'proof', state: 'SUCCESS', sourceHead: head,
      ...(workflow === 'Build Stephanos UI' ? { event: 'pull_request' } : {}) })),
    reviewArchiveBytes,
    reviewWorkflowId: 101,
    reviewWorkflowRun: { id: 100, run_attempt: 1, workflow_id: 101,
      name: 'Independent Merge Security Review', display_title: 'Independent Merge Security Review',
      path: `${repo}/.github/workflows/independent-merge-security-review.yml@refs/heads/main`,
      event: 'pull_request_target', repository: { full_name: repo },
      status: 'completed', conclusion: 'success',
      pull_requests: [{ number: 3104, head: { sha: head, ref: 'rescue-island/preflight-v1-3103' },
        base: { sha: base, ref: 'main' } }] },
    reviewWorkflowJobsInventory: { hasMore: false, totalCount: 1, items: [
      { name: 'independent-security-review', run_attempt: 1, status: 'completed', conclusion: 'success' },
    ] },
    reviewArtifact, reviewArtifactMetadata: { total_count: 1, artifacts: [{ id: 200,
      name: reviewArtifact.artifactName, expired: false, size_in_bytes: reviewArchiveBytes.length,
      digest: reviewArchiveDigest, workflow_run: { id: 100 } }] },
    priorRuns: { hasMore: false, totalCount: 0, items: [] }, priorJobSets: [],
  };
};
const prior = (overrides = {}) => ({ id: 300, run_attempt: 1, repository: { full_name: repo },
  event: 'workflow_dispatch', head_branch: 'main', head_sha: base,
  path: `${repo}/.github/workflows/operator-merge-approval-gate.yml@refs/heads/main`,
  name: `Protected operator merge ${head}`, display_title: `Protected operator merge ${head}`,
  status: 'completed', conclusion: 'failure', ...overrides });
function withRun(run) { const x = fixture(); x.priorRuns = { hasMore: false, totalCount: 1, items: [run] }; return x; }
function held(input, blocker) { const r = inspect(input); assert.equal(r.verdict, 'HELD'); assert.ok(r.blockers.includes(blocker), r.blockers.join(',')); }

test('structural readiness never authenticates observations or grants any execution authority', () => {
  const r = inspect(fixture());
  assert.equal(r.verdict, 'STRUCTURALLY_READY_FOR_PROTECTED_REVALIDATION');
  for (const flag of ['observationsAuthenticated', 'dispatchAllowed', 'mergeAllowed',
    'runtimeMutationAllowed', 'reviewThreadResolutionAllowed', 'leaseAccessAllowed',
    'productionIslandCommissioningAllowed']) assert.equal(r[flag], false);
});
test('open, unknown or incomplete review thread inventories stop before dispatch', () => {
  for (const threads of [undefined, { hasMore: true, totalCount: 1, items: [] },
    { hasMore: false, totalCount: 2, items: [] },
    { hasMore: false, totalCount: 1, items: [{ id: 'thread-1', is_resolved: false }] }])
    held({ ...fixture(), threads }, 'COMPLETE_RESOLVED_TECHNICAL_THREADS_REQUIRED');
});
test('stacked child and stale base/evidence require fresh qualification', () => {
  const x = fixture(); x.pullRequest.base.ref = 'rescue-island/preflight-v1-3103';
  held(x, 'REQUALIFY_AGAINST_CURRENT_MAIN_REQUIRED');
  held({ ...fixture(), mainHead: 'd'.repeat(40) }, 'REQUALIFY_AGAINST_CURRENT_MAIN_REQUIRED');
  held({ ...fixture(), nowUtc: '2026-10-14T10:02:00.000Z' }, 'FRESH_PRIMARY_OBSERVATIONS_REQUIRED');
});
test('forged or other-head review artifacts, expired archives and non-green CI are held', () => {
  let x = fixture(); x.reviewArtifact = { ...x.reviewArtifact, sourceHead: 'd'.repeat(40) };
  held(x, 'EXACT_HEAD_BASE_CLEAN_REVIEW_ARTIFACT_REQUIRED');
  x = fixture(); x.reviewArtifactMetadata.artifacts[0].expired = true;
  held(x, 'EXACT_HEAD_BASE_CLEAN_REVIEW_ARTIFACT_REQUIRED');
  x = fixture(); x.checkRows[0].state = 'FAILURE';
  held(x, 'CANONICAL_EXACT_HEAD_CI_REQUIRED');
});
test('authority-stage same-base failure is held even after all threads become resolved', () => {
  const x = withRun(prior());
  x.priorJobSets = [{ runId: 300, jobs: [{ name: 'operator-personal-repository-squash-merge', conclusion: 'failure' }] }];
  held(x, 'SAME_BASE_PROTECTED_REPLAY_HELD');
});
test('active, completed-successful, rerun, malformed and omitted prior attempts cannot be hidden', () => {
  held(withRun(prior({ status: 'in_progress' })), 'MATCHING_PROTECTED_ATTEMPT_STILL_ACTIVE');
  held(withRun(prior({ conclusion: 'success' })), 'MATCHING_PROTECTED_ATTEMPT_NOT_A_FAILED_RUN');
  held(withRun(prior({ run_attempt: 2 })), 'PRIOR_PROTECTED_ATTEMPT_IDENTITY_UNPROVEN');
  held({ ...fixture(), priorRuns: { hasMore: true, totalCount: 0, items: [] } }, 'COMPLETE_PROTECTED_ATTEMPT_HISTORY_REQUIRED');
  held({ ...fixture(), priorJobSets: undefined }, 'COMPLETE_PROTECTED_ATTEMPT_HISTORY_REQUIRED');
  for (const path of [null, 3, ['wrong'], `${repo}/.github/workflows/operator-merge-approval-gate.yml@refs/heads/other`])
    held(withRun(prior({ path })), 'PRIOR_PROTECTED_ATTEMPT_IDENTITY_UNPROVEN');
});

test('duplicated thread identifiers cannot masquerade as a complete resolved inventory', () => {
  const x = fixture(); x.threads.items.push({ ...x.threads.items[0] }); x.threads.totalCount = 2;
  held(x, 'COMPLETE_RESOLVED_TECHNICAL_THREADS_REQUIRED');
});
test('different-base failed attempt uses existing continuation only after fresh review and CI', () => {
  const x = withRun(prior({ head_sha: 'd'.repeat(40) }));
  assert.equal(inspect(x).verdict, 'STRUCTURALLY_READY_FOR_PROTECTED_REVALIDATION');
  x.reviewArtifact = { ...x.reviewArtifact, baseSha: 'd'.repeat(40) };
  held(x, 'EXACT_HEAD_BASE_CLEAN_REVIEW_ARTIFACT_REQUIRED');
});

test('successful review artifact uploaded by a later-failing workflow is never sufficient', () => {
  const failed = fixture(); failed.reviewWorkflowRun.conclusion = 'failure';
  held(failed, 'EXACT_SUCCESSFUL_REVIEW_RUN_AND_JOBS_REQUIRED');
  const failedJob = fixture(); failedJob.reviewWorkflowJobsInventory.items[0].conclusion = 'failure';
  held(failedJob, 'EXACT_SUCCESSFUL_REVIEW_RUN_AND_JOBS_REQUIRED');
  const wrongRun = fixture(); wrongRun.reviewWorkflowRun.id = 999;
  held(wrongRun, 'EXACT_SUCCESSFUL_REVIEW_RUN_AND_JOBS_REQUIRED');
  const incomplete = fixture(); incomplete.reviewWorkflowJobsInventory.hasMore = true;
  held(incomplete, 'EXACT_SUCCESSFUL_REVIEW_RUN_AND_JOBS_REQUIRED');
});

test('review payload must be extracted from the exact digest-verified ZIP archive', () => {
  const absent = fixture(); delete absent.reviewArchiveBytes;
  held(absent, 'DIGEST_VERIFIED_REVIEW_ARCHIVE_REQUIRED');
  const substituted = fixture(); substituted.reviewArchiveBytes = Buffer.from(substituted.reviewArchiveBytes);
  substituted.reviewArchiveBytes[33] ^= 1;
  held(substituted, 'DIGEST_VERIFIED_REVIEW_ARCHIVE_REQUIRED');
  const otherPayload = fixture(); otherPayload.reviewArtifact = { ...otherPayload.reviewArtifact, payloadSha256: 'e'.repeat(64) };
  held(otherPayload, 'DIGEST_VERIFIED_REVIEW_ARCHIVE_REQUIRED');
  const alteredMetadata = fixture(); alteredMetadata.reviewArtifactMetadata.artifacts[0].digest = `sha256:${'f'.repeat(64)}`;
  held(alteredMetadata, 'DIGEST_VERIFIED_REVIEW_ARCHIVE_REQUIRED');
});

test('every other Rescue Island source head requires independently validated specialist v2 review', () => {
  const child = fixture();
  child.pullRequest.number = 3105;
  child.pullRequest.head.sha = 'd'.repeat(40);
  held(child, 'QUALIFIED_SPECIALIST_REVIEW_REQUIRED');
  const changedParent = fixture(); changedParent.pullRequest.head.sha = 'e'.repeat(40);
  held(changedParent, 'QUALIFIED_SPECIALIST_REVIEW_REQUIRED');
});
