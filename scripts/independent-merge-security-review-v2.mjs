#!/usr/bin/env node

import fs from 'node:fs';
import {
  INDEPENDENT_REVIEW_JOB,
  PROTECTED_REVIEW_MARKER,
  analyzeIndependentSecurityReview,
  buildProtectedSecurityReviewReceipt,
  validateExactHeadWorkflowRuns,
} from '../shared/agents/operatorMergeApprovalGate.mjs';
import {
  bindIndependentReviewReceiptToBase,
  validateMainRefBaseBinding,
  validatePullRequestBaseBinding,
} from '../shared/agents/operatorMergeBaseBindingV1.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-merge-security-review-v2';
const MAX_PAGES = 20;
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function readJson(path) {
  if (!path || !fs.existsSync(path)) throw new Error('GitHub event payload is required.');
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function githubRequest(path, { method = 'GET', body = null, accept = 'application/vnd.github+json' } = {}) {
  const token = text(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  if (!token) throw new Error('GitHub token is required.');
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${raw.slice(0, 500)}`);
  if (accept.includes('diff')) return raw;
  return raw ? JSON.parse(raw) : null;
}

async function githubPages(path, itemKey = null) {
  const separator = path.includes('?') ? '&' : '?';
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await githubRequest(`${path}${separator}per_page=100&page=${page}`);
    const pageItems = itemKey ? payload?.[itemKey] : payload;
    if (!Array.isArray(pageItems)) throw new Error(`Unexpected paginated response for ${path}`);
    items.push(...pageItems);
    if (pageItems.length < 100) return items;
  }
  throw new Error(`Pagination exceeded ${MAX_PAGES * 100} records for ${path}`);
}

async function unresolvedThreadCount(owner, repo, prNumber) {
  const query = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}}}}`;
  const payload = await githubRequest('/graphql', {
    method: 'POST',
    body: { query, variables: { owner, repo, number: prNumber } },
  });
  const threads = payload?.data?.repository?.pullRequest?.reviewThreads;
  if (!threads || threads.pageInfo?.hasNextPage) throw new Error('Review-thread evidence is missing or exceeds the bounded first page.');
  return (threads.nodes || []).filter((thread) => thread?.isResolved !== true).length;
}

function mapWorkflowRun(run) {
  return {
    id: run?.id,
    run_number: run?.run_number,
    name: text(run?.name),
    head_sha: text(run?.head_sha),
    status: text(run?.status),
    conclusion: text(run?.conclusion),
  };
}

async function waitForExactHeadWorkflows(owner, repo, sourceHead) {
  const started = Date.now();
  let lastVerdict = null;
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const runs = (await githubPages(
      `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(sourceHead)}&event=pull_request`,
      'workflow_runs',
    )).map(mapWorkflowRun);
    lastVerdict = validateExactHeadWorkflowRuns(runs, { expectedHead: sourceHead });
    if (lastVerdict.valid) return { runs, verdict: lastVerdict };
    const terminalFailure = lastVerdict.blockers.some((blocker) => blocker.startsWith('workflow-not-green:'));
    if (terminalFailure) throw new Error(`Exact-head workflow failure: ${lastVerdict.blockers.join(', ')}`);
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Exact-head workflows did not become green within ${POLL_TIMEOUT_MS / 60000} minutes: ${lastVerdict?.blockers?.join(', ') || 'unknown'}`);
}

async function postComment(owner, repo, prNumber, body) {
  return githubRequest(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    body: { body },
  });
}

function requireExactBase(pullRequest, mainRef, baseSha, phase) {
  const prBase = validatePullRequestBaseBinding(pullRequest, baseSha);
  const liveBase = validateMainRefBaseBinding(mainRef, baseSha);
  if (!prBase.valid || !liveBase.valid) {
    throw new Error(`${phase} base binding changed: ${[...prBase.blockers, ...liveBase.blockers].join(', ')}`);
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Independent review may run only inside GitHub Actions.');
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request_target') throw new Error('Independent review requires pull_request_target.');
  if (process.env.GITHUB_JOB !== INDEPENDENT_REVIEW_JOB) throw new Error('Independent review job identity mismatch.');

  const event = readJson(text(process.env.GITHUB_EVENT_PATH));
  const repository = text(process.env.GITHUB_REPOSITORY || event?.repository?.full_name);
  const [owner, repo] = repository.split('/');
  const prNumber = integer(event?.pull_request?.number);
  const sourceHead = text(event?.pull_request?.head?.sha).toLowerCase();
  const baseSha = text(event?.pull_request?.base?.sha).toLowerCase();
  const branch = text(event?.pull_request?.head?.ref);
  const baseBranch = text(event?.pull_request?.base?.ref);
  const runId = integer(process.env.GITHUB_RUN_ID);
  const runAttempt = integer(process.env.GITHUB_RUN_ATTEMPT);

  if (!owner || !repo || !prNumber || !/^[a-f0-9]{40}$/.test(sourceHead)
    || !/^[a-f0-9]{40}$/.test(baseSha) || !branch || baseBranch !== 'main' || !runId || !runAttempt) {
    throw new Error('Independent review event identity is incomplete or unsafe.');
  }
  if (text(event?.pull_request?.head?.repo?.full_name).toLowerCase() !== repository.toLowerCase()) {
    throw new Error('Cross-repository pull requests require a separate specialist route.');
  }

  const initialPullRequest = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  const initialMainRef = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/main`);
  if (text(initialPullRequest?.state).toLowerCase() !== 'open'
    || text(initialPullRequest?.head?.sha).toLowerCase() !== sourceHead
    || text(initialPullRequest?.head?.ref) !== branch
    || text(initialPullRequest?.base?.ref) !== 'main') {
    throw new Error('Pull-request identity changed before review.');
  }
  requireExactBase(initialPullRequest, initialMainRef, baseSha, 'pre-review');

  const [{ verdict: workflowVerdict }, files, diff, threads] = await Promise.all([
    waitForExactHeadWorkflows(owner, repo, sourceHead),
    githubPages(`/repos/${owner}/${repo}/pulls/${prNumber}/files`),
    githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, { accept: 'application/vnd.github.v3.diff' }),
    unresolvedThreadCount(owner, repo, prNumber),
  ]);
  if (!workflowVerdict.valid) throw new Error('Exact-head workflows are not green.');
  if (threads !== 0) throw new Error(`Independent review blocked by ${threads} unresolved review thread(s).`);

  const analysis = analyzeIndependentSecurityReview({
    changedFiles: files,
    diff,
    requireReviewerFilesInDiff: false,
  });

  if (analysis.finalVerdict !== 'INDEPENDENT_SECURITY_REVIEW_CLEAN') {
    const body = [
      '<!-- stephanos-independent-security-review-findings -->',
      '## Independent deterministic security review findings',
      '',
      `PR: #${prNumber}`,
      `Exact head: \`${sourceHead}\``,
      `Exact base: \`${baseSha}\``,
      `Workflow run: ${runId} attempt ${runAttempt}`,
      '',
      '```json',
      JSON.stringify(analysis, null, 2),
      '```',
      '',
      'This read-only review did not authorise merge or mark the PR ready.',
    ].join('\n');
    await postComment(owner, repo, prNumber, body);
    throw new Error(`Independent security review found ${analysis.counts.P0} P0, ${analysis.counts.P1} P1 and ${analysis.counts.P2} P2 finding(s).`);
  }

  const finalPullRequest = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  const finalMainRef = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/main`);
  if (text(finalPullRequest?.head?.sha).toLowerCase() !== sourceHead || text(finalPullRequest?.state).toLowerCase() !== 'open') {
    throw new Error('Pull-request head or state changed during review.');
  }
  requireExactBase(finalPullRequest, finalMainRef, baseSha, 'pre-receipt');

  const receipt = bindIndependentReviewReceiptToBase(buildProtectedSecurityReviewReceipt({
    repository,
    prNumber,
    sourceHead,
    branch,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    timestampUtc: new Date().toISOString(),
    analysis,
  }), baseSha);
  const body = [
    PROTECTED_REVIEW_MARKER,
    '## Independent deterministic exact-head and exact-base security review passed',
    '',
    `Exact head: \`${sourceHead}\``,
    `Exact base: \`${baseSha}\``,
    '',
    '```json',
    JSON.stringify(receipt, null, 2),
    '```',
    '',
    'This clean receipt was produced before and independently of the operator approval environment. It is bound to the exact reviewed head and exact reviewed base; any movement of either invalidates it. The reviewer has no merge, mark-ready, source-write, Battle Bridge, OpenClaw or runtime authority.',
  ].join('\n');
  const comment = await postComment(owner, repo, prNumber, body);
  console.log('INDEPENDENT_SECURITY_REVIEW=clean');
  console.log(`INDEPENDENT_SECURITY_REVIEW_COMMENT_ID=${comment?.id ?? ''}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_HEAD=${sourceHead}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_BASE=${baseSha}`);
}

main().catch((error) => {
  console.error(`INDEPENDENT_SECURITY_REVIEW_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
