#!/usr/bin/env node

import fs from 'node:fs';
import { resolve } from 'node:path';

import {
  validateIndependentReviewHandoffIdentityV1,
} from '../shared/agents/independentReviewHandoffIdentityV1.mjs';
import {
  buildIndependentReviewWorkflowDispatchPreflightV1,
} from '../shared/agents/independentReviewWorkflowDispatchPreflightV1.mjs';
import {
  CANONICAL_REPOSITORY,
  CANONICAL_REVIEW_WORKFLOW_NAME,
  CANONICAL_REVIEW_WORKFLOW_PATH,
} from '../shared/agents/independentReviewWorkflowDispatchAdmissionV1.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-review-workflow-dispatch-prepare-v1';
const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({ login: 'github-actions[bot]', id: 41898282 });
const INPUT_KEYS = Object.freeze([
  'pr_number',
  'source_head',
  'base_sha',
  'head_branch',
  'handoff_binding_sha256',
  'handoff_run_receipt_sha256',
]);
const WORKFLOW_ENV_KEYS = Object.freeze([
  'GITHUB_ACTIONS',
  'GITHUB_EVENT_NAME',
  'GITHUB_REPOSITORY',
  'GITHUB_WORKFLOW',
  'GITHUB_JOB',
  'GITHUB_REF',
  'GITHUB_SHA',
  'GITHUB_WORKFLOW_REF',
]);
const FULL_SHA = /^[0-9a-f]{40}$/i;
const MAX_PAGES = 20;
const RECEIPT_FILE = 'independent-review-handoff-run-receipt.json';
const PREFLIGHT_FILE = 'independent-review-workflow-dispatch-preflight.json';

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

function workflowDispatchEnvironment(environment = process.env) {
  const snapshot = {};
  for (const key of WORKFLOW_ENV_KEYS) snapshot[key] = text(environment[key]);
  return Object.freeze(snapshot);
}

function exactRunnerTempPath(fileName, requested = '') {
  const runnerTemp = text(process.env.RUNNER_TEMP);
  if (!runnerTemp) throw new Error('RUNNER_TEMP is required for workflow-dispatch preparation');
  const expected = resolve(runnerTemp, fileName);
  if (requested && resolve(requested) !== expected) {
    throw new Error(`${fileName} must use the exact runner-temp path`);
  }
  return expected;
}

async function githubRequest(pathname, { token, itemKey = null } = {}) {
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
  if (itemKey !== null && !Array.isArray(payload?.[itemKey])) {
    throw new Error(`GitHub GET ${pathname} did not return ${itemKey}`);
  }
  return payload;
}

async function githubPages(pathname, { token, itemKey = null } = {}) {
  const separator = pathname.includes('?') ? '&' : '?';
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await githubRequest(`${pathname}${separator}per_page=100&page=${page}`, { token, itemKey });
    const values = itemKey === null ? payload : payload[itemKey];
    if (!Array.isArray(values)) throw new Error(`GitHub pagination payload for ${pathname} is invalid`);
    rows.push(...values);
    if (values.length < 100) return rows;
  }
  throw new Error(`GitHub pagination exceeded ${MAX_PAGES * 100} records for ${pathname}`);
}

function handoffEvent(repository, prNumber, comment) {
  return {
    repository: { full_name: repository },
    issue: {
      number: prNumber,
      pull_request: { url: `https://api.github.com/repos/${repository}/pulls/${prNumber}` },
    },
    comment,
  };
}

function selectExactHandoffComment(comments, sourceHead) {
  const marker = `<!-- stephanos:exact-head-review-dispatch:v1 head=${sourceHead} -->`;
  const matches = comments.filter((comment) => (
    text(comment?.user?.login).toLowerCase() === TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    && positiveInteger(comment?.user?.id) === TRUSTED_GITHUB_ACTIONS_REVIEWER.id
    && text(comment?.body).startsWith(marker)
    && text(comment?.body).includes('## Provider-neutral exact-head review handoff')
  ));
  if (matches.length !== 1) {
    throw new Error(`exact provider-neutral review handoff count must be one, observed ${matches.length}`);
  }
  return matches[0];
}

