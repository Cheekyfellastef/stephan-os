// Synthetic unit fixtures only. These are not hosted execution evidence.
import { buildIndependentReviewArtifact } from '../operatorMergeReviewArtifactV1.mjs';
import { reviewExactHead } from '../../../scripts/exact-head-review.mjs';
import {
  readyReviewSha256 as sha, sealReadyReviewPayload, readyReviewRunName,
  readyReviewHandoffName, readyReviewReceiptName, READY_REVIEW_HANDOFF_FILE,
  READY_REVIEW_RECEIPT_FILE, READY_REVIEW_REPOSITORY as repository,
  READY_REVIEW_PRODUCER_PATH, READY_REVIEW_PRODUCER_NAME, READY_REVIEW_PATH, READY_REVIEW_NAME,
} from '../protectedReadyReviewLifecycleV1.mjs';
import { PROTECTED_WORKFLOW_DISPATCH_ISSUE } from '../protectedWorkflowDispatchMailboxV1.mjs';

export const clock = second => new Date(Date.UTC(2026, 9, 22, 12, 0, second)).toISOString();
export const fixtureOwner = { login: 'Cheekyfellastef', id: 267490109, type: 'User' };
export const fixtureCarrier = { login: 'github-actions[bot]', id: 41898282, type: 'Bot' };
export function fixtureZip(name, value) {
  const payload = Buffer.from(JSON.stringify(value)), filename = Buffer.from(name);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(payload.length, 22); local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const offset = local.length + filename.length + payload.length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([local, filename, payload, central, filename, end]);
}
export function fixtureArtifact(id, name, file, payload, run, at) {
  const zip = fixtureZip(file, payload);
  return { zip, payload, archiveSha256: sha(zip), metadata: { id, name, size_in_bytes: zip.length,
    expired: false, digest: `sha256:${sha(zip)}`, created_at: at, updated_at: at,
    workflow_run: { id: run.id, head_sha: run.head_sha, head_branch: run.head_branch } } };
}
function job(run, id, name, started, ended) {
  return { id, run_id: run.id, run_attempt: 1, name, workflow_name: run.name,
    status: 'completed', conclusion: 'success', head_sha: run.head_sha, head_branch: run.head_branch,
    run_url: `https://api.github.com/repos/${repository}/actions/runs/${run.id}`,
    check_run_url: `https://api.github.com/repos/${repository}/check-runs/${id}`,
    html_url: `https://github.com/${repository}/actions/runs/${run.id}/job/${id}`,
    started_at: clock(started), completed_at: clock(ended) };
}
function run(id, definition, base, title, producer = false) {
  return { id, run_attempt: 1, workflow_id: definition.id, path: definition.path, name: definition.name,
    display_title: title, repository: { full_name: repository }, head_repository: { full_name: repository },
    head_branch: 'main', head_sha: base, event: producer ? 'issue_comment' : 'workflow_dispatch',
    actor: producer ? fixtureOwner : fixtureCarrier, triggering_actor: producer ? fixtureOwner : fixtureCarrier,
    pull_requests: [], status: 'completed', conclusion: 'success', check_suite_id: id + 2000,
    created_at: clock(producer ? 1 : 13), run_started_at: clock(producer ? 2 : 14) };
}
export function readyLifecycleFixture({ bootstrap = false, alreadyReady = false, engineFindings = false } = {}) {
  const identity = { repository, prNumber: 2094, branch: 'codex/2094-lifecycle-fixture',
    sourceHead: 'a'.repeat(40), sourceTree: 'c'.repeat(40), baseSha: 'b'.repeat(40) };
  const analysis = { schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings: bootstrap ? [{ severity: 'P0', code: 'approval-boundary-v2-self-change-requires-qualified-review',
      summary: 'The approval boundary requires protected operator bootstrap.', path: 'shared/agents/operatorMergeApprovalGate.mjs' }] : [],
    counts: { P0: bootstrap ? 1 : 0, P1: 0, P2: 0 }, verdict: bootstrap ? 'findings' : 'clean',
    proofRefs: ['proofs/diff/complete'], finalVerdict: bootstrap ? 'INDEPENDENT_SECURITY_REVIEW_FINDINGS' : 'INDEPENDENT_SECURITY_REVIEW_CLEAN' };
  const independentPayload = buildIndependentReviewArtifact({ ...identity, workflowRunId: 90,
    workflowRunAttempt: 1, createdAtUtc: clock(-60), analysis });
  const independentDefinition = { id: 602, path: '.github/workflows/independent-merge-security-review.yml',
    name: 'Independent Merge Security Review', state: 'active' };
  const independentTitle = `stephanos-independent-review-pr-${identity.prNumber}-head-${identity.sourceHead}-binding-legacy-pull-request-target`;
  const independentRun = { ...run(90, independentDefinition, identity.sourceHead, independentTitle),
    name: independentTitle, event: 'pull_request_target', head_branch: identity.branch,
    created_at: clock(-90), run_started_at: clock(-80), pull_requests: [{ number: identity.prNumber,
      head: { sha: identity.sourceHead, ref: identity.branch, repo: { url: `https://api.github.com/repos/${repository}` } },
      base: { sha: identity.baseSha, ref: 'main', repo: { url: `https://api.github.com/repos/${repository}` } } }] };
  const independentArtifact = fixtureArtifact(500, 'stephanos-independent-review-90-attempt-1',
    'independent-review-result.json', independentPayload, independentRun, clock(-60));
  const independent = { ...independentArtifact, definition: independentDefinition, run: independentRun,
    jobs: [job(independentRun, 91, 'independent-security-review', -80, -50)] };
  const command = { schemaVersion: 'stephanos.protected-workflow-dispatch.v1', requestId: 'ready-review-fixture-2094-v1',
    operation: 'MARK_PROTECTED_PR_READY', repository, issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
    operatorApproval: 'operator-approved', expiresAt: clock(300), mode: 'user-owned-pr-ready', prNumber: identity.prNumber,
    expectedBranch: identity.branch, expectedHead: identity.sourceHead, expectedHeadTree: identity.sourceTree, expectedBase: identity.baseSha,
    independentReviewRunId: 90, independentReviewRunAttempt: 1, independentReviewArtifactId: 500,
    independentReviewArtifactDigest: independent.metadata.digest, independentReviewPayloadSha256: independentPayload.payloadSha256 };
  const ownerComment = { id: 900, user: fixtureOwner, author_association: 'OWNER', created_at: clock(0), updated_at: clock(0),
    issue_url: `https://api.github.com/repos/${repository}/issues/${PROTECTED_WORKFLOW_DISPATCH_ISSUE}`,
    body: '```stephanos-protected-workflow-dispatch\n' + JSON.stringify(command) + '\n```' };
  const producerDefinition = { id: 600, path: READY_REVIEW_PRODUCER_PATH, name: READY_REVIEW_PRODUCER_NAME, state: 'active' };
  const producerRun = run(100, producerDefinition, identity.baseSha, 'Protected workflow dispatch 900', true);
  const handoffPayload = sealReadyReviewPayload({ schemaVersion: 'stephanos.protected-ready-review-handoff.v1',
    command, identity, authorizationCommentId: 900, authorizationCommentSha256: sha(ownerComment.body),
    producerRunId: 100, producerRunAttempt: 1, producerWorkflowId: 600, producerSourceSha: identity.baseSha,
    lifecycleResult: alreadyReady ? 'ALREADY_READY' : 'READY_FOR_REVIEW_PROVEN', beforeDraft: !alreadyReady,
    unresolvedReviewThreads: alreadyReady ? null : 0, observedAt: clock(8) });
  const handoff = { run: producerRun, definition: producerDefinition, job: job(producerRun, 101, 'dispatch', 2, 10),
    dispatchJob: job(producerRun, 102, 'review-ready', 11, 20), ownerComment,
    artifact: fixtureArtifact(501, readyReviewHandoffName(100), READY_REVIEW_HANDOFF_FILE, handoffPayload, producerRun, clock(9)) };
  const reviewDefinition = { id: 601, path: READY_REVIEW_PATH, name: READY_REVIEW_NAME, state: 'active' };
  const reviewRun = run(200, reviewDefinition, identity.baseSha, readyReviewRunName({ ...identity, readyRunId: 100,
    handoffSha256: handoffPayload.payloadSha256 }));
  const reviewJob = job(reviewRun, 201, 'exact-head-review', 14, 60);
  const file = engineFindings ? '.github/workflows/example.yml' : 'README.md';
  const input = { repository, prNumber: identity.prNumber, headSha: identity.sourceHead, baseSha: identity.baseSha,
    changedFiles: [file], patch: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new\n` };
  const engineReceipt = { ...reviewExactHead(input), reviewedAt: clock(30) };
  const escalationPacket = { schemaVersion: 'stephanos.exact-head-qualified-escalation.v1', operation: 'AUTHORIZE_EXACT_HEAD_REVIEW_ESCALATION',
    repository, prNumber: identity.prNumber, expectedHead: identity.sourceHead, expectedBase: identity.baseSha,
    patchSha256: sha(input.patch), reviewRunId: 90, reviewRunAttempt: 1, reviewArtifactId: 500,
    reviewArtifactDigest: command.independentReviewArtifactDigest, reviewPayloadSha256: command.independentReviewPayloadSha256,
    scope: 'exact-head-review-only', expiresAt: clock(300) };
  const escalationComment = engineFindings ? { id: 901, user: fixtureOwner, author_association: 'OWNER',
    issue_url: `https://api.github.com/repos/${repository}/issues/${identity.prNumber}`, created_at: clock(5), updated_at: clock(5),
    body: '```stephanos-exact-head-qualified-review-v1\n' + JSON.stringify(escalationPacket) + '\n```' } : null;
  const qualification = engineFindings ? { ok: true, finalVerdict: 'EXACT_HEAD_QUALIFIED_ESCALATION_PASS',
    prNumber: identity.prNumber, sourceHead: identity.sourceHead, ownerCommentId: 901,
    independentReviewRunId: 90, independentArtifactId: 500, reviewMode: independentPayload.reviewMode,
    approvalAuthority: false, mergeAuthority: false } : null;
  const receipt = sealReadyReviewPayload({ schemaVersion: 'stephanos.protected-ready-review-receipt.v1', identity,
    reviewRunId: 200, reviewRunAttempt: 1, reviewSourceSha: identity.baseSha, handoffRunId: 100,
    handoffArtifactId: 501, handoffArtifactDigest: handoff.artifact.metadata.digest, handoffPayloadSha256: handoffPayload.payloadSha256,
    startedAt: clock(15), finishedAt: clock(50), patchSha256: sha(input.patch), changedFilesSha256: sha(JSON.stringify(input.changedFiles)),
    engineReceipt, independentReviewMode: independentPayload.reviewMode, qualification,
    escalationCommentId: escalationComment?.id || 0, escalationCommentSha256: escalationComment ? sha(escalationComment.body) : '' });
  const review = { run: reviewRun, definition: reviewDefinition, job: reviewJob,
    check: { id: 201, name: 'exact-head-review', head_sha: identity.baseSha, status: 'completed', conclusion: 'success',
      app: { slug: 'github-actions', id: 15368 }, check_suite: { id: reviewRun.check_suite_id }, details_url: reviewJob.html_url },
    artifact: fixtureArtifact(502, readyReviewReceiptName(200), READY_REVIEW_RECEIPT_FILE, receipt, reviewRun, clock(51)) };
  const proof = { handoff, review, independent, escalationComment };
  const inputs = { pr_number: String(identity.prNumber), source_head: identity.sourceHead, base_sha: identity.baseSha,
    ready_run_id: '100', ready_artifact_id: '501', ready_receipt_sha256: handoffPayload.payloadSha256 };
  const state = { pull: { number: identity.prNumber, node_id: 'PR_fixture', state: 'open', merged: false, draft: false,
    head: { sha: identity.sourceHead, ref: identity.branch, repo: { full_name: repository } },
    base: { sha: identity.baseSha, ref: 'main', repo: { full_name: repository } } },
    main: { object: { sha: identity.baseSha } }, commit: { sha: identity.sourceHead, tree: { sha: identity.sourceTree } } };
  return { identity, command, proof, inputs, state, input };
}
export function fixtureEnv(fixture, role = 'exact-head-review') {
  const producer = role === 'dispatch' || role === 'review-ready';
  return { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: fixture.identity.repository, GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: fixture.identity.baseSha, GITHUB_WORKFLOW_SHA: fixture.identity.baseSha,
    GITHUB_WORKFLOW_REF: `${fixture.identity.repository}/${producer ? READY_REVIEW_PRODUCER_PATH : READY_REVIEW_PATH}@refs/heads/main`,
    GITHUB_EVENT_NAME: producer ? 'issue_comment' : 'workflow_dispatch', GITHUB_JOB: role, GITHUB_RUN_ATTEMPT: '1',
    GITHUB_RUN_ID: producer ? '100' : '200' };
}
export function fixtureTransport(fixture) {
  const p = fixture.proof, calls = [], inventory = { runs: [p.review.run] }, threadPages = [];
  const runs = new Map([[100, p.handoff.run], [200, p.review.run], [90, p.independent.run]]);
  const artifacts = new Map([[501, p.handoff.artifact], [502, p.review.artifact], [500, p.independent]]);
  const api = async path => {
    calls.push(path);
    let m;
    if (path === '/pulls/2094') return fixture.state.pull;
    if (path === '/git/ref/heads/main') return fixture.state.main;
    if (path === `/git/commits/${fixture.identity.sourceHead}`) return fixture.state.commit;
    if (path === '/actions/workflows/protected-workflow-dispatch-mailbox.yml') return p.handoff.definition;
    if (path === '/actions/workflows/stephanos-exact-head-review.yml') return p.review.definition;
    if (path === '/actions/workflows/independent-merge-security-review.yml') return p.independent.definition;
    if (path.startsWith('/actions/workflows/stephanos-exact-head-review.yml/runs?')) {
      return { total_count: inventory.runs.length, workflow_runs: inventory.runs };
    }
    if ((m = path.match(/^\/actions\/runs\/(\d+)$/))) return runs.get(Number(m[1]));
    if ((m = path.match(/^\/actions\/runs\/(\d+)\/attempts\/1\/jobs\?/))) {
      const jobs = Number(m[1]) === 100 ? [p.handoff.job, p.handoff.dispatchJob]
        : Number(m[1]) === 200 ? [p.review.job] : p.independent.jobs;
      return { total_count: jobs.length, jobs };
    }
    if ((m = path.match(/^\/actions\/runs\/(\d+)\/artifacts\?/))) {
      const list = [...artifacts.values()].filter(a => a.metadata.workflow_run.id === Number(m[1])).map(a => a.metadata);
      return { total_count: list.length, artifacts: list };
    }
    if ((m = path.match(/^\/actions\/artifacts\/(\d+)$/))) return artifacts.get(Number(m[1]))?.metadata;
    if (path === '/issues/comments/900') return p.handoff.ownerComment;
    if (path === '/issues/comments/901') return p.escalationComment;
    if (path === '/issues/2094') return { comments: p.escalationComment ? 1 : 0 };
    if (path.startsWith('/issues/2094/comments?')) return p.escalationComment ? [p.escalationComment] : [];
    if (path === '/actions/runs/90/jobs?per_page=100') return { total_count: p.independent.jobs.length, jobs: p.independent.jobs };
    if (path === '/check-runs/201') return p.review.check;
    throw new Error(`Unexpected fixture API read: ${path}`);
  };
  const readThreadsPage = async (prNumber, after) => {
    calls.push(`reviewThreads:${prNumber}:${after}`);
    if (threadPages.length) return threadPages.shift();
    return fixtureThreadPage(fixture);
  };
  return { api, download: async id => artifacts.get(id)?.zip, readThreadsPage, threadPages, inventory, calls, runs, artifacts };
}

export function fixtureThreadPage(fixture, { nodes = [], totalCount = nodes.length, hasNextPage = false, endCursor = null } = {}) {
  const { identity, state } = fixture;
  return { data: { repository: { nameWithOwner: identity.repository, pullRequest: {
    number: state.pull.number, state: state.pull.state.toUpperCase(), merged: state.pull.merged, isDraft: state.pull.draft,
    headRepository: { nameWithOwner: state.pull.head.repo.full_name }, headRefName: state.pull.head.ref,
    headRefOid: state.pull.head.sha, baseRefName: state.pull.base.ref, baseRefOid: state.pull.base.sha,
    reviewThreads: { totalCount, nodes, pageInfo: { hasNextPage, endCursor } },
  } } } };
}
