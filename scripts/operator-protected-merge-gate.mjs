import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  OPERATOR_MERGE_ENVIRONMENT,
  OPERATOR_MERGE_GATE_JOB,
  PROTECTED_APPROVAL_MARKER,
  buildProtectedApprovalReceipt,
  extractJsonObjects,
  validateProtectedOperatorMergeEvidence,
} from '../shared/agents/operatorMergeApprovalGate.mjs';

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
  return parseJson(runRequired('gh', args, `GitHub API request failed: ${method} ${endpoint}`).stdout, `GitHub API returned invalid JSON: ${endpoint}`);
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
const branch = String(event?.pull_request?.head?.ref || '').trim();
const baseBranch = String(event?.pull_request?.base?.ref || '').trim();
const runId = integer(process.env.GITHUB_RUN_ID);
const runAttempt = integer(process.env.GITHUB_RUN_ATTEMPT);
if (!owner || !repo || !prNumber || !/^[a-f0-9]{40}$/.test(sourceHead) || !branch || baseBranch !== 'main') {
  fail('Pull request target identity is incomplete or unsafe.', { repository, prNumber, sourceHead, branch, baseBranch });
}

function collectEvidence() {
  const encodedEnvironment = encodeURIComponent(OPERATOR_MERGE_ENVIRONMENT);
  const environment = api(`repos/${owner}/${repo}/environments/${encodedEnvironment}`);
  const pullRequest = api(`repos/${owner}/${repo}/pulls/${prNumber}`);
  const workflowRun = api(`repos/${owner}/${repo}/actions/runs/${runId}`);
  const workflowRunsPayload = api(`repos/${owner}/${repo}/actions/runs?head_sha=${sourceHead}&per_page=100`);
  const reviews = flattenPages(api(`repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`, { paginate: true }));
  const comments = flattenPages(api(`repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`, { paginate: true }));
  const threadQuery = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}`;
  const threadPayload = api('graphql', {
    method: 'POST',
    fields: [
      ['query', threadQuery],
      ['owner', owner],
      ['repo', repo],
      ['number', prNumber, true],
    ],
  });
  const threads = threadPayload?.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
  const reviewBodies = [...reviews, ...comments].map((entry) => String(entry?.body || '')).filter(Boolean);
  const verdict = validateProtectedOperatorMergeEvidence({
    repository,
    prNumber,
    sourceHead,
    branch,
    baseBranch,
    environment,
    pullRequest,
    workflowRun,
    workflowRuns: workflowRunsPayload?.workflow_runs || [],
    reviewBodies,
    unresolvedThreadCount: threads.filter((thread) => thread?.isResolved !== true).length,
  });
  return { environment, pullRequest, workflowRun, workflowRunsPayload, reviews, comments, threads, reviewBodies, verdict };
}

function currentApprovalComment(comments) {
  return comments.find((comment) => {
    if (String(comment?.user?.login || '') !== actionsBotLogin) return false;
    if (!String(comment?.body || '').includes(PROTECTED_APPROVAL_MARKER)) return false;
    return extractJsonObjects(comment.body).some((receipt) => (
      receipt?.kind === 'stephanos.protected-operator-approval'
      && integer(receipt.workflowRunId) === runId
      && integer(receipt.prNumber) === prNumber
      && String(receipt.sourceHead || '').toLowerCase() === sourceHead
    ));
  }) || null;
}

if (mode === 'approve') {
  if (process.env.GITHUB_JOB !== OPERATOR_MERGE_GATE_JOB) {
    fail('Approval evidence may be issued only by the protected environment gate job.', { job: process.env.GITHUB_JOB });
  }
  const evidence = collectEvidence();
  if (evidence.verdict.finalVerdict !== 'PROTECTED_OPERATOR_MERGE_READY') {
    fail('Protected operator approval evidence is incomplete or stale.', { verdict: evidence.verdict });
  }
  if (currentApprovalComment(evidence.comments)) {
    emit({
      finalStatus: 'PROTECTED_OPERATOR_APPROVAL_ALREADY_RECORDED',
      repository,
      prNumber,
      sourceHead,
      workflowRunId: runId,
    });
  }
  const receipt = buildProtectedApprovalReceipt({
    verdict: evidence.verdict,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    approvedAtUtc: new Date().toISOString(),
  });
  const body = `${PROTECTED_APPROVAL_MARKER}\n## GitHub-protected operator approval passed\n\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\`\n\nThis receipt was produced by the GitHub Actions job only after the protected environment released the job. It is bound to this PR and exact head and cannot authorize another head.`;
  apiNoContent(`repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    fields: [['body', body]],
  });
  emit({
    finalStatus: 'PROTECTED_OPERATOR_APPROVAL_RECORDED',
    repository,
    prNumber,
    sourceHead,
    workflowRunId: runId,
    receipt,
  });
}

if (process.env.GITHUB_JOB !== 'operator-approved-exact-head-merge') {
  fail('Merge may run only in the trusted post-environment merge job.', { job: process.env.GITHUB_JOB });
}
const jobsPayload = api(`repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`);
const gateJob = (jobsPayload?.jobs || []).find((job) => job?.name === OPERATOR_MERGE_GATE_JOB);
if (!gateJob || gateJob.status !== 'completed' || gateJob.conclusion !== 'success') {
  fail('The protected environment gate job is not complete and successful.', { gateJob });
}

const immediatelyBeforeMerge = collectEvidence();
if (immediatelyBeforeMerge.verdict.finalVerdict !== 'PROTECTED_OPERATOR_MERGE_READY') {
  fail('Exact-head evidence changed after protected approval.', { verdict: immediatelyBeforeMerge.verdict });
}
const approvalComment = currentApprovalComment(immediatelyBeforeMerge.comments);
if (!approvalComment) {
  fail('GitHub Actions protected approval receipt is missing for this exact run and head.');
}

runRequired('gh', [
  'pr', 'merge', String(prNumber),
  '--repo', repository,
  '--squash',
  '--match-head-commit', sourceHead,
], 'Protected exact-head merge failed.');

const merged = api(`repos/${owner}/${repo}/pulls/${prNumber}`);
if (merged?.merged !== true || String(merged?.head?.sha || '').toLowerCase() !== sourceHead || !merged?.merge_commit_sha) {
  fail('Merged evidence is incomplete or does not match the approved exact head.', { merged });
}

emit({
  schemaVersion: 'stephanos.protected-operator-merge-completion.v1',
  finalStatus: 'MERGED',
  repository,
  prNumber,
  sourceHead,
  mergeCommit: merged.merge_commit_sha,
  workflowRunId: runId,
  protectedApprovalCommentId: integer(approvalComment.id),
  environment: OPERATOR_MERGE_ENVIRONMENT,
});
