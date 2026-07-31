#!/usr/bin/env node

import fs from 'node:fs';
import {
  INDEPENDENT_REVIEW_JOB,
  PROTECTED_WORKFLOW_SOURCE_MAX_BYTES,
  PROTECTED_WORKFLOW_SOURCE_PATHS,
  PROTECTED_WORKFLOW_SOURCE_SCHEMA_VERSION,
  PROTECTED_REVIEW_MARKER,
  analyzeIndependentSecurityReview,
  bindRequiredExactHeadWorkflowIdentities,
  isApprovalBoundaryBootstrapAnalysis,
  validateExactHeadWorkflowRuns,
} from '../shared/agents/operatorMergeApprovalGateV2.mjs';
import {
  validateMainRefBaseBinding,
  validatePullRequestBaseBinding,
} from '../shared/agents/operatorMergeBaseBindingV1.mjs';
import {
  INDEPENDENT_REVIEW_ARTIFACT_FILE,
  buildIndependentReviewArtifact,
} from '../shared/agents/operatorMergeReviewArtifactV1.mjs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';

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

async function githubRequest(path, {
  method = 'GET',
  body = null,
  accept = 'application/vnd.github+json',
  allowNotFound = false,
  maxResponseBytes = 0,
} = {}) {
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
  const rawBytes = Buffer.from(await response.arrayBuffer());
  if (maxResponseBytes && rawBytes.length > maxResponseBytes) {
    throw new Error(`GitHub ${method} ${path} exceeded the ${maxResponseBytes}-byte response bound.`);
  }
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
  if (allowNotFound && response.status === 404) return null;
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

function changedFilePaths(files = []) {
  return [...new Set((Array.isArray(files) ? files : []).flatMap((file) => [
    text(file?.filename),
    text(file?.previous_filename),
  ]).filter(Boolean))];
}

function strictBase64Bytes(value, path) {
  const encoded = String(value ?? '').replace(/\s/g, '');
  if (!encoded
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`Protected workflow ${path} did not contain canonical base64 file content.`);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) {
    throw new Error(`Protected workflow ${path} base64 content was not canonical.`);
  }
  return bytes;
}

