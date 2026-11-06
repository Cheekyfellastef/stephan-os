import { createHash } from 'node:crypto';
import {
  PROTECTED_WORKFLOW_DISPATCH_REPOSITORY as REPOSITORY,
  PROTECTED_WORKFLOW_DISPATCH_AUTHOR as OWNER,
  PROTECTED_WORKFLOW_DISPATCH_AUTHOR_ID as OWNER_ID,
  PROTECTED_WORKFLOW_MAILBOX_TRANSPORT_ACTOR as CARRIER,
  PROTECTED_WORKFLOW_MAILBOX_TRANSPORT_ACTOR_ID as CARRIER_ID,
  PROTECTED_WORKFLOW_READY_OPERATION,
  validateProtectedWorkflowActorHandoff,
  protectedWorkflowAuthorizationCommentSha256,
} from './protectedWorkflowDispatchMailboxV1.mjs';
import { validateIndependentReviewWorkflowRun } from './operatorMergeApprovalGate.mjs';
import { validateIndependentReviewWorkflowDispatchExecutionV1 } from './independentReviewWorkflowDispatchExecutionV1.mjs';
import { independentReviewWorkflowDispatchRunNameV1 } from './independentReviewWorkflowDispatchLaunchReceiptV1.mjs';
import { validateIndependentReviewArtifact } from './operatorMergeReviewArtifactV1.mjs';
import {
  validateProtectedOpenClawReviewArtifactMetadata,
  validateProtectedOpenClawBootstrapFindings,
} from './protectedOpenClawMergeMailboxAdapter.mjs';

export const READY_REVIEW_REPOSITORY = REPOSITORY;
export const READY_REVIEW_PRODUCER_PATH = '.github/workflows/protected-workflow-dispatch-mailbox.yml';
export const READY_REVIEW_PRODUCER_NAME = 'Protected Workflow Dispatch Mailbox';
export const READY_REVIEW_PATH = '.github/workflows/stephanos-exact-head-review.yml';
export const READY_REVIEW_NAME = 'Stephanos Exact-Head Review';
export const READY_REVIEW_HANDOFF_FILE = 'protected-ready-review-handoff.json';
export const READY_REVIEW_RECEIPT_FILE = 'protected-ready-review-receipt.json';
export const READY_REVIEW_RECOVERY_RECEIPT_FILE = 'protected-ready-review-recovery-receipt.json';
export const READY_REVIEW_MAX_BYTES = 256 * 1024;
export const READY_REVIEW_RECOVERY_SOURCE_PATHS = Object.freeze([
  '.github/workflows/stephanos-exact-head-review.yml',
  'docs/architecture/stephanos-protected-ready-review-failure-recovery-v1.md',
  'scripts/exact-head-qualified-escalation-v1.mjs',
  'scripts/exact-head-qualified-escalation-v1.test.mjs',
  'scripts/protected-ready-review-lifecycle-v1.mjs',
  'scripts/protected-ready-review-lifecycle-v1.test.mjs',
  'shared/agents/fixtures/protectedReadyReviewLifecycleV1.fixture.mjs',
  'shared/agents/protectedReadyReviewLifecycleV1.mjs',
  'shared/agents/protectedReadyReviewLifecycleV1.test.mjs',
]);
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const positive = n => Number.isSafeInteger(n) && n > 0;
const record = x => x && typeof x === 'object' && !Array.isArray(x);
const time = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
export const readyReviewAssert = (ok, reason) => {
  if (!ok) throw new Error(`PROTECTED_READY_REVIEW_BLOCKED:${reason}`);
};
export const readyReviewSha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function readyReviewCanonical(value) {
  if (Array.isArray(value)) return value.map(readyReviewCanonical);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, readyReviewCanonical(value[key])]));
}
const equal = (a, b) => JSON.stringify(readyReviewCanonical(a)) === JSON.stringify(readyReviewCanonical(b));
function exactKeys(value, keys) {
  readyReviewAssert(record(value) && equal(Object.keys(value).sort(), [...keys].sort()), 'PAYLOAD_SCHEMA');
}
export function sealReadyReviewPayload(value) {
  readyReviewAssert(record(value) && !Object.hasOwn(value, 'payloadSha256'), 'PAYLOAD_ALREADY_SEALED');
  return Object.freeze({ ...value, payloadSha256: readyReviewSha256(JSON.stringify(readyReviewCanonical(value))) });
}
export function assertReadyReviewPayload(value) {
  readyReviewAssert(record(value) && SHA256.test(value.payloadSha256 || ''), 'PAYLOAD_DIGEST_MISSING');
  const { payloadSha256, ...body } = value;
  readyReviewAssert(payloadSha256 === readyReviewSha256(JSON.stringify(readyReviewCanonical(body))), 'PAYLOAD_DIGEST');
}
export function hasReadyReviewSelection(command = {}) {
  return positive(command.independentReviewRunId) && positive(command.independentReviewRunAttempt)
    && positive(command.independentReviewArtifactId) && DIGEST.test(command.independentReviewArtifactDigest || '')
    && SHA256.test(command.independentReviewPayloadSha256 || '');
}
export function readyReviewIdentity(command) {
  readyReviewAssert(command?.operation === PROTECTED_WORKFLOW_READY_OPERATION
    && command.repository === REPOSITORY && command.mode === 'user-owned-pr-ready'
    && positive(command.prNumber) && typeof command.expectedBranch === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/.test(command.expectedBranch) && !command.expectedBranch.includes('..')
    && SHA.test(command.expectedHead) && SHA.test(command.expectedHeadTree) && SHA.test(command.expectedBase)
    && hasReadyReviewSelection(command), 'COMPLETE_OWNER_READY_SELECTION_REQUIRED');
  return Object.freeze({ repository: REPOSITORY, prNumber: command.prNumber, branch: command.expectedBranch,
    sourceHead: command.expectedHead, sourceTree: command.expectedHeadTree, baseSha: command.expectedBase });
}
export const readyReviewHandoffName = (runId, attempt = 1) => `protected-ready-review-handoff-${runId}-attempt-${attempt}`;
export const readyReviewReceiptName = (runId, attempt = 1) => `protected-ready-review-receipt-${runId}-attempt-${attempt}`;
export const readyReviewRecoveryReceiptName = (runId, attempt = 1) => `protected-ready-review-recovery-receipt-${runId}-attempt-${attempt}`;
export const readyReviewRunName = ({ prNumber, sourceHead, readyRunId, handoffSha256 }) =>
  `protected-ready-review-pr-${prNumber}-head-${sourceHead}-ready-${readyRunId}-binding-${handoffSha256}`;
