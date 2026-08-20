#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';

import {
  INDEPENDENT_REVIEW_RETRY_DECISION,
  planIndependentReviewRetry,
} from '../shared/agents/independentReviewRetryPlanner.mjs';
import {
  buildIndependentReviewRunQueryV1,
  buildIndependentReviewWorkflowDispatchRunQueryV1,
  selectIndependentReviewRunCandidatesV1,
} from '../shared/agents/independentReviewRunDiscoveryV1.mjs';
import {
  validateIndependentReviewHandoffIdentityV1,
} from '../shared/agents/independentReviewHandoffIdentityV1.mjs';
import {
  admitIndependentReviewWorkflowDispatchV1,
} from '../shared/agents/independentReviewWorkflowDispatchAdmissionV1.mjs';
import {
  INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION,
  planIndependentReviewMissingRunLaunchV1,
} from '../shared/agents/independentReviewMissingRunLaunchV1.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
} from '../shared/agents/operatorMergeApprovalGate.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-review-missing-run-launch-v1';
const FULL_SHA = /^[0-9a-f]{40}$/i;
const MAX_COMMENT_PAGES = 20;
const MAX_RUN_DETAILS = 20;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function repositoryParts(repository) {
  const match = text(repository).match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error('GITHUB_REPOSITORY must be owner/name');
  return { owner: match[1], repo: match[2] };
}

function sameSha(left, right) {
  return FULL_SHA.test(text(left))
    && FULL_SHA.test(text(right))
    && text(left).toLowerCase() === text(right).toLowerCase();
}

function appendOutput(name, value) {
  const outputPath = text(process.env.GITHUB_OUTPUT);
  if (!outputPath) return;
  appendFileSync(outputPath, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`);
}

function readJsonFile(path) {
  if (!text(path)) throw new Error('immutable handoff receipt path is required');
  return JSON.parse(readFileSync(path, 'utf8'));
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

async function githubPages(pathname, itemKey, token) {
  const payload = await githubRequest(pathname, { token });
  const values = itemKey ? payload?.[itemKey] : payload;
  if (!Array.isArray(values)) throw new Error(`GitHub payload for ${pathname} is not ${itemKey || 'an array'}`);
  if (positiveInteger(payload?.total_count) > values.length) {
    throw new Error(`bounded GitHub query for ${pathname} exceeded returned page`);
  }
  return values;
}

async function githubCommentPages(owner, repo, prNumber, token) {
  const comments = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const payload = await githubRequest(
      `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      { token },
    );
    if (!Array.isArray(payload)) throw new Error('review handoff comment listing is not an array');
    comments.push(...payload);
    if (payload.length < 100) return comments;
  }
  throw new Error(`review handoff comment listing exceeded ${MAX_COMMENT_PAGES * 100} records`);
}

async function loadCanonicalWorkflow(owner, repo, token) {
  const definitions = await githubPages(`/repos/${owner}/${repo}/actions/workflows?per_page=100&page=1`, 'workflows', token);
  const pathMatches = definitions.filter((workflow) => text(workflow?.path) === INDEPENDENT_REVIEW_WORKFLOW_PATH);
  const nameCollisions = definitions.filter((workflow) => (
    text(workflow?.name) === INDEPENDENT_REVIEW_WORKFLOW_NAME
    && text(workflow?.path) !== INDEPENDENT_REVIEW_WORKFLOW_PATH
  ));
  if (pathMatches.length !== 1 || nameCollisions.length !== 0) {
    throw new Error('canonical independent-review workflow identity is missing or ambiguous');
  }
  const workflow = pathMatches[0];
  const normalized = {
    id: positiveInteger(workflow?.id),
    name: text(workflow?.name),
    path: text(workflow?.path),
    state: text(workflow?.state),
  };
  if (!normalized.id) throw new Error('canonical independent-review workflow id is missing');
  return normalized;
}

