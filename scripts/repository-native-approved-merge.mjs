import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildConsumedApprovalRecord,
  validateOperatorMergeApproval,
} from '../shared/agents/operatorMergeApprovalGate.mjs';

const CONSUMPTION_MARKER = '<!-- stephanos-operator-merge-approval-consumed -->';

function emit(packet, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
  process.exit(exitCode);
}

function fail(message, details = {}) {
  emit({ finalStatus: 'BLOCKED', message, ...details }, 1);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, windowsHide: true });
  return {
    command: [command, ...args].join(' '),
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  };
}

function runRequired(command, args, cwd, message) {
  const result = run(command, args, cwd);
  if (result.exitCode !== 0) fail(message, { result });
  return result;
}

function parseJson(stdout, message) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    fail(message, { error: error.message, stdout });
  }
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function consumedReceiptIds(comments) {
  const ids = [];
  for (const comment of Array.isArray(comments) ? comments : []) {
    const body = String(comment?.body || '');
    if (!body.includes(CONSUMPTION_MARKER)) continue;
    const match = body.match(/"receiptId"\s*:\s*"([^"]+)"/);
    if (match?.[1]) ids.push(match[1]);
  }
  return [...new Set(ids)];
}

const requestPath = process.argv[2];
if (!requestPath) fail('Usage: npm run stephanos:approved-merge -- <approval-request.json>');

let request;
try {
  request = JSON.parse(readFileSync(resolve(requestPath), 'utf8'));
} catch (error) {
  fail('Approved merge request could not be read.', { error: error.message });
}

const repository = String(request.repository || '').trim();
const [owner, repo] = repository.split('/');
const prNumber = integer(request.prNumber);
const expectedHead = String(request.sourceHead || '').trim().toLowerCase();
const expectedBase = String(request.baseBranch || 'main').trim();
const expectedOperatorId = String(request.operatorId || '').trim();
const mergeExecutionId = String(request.mergeExecutionId || '').trim();
const repositoryRoot = resolve(request.repositoryRoot || process.cwd());
if (!owner || !repo || !prNumber || !expectedHead || !expectedOperatorId || !mergeExecutionId) {
  fail('Approved merge request is missing repository, PR, exact head, operator identity, or merge execution identity.');
}

const viewArgs = ['pr', 'view', String(prNumber), '--repo', repository, '--json', 'number,headRefOid,isDraft,state,mergeable,baseRefName'];
const before = parseJson(runRequired('gh', viewArgs, repositoryRoot, 'Could not inspect the pull request before approval validation.').stdout, 'Pull request payload was not JSON.');
if (before.number !== prNumber || before.state !== 'OPEN' || before.headRefOid !== expectedHead || before.baseRefName !== expectedBase) {
  fail('Pull request no longer matches the approval target.', { before, expectedHead, expectedBase });
}
if (before.mergeable !== 'MERGEABLE') fail('Pull request is not currently mergeable.', { before });

const checks = run('gh', ['pr', 'checks', String(prNumber), '--repo', repository], repositoryRoot);
if (checks.exitCode !== 0) fail('Pull request checks are missing, pending, stale, or failing.', { checks });

