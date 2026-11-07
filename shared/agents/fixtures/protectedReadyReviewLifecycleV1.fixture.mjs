// Synthetic unit fixtures only. These are not hosted execution evidence.
import { buildIndependentReviewArtifact } from '../operatorMergeReviewArtifactV1.mjs';
import { reviewExactHead } from '../../../scripts/exact-head-review.mjs';
import {
  readyReviewSha256 as sha, sealReadyReviewPayload, readyReviewRunName,
  readyReviewHandoffName, readyReviewReceiptName, readyReviewRecoveryReceiptName, readyReviewRecoveryRunName,
  READY_REVIEW_HANDOFF_FILE, READY_REVIEW_RECEIPT_FILE, READY_REVIEW_RECOVERY_RECEIPT_FILE,
  READY_REVIEW_REPOSITORY as repository,
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
export function fixtureZipFiles(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const payload = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    const filename = Buffer.from(name);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(payload.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(payload.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, filename, payload); centrals.push(central, filename);
    offset += local.length + filename.length + payload.length;
  }
  const centralBytes = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
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
    changed_files: input.changedFiles.length,
    head: { sha: identity.sourceHead, ref: identity.branch, repo: { full_name: repository } },
    base: { sha: identity.baseSha, ref: 'main', repo: { full_name: repository } } },
    main: { object: { sha: identity.baseSha } }, commit: { sha: identity.sourceHead, tree: { sha: identity.sourceTree } } };
  return { identity, command, proof, inputs, state, input };
}

