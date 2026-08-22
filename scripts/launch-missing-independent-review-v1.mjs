#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateIndependentReviewHandoffIdentityV1,
} from '../shared/agents/independentReviewHandoffIdentityV1.mjs';
import {
  admitIndependentReviewWorkflowDispatchV1,
} from '../shared/agents/independentReviewWorkflowDispatchAdmissionV1.mjs';
import {
  INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT,
  INDEPENDENT_REVIEW_RETRY_DECISION,
  planIndependentReviewRetry,
} from '../shared/agents/independentReviewRetryPlanner.mjs';
import {
  buildIndependentReviewRunQueryV1,
  selectIndependentReviewRunCandidatesV1,
} from '../shared/agents/independentReviewRunDiscoveryV1.mjs';
import {
  INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION,
  planIndependentReviewMissingRunLaunchV1,
} from '../shared/agents/independentReviewMissingRunLaunchV1.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER,
  buildIndependentReviewWorkflowDispatchLaunchReceiptV1,
  parseIndependentReviewWorkflowDispatchLaunchReceiptCommentV1,
  renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1,
  validateIndependentReviewWorkflowDispatchLaunchReceiptV1,
} from '../shared/agents/independentReviewWorkflowDispatchLaunchReceiptV1.mjs';
import {
  discoverIndependentReviewWorkflowDispatchRunV1,
} from '../shared/agents/independentReviewWorkflowDispatchRunDiscoveryV1.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
} from '../shared/agents/operatorMergeApprovalGate.mjs';