function mapPullRequest(pr) {
  return {
    number: positiveInteger(pr?.number),
    head: { ref: text(pr?.head?.ref), sha: text(pr?.head?.sha).toLowerCase() },
    base: { ref: text(pr?.base?.ref), sha: text(pr?.base?.sha).toLowerCase() },
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
    pull_requests: Array.isArray(run?.pull_requests) ? run.pull_requests.map(mapPullRequest) : [],
  };
}

async function loadRecentReviewRuns({ owner, repo, workflowId, prNumber, headRef, expectedHead, expectedBase, token }) {
  const targetQuery = buildIndependentReviewRunQueryV1({ workflowId, expectedHead });
  const dispatchQuery = buildIndependentReviewWorkflowDispatchRunQueryV1({ workflowId, expectedBase });
  const [targetPayload, dispatchPayload] = await Promise.all([
    githubRequest(`/repos/${owner}/${repo}${targetQuery}`, { token }),
    githubRequest(`/repos/${owner}/${repo}${dispatchQuery}`, { token }),
  ]);
  const targetRuns = Array.isArray(targetPayload?.workflow_runs) ? targetPayload.workflow_runs : null;
  const dispatchRuns = Array.isArray(dispatchPayload?.workflow_runs) ? dispatchPayload.workflow_runs : null;
  if (!targetRuns || !dispatchRuns) throw new Error('independent-review run discovery is not workflow_runs');
  if (positiveInteger(targetPayload?.total_count) > targetRuns.length
    || positiveInteger(dispatchPayload?.total_count) > dispatchRuns.length) {
    throw new Error('bounded independent-review run discovery exceeded 100 records');
  }
  const candidates = selectIndependentReviewRunCandidatesV1({
    runs: [...targetRuns, ...dispatchRuns],
    prNumber,
    headRef,
    expectedHead,
    expectedBase,
  }).slice(0, MAX_RUN_DETAILS);
  const details = [];
  for (const candidate of candidates) {
    details.push(mapRun(await githubRequest(`/repos/${owner}/${repo}/actions/runs/${positiveInteger(candidate.id)}`, { token })));
  }
  return details;
}

function exactHandoffComment(comments, { sourceHead, commentId }) {
  const marker = `<!-- stephanos:exact-head-review-dispatch:v1 head=${sourceHead} -->`;
  const matches = comments.filter((comment) => (
    positiveInteger(comment?.id) === commentId
    && text(comment?.user?.login).toLowerCase() === 'github-actions[bot]'
    && positiveInteger(comment?.user?.id) === 41898282
    && text(comment?.body).startsWith(marker)
    && text(comment?.body).includes('## Provider-neutral exact-head review handoff')
  ));
  if (matches.length !== 1) throw new Error(`exact authenticated review handoff count must be one, observed ${matches.length}`);
  return matches[0];
}

async function loadLaunchState({ token, repository, owner, repo, prNumber, expectedHead, handoffCommentId, handoffRunReceipt }) {
  const [rawPr, mainRef, workflow, comments] = await Promise.all([
    githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, { token }),
    githubRequest(`/repos/${owner}/${repo}/git/ref/heads/main`, { token }),
    loadCanonicalWorkflow(owner, repo, token),
    githubCommentPages(owner, repo, prNumber, token),
  ]);
  const currentMainSha = text(mainRef?.object?.sha).toLowerCase();
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
  if (pr.headSha !== expectedHead || pr.baseSha !== currentMainSha) {
    throw new Error('pull request head/base moved before missing-run launch');
  }
  const comment = exactHandoffComment(comments, { sourceHead: expectedHead, commentId: handoffCommentId });
  const handoffIdentity = validateIndependentReviewHandoffIdentityV1({
    event: {
      repository: { full_name: repository },
      issue: { number: prNumber, pull_request: {} },
      comment,
    },
    repository,
    prNumber,
    sourceHead: expectedHead,
    baseSha: currentMainSha,
    branch: pr.headRef,
  });
  const dispatchAdmission = admitIndependentReviewWorkflowDispatchV1({
    repository,
    workflowDefinition: workflow,
    currentMainSha,
    pullRequest: rawPr,
    handoffIdentity,
    handoffRunReceipt,
  });
  const runs = await loadRecentReviewRuns({
    owner,
    repo,
    workflowId: workflow.id,
    prNumber,
    headRef: pr.headRef,
    expectedHead,
    expectedBase: currentMainSha,
    token,
  });
  const retryPlan = planIndependentReviewRetry({ repository, workflow, pr, runs });
  const launchPlan = planIndependentReviewMissingRunLaunchV1({ retryPlan, dispatchAdmission });
  return { rawPr, currentMainSha, workflow, retryPlan, launchPlan };
}