async function protectedWorkflowSourceAtHead(owner, repo, repository, path, sourceHead) {
  const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const payload = await githubRequest(
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(sourceHead)}`,
    {
      allowNotFound: true,
      maxResponseBytes: Math.ceil(PROTECTED_WORKFLOW_SOURCE_MAX_BYTES * 4 / 3) + 65_536,
    },
  );
  if (payload === null) {
    return Object.freeze({
      schemaVersion: PROTECTED_WORKFLOW_SOURCE_SCHEMA_VERSION,
      repository,
      path,
      ref: sourceHead,
      exists: false,
      size: 0,
      blobSha: null,
      content: null,
    });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || payload.type !== 'file'
    || payload.path !== path
    || payload.encoding !== 'base64'
    || typeof payload.size !== 'number'
    || !Number.isSafeInteger(payload.size)
    || payload.size <= 0
    || payload.size > PROTECTED_WORKFLOW_SOURCE_MAX_BYTES
    || !/^[a-f0-9]{40}$/.test(text(payload.sha))) {
    throw new Error(`Protected workflow ${path} metadata was not an exact bounded file at ${sourceHead}.`);
  }
  const bytes = strictBase64Bytes(payload.content, path);
  if (bytes.length !== payload.size) {
    throw new Error(`Protected workflow ${path} declared size did not match its exact-head content.`);
  }
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return Object.freeze({
    schemaVersion: PROTECTED_WORKFLOW_SOURCE_SCHEMA_VERSION,
    repository,
    path,
    ref: sourceHead,
    exists: true,
    size: bytes.length,
    blobSha: text(payload.sha).toLowerCase(),
    content,
  });
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
    workflow_id: run?.workflow_id,
    name: text(run?.name),
    path: text(run?.path),
    event: text(run?.event),
    repository: { full_name: text(run?.repository?.full_name) },
    head_sha: text(run?.head_sha),
    status: text(run?.status),
    conclusion: text(run?.conclusion),
    pull_requests: Array.isArray(run?.pull_requests)
      ? run.pull_requests.map((pullRequest) => ({
        number: pullRequest?.number,
        head: {
          sha: text(pullRequest?.head?.sha),
          ref: text(pullRequest?.head?.ref),
        },
        base: {
          sha: text(pullRequest?.base?.sha),
          ref: text(pullRequest?.base?.ref),
        },
      }))
      : [],
  };
}

async function waitForExactHeadWorkflows(
  owner,
  repo,
  sourceHead,
  requiredIdentities,
  repository,
  prNumber,
  branch,
  baseBranch,
  baseSha,
) {
  const started = Date.now();
  let lastVerdict = null;
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const runs = (await githubPages(
      `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(sourceHead)}&event=pull_request`,
      'workflow_runs',
    )).map(mapWorkflowRun);
    lastVerdict = validateExactHeadWorkflowRuns(runs, {
      expectedHead: sourceHead,
      expectedPrNumber: prNumber,
      expectedBranch: branch,
      expectedBaseBranch: baseBranch,
      expectedBaseSha: baseSha,
      requiredIdentities,
    });
    if (lastVerdict.valid) return { runs, verdict: lastVerdict };
    const terminalFailure = lastVerdict.blockers.some((blocker) => (
      blocker.startsWith('workflow-not-green:')
      || blocker.startsWith('workflow-identity-spoof:')
      || blocker.startsWith('workflow-path-identity-mismatch:')
      || blocker === 'required-workflow-identities-invalid-or-ambiguous'
    ));
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

async function postDisplayComment(owner, repo, prNumber, body) {
  try {
    return await postComment(owner, repo, prNumber, body);
  } catch (error) {
    console.warn(`INDEPENDENT_SECURITY_REVIEW_DISPLAY_COMMENT_FAILED=${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function writeReviewArtifact(artifact) {
  const runnerTemp = text(process.env.RUNNER_TEMP);
  const requestedPath = text(process.env.STEPHANOS_INDEPENDENT_REVIEW_ARTIFACT_PATH);
  if (!runnerTemp || !requestedPath) throw new Error('Independent review artifact path is required.');
  const expectedPath = resolve(runnerTemp, INDEPENDENT_REVIEW_ARTIFACT_FILE);
  const artifactPath = resolve(requestedPath);
  if (artifactPath !== expectedPath) throw new Error('Independent review artifact path must be the exact runner-temp result file.');
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return artifactPath;
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

  const workflowDefinitions = await githubPages(
    `/repos/${owner}/${repo}/actions/workflows`,
    'workflows',
  );
  const workflowIdentityBinding = bindRequiredExactHeadWorkflowIdentities(
    workflowDefinitions,
    { repository },
  );
  if (!workflowIdentityBinding.valid) {
    throw new Error(`Required workflow identity binding failed: ${workflowIdentityBinding.blockers.join(', ')}`);
  }

  const [{ verdict: workflowVerdict }, files, diff, threads] = await Promise.all([
    waitForExactHeadWorkflows(
      owner,
      repo,
      sourceHead,
      workflowIdentityBinding.identities,
      repository,
      prNumber,
      branch,
      baseBranch,
      baseSha,
    ),
    githubPages(`/repos/${owner}/${repo}/pulls/${prNumber}/files`),
    githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, { accept: 'application/vnd.github.v3.diff' }),
    unresolvedThreadCount(owner, repo, prNumber),
  ]);
  if (!workflowVerdict.valid) throw new Error('Exact-head workflows are not green.');
  if (threads !== 0) throw new Error(`Independent review blocked by ${threads} unresolved review thread(s).`);
  const protectedWorkflowPaths = PROTECTED_WORKFLOW_SOURCE_PATHS.filter((path) => (
    changedFilePaths(files).includes(path)
  ));
  const protectedWorkflowSources = await Promise.all(protectedWorkflowPaths.map((path) => (
    protectedWorkflowSourceAtHead(owner, repo, repository, path, sourceHead)
  )));

  const analysis = analyzeIndependentSecurityReview({
    repository,
    sourceHead,
    changedFiles: files,
    diff,
    protectedWorkflowSources,
    requireReviewerFilesInDiff: false,
  });

  const bootstrapRequired = isApprovalBoundaryBootstrapAnalysis(analysis);
  if (analysis.finalVerdict !== 'INDEPENDENT_SECURITY_REVIEW_CLEAN' && !bootstrapRequired) {
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
    await postDisplayComment(owner, repo, prNumber, body);
    throw new Error(`Independent security review found ${analysis.counts.P0} P0, ${analysis.counts.P1} P1 and ${analysis.counts.P2} P2 finding(s).`);
  }

  const finalPullRequest = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  const finalMainRef = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/main`);
  if (text(finalPullRequest?.head?.sha).toLowerCase() !== sourceHead || text(finalPullRequest?.state).toLowerCase() !== 'open') {
    throw new Error('Pull-request head or state changed during review.');
  }
  requireExactBase(finalPullRequest, finalMainRef, baseSha, 'pre-receipt');

  const artifact = buildIndependentReviewArtifact({
    repository,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    createdAtUtc: new Date().toISOString(),
    analysis,
  });
  const artifactPath = writeReviewArtifact(artifact);
  const receipt = artifact.receipt;
  const body = [
    PROTECTED_REVIEW_MARKER,
    bootstrapRequired
      ? '## Exact-head and exact-base approval-boundary review requires protected operator bootstrap'
      : '## Independent deterministic exact-head and exact-base security review passed',
    '',
    `Exact head: \`${sourceHead}\``,
    `Exact base: \`${baseSha}\``,
    '',
    '```json',
    JSON.stringify(receipt, null, 2),
    '```',
    '',
    bootstrapRequired
      ? 'This receipt contains only approval-boundary self-change findings. It grants no merge authority and becomes acceptable only after the exact run is released by the protected operator environment; any other finding remains blocking.'
      : 'This clean receipt was produced before and independently of the operator approval environment. It is bound to the exact reviewed head and exact reviewed base; any movement of either invalidates it. The reviewer has no merge, mark-ready, source-write, Battle Bridge, OpenClaw or runtime authority.',
  ].join('\n');
  const comment = await postDisplayComment(owner, repo, prNumber, body);
  console.log(`INDEPENDENT_SECURITY_REVIEW=${bootstrapRequired ? 'operator-bootstrap-required' : 'clean'}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_COMMENT_ID=${comment?.id ?? ''}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_ARTIFACT_NAME=${artifact.artifactName}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_ARTIFACT_PATH=${artifactPath}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_ARTIFACT_PAYLOAD_SHA256=${artifact.payloadSha256}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_HEAD=${sourceHead}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_BASE=${baseSha}`);
}

main().catch((error) => {
  console.error(`INDEPENDENT_SECURITY_REVIEW_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