const threadQuery = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}`;
const threadPayload = parseJson(runRequired('gh', [
  'api', 'graphql',
  '-f', `query=${threadQuery}`,
  '-F', `owner=${owner}`,
  '-F', `repo=${repo}`,
  '-F', `number=${prNumber}`,
], repositoryRoot, 'Could not inspect review threads.').stdout, 'Review-thread payload was not JSON.');
const reviewThreads = threadPayload?.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
const unresolvedThreadCount = reviewThreads.filter((thread) => thread?.isResolved !== true).length;
if (unresolvedThreadCount > 0) fail('Pull request has unresolved review threads.', { unresolvedThreadCount });

const comments = parseJson(runRequired('gh', [
  'api', `repos/${owner}/${repo}/issues/${prNumber}/comments`, '--paginate',
], repositoryRoot, 'Could not inspect prior approval consumption records.').stdout, 'Issue comments payload was not JSON.');

const approvalVerdict = validateOperatorMergeApproval({
  challenge: request.challenge,
  receipt: request.approvalReceipt,
  expectedRepository: repository,
  expectedPrNumber: prNumber,
  expectedSourceHead: expectedHead,
  expectedOperatorId,
  mergeExecutionId,
  consumedReceiptIds: consumedReceiptIds(comments),
  nowUtc: request.nowUtc || new Date().toISOString(),
});
if (approvalVerdict.finalVerdict !== 'OPERATOR_MERGE_APPROVAL_READY') {
  fail('Direct operator exact-head approval is absent, invalid, stale, ambiguous, self-issued, or already consumed.', { approvalVerdict });
}

const beforeConsumption = parseJson(runRequired('gh', viewArgs, repositoryRoot, 'Could not revalidate the pull request immediately before approval consumption.').stdout, 'Pull request payload was not JSON.');
if (beforeConsumption.state !== 'OPEN' || beforeConsumption.headRefOid !== expectedHead || beforeConsumption.mergeable !== 'MERGEABLE') {
  fail('Pull request changed before approval consumption.', { beforeConsumption, expectedHead });
}

const reservation = buildConsumedApprovalRecord({
  verdict: approvalVerdict,
  mergeExecutionId,
  consumedAtUtc: new Date().toISOString(),
});
const reservationBody = `${CONSUMPTION_MARKER}\n## Exact-head operator approval reserved\n\n\`\`\`json\n${JSON.stringify(reservation, null, 2)}\n\`\`\`\n\nThis one-time receipt is now consumed even if the subsequent merge fails. A new approval is required for any retry or head change.`;
runRequired('gh', ['pr', 'comment', String(prNumber), '--repo', repository, '--body', reservationBody], repositoryRoot, 'Could not reserve the one-time operator approval receipt.');

if (beforeConsumption.isDraft) {
  runRequired('gh', ['pr', 'ready', String(prNumber), '--repo', repository], repositoryRoot, 'Could not mark the approved exact-head pull request ready.');
}
const afterReady = parseJson(runRequired('gh', viewArgs, repositoryRoot, 'Could not revalidate the pull request after ready transition.').stdout, 'Pull request payload was not JSON.');
if (afterReady.state !== 'OPEN' || afterReady.headRefOid !== expectedHead || afterReady.isDraft || afterReady.mergeable !== 'MERGEABLE') {
  fail('Pull request changed or became unmergeable after ready transition.', { afterReady, expectedHead });
}

runRequired('gh', ['pr', 'merge', String(prNumber), '--repo', repository, '--squash', '--match-head-commit', expectedHead], repositoryRoot, 'Exact-head approved merge failed.');
const merged = parseJson(runRequired('gh', ['pr', 'view', String(prNumber), '--repo', repository, '--json', 'state,mergeCommit,headRefOid'], repositoryRoot, 'Could not read merged evidence.').stdout, 'Merged pull request payload was not JSON.');
const mergeCommit = merged?.mergeCommit?.oid || '';
if (merged.state !== 'MERGED' || merged.headRefOid !== expectedHead || !mergeCommit) {
  fail('Merge evidence is incomplete or mismatched.', { merged, expectedHead });
}

emit({
  schemaVersion: 'repository-native-approved-merge.completion.v1',
  finalStatus: 'MERGED',
  repository,
  prNumber,
  sourceHead: expectedHead,
  mergeCommit,
  approvalConsumption: buildConsumedApprovalRecord({
    verdict: approvalVerdict,
    mergeExecutionId,
    mergeCommit,
    consumedAtUtc: new Date().toISOString(),
  }),
  unresolvedThreadCount,
  checksVerdict: 'PASS',
});
