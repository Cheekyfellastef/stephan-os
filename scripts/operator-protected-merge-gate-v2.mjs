#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  OPERATOR_MERGE_ENVIRONMENT,
  OPERATOR_MERGE_EXECUTOR_JOB,
  OPERATOR_MERGE_GATE_JOB,
  PROTECTED_APPROVAL_MARKER,
  PROTECTED_REVIEW_MARKER,
  buildProtectedApprovalReceipt,
  extractJsonObjects,
  parseIndependentReviewSessionId,
  validateIndependentReviewWorkflowRun,
  validateProtectedOperatorMergeEvidence,
  validateProtectedOperatorMergePrerequisites,
} from '../shared/agents/operatorMergeApprovalGate.mjs';
import {
  buildBaseBoundApprovalReceipt,
  validateBaseBoundApprovalReceipt,
  validateIndependentReviewBaseBinding,
  validateIndependentWorkflowBaseBinding,
  validateMainRefBaseBinding,
  validatePullRequestBaseBinding,
} from '../shared/agents/operatorMergeBaseBindingV1.mjs';

const mode = String(process.argv[2] || '').trim().toLowerCase();
const actionsBotLogin = 'github-actions[bot]';

function emit(packet, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
  process.exit(exitCode);
}

function fail(message, details = {}) {
  emit({ finalStatus: 'BLOCKED', message, ...details }, 1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: process.env,
    ...options,
  });
  return {
    command: [command, ...args].join(' '),
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  };
}

function runRequired(command, args, message) {
  const result = run(command, args);
  if (result.exitCode !== 0) fail(message, { result });
  return result;
}

function parseJson(value, message) {
  try {
    return JSON.parse(value);
  } catch (error) {
    fail(message, { error: error.message, value });
  }
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function flattenPages(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (Array.isArray(entry) ? flattenPages(entry) : [entry]));
}

function appendFields(args, fields) {
  for (const field of fields) {
    const [name, value, typed = false] = field;
    args.push(typed ? '-F' : '-f', `${name}=${value}`);
  }
}

function api(endpoint, { paginate = false, method = 'GET', fields = [] } = {}) {
  const args = ['api', endpoint, '--method', method];
  if (paginate) args.push('--paginate', '--slurp');
  appendFields(args, fields);
  return parseJson(
    runRequired('gh', args, `GitHub API request failed: ${method} ${endpoint}`).stdout,
    `GitHub API returned invalid JSON: ${endpoint}`,
  );
}

function apiNoContent(endpoint, { method = 'POST', fields = [] } = {}) {
  const args = ['api', endpoint, '--method', method];
  appendFields(args, fields);
  return runRequired('gh', args, `GitHub API request failed: ${method} ${endpoint}`);
}

if (!['approve', 'merge'].includes(mode)) fail('Mode must be approve or merge.');
if (process.env.GITHUB_ACTIONS !== 'true') fail('Protected merge gate may run only inside GitHub Actions.');
if (process.env.GITHUB_EVENT_NAME !== 'pull_request_target') fail('Protected merge gate requires pull_request_target.');
if (!process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_RUN_ID || !process.env.GITHUB_RUN_ATTEMPT) {
  fail('GitHub Actions event and run identity are required.');
}
if (!process.env.GH_TOKEN) fail('GitHub Actions token is required.');

