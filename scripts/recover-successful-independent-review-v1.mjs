#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER,
  parseIndependentReviewWorkflowDispatchLaunchReceiptCommentV1,
} from '../shared/agents/independentReviewWorkflowDispatchLaunchReceiptV1.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
} from '../shared/agents/operatorMergeApprovalGate.mjs';
import {
  loadWorkflowDispatchRuns,
  reconcileExistingLaunchReceiptV1,
} from './launch-missing-independent-review-v1.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-review-successful-artifact-recovery-v1';
const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({ login: 'github-actions[bot]', id: 41898282 });
const FULL_SHA = /^[0-9a-f]{40}$/i;
const MAX_PAGES = 20;
const LAUNCH_RECEIPT_HEADING = '## Provider-neutral independent-review missing-run launch receipt';
const TERMINAL_RECOVERY_POLL_INTERVAL_MS = 2000;
const TERMINAL_RECOVERY_MAX_POLLS = 30;
const CANONICAL_WORKFLOW_ID = 318073448;
const REVIEW_SHA256 = /^[a-f0-9]{64}$/i;

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

async function githubRequest(pathname, { token } = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    method: 'GET',
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

function exactTrustedLaunchComment(comment) {
  const body = text(comment?.body);
  return text(comment?.user?.login).toLowerCase() === TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    && positiveInteger(comment?.user?.id) === TRUSTED_GITHUB_ACTIONS_REVIEWER.id
    && body.startsWith(`<!-- ${INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER} key=`)
    && body.includes(LAUNCH_RECEIPT_HEADING);
}

export function selectSuccessfulReviewRecoveryLaunchReceiptV1(comments, {
  repository,
  prNumber,
  expectedHead,
  expectedBase,
} = {}) {
  const matches = [];
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!exactTrustedLaunchComment(comment)) continue;
    const receipt = parseIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(comment.body);
    if (text(receipt.repository).toLowerCase() !== text(repository).toLowerCase()) continue;
    if (positiveInteger(receipt.prNumber) !== positiveInteger(prNumber)) continue;
    if (text(receipt.sourceHead).toLowerCase() !== text(expectedHead).toLowerCase()) continue;
    if (text(receipt.baseSha).toLowerCase() !== text(expectedBase).toLowerCase()) continue;
    matches.push(receipt);
  }
  if (matches.length !== 1) {
    throw new Error(`exact successful-review recovery launch receipt count must be one, observed ${matches.length}`);
  }
  return matches[0];
}