const API_VERSION = '2026-03-10';
const USER_AGENT = 'stephanos-independent-review-missing-run-launch-v1';
const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({ login: 'github-actions[bot]', id: 41898282 });
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SHA64 = /^[0-9a-f]{64}$/i;
const MAX_PAGES = 20;
const MAX_DISPATCH_RUN_HYDRATIONS = 20;
const GITHUB_TIMESTAMP_PRECISION_MS = 1000;
const DISPATCH_ACK_SCHEMA = 'stephanos.independent-review-workflow-dispatch-run-ack.v1';
const DISPATCH_ACK_MARKER = 'stephanos:independent-review-workflow-dispatch-run:v1';

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function appendOutput(name, value) {
  const outputPath = text(process.env.GITHUB_OUTPUT);
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${String(value ?? '').replace(/\r?\n/g, ' ')}\n`);
}

function repositoryParts(repository) {
  const match = text(repository).match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error('GITHUB_REPOSITORY must be owner/name');
  return { owner: match[1], repo: match[2] };
}

function exactRunnerTempFile(requested) {
  const root = path.resolve(text(process.env.RUNNER_TEMP));
  const target = path.resolve(text(requested));
  if (!text(process.env.RUNNER_TEMP) || !text(requested)) throw new Error('RUNNER_TEMP and receipt path are required');
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('handoff receipt path must be a file inside RUNNER_TEMP');
  }
  return target;
}

async function githubRequest(pathname, { method = 'GET', body = null, token } = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = raw; }
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' ? payload.message : raw;
    throw new Error(`GitHub ${method} ${pathname} failed (${response.status}): ${text(message).slice(0, 300)}`);
  }
  return payload;
}

async function githubPages(pathname, { token, itemKey = null } = {}) {
  const separator = pathname.includes('?') ? '&' : '?';
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await githubRequest(`${pathname}${separator}per_page=100&page=${page}`, { token });
    const values = itemKey ? payload?.[itemKey] : payload;
    if (!Array.isArray(values)) throw new Error(`GitHub pagination payload for ${pathname} is invalid`);
    rows.push(...values);
    if (values.length < 100) return rows;
  }
  throw new Error(`GitHub pagination exceeded ${MAX_PAGES * 100} records for ${pathname}`);
}

function mapPullRequest(pr) {
  return {
    number: positiveInteger(pr?.number),
    state: text(pr?.state),
    draft: pr?.draft === true,
    sameRepository: text(pr?.head?.repo?.full_name).toLowerCase() === text(pr?.base?.repo?.full_name).toLowerCase(),
    headRef: text(pr?.head?.ref),
    headSha: text(pr?.head?.sha).toLowerCase(),
    baseRef: text(pr?.base?.ref),
    baseSha: text(pr?.base?.sha).toLowerCase(),
  };
}

function mapRun(run) {
  return {
    id: positiveInteger(run?.id),
    run_number: positiveInteger(run?.run_number),
    run_attempt: positiveInteger(run?.run_attempt),
    workflow_id: positiveInteger(run?.workflow_id),
    name: text(run?.name),
    path: text(run?.path),
    event: text(run?.event),
    repository: { full_name: text(run?.repository?.full_name) },
    head_branch: text(run?.head_branch),
    head_sha: text(run?.head_sha).toLowerCase(),
    display_title: text(run?.display_title),
    status: text(run?.status),
    conclusion: text(run?.conclusion),
    created_at: run?.created_at ?? null,
    pull_requests: Array.isArray(run?.pull_requests) ? run.pull_requests.map((item) => ({
      number: positiveInteger(item?.number),
      head: { ref: text(item?.head?.ref), sha: text(item?.head?.sha).toLowerCase() },
      base: { ref: text(item?.base?.ref), sha: text(item?.base?.sha).toLowerCase() },
    })) : [],
  };
}

function sameOrLaterGithubTimestamp(runCreatedAt, requestedAtUtc) {
  const createdAt = Date.parse(text(runCreatedAt));
  const requestedAt = Date.parse(text(requestedAtUtc));
  return Number.isFinite(createdAt)
    && Number.isFinite(requestedAt)
    && Math.floor(createdAt / GITHUB_TIMESTAMP_PRECISION_MS)
      >= Math.floor(requestedAt / GITHUB_TIMESTAMP_PRECISION_MS);
}

function assertWorkflowDispatchSummaryDetailBinding(summary, detail, workflowId) {
  const summaryId = positiveInteger(summary?.id);
  const detailId = positiveInteger(detail?.id);
  if (!summaryId || detailId !== summaryId) {
    throw new Error(`workflow-dispatch run summary/detail id mismatch for run ${summaryId || 'unknown'}`);
  }
  const summaryWorkflowId = positiveInteger(summary?.workflow_id);
  if (summaryWorkflowId && summaryWorkflowId !== workflowId) {
    throw new Error(`workflow-dispatch run summary workflow mismatch for run ${summaryId}`);
  }
  if (positiveInteger(detail?.workflow_id) !== workflowId) {
    throw new Error(`workflow-dispatch run detail workflow mismatch for run ${summaryId}`);
  }
  const summaryAttempt = positiveInteger(summary?.run_attempt);
  if (summaryAttempt && summaryAttempt !== positiveInteger(detail?.run_attempt)) {
    throw new Error(`workflow-dispatch run summary/detail attempt mismatch for run ${summaryId}`);
  }
}

function plausibleWorkflowDispatchSummary(summary, workflowId, launchReceipt) {
  const requestedAtUtc = text(launchReceipt?.requestedAtUtc);
  const expectedRunName = text(launchReceipt?.runName);
  if (!Number.isFinite(Date.parse(requestedAtUtc)) || !expectedRunName) {
    throw new Error('workflow-dispatch launch receipt timestamp and run name are required for bounded hydration');
  }
  const summaryWorkflowId = positiveInteger(summary?.workflow_id);
  if (summaryWorkflowId && summaryWorkflowId !== workflowId) {
    throw new Error(`workflow-dispatch list returned a foreign workflow id ${summaryWorkflowId}`);
  }
  const event = text(summary?.event);
  if (event && event !== 'workflow_dispatch') {
    throw new Error(`workflow-dispatch list returned foreign event ${event}`);
  }
  const branch = text(summary?.head_branch);
  if (branch && branch !== 'main') {
    throw new Error(`workflow-dispatch list returned foreign branch ${branch}`);
  }
  const displayTitle = text(summary?.display_title);
  const createdAt = text(summary?.created_at);
  if (createdAt) {
    if (!sameOrLaterGithubTimestamp(createdAt, requestedAtUtc)) return false;
  } else if (displayTitle !== expectedRunName) {
    return false;
  }
  if (!positiveInteger(summary?.id)) {
    if (displayTitle === expectedRunName || createdAt) {
      throw new Error('plausible workflow-dispatch summary is missing a positive run id');
    }
    return false;
  }
  return true;
}

async function loadCanonicalWorkflow(owner, repo, token) {
  const workflows = await githubPages(`/repos/${owner}/${repo}/actions/workflows`, { token, itemKey: 'workflows' });
  const pathMatches = workflows.filter((workflow) => text(workflow?.path) === INDEPENDENT_REVIEW_WORKFLOW_PATH);
  const nameCollisions = workflows.filter((workflow) => text(workflow?.name) === INDEPENDENT_REVIEW_WORKFLOW_NAME
    && text(workflow?.path) !== INDEPENDENT_REVIEW_WORKFLOW_PATH);
  if (pathMatches.length !== 1 || nameCollisions.length) throw new Error('canonical independent-review workflow identity is missing or ambiguous');
  const workflow = pathMatches[0];
  return {
    id: positiveInteger(workflow?.id),
    name: text(workflow?.name),
    path: text(workflow?.path),
    state: text(workflow?.state),
  };
}

async function loadPullRequestTargetRuns(owner, repo, workflowId, pr, token) {
  const query = buildIndependentReviewRunQueryV1({ workflowId, expectedHead: pr.headSha });
  const payload = await githubRequest(`/repos/${owner}/${repo}${query}`, { token });
  if (!Array.isArray(payload?.workflow_runs) || positiveInteger(payload?.total_count) > payload.workflow_runs.length) {
    throw new Error('bounded pull_request_target review-run query is incomplete');
  }
  const candidates = selectIndependentReviewRunCandidatesV1({
    runs: payload.workflow_runs,
    prNumber: pr.number,
    headRef: pr.headRef,
    expectedHead: pr.headSha,
    expectedBase: pr.baseSha,
  });
  const rows = [];
  for (const candidate of candidates.slice(0, 20)) {
    rows.push(mapRun(await githubRequest(`/repos/${owner}/${repo}/actions/runs/${positiveInteger(candidate.id)}`, { token })));
  }
  return rows;
}

function dispatchRunApiUrl(owner, repo, runId) {
  return `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`;
}

function dispatchRunHtmlUrl(owner, repo, runId) {
  return `https://github.com/${owner}/${repo}/actions/runs/${runId}`;
}