const event = parseJson(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'), 'GitHub event payload was invalid.');
const repository = String(process.env.GITHUB_REPOSITORY || event?.repository?.full_name || '').trim();
const [owner, repo] = repository.split('/');
const prNumber = integer(event?.pull_request?.number);
const sourceHead = String(event?.pull_request?.head?.sha || '').trim().toLowerCase();
const baseSha = String(event?.pull_request?.base?.sha || '').trim().toLowerCase();
const branch = String(event?.pull_request?.head?.ref || '').trim();
const baseBranch = String(event?.pull_request?.base?.ref || '').trim();
const runId = integer(process.env.GITHUB_RUN_ID);
const runAttempt = integer(process.env.GITHUB_RUN_ATTEMPT);
if (!owner || !repo || !prNumber || !/^[a-f0-9]{40}$/.test(sourceHead)
  || !/^[a-f0-9]{40}$/.test(baseSha) || !branch || baseBranch !== 'main') {
  fail('Pull request target identity is incomplete or unsafe.', {
    repository, prNumber, sourceHead, baseSha, branch, baseBranch,
  });
}

function collectRawEvidence() {
  const encodedEnvironment = encodeURIComponent(OPERATOR_MERGE_ENVIRONMENT);
  const environment = api(`repos/${owner}/${repo}/environments/${encodedEnvironment}`);
  const pullRequest = api(`repos/${owner}/${repo}/pulls/${prNumber}`);
  const mainRef = api(`repos/${owner}/${repo}/git/ref/heads/main`);
  const workflowRun = api(`repos/${owner}/${repo}/actions/runs/${runId}`);
  const workflowRunsPayload = api(`repos/${owner}/${repo}/actions/runs?head_sha=${sourceHead}&per_page=100`);
  const comments = flattenPages(api(`repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`, { paginate: true }));
  const threadQuery = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}}}}`;
  const threadPayload = api('graphql', {
    method: 'POST',
    fields: [
      ['query', threadQuery],
      ['owner', owner],
      ['repo', repo],
      ['number', prNumber, true],
    ],
  });
  const reviewThreads = threadPayload?.data?.repository?.pullRequest?.reviewThreads;
  if (!reviewThreads || reviewThreads.pageInfo?.hasNextPage) {
    fail('Review-thread evidence is missing or exceeds the bounded first page.');
  }
  const threads = reviewThreads.nodes || [];
  return {
    environment,
    pullRequest,
    mainRef,
    workflowRun,
    workflowRuns: workflowRunsPayload?.workflow_runs || [],
    comments,
    threads,
    unresolvedThreadCount: threads.filter((thread) => thread?.isResolved !== true).length,
  };
}

function validateCurrentBase(raw, phase) {
  const prBase = validatePullRequestBaseBinding(raw.pullRequest, baseSha);
  const liveBase = validateMainRefBaseBinding(raw.mainRef, baseSha);
  if (!prBase.valid || !liveBase.valid) {
    fail(`${phase} exact-base evidence changed.`, { prBase, liveBase, sourceHead, baseSha });
  }
  return { prBase, liveBase };
}

function matchingApprovalComment(comments) {
  for (const comment of [...comments].reverse()) {
    if (String(comment?.user?.login || '') !== actionsBotLogin) continue;
    if (!String(comment?.body || '').includes(PROTECTED_APPROVAL_MARKER)) continue;
    const receipt = extractJsonObjects(comment.body).find((candidate) => (
      validateBaseBoundApprovalReceipt(candidate, {
        prNumber,
        expectedHead: sourceHead,
        expectedBaseSha: baseSha,
        workflowRunId: runId,
        workflowRunAttempt: runAttempt,
      }).valid
    ));
    if (receipt) return { comment, receipt };
  }
  return null;
}

function independentReviewCandidate(comment) {
  if (String(comment?.user?.login || '') !== actionsBotLogin) return null;
  if (!String(comment?.body || '').includes(PROTECTED_REVIEW_MARKER)) return null;
  const receipt = extractJsonObjects(comment.body).find((candidate) => (
    candidate?.kind === 'stephanos.provider-neutral.review'
      && integer(candidate.prNumber) === prNumber
      && String(candidate.sourceHead || '').toLowerCase() === sourceHead
      && validateIndependentReviewBaseBinding(candidate, baseSha).valid
  ));
  const identity = parseIndependentReviewSessionId(receipt?.reviewerSessionId);
  return receipt && identity ? { comment, receipt, identity } : null;
}

function loadIndependentReview(comments) {
  for (const comment of [...comments].reverse()) {
    const candidate = independentReviewCandidate(comment);
    if (!candidate) continue;
    const reviewWorkflowRun = api(`repos/${owner}/${repo}/actions/runs/${candidate.identity.workflowRunId}`);
    const jobsPayload = api(`repos/${owner}/${repo}/actions/runs/${candidate.identity.workflowRunId}/jobs?per_page=100`);
    const reviewWorkflowJobs = jobsPayload?.jobs || [];
    const workflowValidation = validateIndependentReviewWorkflowRun(reviewWorkflowRun, reviewWorkflowJobs, {
      repository,
      prNumber,
      expectedHead: sourceHead,
      workflowRunId: candidate.identity.workflowRunId,
      workflowRunAttempt: candidate.identity.workflowRunAttempt,
    });
    const workflowBaseValidation = validateIndependentWorkflowBaseBinding(reviewWorkflowRun, prNumber, baseSha);
    if (workflowValidation.valid && workflowBaseValidation.valid) {
      return {
        ...candidate,
        reviewWorkflowRun,
        reviewWorkflowJobs,
        workflowValidation,
        workflowBaseValidation,
      };
    }
  }
  return null;
}

function postComment(body) {
  apiNoContent(`repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    fields: [['body', body]],
  });
}

function evidenceInput(raw, independentReview) {
  return {
    repository,
    prNumber,
    sourceHead,
    branch,
    baseBranch,
    environment: raw.environment,
    pullRequest: raw.pullRequest,
    workflowRun: raw.workflowRun,
    workflowRuns: raw.workflowRuns,
    unresolvedThreadCount: raw.unresolvedThreadCount,
    trustedReviewReceipt: independentReview?.receipt,
    reviewWorkflowRun: independentReview?.reviewWorkflowRun,
    reviewWorkflowJobs: independentReview?.reviewWorkflowJobs,
    reviewWorkflowRunId: independentReview?.identity?.workflowRunId,
    reviewWorkflowRunAttempt: independentReview?.identity?.workflowRunAttempt,
  };
}

function validateAllEvidence(raw, independentReview, phase) {
  validateCurrentBase(raw, phase);
  if (!independentReview) fail(`${phase} authenticated independent exact-head and exact-base security review is missing.`);
  const verdict = validateProtectedOperatorMergeEvidence(evidenceInput(raw, independentReview));
  if (verdict.finalVerdict !== 'PROTECTED_OPERATOR_MERGE_READY') {
    fail(`${phase} protected operator evidence is incomplete or stale.`, { verdict });
  }
  return verdict;
}