export function readyRecoveryFixture() {
  const f = readyLifecycleFixture({ alreadyReady: true, engineFindings: true });
  const originalIdentity = f.identity, currentMainSha = 'd'.repeat(40);
  f.proof.review.run.status = 'completed';
  f.proof.review.run.conclusion = 'failure';
  f.proof.review.job.status = 'completed';
  f.proof.review.job.conclusion = 'failure';
  f.proof.review.job.steps = [
    'Gate hosted review on its own GitHub installation API budget', 'Resolve immutable review identity',
    'Checkout trusted reviewer', 'Verify trusted reviewer source', 'Authenticate immutable READY handoff before review reads',
    'Admit exact current-main review target', 'Require exact current-main admission', 'Run trusted engine regressions',
    'Build immutable exact-head review input',
  ].map((name, index) => ({ number: index + 1, name, conclusion: 'success' }));
  f.proof.review.job.steps.push({ number: 10, name: 'Review ready head with the unchanged engine and qualified escalation', conclusion: 'failure' },
    { number: 11, name: 'Upload separate immutable lifecycle review proof', conclusion: 'skipped' },
    { number: 12, name: 'Upload SHA-bound review receipt', conclusion: 'success' });
  const diagnosticZip = Buffer.from('synthetic-diagnostic-archive');
  const diagnosticMetadata = { ...f.proof.review.artifact.metadata, id: 503,
    name: `exact-head-review-${originalIdentity.prNumber}-${originalIdentity.sourceHead}`,
    size_in_bytes: diagnosticZip.length, digest: `sha256:${sha(diagnosticZip)}` };
  const diagnostic = { metadata: diagnosticMetadata, archiveSha256: sha(diagnosticZip), input: f.input,
    changedFilesText: `${f.input.changedFiles.join('\n')}\n`, patch: f.input.patch,
    readyContext: { inputs: f.inputs, review: { run: f.proof.review.run } } };
  const correctionFiles = [
    'docs/architecture/stephanos-protected-ready-review-failure-recovery-v1.md',
    'scripts/exact-head-qualified-escalation-v1.mjs',
    'scripts/exact-head-qualified-escalation-v1.test.mjs',
    'scripts/protected-ready-review-lifecycle-v1.mjs',
    'scripts/protected-ready-review-lifecycle-v1.test.mjs',
    'shared/agents/fixtures/protectedReadyReviewLifecycleV1.fixture.mjs',
    'shared/agents/operatorPersonalRepositoryMergeDraftSkipV1.test.mjs',
    'shared/agents/operatorPersonalRepositoryMergeV1.mjs',
    'shared/agents/protectedReadyReviewLifecycleV1.mjs',
    'shared/agents/protectedReadyReviewLifecycleV1.test.mjs',
  ];
  const continuity = { schemaVersion: 'stephanos.protected-ready-review-continuity.v1',
    fromBaseSha: originalIdentity.baseSha, toMainSha: currentMainSha, commitShas: [currentMainSha],
    changedFiles: correctionFiles,
    changedFilesSha256: sha(JSON.stringify(correctionFiles)),
    correctionFiles,
    correctionFilesSha256: sha(JSON.stringify(correctionFiles)) };
  const recoveryRun = run(300, f.proof.review.definition, currentMainSha,
    readyReviewRecoveryRunName({ prNumber: originalIdentity.prNumber, commentId: 901, sourceSha: currentMainSha }));
  recoveryRun.event = 'issue_comment'; recoveryRun.actor = fixtureOwner; recoveryRun.triggering_actor = fixtureOwner;
  recoveryRun.created_at = clock(70); recoveryRun.run_started_at = clock(71);
  const recoveryJob = job(recoveryRun, 301, 'exact-head-review', 71, 90);
  const recoveryReceipt = sealReadyReviewPayload({ schemaVersion: 'stephanos.protected-ready-review-recovery-receipt.v1',
    identity: originalIdentity, recoveryRunId: 300, recoveryRunAttempt: 1, recoverySourceSha: currentMainSha,
    failedReviewRunId: 200, failedReviewRunAttempt: 1, failedDiagnosticArtifactId: diagnosticMetadata.id,
    failedDiagnosticArtifactDigest: diagnosticMetadata.digest, failedDiagnosticArchiveSha256: diagnostic.archiveSha256,
    handoffRunId: 100, handoffArtifactId: 501, handoffArtifactDigest: f.proof.handoff.artifact.metadata.digest,
    handoffPayloadSha256: f.proof.handoff.artifact.payload.payloadSha256, startedAt: clock(72), finishedAt: clock(85),
    patchSha256: sha(f.input.patch), changedFilesSha256: sha(JSON.stringify(f.input.changedFiles)),
    target: { currentMainSha, prBaseSha: currentMainSha, sourceHead: originalIdentity.sourceHead,
      sourceTree: originalIdentity.sourceTree, mergeable: true }, continuity,
    engineReceipt: f.proof.review.artifact.payload.engineReceipt,
    independentReviewMode: f.proof.review.artifact.payload.independentReviewMode,
    qualification: f.proof.review.artifact.payload.qualification, escalationCommentId: 901,
    escalationCommentSha256: sha(f.proof.escalationComment.body) });
  const recoveryArtifact = fixtureArtifact(504, readyReviewRecoveryReceiptName(300),
    READY_REVIEW_RECOVERY_RECEIPT_FILE, recoveryReceipt, recoveryRun, clock(86));
  const recoveryCheck = { id: recoveryJob.id, name: 'exact-head-review', head_sha: currentMainSha,
    status: 'completed', conclusion: 'success', app: { slug: 'github-actions', id: 15368 },
    check_suite: { id: recoveryRun.check_suite_id }, details_url: recoveryJob.html_url };
  const proof = { handoff: f.proof.handoff, failedReview: { run: f.proof.review.run,
    definition: f.proof.review.definition, job: f.proof.review.job, lifecycleArtifacts: [],
    diagnosticArtifacts: [diagnosticMetadata], diagnostic }, recovery: { run: recoveryRun,
    definition: f.proof.review.definition, job: recoveryJob, check: recoveryCheck, artifact: recoveryArtifact },
  independent: f.proof.independent, escalationComment: f.proof.escalationComment };
  return { ...f, originalIdentity, identity: { ...originalIdentity, baseSha: currentMainSha }, currentMainSha,
    continuity, diagnostic, recoveryReceipt, proof };
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
  const readExactHeadInput = async identity => {
    calls.push(`exactHeadInput:${identity.prNumber}:${identity.sourceHead}:${identity.baseSha}`);
    return fixture.input;
  };
  return { api, download: async id => artifacts.get(id)?.zip, readThreadsPage, readExactHeadInput,
    threadPages, inventory, calls, runs, artifacts };
}