export function validateWorkflowDispatchCreationResponseV1(payload = {}, { owner, repo } = {}) {
  const runId = positiveInteger(payload?.workflow_run_id);
  if (!runId || !text(owner) || !text(repo)) {
    throw new Error('workflow-dispatch response requires exact repository and positive run id');
  }
  const runUrl = dispatchRunApiUrl(owner, repo, runId);
  const htmlUrl = dispatchRunHtmlUrl(owner, repo, runId);
  if (text(payload?.run_url) !== runUrl || text(payload?.html_url) !== htmlUrl) {
    throw new Error('workflow-dispatch response run URLs do not match the returned run id');
  }
  return Object.freeze({ workflowRunId: runId, runUrl, htmlUrl });
}

function validateDispatchAcknowledgementV1(value = {}, receipt = {}) {
  const launch = validateIndependentReviewWorkflowDispatchLaunchReceiptV1(receipt);
  const runId = positiveInteger(value?.workflowRunId);
  if (text(value?.schemaVersion) !== DISPATCH_ACK_SCHEMA
    || text(value?.launchKeySha256).toLowerCase() !== launch.launchKeySha256
    || !runId) {
    throw new Error('workflow-dispatch acknowledgement identity is invalid');
  }
  const { owner, repo } = repositoryParts(launch.repository);
  if (text(value?.runUrl) !== dispatchRunApiUrl(owner, repo, runId)
    || text(value?.htmlUrl) !== dispatchRunHtmlUrl(owner, repo, runId)) {
    throw new Error('workflow-dispatch acknowledgement URLs are invalid');
  }
  return Object.freeze({
    schemaVersion: DISPATCH_ACK_SCHEMA,
    launchKeySha256: launch.launchKeySha256,
    workflowRunId: runId,
    runUrl: dispatchRunApiUrl(owner, repo, runId),
    htmlUrl: dispatchRunHtmlUrl(owner, repo, runId),
  });
}