export const readyReviewRecoveryRunName = ({ prNumber, commentId, sourceSha }) =>
  `protected-ready-review-recovery-pr-${prNumber}-comment-${commentId}-source-${sourceSha}`;

export function parseReadyReviewInputs(inputs) {
  exactKeys(inputs, ['pr_number', 'source_head', 'base_sha', 'ready_run_id', 'ready_artifact_id', 'ready_receipt_sha256']);
  for (const key of ['pr_number', 'ready_run_id', 'ready_artifact_id']) {
    readyReviewAssert(typeof inputs[key] === 'string' && /^[1-9][0-9]*$/.test(inputs[key])
      && positive(Number(inputs[key])), 'DISPATCH_INTEGER');
  }
  readyReviewAssert(SHA.test(inputs.source_head) && SHA.test(inputs.base_sha)
    && SHA256.test(inputs.ready_receipt_sha256), 'DISPATCH_DIGEST');
  const parsed = { prNumber: Number(inputs.pr_number), sourceHead: inputs.source_head,
    baseSha: inputs.base_sha, readyRunId: Number(inputs.ready_run_id),
    readyArtifactId: Number(inputs.ready_artifact_id), handoffSha256: inputs.ready_receipt_sha256 };
  assertReadyReviewNormalizedInputs(parsed);
  return Object.freeze(parsed);
}
export function assertReadyReviewNormalizedInputs(inputs) {
  exactKeys(inputs, ['prNumber', 'sourceHead', 'baseSha', 'readyRunId', 'readyArtifactId', 'handoffSha256']);
  readyReviewAssert(positive(inputs.prNumber) && positive(inputs.readyRunId) && positive(inputs.readyArtifactId)
    && typeof inputs.sourceHead === 'string' && SHA.test(inputs.sourceHead)
    && typeof inputs.baseSha === 'string' && SHA.test(inputs.baseSha)
    && typeof inputs.handoffSha256 === 'string' && SHA256.test(inputs.handoffSha256), 'NORMALIZED_DISPATCH_IDENTITY');
}

export function assertReadyReviewSourceContext(env, sourceSha, baseSha, role) {
  const producer = role === 'dispatch' || role === 'review-ready';
  const path = producer ? READY_REVIEW_PRODUCER_PATH : READY_REVIEW_PATH;
  readyReviewAssert(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === REPOSITORY
    && env.GITHUB_REF === 'refs/heads/main' && SHA.test(baseSha)
    && env.GITHUB_SHA === baseSha && sourceSha === baseSha && env.GITHUB_WORKFLOW_SHA === baseSha
    && env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/${path}@refs/heads/main`
    && env.GITHUB_EVENT_NAME === (producer ? 'issue_comment' : 'workflow_dispatch')
    && env.GITHUB_JOB === role && env.GITHUB_RUN_ATTEMPT === '1'
    && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') && positive(Number(env.GITHUB_RUN_ID)),
  'TRUSTED_SOURCE_CONTEXT');
}

export function assertReadyReviewRecoverySourceContext(env, sourceSha) {
  readyReviewAssert(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === REPOSITORY
    && env.GITHUB_REF === 'refs/heads/main' && SHA.test(sourceSha)
    && env.GITHUB_SHA === sourceSha && env.GITHUB_WORKFLOW_SHA === sourceSha
    && env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/${READY_REVIEW_PATH}@refs/heads/main`
    && env.GITHUB_EVENT_NAME === 'issue_comment' && env.GITHUB_JOB === 'exact-head-review'
    && env.GITHUB_RUN_ATTEMPT === '1' && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '')
    && positive(Number(env.GITHUB_RUN_ID)), 'RECOVERY_TRUSTED_SOURCE_CONTEXT');
}

export function assertReadyReviewRecoveryTarget({ pull, main, commit }, identity, currentMainSha) {
  readyReviewAssert(identity.repository === REPOSITORY && positive(identity.prNumber)
    && SHA.test(identity.sourceHead) && SHA.test(identity.sourceTree) && SHA.test(identity.baseSha)
    && SHA.test(currentMainSha) && currentMainSha !== identity.baseSha
    && pull?.number === identity.prNumber && pull?.state === 'open' && pull.merged === false && pull.draft === false
    && pull.mergeable === true
    && pull.head?.repo?.full_name === REPOSITORY && pull.base?.repo?.full_name === REPOSITORY
    && pull.head?.ref === identity.branch && pull.head?.sha === identity.sourceHead
    && pull.base?.ref === 'main' && [identity.baseSha, currentMainSha].includes(pull.base?.sha)
    && main?.object?.sha === currentMainSha && commit?.sha === identity.sourceHead
    && commit?.tree?.sha === identity.sourceTree, 'RECOVERY_CURRENT_PR_HEAD_TREE_OR_MAIN_CHANGED');
}

export function assertReadyReviewTarget({ pull, main, commit }, identity, { allowDraft = false } = {}) {
  readyReviewAssert(identity.repository === REPOSITORY && positive(identity.prNumber)
    && SHA.test(identity.sourceHead) && SHA.test(identity.sourceTree) && SHA.test(identity.baseSha)
    && pull?.number === identity.prNumber && pull?.state === 'open' && pull.merged === false
    && (pull.draft === false || (allowDraft && pull.draft === true))
    && pull.head?.repo?.full_name === REPOSITORY && pull.base?.repo?.full_name === REPOSITORY
    && pull.head?.ref === identity.branch && pull.head?.sha === identity.sourceHead
    && pull.base?.ref === 'main' && pull.base?.sha === identity.baseSha
    && main?.object?.sha === identity.baseSha && commit?.sha === identity.sourceHead
    && commit?.tree?.sha === identity.sourceTree, 'CURRENT_PR_HEAD_TREE_BASE_OR_DRAFT_CHANGED');
}