async function main() {
  if (text(process.env.GITHUB_ACTIONS) !== 'true') throw new Error('missing-run launch may run only inside GitHub Actions');
  if (text(process.env.GITHUB_JOB) !== 'coordinate') throw new Error('missing-run launch requires the canonical coordinator job');
  if (!['issue_comment', 'workflow_run', 'schedule', 'workflow_dispatch'].includes(text(process.env.GITHUB_EVENT_NAME))) {
    throw new Error('missing-run launch event is not allowlisted');
  }

  const token = text(process.env.GITHUB_TOKEN);
  const repository = text(process.env.GITHUB_REPOSITORY);
  const prNumber = positiveInteger(process.env.STEPHANOS_INDEPENDENT_REVIEW_LAUNCH_PR);
  const expectedHead = text(process.env.STEPHANOS_INDEPENDENT_REVIEW_LAUNCH_HEAD).toLowerCase();
  const handoffCommentId = positiveInteger(process.env.STEPHANOS_INDEPENDENT_REVIEW_HANDOFF_COMMENT_ID);
  if (!token || !repository || !prNumber || !FULL_SHA.test(expectedHead) || !handoffCommentId) {
    throw new Error('exact PR/head/handoff identity is required for missing-run launch');
  }
  const handoffRunReceipt = readJsonFile(process.env.STEPHANOS_INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_PATH);
  const { owner, repo } = repositoryParts(repository);

  let state = await loadLaunchState({
    token,
    repository,
    owner,
    repo,
    prNumber,
    expectedHead,
    handoffCommentId,
    handoffRunReceipt,
  });
  console.log(`INDEPENDENT_REVIEW_MISSING_RUN_DECISION=${state.launchPlan.decision}`);
  console.log(`INDEPENDENT_REVIEW_MISSING_RUN_REASON=${state.launchPlan.reason}`);

  if (state.launchPlan.decision === INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.SUPPRESS_EXISTING_RUN) {
    appendOutput('launch_requested', 'false');
    console.log('INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_REQUESTED=false');
    return;
  }
  if (state.launchPlan.decision !== INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.LAUNCH_MISSING_RUN
    || state.retryPlan.decision !== INDEPENDENT_REVIEW_RETRY_DECISION.NO_MATCHING_RUN) {
    throw new Error(`missing-run launch is blocked: ${state.launchPlan.reason}`);
  }

  // Re-read every mutable authority surface immediately before the mutation.
  state = await loadLaunchState({
    token,
    repository,
    owner,
    repo,
    prNumber,
    expectedHead,
    handoffCommentId,
    handoffRunReceipt,
  });
  if (state.launchPlan.decision !== INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.LAUNCH_MISSING_RUN
    || state.retryPlan.decision !== INDEPENDENT_REVIEW_RETRY_DECISION.NO_MATCHING_RUN) {
    throw new Error('exact review-run state changed before workflow dispatch');
  }

  await githubRequest(`/repos/${owner}/${repo}/actions/workflows/${state.workflow.id}/dispatches`, {
    method: 'POST',
    token,
    body: {
      ref: 'main',
      inputs: state.launchPlan.workflowDispatchInputs,
    },
  });
  appendOutput('launch_requested', 'true');
  console.log('INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_REQUESTED=true');
  console.log(`INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_PR=${prNumber}`);
  console.log(`INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_HEAD=${expectedHead}`);
  console.log(`INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_BASE=${state.currentMainSha}`);
}

main().catch((error) => {
  console.error(`INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