export function renderWorkflowDispatchRunAcknowledgementV1(receipt, dispatchResponse) {
  const launch = validateIndependentReviewWorkflowDispatchLaunchReceiptV1(receipt);
  const { owner, repo } = repositoryParts(launch.repository);
  const response = validateWorkflowDispatchCreationResponseV1(dispatchResponse, { owner, repo });
  const acknowledgement = validateDispatchAcknowledgementV1({
    schemaVersion: DISPATCH_ACK_SCHEMA,
    launchKeySha256: launch.launchKeySha256,
    workflowRunId: response.workflowRunId,
    runUrl: response.runUrl,
    htmlUrl: response.htmlUrl,
  }, launch);
  return [
    `<!-- ${DISPATCH_ACK_MARKER} key=${launch.launchKeySha256} run_id=${acknowledgement.workflowRunId} -->`,
    '## Provider-neutral independent-review dispatch acknowledgement',
    '',
    '```json',
    JSON.stringify(acknowledgement, null, 2),
    '```',
    '',
    'This acknowledgement binds the existing content-addressed launch to the exact GitHub Actions run returned by the canonical workflow-dispatch endpoint. It grants no additional authority.',
  ].join('\n');
}

export function parseWorkflowDispatchRunAcknowledgementV1(body, receipt) {
  const launch = validateIndependentReviewWorkflowDispatchLaunchReceiptV1(receipt);
  const value = String(body ?? '');
  const expression = new RegExp(`<!--\\s*${DISPATCH_ACK_MARKER}\\s+key=([0-9a-f]{64})\\s+run_id=([1-9][0-9]*)\\s*-->`, 'g');
  const matches = [...value.matchAll(expression)];
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new Error(`workflow-dispatch acknowledgement count must be at most one, observed ${matches.length}`);
  const match = matches[0];
  if (match[1].toLowerCase() !== launch.launchKeySha256) {
    throw new Error('workflow-dispatch acknowledgement launch key does not match');
  }
  const suffix = value.slice(match.index);
  if (!suffix.includes('## Provider-neutral independent-review dispatch acknowledgement')) {
    throw new Error('workflow-dispatch acknowledgement heading is missing');
  }
  const fenced = suffix.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!fenced) throw new Error('workflow-dispatch acknowledgement JSON is missing');
  let parsed;
  try { parsed = JSON.parse(fenced[1]); } catch { throw new Error('workflow-dispatch acknowledgement JSON is invalid'); }
  const acknowledgement = validateDispatchAcknowledgementV1(parsed, launch);
  if (acknowledgement.workflowRunId !== Number(match[2])) {
    throw new Error('workflow-dispatch acknowledgement marker run id does not match');
  }
  return acknowledgement;
}