export function assertReadyReviewDefinition(definition, path, name) {
  readyReviewAssert(positive(definition?.id) && definition.path === path && definition.name === name
    && definition.state === 'active', 'WORKFLOW_DEFINITION');
}
function actorAllowed(actor) {
  return (actor?.login === OWNER && actor?.id === OWNER_ID)
    || (actor?.login === CARRIER && actor?.id === CARRIER_ID);
}
function assertReadyReviewRunIdentity(run, definition, identity, { producer = false,
  commentId, handoffSha256, readyRunId } = {}) {
  const path = producer ? READY_REVIEW_PRODUCER_PATH : READY_REVIEW_PATH;
  const name = producer ? READY_REVIEW_PRODUCER_NAME : READY_REVIEW_NAME;
  assertReadyReviewDefinition(definition, path, name);
  const title = producer ? `Protected workflow dispatch ${commentId}`
    : readyReviewRunName({ ...identity, readyRunId, handoffSha256 });
  readyReviewAssert(positive(run?.id) && run.run_attempt === 1 && run.workflow_id === definition.id
    && run.path === path && (run.name === name || run.name === title) && run.display_title === title
    && run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY
    && run.event === (producer ? 'issue_comment' : 'workflow_dispatch')
    && run.head_branch === 'main' && run.head_sha === identity.baseSha
    && Array.isArray(run.pull_requests) && run.pull_requests.length === 0
    && actorAllowed(run.actor) && actorAllowed(run.triggering_actor)
    && (!producer || (run.actor.login === OWNER && run.triggering_actor.login === OWNER))
    && time(run.created_at), 'RUN_PROVENANCE_OR_STATE');
}
export function assertReadyReviewRun(run, definition, identity, options = {}) {
  assertReadyReviewRunIdentity(run, definition, identity, options);
  const terminal = options.terminal !== false;
  readyReviewAssert(time(run.run_started_at)
    && (terminal ? run.status === 'completed' && run.conclusion === 'success'
      : ((run.status === 'in_progress' && run.conclusion === null)
        || (run.status === 'completed' && run.conclusion === 'success'))), 'RUN_PROVENANCE_OR_STATE');
}
// Queued is evidence only that the fixed dispatch created its bound run. It is
// never accepted by assertReadyReviewRun or the terminal lifecycle validator.
export function assertReadyReviewLaunchRun(run, definition, identity, { handoffSha256, readyRunId } = {}) {
  assertReadyReviewRunIdentity(run, definition, identity, { handoffSha256, readyRunId });
  if (run.status === 'queued') {
    readyReviewAssert(run.conclusion === null, 'LAUNCH_RUN_STATE');
  } else assertReadyReviewRun(run, definition, identity, { terminal: false, handoffSha256, readyRunId });
}
export function assertReadyReviewJob(job, run, name, { terminal = true } = {}) {
  readyReviewAssert(positive(job?.id) && job.run_id === run.id && job.run_attempt === 1
    && job.name === name && job.head_sha === run.head_sha && job.head_branch === 'main'
    && job.run_url === `https://api.github.com/repos/${REPOSITORY}/actions/runs/${run.id}`
    && job.check_run_url === `https://api.github.com/repos/${REPOSITORY}/check-runs/${job.id}`
    && job.html_url === `https://github.com/${REPOSITORY}/actions/runs/${run.id}/job/${job.id}`
    && time(job.started_at)
    && (terminal ? job.status === 'completed' && job.conclusion === 'success' && time(job.completed_at)
      : job.status === 'in_progress' && job.conclusion === null), 'JOB_PROVENANCE_OR_STATE');
}

export function assertReadyReviewFailedRun(run, definition, identity, handoff, job) {
  assertReadyReviewRunIdentity(run, definition, identity, {
    handoffSha256: handoff.payloadSha256, readyRunId: handoff.producerRunId,
  });
  readyReviewAssert(run.status === 'completed' && run.conclusion === 'failure' && time(run.run_started_at),
    'FAILED_RUN_STATE');
  readyReviewAssert(positive(job?.id) && job.run_id === run.id && job.run_attempt === 1
    && job.name === 'exact-head-review' && job.head_sha === run.head_sha && job.head_branch === 'main'
    && job.status === 'completed' && job.conclusion === 'failure' && time(job.started_at) && time(job.completed_at)
    && Array.isArray(job.steps), 'FAILED_JOB_PROVENANCE');
  const steps = new Map(job.steps.map(step => [step?.name, step?.conclusion]));
  const beforeFailure = [
    'Gate hosted review on its own GitHub installation API budget', 'Resolve immutable review identity',
    'Checkout trusted reviewer', 'Verify trusted reviewer source', 'Authenticate immutable READY handoff before review reads',
    'Admit exact current-main review target', 'Require exact current-main admission', 'Run trusted engine regressions',
    'Build immutable exact-head review input',
  ];
  readyReviewAssert(beforeFailure.every(name => steps.get(name) === 'success')
    && steps.get('Review ready head with the unchanged engine and qualified escalation') === 'failure'
    && steps.get('Upload separate immutable lifecycle review proof') === 'skipped'
    && steps.get('Upload SHA-bound review receipt') === 'success'
    && job.steps.filter(step => step?.conclusion === 'failure').length === 1
    && !job.steps.some(step => ['cancelled', 'timed_out'].includes(step?.conclusion)), 'FAILED_JOB_STEP_TOPOLOGY');
}