export function fixtureRecoveryTransport(fixture) {
  const p = fixture.proof, calls = [], original = fixture.originalIdentity, current = fixture.identity;
  const diagnosticZip = fixtureZipFiles({
    'input.json': p.failedReview.diagnostic.input,
    'ready-context.json': p.failedReview.diagnostic.readyContext,
    'changed-files.txt': p.failedReview.diagnostic.changedFilesText,
    'pull-request.patch': p.failedReview.diagnostic.patch,
  });
  p.failedReview.diagnostic.archiveSha256 = sha(diagnosticZip);
  p.failedReview.diagnostic.metadata.size_in_bytes = diagnosticZip.length;
  p.failedReview.diagnostic.metadata.digest = `sha256:${sha(diagnosticZip)}`;
  p.failedReview.diagnosticArtifacts[0] = p.failedReview.diagnostic.metadata;
  const receiptBody = { ...p.recovery.artifact.payload,
    failedDiagnosticArtifactDigest: p.failedReview.diagnostic.metadata.digest,
    failedDiagnosticArchiveSha256: p.failedReview.diagnostic.archiveSha256 };
  delete receiptBody.payloadSha256;
  p.recovery.artifact.payload = sealReadyReviewPayload(receiptBody);
  p.recovery.artifact = fixtureArtifact(p.recovery.artifact.metadata.id, p.recovery.artifact.metadata.name,
    READY_REVIEW_RECOVERY_RECEIPT_FILE, p.recovery.artifact.payload, p.recovery.run, clock(86));
  const artifacts = new Map([[500, p.independent], [501, p.handoff.artifact],
    [503, { ...p.failedReview.diagnostic, zip: diagnosticZip }], [504, p.recovery.artifact]]);
  const runs = new Map([[90, p.independent.run], [100, p.handoff.run], [200, p.failedReview.run], [300, p.recovery.run]]);
  const jobs = new Map([[90, p.independent.jobs], [100, [p.handoff.job, p.handoff.dispatchJob]],
    [200, [p.failedReview.job]], [300, [p.recovery.job]]]);
  const api = async path => {
    calls.push(path);
    let match;
    if (path === `/pulls/${current.prNumber}`) return { ...fixture.state.pull, draft: false, mergeable: true,
      base: { ...fixture.state.pull.base, sha: current.baseSha } };
    if (path === '/git/ref/heads/main') return { object: { sha: current.baseSha } };
    if (path === `/git/commits/${current.sourceHead}`) return fixture.state.commit;
    if (path === '/actions/workflows/protected-workflow-dispatch-mailbox.yml') return p.handoff.definition;
    if (path === '/actions/workflows/stephanos-exact-head-review.yml') return p.recovery.definition;
    if (path === '/actions/workflows/independent-merge-security-review.yml') return p.independent.definition;
    if (path.includes('/actions/workflows/stephanos-exact-head-review.yml/runs?event=workflow_dispatch')) {
      const selected = path.includes(`head_sha=${original.baseSha}`) ? [p.failedReview.run] : [];
      return { total_count: selected.length, workflow_runs: selected };
    }
    if (path.includes('/actions/workflows/stephanos-exact-head-review.yml/runs?event=issue_comment')) {
      return { total_count: 1, workflow_runs: [p.recovery.run] };
    }
    if ((match = path.match(/^\/actions\/runs\/(\d+)$/))) return runs.get(Number(match[1]));
    if ((match = path.match(/^\/actions\/runs\/(\d+)\/attempts\/1\/jobs\?/))) {
      const value = jobs.get(Number(match[1])); return { total_count: value.length, jobs: value };
    }
    if ((match = path.match(/^\/actions\/runs\/(\d+)\/artifacts\?/))) {
      const value = [...artifacts.values()].filter(artifact => artifact.metadata.workflow_run.id === Number(match[1]));
      return { total_count: value.length, artifacts: value.map(artifact => artifact.metadata) };
    }
    if ((match = path.match(/^\/actions\/artifacts\/(\d+)$/))) return artifacts.get(Number(match[1]))?.metadata;
    if (path === '/issues/comments/900') return p.handoff.ownerComment;
    if (path === '/issues/comments/901') return p.escalationComment;
    if (path === `/issues/${current.prNumber}`) return { comments: 1 };
    if (path.startsWith(`/issues/${current.prNumber}/comments?`)) return [p.escalationComment];
    if (path === '/actions/runs/90/jobs?per_page=100') return { total_count: p.independent.jobs.length, jobs: p.independent.jobs };
    if (path === `/check-runs/${p.recovery.job.id}`) return p.recovery.check;
    if (path === `/compare/${original.baseSha}...${current.baseSha}`) return { status: 'ahead', ahead_by: 1, behind_by: 0,
      total_commits: 1, base_commit: { sha: original.baseSha }, merge_base_commit: { sha: original.baseSha },
      commits: [{ sha: current.baseSha }],
      files: fixture.continuity.changedFiles.map(filename => ({ filename })) };
    if (path === `/commits/${current.baseSha}`) return { sha: current.baseSha, parents: [{ sha: original.baseSha }],
      files: fixture.continuity.correctionFiles.map(filename => ({ filename })) };
    throw new Error(`Unexpected recovery fixture API read: ${path}`);
  };
  return { api, download: async id => artifacts.get(id)?.zip, calls };
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