export async function loadWorkflowDispatchRuns(owner, repo, workflowId, token, launchReceipt) {
  if (positiveInteger(launchReceipt?.prNumber) && SHA64.test(text(launchReceipt?.launchKeySha256))) {
    const comments = await githubPages(`/repos/${owner}/${repo}/issues/${positiveInteger(launchReceipt.prNumber)}/comments`, { token });
    const launchComment = selectExactLaunchReceiptCommentV1(comments, launchReceipt.launchKeySha256);
    if (launchComment) {
      const acknowledgement = parseWorkflowDispatchRunAcknowledgementV1(launchComment.body, launchReceipt);
      if (acknowledgement) {
        const detail = await githubRequest(`/repos/${owner}/${repo}/actions/runs/${acknowledgement.workflowRunId}`, { token });
        if (positiveInteger(detail?.workflow_id) !== workflowId) {
          throw new Error(`acknowledged workflow-dispatch run workflow mismatch for run ${acknowledgement.workflowRunId}`);
        }
        return [mapRun(detail)];
      }
    }
  }

  const summaries = await githubPages(
    `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?event=workflow_dispatch&branch=main`,
    { token, itemKey: 'workflow_runs' },
  );
  const candidates = summaries.filter((summary) => plausibleWorkflowDispatchSummary(summary, workflowId, launchReceipt));
  if (candidates.length > MAX_DISPATCH_RUN_HYDRATIONS) {
    throw new Error(`workflow-dispatch run hydration exceeded ${MAX_DISPATCH_RUN_HYDRATIONS} plausible records`);
  }
  const seen = new Set();
  const rows = [];
  for (const summary of candidates) {
    const runId = positiveInteger(summary?.id);
    if (seen.has(runId)) throw new Error(`duplicate workflow-dispatch run summary id ${runId}`);
    seen.add(runId);
    const detail = await githubRequest(`/repos/${owner}/${repo}/actions/runs/${runId}`, { token });
    assertWorkflowDispatchSummaryDetailBinding(summary, detail, workflowId);
    rows.push(mapRun(detail));
  }
  return rows;
}

export function selectExactHandoffCommentV1(comments, sourceHead) {
  const marker = `<!-- stephanos:exact-head-review-dispatch:v1 head=${text(sourceHead).toLowerCase()} -->`;
  const matches = (Array.isArray(comments) ? comments : []).filter((comment) => (
    text(comment?.user?.login).toLowerCase() === TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    && positiveInteger(comment?.user?.id) === TRUSTED_GITHUB_ACTIONS_REVIEWER.id
    && text(comment?.body).startsWith(marker)
    && text(comment?.body).includes('## Provider-neutral exact-head review handoff')
  ));
  if (matches.length !== 1) throw new Error(`exact provider-neutral review handoff count must be one, observed ${matches.length}`);
  return matches[0];
}

export function selectExactLaunchReceiptCommentV1(comments, launchKeySha256) {
  const marker = `<!-- ${INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER} key=${text(launchKeySha256).toLowerCase()} -->`;
  const matches = (Array.isArray(comments) ? comments : []).filter((comment) => (
    text(comment?.user?.login).toLowerCase() === TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    && positiveInteger(comment?.user?.id) === TRUSTED_GITHUB_ACTIONS_REVIEWER.id
    && text(comment?.body).startsWith(marker)
  ));
  if (matches.length > 1) throw new Error(`exact launch receipt comment count exceeds one: ${matches.length}`);
  return matches[0] || null;
}