export function assertReadyReviewRecoveryRun(run, definition, identity, { commentId, sourceSha, terminal = true } = {}) {
  assertReadyReviewDefinition(definition, READY_REVIEW_PATH, READY_REVIEW_NAME);
  const title = readyReviewRecoveryRunName({ prNumber: identity.prNumber, commentId, sourceSha });
  readyReviewAssert(positive(commentId) && SHA.test(sourceSha) && positive(run?.id) && run.run_attempt === 1
    && run.workflow_id === definition.id && run.path === READY_REVIEW_PATH && (run.name === READY_REVIEW_NAME || run.name === title)
    && run.display_title === title && run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY
    && run.event === 'issue_comment' && run.head_branch === 'main' && run.head_sha === sourceSha
    && Array.isArray(run.pull_requests) && run.pull_requests.length === 0
    && run.actor?.login === OWNER && run.actor?.id === OWNER_ID
    && run.triggering_actor?.login === OWNER && run.triggering_actor?.id === OWNER_ID
    && time(run.created_at) && time(run.run_started_at)
    && (terminal ? run.status === 'completed' && run.conclusion === 'success'
      : run.status === 'in_progress' && run.conclusion === null), 'RECOVERY_RUN_PROVENANCE_OR_STATE');
}

export function buildReadyReviewRecoveryContinuity(compare, correctionCommit, identity, currentMainSha, candidateChangedFiles) {
  readyReviewAssert(compare?.status === 'ahead' && compare?.base_commit?.sha === identity.baseSha
    && compare?.merge_base_commit?.sha === identity.baseSha
    && Number.isSafeInteger(compare.ahead_by) && compare.ahead_by > 0 && compare.ahead_by <= 250
    && compare.behind_by === 0 && compare.total_commits === compare.ahead_by
    && Array.isArray(compare.commits) && compare.commits.length === compare.total_commits
    && compare.commits.at(-1)?.sha === currentMainSha
    && Array.isArray(compare.files) && compare.files.length > 0
    && compare.files.length <= 300, 'RECOVERY_CONTINUITY_COMPARE');
  const commitShas = compare.commits.map(commit => commit?.sha);
  const changedFiles = compare.files.map(file => file?.filename);
  readyReviewAssert(changedFiles.every(path => typeof path === 'string')
    && new Set(changedFiles).size === changedFiles.length
    && commitShas.every(sha => SHA.test(sha)) && new Set(commitShas).size === commitShas.length
    && Array.isArray(candidateChangedFiles) && candidateChangedFiles.length > 0
    && !changedFiles.some(path => candidateChangedFiles.includes(path)), 'RECOVERY_CONTINUITY_SCOPE_OR_OVERLAP');
  const correctionFiles = correctionCommit?.files?.map(file => file?.filename);
  const expectedParent = commitShas.length === 1 ? identity.baseSha : commitShas.at(-2);
  readyReviewAssert(correctionCommit?.sha === currentMainSha && Array.isArray(correctionCommit.parents)
    && correctionCommit.parents.length === 1 && correctionCommit.parents[0]?.sha === expectedParent
    && Array.isArray(correctionFiles) && correctionFiles.length > 0
    && new Set(correctionFiles).size === correctionFiles.length
    && correctionFiles.every(path => READY_REVIEW_RECOVERY_SOURCE_PATHS.includes(path))
    && correctionFiles.every(path => changedFiles.includes(path)), 'RECOVERY_CORRECTION_TIP');
  return Object.freeze({ schemaVersion: 'stephanos.protected-ready-review-continuity.v1',
    fromBaseSha: identity.baseSha, toMainSha: currentMainSha, commitShas, changedFiles,
    changedFilesSha256: readyReviewSha256(JSON.stringify(changedFiles)), correctionFiles,
    correctionFilesSha256: readyReviewSha256(JSON.stringify(correctionFiles)) });
}
export function assertReadyReviewArtifact(envelope, run, name, payloadSha256) {
  const { metadata, payload, archiveSha256 } = envelope || {};
  assertReadyReviewPayload(payload);
  readyReviewAssert(positive(metadata?.id) && metadata.name === name && metadata.expired === false
    && positive(metadata.size_in_bytes) && metadata.size_in_bytes <= READY_REVIEW_MAX_BYTES
    && metadata.workflow_run?.id === run.id && metadata.workflow_run?.head_sha === run.head_sha
    && metadata.workflow_run?.head_branch === 'main' && DIGEST.test(metadata.digest || '')
    && metadata.digest === `sha256:${archiveSha256}`
    && (!payloadSha256 || payload.payloadSha256 === payloadSha256)
    && time(metadata.created_at) && time(metadata.updated_at)
    && Date.parse(metadata.updated_at) >= Date.parse(metadata.created_at)
    && Date.parse(metadata.created_at) >= Date.parse(run.created_at), 'ARTIFACT_PROVENANCE');
}

