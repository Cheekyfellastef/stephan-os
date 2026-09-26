#!/usr/bin/env node

import fs from 'node:fs';

import {
  INDEPENDENT_REVIEW_RETRY_DECISION,
  planIndependentReviewRetry,
} from '../shared/agents/independentReviewRetryPlanner.mjs';
import {
  buildIndependentReviewRunQueryV1,
  selectIndependentReviewRunCandidatesV1,
} from '../shared/agents/independentReviewRunDiscoveryV1.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
} from '../shared/agents/operatorMergeApprovalGate.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-review-retry-v1';
const MAX_RUN_PAGES = 5;
const MAX_RUN_DETAILS = 20;

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

async function githubRequest(path, { method = 'GET', body = null } = {}) {
  const token = text(process.env.GITHUB_TOKEN);
  if (!token) throw new Error('GITHUB_TOKEN is required for bounded review retry');
  const response = await fetch(`https://api.github.com${path}`, {
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
    throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${text(message).slice(0, 300)}`);
  }
  return payload;
}

async function githubPages(path, itemKey) {
  const separator = path.includes('?') ? '&' : '?';
  const rows = [];
  for (let page = 1; page <= MAX_RUN_PAGES; page += 1) {
    const payload = await githubRequest(`${path}${separator}per_page=100&page=${page}`);
    const values = payload?.[itemKey];
    if (!Array.isArray(values)) throw new Error(`GitHub pagination payload for ${path} is not ${itemKey}`);
    rows.push(...values);
    if (values.length < 100) return rows;
  }
  throw new Error(`GitHub pagination exceeded ${MAX_RUN_PAGES * 100} records for ${path}`);
}

function mapPullRequest(pr) {
  return {
    number: positiveInteger(pr?.number),
    head: {
      ref: text(pr?.head?.ref),
      sha: text(pr?.head?.sha).toLowerCase(),
    },
    base: {
      ref: text(pr?.base?.ref),
      sha: text(pr?.base?.sha).toLowerCase(),
    },
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
    status: text(run?.status),
    conclusion: text(run?.conclusion),
    created_at: run?.created_at ?? null,
    pull_requests: Array.isArray(run?.pull_requests) ? run.pull_requests.map(mapPullRequest) : [],
  };
}

async function loadCanonicalWorkflow(owner, repo) {
  const definitions = await githubPages(`/repos/${owner}/${repo}/actions/workflows`, 'workflows');
  const pathMatches = definitions.filter((workflow) => text(workflow?.path) === INDEPENDENT_REVIEW_WORKFLOW_PATH);
  const nameCollisions = definitions.filter((workflow) => (
    text(workflow?.name) === INDEPENDENT_REVIEW_WORKFLOW_NAME
    && text(workflow?.path) !== INDEPENDENT_REVIEW_WORKFLOW_PATH
  ));
  if (pathMatches.length !== 1 || nameCollisions.length !== 0) {
    throw new Error('canonical independent-review workflow identity is missing or ambiguous');
  }
  const workflow = pathMatches[0];
  return {
    id: positiveInteger(workflow?.id),
    name: text(workflow?.name),
    path: text(workflow?.path),
    state: text(workflow?.state),
  };
}

async function loadRecentReviewRuns(owner, repo, workflowId, prNumber, headRef, expectedHead, expectedBase) {
  const query = buildIndependentReviewRunQueryV1({ workflowId, expectedHead });
  const trustedQueryPrefix = `/actions/workflows/${workflowId}/runs?event=pull_request_target`;
  if (!query.startsWith(trustedQueryPrefix)) throw new Error('review-run discovery escaped the trusted workflow/event route');
  const payload = await githubRequest(`/repos/${owner}/${repo}${query}`);
  const listed = payload?.workflow_runs;
  if (!Array.isArray(listed)) {
    throw new Error('bounded exact-head review-run payload is not workflow_runs');
  }
  if (positiveInteger(payload?.total_count) > listed.length) {
    throw new Error('bounded exact-head review-run query exceeded 100 records');
  }
  const candidates = selectIndependentReviewRunCandidatesV1({
    runs: listed,
    prNumber,
    headRef,
    expectedHead,
    expectedBase,
  }).slice(0, MAX_RUN_DETAILS);
  const details = [];
  for (const candidate of candidates) {
    details.push(mapRun(await githubRequest(`/repos/${owner}/${repo}/actions/runs/${positiveInteger(candidate.id)}`)));
  }
  return details;
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('review retry may run only inside GitHub Actions');
  const eventName = text(process.env.GITHUB_EVENT_NAME);
  if (!['issue_comment', 'workflow_run', 'schedule', 'workflow_dispatch'].includes(eventName)) {
    throw new Error(`review retry event ${eventName || 'unknown'} is not allowlisted`);
  }

  const repository = text(process.env.GITHUB_REPOSITORY);
  const { owner, repo } = repositoryParts(repository);
  const prNumber = positiveInteger(process.env.STEPHANOS_INDEPENDENT_REVIEW_RETRY_PR);
  const expectedHead = text(process.env.STEPHANOS_INDEPENDENT_REVIEW_RETRY_HEAD).toLowerCase();
  if (!prNumber || !/^[0-9a-f]{40}$/.test(expectedHead)) {
    throw new Error('exact PR number and head are required from the coordinator decision');
  }

  const [rawPr, mainRef, workflow] = await Promise.all([
    githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`),
    githubRequest(`/repos/${owner}/${repo}/git/ref/heads/main`),
    loadCanonicalWorkflow(owner, repo),
  ]);
  const pr = {
    number: positiveInteger(rawPr?.number),
    state: text(rawPr?.state),
    draft: rawPr?.draft === true,
    sameRepository: text(rawPr?.head?.repo?.full_name).toLowerCase() === repository.toLowerCase(),
    headRef: text(rawPr?.head?.ref),
    headSha: text(rawPr?.head?.sha).toLowerCase(),
    baseRef: text(rawPr?.base?.ref),
    baseSha: text(rawPr?.base?.sha).toLowerCase(),
  };
  if (pr.headSha !== expectedHead) throw new Error('pull-request head moved after coordinator decision');
  if (text(mainRef?.object?.sha).toLowerCase() !== pr.baseSha) {
    throw new Error('pull-request base is not exact current main');
  }

  const runs = await loadRecentReviewRuns(
    owner,
    repo,
    workflow.id,
    prNumber,
    pr.headRef,
    expectedHead,
    pr.baseSha,
  );
  const plan = planIndependentReviewRetry({ repository, workflow, pr, runs });
  console.log(`INDEPENDENT_REVIEW_RETRY_DECISION=${plan.decision}`);
  console.log(`INDEPENDENT_REVIEW_RETRY_PR=${plan.prNumber ?? ''}`);
  console.log(`INDEPENDENT_REVIEW_RETRY_HEAD=${plan.exactHead}`);
  console.log(`INDEPENDENT_REVIEW_RETRY_BASE=${plan.exactBase}`);
  console.log(`INDEPENDENT_REVIEW_RETRY_RUN_ID=${plan.runId ?? ''}`);
  console.log(`INDEPENDENT_REVIEW_RETRY_ATTEMPT=${plan.runAttempt ?? ''}`);
  console.log(`INDEPENDENT_REVIEW_RETRY_REASON=${plan.reason}`);
  appendOutput('decision', plan.decision);
  appendOutput('exact_head', plan.exactHead);
  appendOutput('exact_base', plan.exactBase);
  appendOutput('workflow_id', plan.workflowId ?? '');

  if (plan.decision === INDEPENDENT_REVIEW_RETRY_DECISION.RERUN_FAILED_JOBS) {
    await githubRequest(`/repos/${owner}/${repo}/actions/runs/${plan.runId}/rerun-failed-jobs`, {
      method: 'POST',
    });
    console.log('INDEPENDENT_REVIEW_RETRY_REQUESTED=true');
    appendOutput('mutation', 'rerun-failed-jobs');
    return;
  }
  if ([
    INDEPENDENT_REVIEW_RETRY_DECISION.WAIT_RUNNING,
    INDEPENDENT_REVIEW_RETRY_DECISION.ALREADY_SUCCESSFUL,
    INDEPENDENT_REVIEW_RETRY_DECISION.NO_MATCHING_RUN,
  ].includes(plan.decision)) {
    console.log('INDEPENDENT_REVIEW_RETRY_REQUESTED=false');
    appendOutput('mutation', 'none');
    return;
  }
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(`INDEPENDENT_REVIEW_RETRY_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});