export function reconcileExistingLaunchReceiptV1({ launchReceipt, runs } = {}) {
  const discovery = discoverIndependentReviewWorkflowDispatchRunV1({ launchReceipt, runs });
  if (discovery.verdict === 'DISPATCH_RUN_NOT_YET_OBSERVED') {
    return Object.freeze({
      ...discovery,
      reconciliation: 'BLOCKED_DISPATCH_REQUEST_UNOBSERVED',
      mutationAllowed: false,
      operation: 'none',
      blockers: Object.freeze([
        'launch receipt exists but no matching workflow-dispatch run is observable; blind redispatch is forbidden',
      ]),
    });
  }
  if (discovery.verdict === 'DISPATCH_RUN_RUNNING') {
    return Object.freeze({ ...discovery, reconciliation: 'WAIT_RUNNING', mutationAllowed: false, operation: 'none' });
  }
  if (discovery.verdict !== 'DISPATCH_RUN_TERMINAL') {
    return Object.freeze({ ...discovery, reconciliation: discovery.verdict, mutationAllowed: false, operation: 'none' });
  }
  if (discovery.conclusion === 'success') {
    return Object.freeze({ ...discovery, reconciliation: 'ALREADY_SUCCESSFUL', mutationAllowed: false, operation: 'none' });
  }
  if (discovery.conclusion !== 'failure') {
    return Object.freeze({
      ...discovery,
      reconciliation: 'BLOCKED_CONCLUSION',
      mutationAllowed: false,
      operation: 'none',
      blockers: Object.freeze([`workflow-dispatch review conclusion ${discovery.conclusion || 'unknown'} is not retryable`]),
    });
  }
  if (!positiveInteger(discovery.runAttempt) || discovery.runAttempt >= INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT) {
    return Object.freeze({
      ...discovery,
      reconciliation: 'RETRY_BUDGET_EXHAUSTED',
      mutationAllowed: false,
      operation: 'none',
      blockers: Object.freeze([`workflow-dispatch review attempt ${discovery.runAttempt || 'unknown'} reached the bounded retry limit`]),
    });
  }
  return Object.freeze({
    ...discovery,
    reconciliation: 'RERUN_FAILED_JOBS',
    mutationAllowed: true,
    operation: 'rerun-failed-jobs',
    blockers: Object.freeze([]),
  });
}

function handoffEvent(repository, prNumber, comment) {
  return {
    repository: { full_name: repository },
    issue: { number: prNumber, pull_request: { url: `https://api.github.com/repos/${repository}/pulls/${prNumber}` } },
    comment,
  };
}