export function assertReadyReviewOwner(comment, command, at, expectedId, expectedDigest) {
  const proof = validateProtectedWorkflowActorHandoff(comment, command, {
    transportActor: OWNER, transportActorId: OWNER_ID, expectedCommentId: expectedId,
    expectedCommentSha256: expectedDigest, now: new Date(at),
  });
  readyReviewAssert(proof.ok && proof.command.requestId === command.requestId, proof.blocker || 'OWNER_READY_BINDING');
  return proof;
}
export function buildReadyReviewHandoff({ command, comment, run, definition, sourceSha, lifecycleResult,
  beforeDraft, unresolvedReviewThreads, observedAt }) {
  const identity = readyReviewIdentity(command);
  assertReadyReviewOwner(comment, command, observedAt, comment.id, protectedWorkflowAuthorizationCommentSha256(comment));
  assertReadyReviewRun(run, definition, identity, { producer: true, terminal: false, commentId: comment.id });
  readyReviewAssert(sourceSha === identity.baseSha && time(observedAt)
    && Date.parse(observedAt) >= Date.parse(run.run_started_at)
    && ((beforeDraft === true && lifecycleResult === 'READY_FOR_REVIEW_PROVEN' && unresolvedReviewThreads === 0)
      || (beforeDraft === false && lifecycleResult === 'ALREADY_READY' && unresolvedReviewThreads === null)), 'READY_TRANSITION');
  return sealReadyReviewPayload({ schemaVersion: 'stephanos.protected-ready-review-handoff.v1',
    command, identity, authorizationCommentId: comment.id,
    authorizationCommentSha256: protectedWorkflowAuthorizationCommentSha256(comment),
    producerRunId: run.id, producerRunAttempt: 1, producerWorkflowId: definition.id,
    producerSourceSha: sourceSha, lifecycleResult, beforeDraft, unresolvedReviewThreads, observedAt });
}
export function assertReadyReviewHandoff(evidence, { terminal = true, at = null } = {}) {
  const { run, definition, job, ownerComment, artifact } = evidence || {};
  const handoff = artifact?.payload;
  exactKeys(handoff, ['schemaVersion', 'command', 'identity', 'authorizationCommentId', 'authorizationCommentSha256',
    'producerRunId', 'producerRunAttempt', 'producerWorkflowId', 'producerSourceSha', 'lifecycleResult',
    'beforeDraft', 'unresolvedReviewThreads', 'observedAt', 'payloadSha256']);
  readyReviewAssert(handoff.schemaVersion === 'stephanos.protected-ready-review-handoff.v1', 'HANDOFF_SCHEMA');
  const identity = readyReviewIdentity(handoff.command);
  readyReviewAssert(equal(identity, handoff.identity) && handoff.producerRunId === run?.id
    && handoff.producerRunAttempt === 1 && handoff.producerWorkflowId === definition?.id
    && handoff.producerSourceSha === identity.baseSha && time(handoff.observedAt)
    && ((handoff.beforeDraft === true && handoff.lifecycleResult === 'READY_FOR_REVIEW_PROVEN' && handoff.unresolvedReviewThreads === 0)
      || (handoff.beforeDraft === false && handoff.lifecycleResult === 'ALREADY_READY' && handoff.unresolvedReviewThreads === null)), 'HANDOFF_BINDING');
  assertReadyReviewRun(run, definition, identity, { producer: true, terminal, commentId: handoff.authorizationCommentId });
  assertReadyReviewJob(job, run, 'dispatch');
  assertReadyReviewArtifact(artifact, run, readyReviewHandoffName(run.id));
  readyReviewAssert(Date.parse(handoff.observedAt) >= Date.parse(job.started_at)
    && Date.parse(handoff.observedAt) <= Date.parse(job.completed_at), 'HANDOFF_JOB_TIME');
  assertReadyReviewOwner(ownerComment, handoff.command, handoff.observedAt,
    handoff.authorizationCommentId, handoff.authorizationCommentSha256);
  if (at !== null) assertReadyReviewOwner(ownerComment, handoff.command, at,
    handoff.authorizationCommentId, handoff.authorizationCommentSha256);
  return identity;
}

export function assertReadyReviewIndependent(evidence, command) {
  const { definition, run, jobs, metadata, payload, archiveSha256 } = evidence || {};
  const identity = readyReviewIdentity(command);
  assertReadyReviewDefinition(definition, '.github/workflows/independent-merge-security-review.yml', 'Independent Merge Security Review');
  const expected = { repository: REPOSITORY, prNumber: identity.prNumber, expectedHead: identity.sourceHead,
    expectedBranch: identity.branch, expectedBaseBranch: 'main', expectedBaseSha: identity.baseSha,
    expectedWorkflowId: definition.id, workflowRunId: command.independentReviewRunId,
    workflowRunAttempt: command.independentReviewRunAttempt };
  const execution = run?.event === 'workflow_dispatch'
    ? validateIndependentReviewWorkflowDispatchExecutionV1(run, jobs, expected)
    : validateIndependentReviewWorkflowRun(run, jobs, { ...expected,
      expectedWorkflowRunName: independentReviewWorkflowDispatchRunNameV1({ prNumber: identity.prNumber,
        sourceHead: identity.sourceHead, handoffBindingSha256: 'legacy-pull-request-target' }) });
  readyReviewAssert(execution.valid, 'INDEPENDENT_RUN_OR_JOB');
  readyReviewAssert(validateProtectedOpenClawReviewArtifactMetadata(metadata, {
    reviewRunId: command.independentReviewRunId, reviewRunAttempt: command.independentReviewRunAttempt,
    reviewArtifactId: command.independentReviewArtifactId, reviewArtifactDigest: command.independentReviewArtifactDigest,
    expectedHead: identity.sourceHead, expectedBase: identity.baseSha,
  }, run) && metadata.digest === `sha256:${archiveSha256}`, 'INDEPENDENT_ARTIFACT_METADATA_OR_ARCHIVE');
  const verified = validateIndependentReviewArtifact(payload, { repository: REPOSITORY,
    prNumber: identity.prNumber, branch: identity.branch, expectedHead: identity.sourceHead,
    expectedBaseSha: identity.baseSha, expectedPayloadSha256: command.independentReviewPayloadSha256,
    workflowRunId: command.independentReviewRunId, workflowRunAttempt: command.independentReviewRunAttempt });
  readyReviewAssert(verified.valid, 'INDEPENDENT_ARTIFACT_PAYLOAD');
  const findings = payload.receipt?.findings;
  const clean = payload.reviewMode === 'clean-independent' && payload.receipt?.verdict === 'clean'
    && payload.receipt?.blocker === '' && Array.isArray(findings) && findings.length === 0;
  const bootstrap = payload.reviewMode === 'qualified-operator-bootstrap' && payload.receipt?.verdict === 'findings'
    && payload.receipt?.reviewScope?.includes('operator-protected-bootstrap-required')
    && validateProtectedOpenClawBootstrapFindings(findings);
  readyReviewAssert(clean || bootstrap, 'INDEPENDENT_REVIEW_NOT_QUALIFIED');
  return payload.reviewMode;
}