async function canonicalWorkflow(owner, repo, token) {
  const workflows = await githubPages(`/repos/${owner}/${repo}/actions/workflows`, { token, itemKey: 'workflows' });
  const pathMatches = workflows.filter((workflow) => text(workflow?.path) === CANONICAL_REVIEW_WORKFLOW_PATH);
  const nameCollisions = workflows.filter((workflow) => (
    text(workflow?.name) === CANONICAL_REVIEW_WORKFLOW_NAME
    && text(workflow?.path) !== CANONICAL_REVIEW_WORKFLOW_PATH
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

function readEventInputs() {
  const eventPath = text(process.env.GITHUB_EVENT_PATH);
  if (!eventPath || !fs.existsSync(eventPath)) throw new Error('workflow_dispatch event payload is required');
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  if (!exactKeys(event?.inputs, INPUT_KEYS)) throw new Error('workflow_dispatch inputs must use the exact six-field schema');
  return { event, inputs: event.inputs };
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('workflow-dispatch preparation may run only inside GitHub Actions');
  if (text(process.env.GITHUB_EVENT_NAME) !== 'workflow_dispatch') throw new Error('workflow-dispatch preparation requires workflow_dispatch');
  if (text(process.env.GITHUB_REPOSITORY) !== CANONICAL_REPOSITORY) throw new Error('workflow-dispatch preparation requires the canonical repository');
  if (text(process.env.GITHUB_JOB) !== 'independent-security-review') throw new Error('workflow-dispatch preparation job identity mismatch');

  const token = text(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
  if (!token) throw new Error('GitHub token is required for workflow-dispatch preparation');
  const { inputs } = readEventInputs();
  const prNumber = positiveInteger(inputs.pr_number);
  const sourceHead = text(inputs.source_head).toLowerCase();
  const baseSha = text(inputs.base_sha).toLowerCase();
  const branch = text(inputs.head_branch);
  if (!prNumber || !FULL_SHA.test(sourceHead) || !FULL_SHA.test(baseSha) || !branch) {
    throw new Error('workflow_dispatch PR/head/base/branch inputs are incomplete');
  }

  const [owner, repo] = CANONICAL_REPOSITORY.split('/');
  const [pullRequest, mainRef, workflow, comments] = await Promise.all([
    githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, { token }),
    githubRequest(`/repos/${owner}/${repo}/git/ref/heads/main`, { token }),
    canonicalWorkflow(owner, repo, token),
    githubPages(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, { token }),
  ]);
  const currentMainSha = text(mainRef?.object?.sha).toLowerCase();
  if (currentMainSha !== baseSha) throw new Error('workflow_dispatch base is not exact current main');
  if (text(pullRequest?.state).toLowerCase() !== 'open'
    || typeof pullRequest?.draft !== 'boolean'
    || text(pullRequest?.head?.sha).toLowerCase() !== sourceHead
    || text(pullRequest?.head?.ref) !== branch
    || text(pullRequest?.base?.sha).toLowerCase() !== baseSha
    || text(pullRequest?.base?.ref) !== 'main'
    || text(pullRequest?.head?.repo?.full_name) !== CANONICAL_REPOSITORY
    || text(pullRequest?.base?.repo?.full_name) !== CANONICAL_REPOSITORY) {
    throw new Error('workflow_dispatch pull request no longer matches exact canonical identity');
  }

  const handoffComment = selectExactHandoffComment(comments, sourceHead);
  const handoffIdentity = validateIndependentReviewHandoffIdentityV1({
    event: handoffEvent(CANONICAL_REPOSITORY, prNumber, handoffComment),
    repository: CANONICAL_REPOSITORY,
    prNumber,
    sourceHead,
    baseSha,
    branch,
  });

  const receiptPath = exactRunnerTempPath(
    RECEIPT_FILE,
    text(process.env.STEPHANOS_REVIEW_HANDOFF_RUN_RECEIPT_PATH),
  );
  if (!fs.existsSync(receiptPath)) throw new Error('immutable coordinator handoff receipt is required');
  const handoffRunReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));

  const preflight = buildIndependentReviewWorkflowDispatchPreflightV1({
    environment: workflowDispatchEnvironment(),
    workflowDefinition: workflow,
    currentMainSha,
    pullRequest,
    handoffIdentity,
    handoffRunReceipt,
    workflowDispatchInputs: inputs,
  });
  const outputPath = exactRunnerTempPath(
    PREFLIGHT_FILE,
    text(process.env.STEPHANOS_INDEPENDENT_REVIEW_DISPATCH_PREFLIGHT_PATH),
  );
  fs.writeFileSync(outputPath, `${JSON.stringify(preflight, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  console.log(`INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT=${preflight.verdict}`);
  console.log(`INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_PR=${preflight.prNumber}`);
  console.log(`INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_HEAD=${preflight.sourceHead}`);
}

main().catch((error) => {
  console.error(`INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});