async function exactContext({ owner, repo, repository, prNumber, expectedHead, token }) {
  const [rawPr, mainRef, workflow, comments] = await Promise.all([
    githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, { token }),
    githubRequest(`/repos/${owner}/${repo}/git/ref/heads/main`, { token }),
    loadCanonicalWorkflow(owner, repo, token),
    githubPages(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, { token }),
  ]);
  const pr = mapPullRequest(rawPr);
  const mainSha = text(mainRef?.object?.sha).toLowerCase();
  if (pr.state.toLowerCase() !== 'open' || !pr.sameRepository
    || pr.baseRef !== 'main' || pr.baseSha !== mainSha || pr.headSha !== expectedHead) {
    throw new Error('pull request no longer matches exact open current-main review identity');
  }
  const handoffComment = selectExactHandoffCommentV1(comments, expectedHead);
  const handoffIdentity = validateIndependentReviewHandoffIdentityV1({
    event: handoffEvent(repository, prNumber, handoffComment),
    repository,
    prNumber,
    sourceHead: pr.headSha,
    baseSha: pr.baseSha,
    branch: pr.headRef,
  });
  return { rawPr, pr, mainSha, workflow, comments, handoffIdentity };
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('missing independent-review launch may run only inside GitHub Actions');
  const eventName = text(process.env.GITHUB_EVENT_NAME);
  if (!['issue_comment', 'workflow_run', 'schedule', 'workflow_dispatch'].includes(eventName)) {
    throw new Error(`missing independent-review launch event ${eventName || 'unknown'} is not allowlisted`);
  }
  const token = text(process.env.GITHUB_TOKEN);
  const repository = text(process.env.GITHUB_REPOSITORY);
  const prNumber = positiveInteger(process.env.STEPHANOS_INDEPENDENT_REVIEW_RETRY_PR);
  const expectedHead = text(process.env.STEPHANOS_INDEPENDENT_REVIEW_RETRY_HEAD).toLowerCase();
  const receiptPath = exactRunnerTempFile(process.env.STEPHANOS_REVIEW_HANDOFF_RUN_RECEIPT_PATH);
  if (!token || !repository || !prNumber || !FULL_SHA.test(expectedHead) || !fs.existsSync(receiptPath)) {
    throw new Error('token, repository, exact PR/head and handoff receipt are required');
  }
  const handoffRunReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const { owner, repo } = repositoryParts(repository);

  let context = await exactContext({ owner, repo, repository, prNumber, expectedHead, token });
  let pullRequestTargetRuns = await loadPullRequestTargetRuns(owner, repo, context.workflow.id, context.pr, token);
  let retryPlan = planIndependentReviewRetry({ repository, workflow: context.workflow, pr: context.pr, runs: pullRequestTargetRuns });
  if (retryPlan.decision !== INDEPENDENT_REVIEW_RETRY_DECISION.NO_MATCHING_RUN) {
    console.log(`INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_SUPPRESSED=${retryPlan.decision}`);
    appendOutput('decision', 'SUPPRESSED_EXISTING_RUN');
    return;
  }

  let dispatchAdmission = admitIndependentReviewWorkflowDispatchV1({
    repository,
    workflowDefinition: context.workflow,
    currentMainSha: context.mainSha,
    pullRequest: context.rawPr,
    handoffIdentity: context.handoffIdentity,
    handoffRunReceipt,
  });
  let launchPlan = planIndependentReviewMissingRunLaunchV1({ retryPlan, dispatchAdmission });
  if (launchPlan.decision !== INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.LAUNCH_MISSING_RUN) {
    throw new Error(`missing-run launch plan is not admitted: ${launchPlan.decision}`);
  }
  const requestedAtUtc = new Date().toISOString();
  const launchReceipt = buildIndependentReviewWorkflowDispatchLaunchReceiptV1({ launchPlan, requestedAtUtc });

  const existingLaunchComment = selectExactLaunchReceiptCommentV1(context.comments, launchReceipt.launchKeySha256);
  if (existingLaunchComment) {
    const persistedReceipt = parseIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(existingLaunchComment.body);
    const dispatchRuns = await loadWorkflowDispatchRuns(owner, repo, context.workflow.id, token, persistedReceipt);
    const reconciliation = reconcileExistingLaunchReceiptV1({ launchReceipt: persistedReceipt, runs: dispatchRuns });
    console.log(`INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_DISCOVERY=${reconciliation.verdict}`);
    console.log(`INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RECONCILIATION=${reconciliation.reconciliation}`);
    appendOutput('decision', reconciliation.reconciliation);
    appendOutput('launch_key', persistedReceipt.launchKeySha256);
    if (reconciliation.reconciliation === 'RERUN_FAILED_JOBS' && reconciliation.mutationAllowed === true) {
      await githubRequest(`/repos/${owner}/${repo}/actions/runs/${reconciliation.runId}/rerun-failed-jobs`, {
        method: 'POST',
        token,
      });
      console.log('INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RETRY_REQUESTED=true');
      appendOutput('mutation', 'rerun-failed-jobs');
      appendOutput('run_id', reconciliation.runId);
      appendOutput('run_attempt', reconciliation.runAttempt);
      return;
    }
    if (['WAIT_RUNNING', 'ALREADY_SUCCESSFUL'].includes(reconciliation.reconciliation)) return;
    if (reconciliation.reconciliation === 'BLOCKED_DISPATCH_REQUEST_UNOBSERVED') {
      throw new Error('workflow-dispatch launch receipt exists but no matching dispatch run is observable; request requires bounded recovery');
    }
    throw new Error(`workflow-dispatch reconciliation blocked: ${reconciliation.reconciliation}`);
  }

  // Reconstruct the complete trusted context immediately before publishing the
  // durable launch receipt and performing the one fixed workflow dispatch.
  context = await exactContext({ owner, repo, repository, prNumber, expectedHead, token });
  pullRequestTargetRuns = await loadPullRequestTargetRuns(owner, repo, context.workflow.id, context.pr, token);
  retryPlan = planIndependentReviewRetry({ repository, workflow: context.workflow, pr: context.pr, runs: pullRequestTargetRuns });
  if (retryPlan.decision !== INDEPENDENT_REVIEW_RETRY_DECISION.NO_MATCHING_RUN) {
    console.log(`INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_SUPPRESSED_AFTER_REVALIDATION=${retryPlan.decision}`);
    appendOutput('decision', 'SUPPRESSED_AFTER_REVALIDATION');
    return;
  }
  dispatchAdmission = admitIndependentReviewWorkflowDispatchV1({
    repository,
    workflowDefinition: context.workflow,
    currentMainSha: context.mainSha,
    pullRequest: context.rawPr,
    handoffIdentity: context.handoffIdentity,
    handoffRunReceipt,
  });
  launchPlan = planIndependentReviewMissingRunLaunchV1({ retryPlan, dispatchAdmission });
  if (launchPlan.decision !== INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.LAUNCH_MISSING_RUN) {
    throw new Error(`revalidated missing-run launch plan is not admitted: ${launchPlan.decision}`);
  }
  const finalReceipt = buildIndependentReviewWorkflowDispatchLaunchReceiptV1({ launchPlan, requestedAtUtc });
  const launchBody = renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(finalReceipt);
  const created = await githubRequest(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST', token, body: { body: launchBody },
  });
  if (text(created?.user?.login).toLowerCase() !== TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    || positiveInteger(created?.user?.id) !== TRUSTED_GITHUB_ACTIONS_REVIEWER.id
    || parseIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(created?.body).launchKeySha256 !== finalReceipt.launchKeySha256) {
    throw new Error('persisted workflow-dispatch launch receipt comment is not canonical');
  }

  const dispatchResponse = await githubRequest(`/repos/${owner}/${repo}/actions/workflows/${context.workflow.id}/dispatches`, {
    method: 'POST',
    token,
    body: {
      ref: 'main',
      inputs: finalReceipt.authority.reviewWorkflowDispatchAllowed ? dispatchAdmission.workflowDispatchInputs : {},
      return_run_details: true,
    },
  });
  const acknowledgementText = renderWorkflowDispatchRunAcknowledgementV1(finalReceipt, dispatchResponse);
  const acknowledgedBody = `${launchBody}\n\n${acknowledgementText}`;
  const updated = await githubRequest(`/repos/${owner}/${repo}/issues/comments/${positiveInteger(created?.id)}`, {
    method: 'PATCH',
    token,
    body: { body: acknowledgedBody },
  });
  if (text(updated?.user?.login).toLowerCase() !== TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    || positiveInteger(updated?.user?.id) !== TRUSTED_GITHUB_ACTIONS_REVIEWER.id
    || parseIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(updated?.body).launchKeySha256 !== finalReceipt.launchKeySha256) {
    throw new Error('persisted workflow-dispatch acknowledgement comment is not canonical');
  }
  const acknowledgement = parseWorkflowDispatchRunAcknowledgementV1(updated.body, finalReceipt);
  if (!acknowledgement) throw new Error('persisted workflow-dispatch acknowledgement is missing');

  console.log('INDEPENDENT_REVIEW_MISSING_RUN_DISPATCH_REQUESTED=true');
  console.log(`INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_KEY=${finalReceipt.launchKeySha256}`);
  console.log(`INDEPENDENT_REVIEW_MISSING_RUN_RUN_ID=${acknowledgement.workflowRunId}`);
  appendOutput('decision', 'LAUNCH_MISSING_RUN');
  appendOutput('launch_key', finalReceipt.launchKeySha256);
  appendOutput('launch_comment_id', positiveInteger(created?.id));
  appendOutput('run_id', acknowledgement.workflowRunId);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    console.error(`INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_BLOCKED=${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  });
}