// Read every run at this exact trusted base before selecting. Unknown, duplicate,
// pending, failed or canceled executions cannot be hidden behind an older pass.
export function selectReadyReviewRun(runs, identity, { absentAllowed = false } = {}) {
  readyReviewAssert(Array.isArray(runs), 'RUN_INVENTORY');
  const pattern = /^protected-ready-review-pr-([1-9][0-9]*)-head-([a-f0-9]{40})-ready-([1-9][0-9]*)-binding-([a-f0-9]{64})$/;
  const seen = new Set(), matches = [];
  for (const run of runs) {
    const match = String(run?.display_title || '').match(pattern);
    readyReviewAssert(positive(run?.id) && !seen.has(run.id) && run.event === 'workflow_dispatch'
      && run.head_sha === identity.baseSha && run.path === READY_REVIEW_PATH && match, 'RUN_INVENTORY_AMBIGUOUS');
    seen.add(run.id);
    if (Number(match[1]) === identity.prNumber && match[2] === identity.sourceHead) matches.push(run);
  }
  readyReviewAssert(matches.length <= 1 && (absentAllowed || matches.length === 1), 'RUN_INVENTORY_NOT_UNIQUE');
  return matches[0] || null;
}

export function validateProtectedReadyReviewLifecycleEvidence(proof, expected, skippedRunId) {
  try {
    readyReviewAssert(positive(skippedRunId), 'SKIPPED_RUN_ID');
    const identity = assertReadyReviewHandoff(proof.handoff);
    assertReadyReviewJob(proof.handoff.dispatchJob, proof.handoff.run, 'review-ready');
    readyReviewAssert(['repository', 'prNumber', 'branch', 'sourceHead', 'sourceTree', 'baseSha']
      .every(key => identity[key] === expected[key]), 'CONSUMER_IDENTITY');
    const handoff = proof.handoff.artifact.payload;
    const { run, definition, job, check, artifact } = proof.review;
    const receipt = artifact?.payload;
    assertReadyReviewRun(run, definition, identity, { handoffSha256: handoff.payloadSha256, readyRunId: handoff.producerRunId });
    assertReadyReviewJob(job, run, 'exact-head-review');
    assertReadyReviewArtifact(artifact, run, readyReviewReceiptName(run.id));
    exactKeys(receipt, ['schemaVersion', 'identity', 'reviewRunId', 'reviewRunAttempt', 'reviewSourceSha',
      'handoffRunId', 'handoffArtifactId', 'handoffArtifactDigest', 'handoffPayloadSha256',
      'startedAt', 'finishedAt', 'patchSha256', 'changedFilesSha256', 'engineReceipt',
      'independentReviewMode', 'qualification', 'escalationCommentId', 'escalationCommentSha256', 'payloadSha256']);
    readyReviewAssert(receipt.schemaVersion === 'stephanos.protected-ready-review-receipt.v1'
      && equal(receipt.identity, identity) && receipt.reviewRunId === run.id && receipt.reviewRunAttempt === 1
      && receipt.reviewSourceSha === identity.baseSha && run.id > skippedRunId
      && Date.parse(run.created_at) >= Date.parse(proof.handoff.job.completed_at)
      && Date.parse(run.created_at) >= Date.parse(proof.handoff.dispatchJob.started_at)
      && Date.parse(run.created_at) <= Date.parse(proof.handoff.dispatchJob.completed_at)
      && receipt.handoffRunId === handoff.producerRunId && receipt.handoffArtifactId === proof.handoff.artifact.metadata.id
      && receipt.handoffArtifactDigest === proof.handoff.artifact.metadata.digest
      && receipt.handoffPayloadSha256 === handoff.payloadSha256
      && time(receipt.startedAt) && time(receipt.finishedAt)
      && Date.parse(receipt.startedAt) >= Date.parse(proof.handoff.job.completed_at)
      && Date.parse(receipt.startedAt) >= Date.parse(job.started_at)
      && Date.parse(receipt.finishedAt) >= Date.parse(receipt.startedAt)
      && Date.parse(receipt.finishedAt) <= Date.parse(job.completed_at)
      && SHA256.test(receipt.patchSha256) && SHA256.test(receipt.changedFilesSha256), 'RECEIPT_BINDING');
    readyReviewAssert(check?.id === job.id && check.name === 'exact-head-review' && check.head_sha === identity.baseSha
      && check.status === 'completed' && check.conclusion === 'success'
      && check.app?.slug === 'github-actions' && check.app?.id === 15368
      && check.check_suite?.id === run.check_suite_id
      && check.details_url === job.html_url, 'REVIEW_CHECK_PROVENANCE');
    assertReadyReviewOwner(proof.handoff.ownerComment, handoff.command, receipt.startedAt,
      handoff.authorizationCommentId, handoff.authorizationCommentSha256);
    const reviewMode = assertReadyReviewIndependent(proof.independent, handoff.command);
    readyReviewAssert(receipt.independentReviewMode === reviewMode
      && (!handoff.beforeDraft || reviewMode === 'clean-independent'), 'DRAFT_BOOTSTRAP_READY_NOT_AUTHORIZED');
    const engine = receipt.engineReceipt;
    readyReviewAssert(engine?.repository === REPOSITORY && engine.prNumber === identity.prNumber
      && engine.headSha === identity.sourceHead && engine.baseSha === identity.baseSha
      && engine.reviewer === 'stephanos-deterministic-review-v1'
      && engine.authority?.readOnly === true && engine.authority?.mayEdit === false && engine.authority?.mayApprove === false
      && engine.authority?.mayMerge === false && engine.authority?.mayDeploy === false
      && Array.isArray(engine.findings), 'ENGINE_RECEIPT');
    if (engine.verdict === 'STEPHANOS_REVIEW_PASS' && engine.findings.length === 0) {
      readyReviewAssert(receipt.qualification === null && receipt.escalationCommentId === 0
        && receipt.escalationCommentSha256 === '', 'CLEAN_REVIEW_ESCALATION_UNEXPECTED');
    } else {
      const q = receipt.qualification;
      readyReviewAssert(engine.verdict === 'STEPHANOS_REVIEW_FINDINGS' && engine.findings.length > 0
        && engine.findings.length <= 40 && engine.findings.every(f => f.severity === 'P2'
          && ['AUTHORITY_SURFACE_CHANGED', 'DYNAMIC_EXECUTION'].includes(f.code))
        && q?.ok === true && q.finalVerdict === 'EXACT_HEAD_QUALIFIED_ESCALATION_PASS'
        && q.prNumber === identity.prNumber && q.sourceHead === identity.sourceHead
        && q.reviewMode === reviewMode && q.approvalAuthority === false && q.mergeAuthority === false
        && q.ownerCommentId === receipt.escalationCommentId
        && q.independentReviewRunId === handoff.command.independentReviewRunId
        && q.independentArtifactId === handoff.command.independentReviewArtifactId
        && proof.escalationComment?.id === receipt.escalationCommentId
        && protectedWorkflowAuthorizationCommentSha256(proof.escalationComment) === receipt.escalationCommentSha256,
      'QUALIFIED_FINDINGS_NOT_PRESERVED');
    }
    return Object.freeze({ valid: true, identity, workflowRunId: run.id, workflowRunAttempt: 1,
      artifactId: artifact.metadata.id, artifactDigest: artifact.metadata.digest, payloadSha256: receipt.payloadSha256,
      reviewMode, handoffRunId: handoff.producerRunId, handoffPayloadSha256: handoff.payloadSha256 });
  } catch (error) {
    return Object.freeze({ valid: false, blocker: String(error?.message || error) });
  }
}