export async function waitForTerminalReviewReconciliationV1(initialReconciliation, readNextReconciliation, {
  enabled = false,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  let reconciliation = initialReconciliation;
  if (!enabled || reconciliation?.reconciliation !== 'WAIT_RUNNING') return reconciliation;
  if (typeof readNextReconciliation !== 'function' || typeof sleep !== 'function') {
    throw new Error('terminal review recovery polling requires read and sleep functions');
  }
  for (let poll = 0; poll < TERMINAL_RECOVERY_MAX_POLLS && reconciliation?.reconciliation === 'WAIT_RUNNING'; poll += 1) {
    await sleep(TERMINAL_RECOVERY_POLL_INTERVAL_MS);
    reconciliation = await readNextReconciliation();
  }
  return reconciliation;
}

export function buildSuccessfulReviewArtifactRecoveryV1(reconciliation = {}) {
  if (reconciliation?.reconciliation !== 'ALREADY_SUCCESSFUL') {
    return Object.freeze({
      decision: 'NO_SUCCESSFUL_REVIEW_ARTIFACT_RECOVERY',
      recoveryRequired: false,
      runId: null,
      runAttempt: null,
      artifactName: null,
    });
  }
  const runId = positiveInteger(reconciliation.runId);
  const runAttempt = positiveInteger(reconciliation.runAttempt);
  if (!runId || !runAttempt || text(reconciliation.conclusion).toLowerCase() !== 'success') {
    throw new Error('successful review recovery requires one exact successful run id and attempt');
  }
  return Object.freeze({
    decision: 'RECOVER_SUCCESSFUL_REVIEW_ARTIFACT',
    recoveryRequired: true,
    runId,
    runAttempt,
    artifactName: `stephanos-independent-review-${runId}-attempt-${runAttempt}`,
  });
}

function mapPullRequest(pr) {
  return {
    number: positiveInteger(pr?.number),
    state: text(pr?.state).toLowerCase(),
    sameRepository: text(pr?.head?.repo?.full_name).toLowerCase() === text(pr?.base?.repo?.full_name).toLowerCase(),
    headRef: text(pr?.head?.ref),
    headSha: text(pr?.head?.sha).toLowerCase(),
    baseRef: text(pr?.base?.ref),
    baseSha: text(pr?.base?.sha).toLowerCase(),
  };
}

async function loadCanonicalWorkflow(owner, repo, token, receipt) {
  const workflows = await githubPages(`/repos/${owner}/${repo}/actions/workflows`, { token, itemKey: 'workflows' });
  const pathMatches = workflows.filter((workflow) => text(workflow?.path) === INDEPENDENT_REVIEW_WORKFLOW_PATH);
  const nameCollisions = workflows.filter((workflow) => text(workflow?.name) === INDEPENDENT_REVIEW_WORKFLOW_NAME
    && text(workflow?.path) !== INDEPENDENT_REVIEW_WORKFLOW_PATH);
  if (pathMatches.length !== 1 || nameCollisions.length) {
    throw new Error('canonical independent-review workflow identity is missing or ambiguous');
  }
  const workflow = pathMatches[0];
  if (positiveInteger(workflow?.id) !== positiveInteger(receipt.workflowId)
    || text(workflow?.name) !== INDEPENDENT_REVIEW_WORKFLOW_NAME
    || text(workflow?.state).toLowerCase() !== 'active') {
    throw new Error('successful review recovery workflow identity does not match the launch receipt');
  }
  return workflow;
}

// An owner hint is not a review result. Bind it to canonical live GitHub
// run, workflow, PR/head/base, and immutable artifact before consumption.
export function validateOwnerHintReviewArtifactReadbackV1({ workflow, run, artifacts, pr, hint } = {}) {
  const runId=positiveInteger(hint?.runId), artifactId=positiveInteger(hint?.artifactId);
  const digest=text(hint?.sha256).toLowerCase();
  if (!runId || !artifactId || !REVIEW_SHA256.test(digest)) throw new Error('owner review hint identity incomplete');
  if (positiveInteger(workflow?.id)!==CANONICAL_WORKFLOW_ID
    || text(workflow?.path)!==INDEPENDENT_REVIEW_WORKFLOW_PATH
    || text(workflow?.name)!==INDEPENDENT_REVIEW_WORKFLOW_NAME
    || text(workflow?.state).toLowerCase()!=='active') throw new Error('unqualified review workflow');
  if (positiveInteger(run?.id)!==runId || positiveInteger(run?.workflow_id)!==CANONICAL_WORKFLOW_ID
    || text(run?.path)!==INDEPENDENT_REVIEW_WORKFLOW_PATH
    || !['pull_request_target','pull_request','workflow_dispatch'].includes(text(run?.event))
    || text(run?.status)!=='completed' || text(run?.conclusion)!=='success'
    || !positiveInteger(run?.run_attempt)
    || text(run?.head_sha).toLowerCase()!==text(pr?.headSha).toLowerCase()
    || text(run?.head_branch)!==text(pr?.headRef)) throw new Error('review run stale or mismatched');
  const matches=Array.isArray(run?.pull_requests) && run.pull_requests.filter((entry)=>
    positiveInteger(entry?.number)===positiveInteger(pr?.number)
    && text(entry?.head?.sha).toLowerCase()===text(pr?.headSha).toLowerCase()
    && text(entry?.head?.ref)===text(pr?.headRef)
    && text(entry?.base?.sha).toLowerCase()===text(pr?.baseSha).toLowerCase()
    && text(entry?.base?.ref)==='main'
    && positiveInteger(entry?.head?.repo?.id)>0 && entry?.head?.repo?.id===entry?.base?.repo?.id);
  if (!matches || matches.length!==1) throw new Error('review run lacks exact PR/head/base binding');
  const name=`stephanos-independent-review-${runId}-attempt-${run.run_attempt}`;
  const artifactMatches=Array.isArray(artifacts) && artifacts.filter((entry)=>
    positiveInteger(entry?.id)===artifactId && text(entry?.name)===name && entry?.expired===false
    && text(entry?.digest).toLowerCase()===`sha256:${digest}`
    && positiveInteger(entry?.workflow_run?.id)===runId
    && text(entry?.workflow_run?.head_sha).toLowerCase()===text(pr?.headSha).toLowerCase()
    && text(entry?.workflow_run?.head_branch)===text(pr?.headRef));
  if (!artifactMatches || artifactMatches.length!==1) throw new Error('immutable review artifact readback mismatch');
  return Object.freeze({decision:'RECOVER_SUCCESSFUL_REVIEW_ARTIFACT',recoveryRequired:true,
    runId,runAttempt:positiveInteger(run.run_attempt),artifactName:name});
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('successful independent-review artifact recovery may run only inside GitHub Actions');
  }
  const eventName = text(process.env.GITHUB_EVENT_NAME);
  if (!['issue_comment', 'workflow_run', 'schedule', 'workflow_dispatch'].includes(eventName)) {
    throw new Error(`successful independent-review artifact recovery event ${eventName || 'unknown'} is not allowlisted`);
  }
  const token = text(process.env.GITHUB_TOKEN);
  const repository = text(process.env.GITHUB_REPOSITORY);
  const prNumber = positiveInteger(process.env.STEPHANOS_INDEPENDENT_REVIEW_RECOVERY_PR);
  const expectedHead = text(process.env.STEPHANOS_INDEPENDENT_REVIEW_RECOVERY_HEAD).toLowerCase();
  if (!token || !repository || !prNumber || !FULL_SHA.test(expectedHead)) {
    throw new Error('token, repository and exact PR/head are required for successful review recovery');
  }
  const { owner, repo } = repositoryParts(repository);
  const [rawPr, mainRef, comments] = await Promise.all([
    githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, { token }),
    githubRequest(`/repos/${owner}/${repo}/git/ref/heads/main`, { token }),
    githubPages(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, { token }),
  ]);
  const pr = mapPullRequest(rawPr);
  const currentMain = text(mainRef?.object?.sha).toLowerCase();
  if (pr.state !== 'open' || !pr.sameRepository || pr.baseRef !== 'main'
    || pr.baseSha !== currentMain || pr.headSha !== expectedHead) {
    throw new Error('pull request no longer matches exact open current-main successful-review recovery identity');
  }
  const hint={runId:positiveInteger(process.env.STEPHANOS_INDEPENDENT_REVIEW_RECOVERY_HINT_RUN),
    artifactId:positiveInteger(process.env.STEPHANOS_INDEPENDENT_REVIEW_RECOVERY_HINT_ARTIFACT),
    sha256:text(process.env.STEPHANOS_INDEPENDENT_REVIEW_RECOVERY_HINT_SHA256).toLowerCase()};
  const provided=Boolean(text(process.env.STEPHANOS_INDEPENDENT_REVIEW_RECOVERY_HINT_RUN)
    || text(process.env.STEPHANOS_INDEPENDENT_REVIEW_RECOVERY_HINT_ARTIFACT)
    || text(process.env.STEPHANOS_INDEPENDENT_REVIEW_RECOVERY_HINT_SHA256));
  if (provided) {
    if (!hint.runId || !hint.artifactId || !REVIEW_SHA256.test(hint.sha256)) throw new Error('partial owner review hint');
    const workflow=await loadCanonicalWorkflow(owner,repo,token,{workflowId:CANONICAL_WORKFLOW_ID});
    const [run,index]=await Promise.all([
      githubRequest(`/repos/${owner}/${repo}/actions/runs/${hint.runId}`,{token}),
      githubRequest(`/repos/${owner}/${repo}/actions/runs/${hint.runId}/artifacts?per_page=100`,{token}),
    ]);
    if (!Array.isArray(index?.artifacts) || index.total_count>index.artifacts.length) throw new Error('artifact index exceeds bounded read');
    const recovered=validateOwnerHintReviewArtifactReadbackV1({workflow,run,artifacts:index.artifacts,pr,hint});
    console.log(`INDEPENDENT_REVIEW_SUCCESSFUL_ARTIFACT_RECOVERY=${recovered.decision}`);
    appendOutput('decision',recovered.decision);
    appendOutput('recovery_required','true');
    appendOutput('run_id',recovered.runId);
    appendOutput('run_attempt',recovered.runAttempt);
    appendOutput('artifact_name',recovered.artifactName);
    return;
  }
  const launchReceipt = selectSuccessfulReviewRecoveryLaunchReceiptV1(comments, {
    repository,
    prNumber,
    expectedHead: pr.headSha,
    expectedBase: pr.baseSha,
  });
  const workflow = await loadCanonicalWorkflow(owner, repo, token, launchReceipt);
  const readReconciliation = async () => {
    const runs = await loadWorkflowDispatchRuns(owner, repo, positiveInteger(workflow.id), token, launchReceipt);
    return reconcileExistingLaunchReceiptV1({ launchReceipt, runs });
  };
  let reconciliation = await readReconciliation();
  reconciliation = await waitForTerminalReviewReconciliationV1(reconciliation, readReconciliation, {
    enabled: reconciliation?.reconciliation === 'WAIT_RUNNING',
  });
  const recovery = buildSuccessfulReviewArtifactRecoveryV1(reconciliation);

  console.log(`INDEPENDENT_REVIEW_SUCCESSFUL_ARTIFACT_RECOVERY=${recovery.decision}`);
  appendOutput('decision', recovery.decision);
  appendOutput('recovery_required', recovery.recoveryRequired ? 'true' : 'false');
  appendOutput('run_id', recovery.runId ?? '');
  appendOutput('run_attempt', recovery.runAttempt ?? '');
  appendOutput('artifact_name', recovery.artifactName ?? '');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    console.error(`INDEPENDENT_REVIEW_SUCCESSFUL_ARTIFACT_RECOVERY_BLOCKED=${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  });
}
