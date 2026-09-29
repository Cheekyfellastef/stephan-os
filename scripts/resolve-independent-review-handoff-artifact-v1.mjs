#!/usr/bin/env node

import fs from 'node:fs';

import {
  validateIndependentReviewHandoffIdentityV1,
} from '../shared/agents/independentReviewHandoffIdentityV1.mjs';
import {
  CANONICAL_COORDINATOR_WORKFLOW_ID,
  CANONICAL_COORDINATOR_WORKFLOW_NAME,
  CANONICAL_COORDINATOR_WORKFLOW_PATH,
} from '../shared/agents/independentReviewHandoffProvenanceV1.mjs';
import {
  CANONICAL_REPOSITORY,
} from '../shared/agents/independentReviewWorkflowDispatchAdmissionV1.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-review-handoff-artifact-resolver-v1';
const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({ login: 'github-actions[bot]', id: 41898282 });
const INPUT_KEYS = Object.freeze([
  'pr_number',
  'source_head',
  'base_sha',
  'head_branch',
  'handoff_binding_sha256',
  'handoff_run_receipt_sha256',
]);
const FULL_SHA = /^[0-9a-f]{40}$/i;
const MAX_PAGES = 20;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function appendOutput(name, value) {
  const outputPath = text(process.env.GITHUB_OUTPUT);
  if (!outputPath) throw new Error('GITHUB_OUTPUT is required for handoff artifact resolution');
  fs.appendFileSync(outputPath, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`);
}

async function githubRequest(pathname, { token } = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
    },
  });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = raw; }
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' ? payload.message : raw;
    throw new Error(`GitHub GET ${pathname} failed (${response.status}): ${text(message).slice(0, 300)}`);
  }
  return payload;
}

async function githubPages(pathname, { token } = {}) {
  const separator = pathname.includes('?') ? '&' : '?';
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await githubRequest(`${pathname}${separator}per_page=100&page=${page}`, { token });
    if (!Array.isArray(payload)) throw new Error(`GitHub pagination payload for ${pathname} is invalid`);
    rows.push(...payload);
    if (payload.length < 100) return rows;
  }
  throw new Error(`GitHub pagination exceeded ${MAX_PAGES * 100} records for ${pathname}`);
}

function readInputs() {
  const eventPath = text(process.env.GITHUB_EVENT_PATH);
  if (!eventPath || !fs.existsSync(eventPath)) throw new Error('workflow_dispatch event payload is required');
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  if (!exactKeys(event?.inputs, INPUT_KEYS)) throw new Error('workflow_dispatch inputs must use the exact six-field schema');
  return event.inputs;
}

function selectHandoff(comments, sourceHead) {
  const marker = `<!-- stephanos:exact-head-review-dispatch:v1 head=${sourceHead} -->`;
  const matches = comments.filter((comment) => (
    text(comment?.user?.login).toLowerCase() === TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    && positiveInteger(comment?.user?.id) === TRUSTED_GITHUB_ACTIONS_REVIEWER.id
    && text(comment?.body).startsWith(marker)
    && text(comment?.body).includes('## Provider-neutral exact-head review handoff')
  ));
  if (matches.length !== 1) throw new Error(`exact provider-neutral review handoff count must be one, observed ${matches.length}`);
  return matches[0];
}

function handoffEvent(prNumber, comment) {
  return {
    repository: { full_name: CANONICAL_REPOSITORY },
    issue: {
      number: prNumber,
      pull_request: { url: `https://api.github.com/repos/${CANONICAL_REPOSITORY}/pulls/${prNumber}` },
    },
    comment,
  };
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('handoff artifact resolution may run only inside GitHub Actions');
  if (text(process.env.GITHUB_EVENT_NAME) !== 'workflow_dispatch') throw new Error('handoff artifact resolution requires workflow_dispatch');
  if (text(process.env.GITHUB_REPOSITORY) !== CANONICAL_REPOSITORY) throw new Error('handoff artifact resolution requires canonical repository');
  if (text(process.env.GITHUB_JOB) !== 'independent-security-review') throw new Error('handoff artifact resolution job identity mismatch');
  const token = text(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
  if (!token) throw new Error('GitHub token is required for handoff artifact resolution');

  const inputs = readInputs();
  const prNumber = positiveInteger(inputs.pr_number);
  const sourceHead = text(inputs.source_head).toLowerCase();
  const baseSha = text(inputs.base_sha).toLowerCase();
  const branch = text(inputs.head_branch);
  if (!prNumber || !FULL_SHA.test(sourceHead) || !FULL_SHA.test(baseSha) || !branch) {
    throw new Error('handoff artifact resolver PR/head/base/branch inputs are incomplete');
  }

  const [owner, repo] = CANONICAL_REPOSITORY.split('/');
  const [pullRequest, mainRef, comments] = await Promise.all([
    githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, { token }),
    githubRequest(`/repos/${owner}/${repo}/git/ref/heads/main`, { token }),
    githubPages(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, { token }),
  ]);
  const currentMainSha = text(mainRef?.object?.sha).toLowerCase();
  if (currentMainSha !== baseSha
    || text(pullRequest?.state).toLowerCase() !== 'open'
    || text(pullRequest?.head?.sha).toLowerCase() !== sourceHead
    || text(pullRequest?.head?.ref) !== branch
    || text(pullRequest?.base?.sha).toLowerCase() !== baseSha
    || text(pullRequest?.base?.ref) !== 'main'
    || text(pullRequest?.head?.repo?.full_name) !== CANONICAL_REPOSITORY
    || text(pullRequest?.base?.repo?.full_name) !== CANONICAL_REPOSITORY) {
    throw new Error('handoff artifact resolver pull request is not exact current-main identity');
  }

  const handoffComment = selectHandoff(comments, sourceHead);
  const handoff = validateIndependentReviewHandoffIdentityV1({
    event: handoffEvent(prNumber, handoffComment),
    repository: CANONICAL_REPOSITORY,
    prNumber,
    sourceHead,
    baseSha,
    branch,
  });
  const provenance = handoff.coordinatorProvenance;
  const runId = positiveInteger(provenance?.coordinatorWorkflowRunId);
  const runAttempt = positiveInteger(provenance?.coordinatorWorkflowRunAttempt);
  const handoffCommentId = positiveInteger(provenance?.handoffCommentId);
  if (!runId || !runAttempt || !handoffCommentId) throw new Error('handoff coordinator provenance is incomplete');

  const run = await githubRequest(`/repos/${owner}/${repo}/actions/runs/${runId}`, { token });
  if (positiveInteger(run?.workflow_id) !== CANONICAL_COORDINATOR_WORKFLOW_ID
    || text(run?.name) !== CANONICAL_COORDINATOR_WORKFLOW_NAME
    || text(run?.path) !== CANONICAL_COORDINATOR_WORKFLOW_PATH
    || positiveInteger(run?.run_attempt) !== runAttempt
    || text(run?.repository?.full_name) !== CANONICAL_REPOSITORY
    || text(run?.head_sha).toLowerCase() !== baseSha) {
    throw new Error('handoff coordinator run no longer matches immutable canonical identity');
  }

  const artifactName = `stephanos-independent-review-handoff-${runId}-attempt-${runAttempt}-comment-${handoffCommentId}`;
  appendOutput('coordinator_run_id', runId);
  appendOutput('coordinator_run_attempt', runAttempt);
  appendOutput('handoff_comment_id', handoffCommentId);
  appendOutput('artifact_name', artifactName);
  console.log(`INDEPENDENT_REVIEW_HANDOFF_ARTIFACT=${artifactName}`);
}

main().catch((error) => {
  console.error(`INDEPENDENT_REVIEW_HANDOFF_ARTIFACT_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