export function validateProtectedReadyReviewRecoveryEvidence(proof, expected, skippedRunId) {
  try {
    readyReviewAssert(positive(skippedRunId), 'SKIPPED_RUN_ID');
    const originalIdentity = assertReadyReviewHandoff(proof.handoff);
    assertReadyReviewJob(proof.handoff.dispatchJob, proof.handoff.run, 'review-ready');
    readyReviewAssert(['repository', 'prNumber', 'branch', 'sourceHead', 'sourceTree']
      .every(key => originalIdentity[key] === expected[key])
      && originalIdentity.baseSha !== expected.baseSha, 'RECOVERY_CONSUMER_IDENTITY');
    const handoff = proof.handoff.artifact.payload;
    const failed = proof.failedReview;
    assertReadyReviewFailedRun(failed.run, failed.definition, originalIdentity, handoff, failed.job);
    readyReviewAssert(failed.run.id > skippedRunId, 'RECOVERY_FAILED_RUN_AFTER_DRAFT_SKIP');
    readyReviewAssert(failed.lifecycleArtifacts.length === 0 && failed.diagnosticArtifacts.length === 1,
      'RECOVERY_FAILED_ARTIFACT_SET');
    const diagnostic = failed.diagnostic;
    readyReviewAssert(diagnostic.metadata.id === failed.diagnosticArtifacts[0].id
      && diagnostic.metadata.name === `exact-head-review-${originalIdentity.prNumber}-${originalIdentity.sourceHead}`
      && diagnostic.metadata.workflow_run?.id === failed.run.id && diagnostic.metadata.expired === false
      && DIGEST.test(diagnostic.metadata.digest || '') && diagnostic.metadata.digest === `sha256:${diagnostic.archiveSha256}`,
    'RECOVERY_DIAGNOSTIC_PROVENANCE');
    const input = diagnostic.input;
    readyReviewAssert(input?.repository === originalIdentity.repository && input.prNumber === originalIdentity.prNumber
      && input.headSha === originalIdentity.sourceHead && input.baseSha === originalIdentity.baseSha
      && Array.isArray(input.changedFiles) && input.changedFiles.length > 0
      && new Set(input.changedFiles).size === input.changedFiles.length
      && input.changedFiles.every(path => typeof path === 'string' && path.length > 0)
      && typeof input.patch === 'string' && input.patch.startsWith('diff --git '), 'RECOVERY_DIAGNOSTIC_INPUT');
    readyReviewAssert(diagnostic.changedFilesText === `${input.changedFiles.join('\n')}\n`
      && diagnostic.patch === input.patch, 'RECOVERY_DIAGNOSTIC_FILES');
    const { run, definition, job, check, artifact } = proof.recovery;
    const receipt = artifact?.payload;
    exactKeys(receipt, ['schemaVersion', 'identity', 'recoveryRunId', 'recoveryRunAttempt', 'recoverySourceSha',
      'failedReviewRunId', 'failedReviewRunAttempt', 'failedDiagnosticArtifactId', 'failedDiagnosticArtifactDigest',
      'failedDiagnosticArchiveSha256', 'handoffRunId', 'handoffArtifactId', 'handoffArtifactDigest', 'handoffPayloadSha256',
      'startedAt', 'finishedAt', 'patchSha256', 'changedFilesSha256', 'target', 'continuity', 'engineReceipt',
      'independentReviewMode', 'qualification', 'escalationCommentId', 'escalationCommentSha256', 'payloadSha256']);
    assertReadyReviewRecoveryRun(run, definition, originalIdentity, { commentId: receipt.escalationCommentId,
      sourceSha: expected.baseSha });
    assertReadyReviewJob(job, run, 'exact-head-review');
    assertReadyReviewArtifact(artifact, run, readyReviewRecoveryReceiptName(run.id));
    readyReviewAssert(receipt.schemaVersion === 'stephanos.protected-ready-review-recovery-receipt.v1'
      && equal(receipt.identity, originalIdentity) && receipt.recoveryRunId === run.id && receipt.recoveryRunAttempt === 1
      && receipt.recoverySourceSha === expected.baseSha && run.id > failed.run.id
      && receipt.failedReviewRunId === failed.run.id && receipt.failedReviewRunAttempt === 1
      && receipt.failedDiagnosticArtifactId === diagnostic.metadata.id
      && receipt.failedDiagnosticArtifactDigest === diagnostic.metadata.digest
      && receipt.failedDiagnosticArchiveSha256 === diagnostic.archiveSha256
      && receipt.handoffRunId === handoff.producerRunId && receipt.handoffArtifactId === proof.handoff.artifact.metadata.id
      && receipt.handoffArtifactDigest === proof.handoff.artifact.metadata.digest
      && receipt.handoffPayloadSha256 === handoff.payloadSha256
      && time(receipt.startedAt) && time(receipt.finishedAt)
      && Date.parse(receipt.startedAt) >= Date.parse(failed.job.completed_at)
      && Date.parse(receipt.startedAt) >= Date.parse(job.started_at)
      && Date.parse(receipt.finishedAt) >= Date.parse(receipt.startedAt)
      && Date.parse(receipt.finishedAt) <= Date.parse(job.completed_at)
      && receipt.patchSha256 === readyReviewSha256(input.patch)
      && receipt.changedFilesSha256 === readyReviewSha256(JSON.stringify(input.changedFiles)), 'RECOVERY_RECEIPT_BINDING');
    exactKeys(receipt.target, ['currentMainSha', 'prBaseSha', 'sourceHead', 'sourceTree', 'mergeable']);
    readyReviewAssert(receipt.target.currentMainSha === expected.baseSha
      && [originalIdentity.baseSha, expected.baseSha].includes(receipt.target.prBaseSha)
      && receipt.target.sourceHead === originalIdentity.sourceHead
      && receipt.target.sourceTree === originalIdentity.sourceTree && receipt.target.mergeable === true,
    'RECOVERY_TARGET_RECEIPT');
    const continuity = receipt.continuity;
    exactKeys(continuity, ['schemaVersion', 'fromBaseSha', 'toMainSha', 'commitShas', 'changedFiles', 'changedFilesSha256',
      'correctionFiles', 'correctionFilesSha256']);
    readyReviewAssert(continuity.schemaVersion === 'stephanos.protected-ready-review-continuity.v1'
      && continuity.fromBaseSha === originalIdentity.baseSha && continuity.toMainSha === expected.baseSha
      && Array.isArray(continuity.commitShas) && continuity.commitShas.length > 0
      && continuity.commitShas.at(-1) === expected.baseSha && new Set(continuity.commitShas).size === continuity.commitShas.length
      && Array.isArray(continuity.changedFiles) && continuity.changedFiles.length > 0
      && !continuity.changedFiles.some(path => input.changedFiles.includes(path))
      && continuity.changedFilesSha256 === readyReviewSha256(JSON.stringify(continuity.changedFiles))
      && Array.isArray(continuity.correctionFiles) && continuity.correctionFiles.length > 0
      && continuity.correctionFiles.every(path => READY_REVIEW_RECOVERY_SOURCE_PATHS.includes(path))
      && continuity.correctionFiles.every(path => continuity.changedFiles.includes(path))
      && continuity.correctionFilesSha256 === readyReviewSha256(JSON.stringify(continuity.correctionFiles)),
    'RECOVERY_CONTINUITY_RECEIPT');
    readyReviewAssert(check?.id === job.id && check.name === 'exact-head-review' && check.head_sha === expected.baseSha
      && check.status === 'completed' && check.conclusion === 'success'
      && check.app?.slug === 'github-actions' && check.app?.id === 15368
      && check.check_suite?.id === run.check_suite_id && check.details_url === job.html_url,
    'RECOVERY_CHECK_PROVENANCE');
    const reviewMode = assertReadyReviewIndependent(proof.independent, handoff.command);
    readyReviewAssert(receipt.independentReviewMode === reviewMode, 'RECOVERY_INDEPENDENT_MODE');
    const engine = receipt.engineReceipt;
    readyReviewAssert(engine?.repository === REPOSITORY && engine.prNumber === originalIdentity.prNumber
      && engine.headSha === originalIdentity.sourceHead && engine.baseSha === originalIdentity.baseSha
      && engine.reviewer === 'stephanos-deterministic-review-v1'
      && engine.authority?.readOnly === true && engine.authority?.mayEdit === false && engine.authority?.mayApprove === false
      && engine.authority?.mayMerge === false && engine.authority?.mayDeploy === false
      && engine.verdict === 'STEPHANOS_REVIEW_FINDINGS' && Array.isArray(engine.findings)
      && engine.findings.length > 0 && engine.findings.length <= 40
      && engine.findings.every(finding => finding.severity === 'P2'
        && ['AUTHORITY_SURFACE_CHANGED', 'DYNAMIC_EXECUTION'].includes(finding.code)), 'RECOVERY_ENGINE_RECEIPT');
    const q = receipt.qualification;
    readyReviewAssert(q?.ok === true && q.finalVerdict === 'EXACT_HEAD_QUALIFIED_ESCALATION_PASS'
      && q.prNumber === originalIdentity.prNumber && q.sourceHead === originalIdentity.sourceHead
      && q.reviewMode === reviewMode && q.approvalAuthority === false && q.mergeAuthority === false
      && q.ownerCommentId === receipt.escalationCommentId
      && q.independentReviewRunId === handoff.command.independentReviewRunId
      && q.independentArtifactId === handoff.command.independentReviewArtifactId
      && proof.escalationComment?.id === receipt.escalationCommentId
      && proof.escalationComment?.user?.login === OWNER && proof.escalationComment?.user?.id === OWNER_ID
      && proof.escalationComment?.author_association === 'OWNER'
      && proof.escalationComment?.issue_url === `https://api.github.com/repos/${REPOSITORY}/issues/${originalIdentity.prNumber}`
      && proof.escalationComment?.created_at === proof.escalationComment?.updated_at
      && protectedWorkflowAuthorizationCommentSha256(proof.escalationComment) === receipt.escalationCommentSha256,
    'RECOVERY_QUALIFIED_FINDINGS');
    return Object.freeze({ valid: true, identity: originalIdentity, workflowRunId: run.id, workflowRunAttempt: 1,
      artifactId: artifact.metadata.id, artifactDigest: artifact.metadata.digest, payloadSha256: receipt.payloadSha256,
      reviewMode, handoffRunId: handoff.producerRunId, handoffPayloadSha256: handoff.payloadSha256,
      failedReviewRunId: failed.run.id, recoverySourceSha: expected.baseSha });
  } catch (error) {
    return Object.freeze({ valid: false, blocker: String(error?.message || error) });
  }
}