if (mode === 'approve') {
  if (process.env.GITHUB_JOB !== OPERATOR_MERGE_GATE_JOB) {
    fail('Approval evidence may be issued only by the protected environment gate job.', { job: process.env.GITHUB_JOB });
  }

  const raw = collectRawEvidence();
  validateCurrentBase(raw, 'pre-approval');
  const prerequisites = validateProtectedOperatorMergePrerequisites(evidenceInput(raw, null));
  if (prerequisites.finalVerdict !== 'PROTECTED_OPERATOR_PREREQUISITES_READY') {
    fail('Protected operator prerequisites are incomplete or stale.', { prerequisites });
  }

  const independentReview = loadIndependentReview(raw.comments);
  const verdict = validateAllEvidence(raw, independentReview, 'pre-approval');

  const existingApproval = matchingApprovalComment(raw.comments);
  if (!existingApproval) {
    const approvalReceipt = buildBaseBoundApprovalReceipt(buildProtectedApprovalReceipt({
      verdict,
      workflowRunId: runId,
      workflowRunAttempt: runAttempt,
      approvedAtUtc: new Date().toISOString(),
    }), baseSha);
    const approvalBody = `${PROTECTED_APPROVAL_MARKER}\n## GitHub-protected operator approval passed\n\nExact head: \`${sourceHead}\`\nExact base: \`${baseSha}\`\n\n\`\`\`json\n${JSON.stringify(approvalReceipt, null, 2)}\n\`\`\`\n\nThis receipt was produced only after the protected environment released the job. It authorises merge for this PR, workflow run, exact head and exact base only. Any movement of head or base invalidates it.`;
    postComment(approvalBody);
  }

  emit({
    finalStatus: 'INDEPENDENT_REVIEW_AND_BASE_BOUND_OPERATOR_APPROVAL_RECORDED',
    repository,
    prNumber,
    sourceHead,
    baseSha,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    independentReviewWorkflowRunId: independentReview.identity.workflowRunId,
    independentReviewWorkflowRunAttempt: independentReview.identity.workflowRunAttempt,
    independentReviewReceipt: independentReview.receipt,
  });
}

if (process.env.GITHUB_JOB !== OPERATOR_MERGE_EXECUTOR_JOB) {
  fail('Merge may run only in the trusted post-environment merge job.', { job: process.env.GITHUB_JOB });
}
const jobsPayload = api(`repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`);
const gateJob = (jobsPayload?.jobs || []).find((job) => job?.name === OPERATOR_MERGE_GATE_JOB);
if (!gateJob || gateJob.status !== 'completed' || gateJob.conclusion !== 'success') {
  fail('The protected environment gate job is not complete and successful.', { gateJob });
}

const raw = collectRawEvidence();
const independentReview = loadIndependentReview(raw.comments);
const protectedApproval = matchingApprovalComment(raw.comments);
if (!protectedApproval) fail('Same-run exact-head and exact-base operator approval receipt is missing.');
validateAllEvidence(raw, independentReview, 'post-approval');

const finalRaw = collectRawEvidence();
const finalIndependentReview = loadIndependentReview(finalRaw.comments);
const finalProtectedApproval = matchingApprovalComment(finalRaw.comments);
if (!finalProtectedApproval) fail('Base-bound operator approval disappeared before merge.');
if (integer(finalProtectedApproval.comment.id) !== integer(protectedApproval.comment.id)) {
  fail('Operator approval receipt identity changed before merge.');
}
if (!finalIndependentReview || integer(finalIndependentReview.comment.id) !== integer(independentReview.comment.id)) {
  fail('Independent review receipt identity changed before merge.');
}
validateAllEvidence(finalRaw, finalIndependentReview, 'immediately-before-merge');

runRequired('gh', [
  'pr', 'merge', String(prNumber),
  '--repo', repository,
  '--squash',
  '--match-head-commit', sourceHead,
], 'Protected exact-head and exact-base merge failed.');

const merged = api(`repos/${owner}/${repo}/pulls/${prNumber}`);
if (merged?.merged !== true || String(merged?.head?.sha || '').toLowerCase() !== sourceHead || !merged?.merge_commit_sha) {
  fail('Merged evidence is incomplete or does not match the approved exact head.', { merged });
}

emit({
  schemaVersion: 'stephanos.protected-operator-merge-completion.v4',
  finalStatus: 'MERGED',
  repository,
  prNumber,
  sourceHead,
  approvedBaseSha: baseSha,
  mergeCommit: merged.merge_commit_sha,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  independentReviewCommentId: integer(finalIndependentReview.comment.id),
  independentReviewWorkflowRunId: finalIndependentReview.identity.workflowRunId,
  protectedApprovalCommentId: integer(finalProtectedApproval.comment.id),
  environment: OPERATOR_MERGE_ENVIRONMENT,
});
