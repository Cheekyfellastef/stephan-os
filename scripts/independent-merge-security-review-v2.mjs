#!/usr/bin/env node

import fs from 'node:fs';
import {
  INDEPENDENT_REVIEW_JOB,
  PROTECTED_WORKFLOW_SOURCE_MAX_BYTES,
  PROTECTED_WORKFLOW_SOURCE_PATHS,
  PROTECTED_WORKFLOW_SOURCE_SCHEMA_VERSION,
  PROTECTED_REVIEW_MARKER,
  analyzeIndependentSecurityReview,
  isApprovalBoundaryBootstrapAnalysis,
} from '../shared/agents/operatorMergeApprovalGateV2.mjs';
import {
  validateMainRefBaseBinding,
  validatePullRequestBaseBinding,
} from '../shared/agents/operatorMergeBaseBindingV1.mjs';
import {
  INDEPENDENT_REVIEW_ARTIFACT_FILE,
  buildIndependentReviewFindingsArtifact,
  buildIndependentReviewArtifact,
} from '../shared/agents/operatorMergeReviewArtifactV1.mjs';
import {
  GITHUB_READ_MAX_ATTEMPTS,
  GitHubReadInfrastructureError,
  buildIndependentReviewInfrastructureBlockedArtifact,
  classifyGitHubReadFailure,
  githubReadRetryDelayMs,
} from '../shared/agents/githubReadResilienceV1.mjs';
import { resolve } from 'node:path';
import {
  adjudicateQualifiedSpecialistReview,
  qualifiedSpecialistEscalationPaths,
} from '../shared/agents/qualifiedSpecialistReviewV1.mjs';
import { TextDecoder } from 'node:util';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-merge-security-review-v2';
const MAX_PAGES = 20;

let retryIdentity = null;

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

function readRunIdentity() {
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
  return Object.freeze({
    event,
    repository,
    owner,
    repo,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    baseBranch,
    runId,
    runAttempt,
  });
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolveDelay) => setTimeout(resolveDelay, ms)) : Promise.resolve();
}

function requireExactBase(pullRequest, mainRef, baseSha, phase) {
  const prBase = validatePullRequestBaseBinding(pullRequest, baseSha);
  const liveBase = validateMainRefBaseBinding(mainRef, baseSha);
  if (!prBase.valid || !liveBase.valid) {
    throw new Error(`${phase} base binding changed: ${[...prBase.blockers, ...liveBase.blockers].join(', ')}`);
  }
}

async function verifyRetryIdentity() {
  if (!retryIdentity) throw new Error('GitHub read retry identity is unavailable.');
  const {
    owner,
    repo,
    prNumber,
    sourceHead,
    branch,
    baseSha,
  } = retryIdentity;
  const [pullRequest, mainRef] = await Promise.all([
    githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
      retryReads: false,
      verifyIdentityBetweenRetries: false,
    }),
    githubRequest(`/repos/${owner}/${repo}/git/ref/heads/main`, {
      retryReads: false,
      verifyIdentityBetweenRetries: false,
    }),
  ]);
  if (text(pullRequest?.state).toLowerCase() !== 'open'
    || text(pullRequest?.head?.sha).toLowerCase() !== sourceHead
    || text(pullRequest?.head?.ref) !== branch
    || text(pullRequest?.base?.ref) !== 'main') {
    throw new Error('Pull-request identity changed while retrying a GitHub read.');
  }
  requireExactBase(pullRequest, mainRef, baseSha, 'retry');
}

async function githubRequest(path, {
  method = 'GET',
  body = null,
  accept = 'application/vnd.github+json',
  allowNotFound = false,
  maxResponseBytes = 0,
  retryReads = true,
  verifyIdentityBetweenRetries = true,
} = {}) {
  const token = text(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  if (!token) throw new Error('GitHub token is required.');
  const normalizedMethod = text(method || 'GET').toUpperCase();
  const maxAttempts = normalizedMethod === 'GET' && retryReads
    ? GITHUB_READ_MAX_ATTEMPTS
    : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        method: normalizedMethod,
        redirect: 'error',
        headers: {
          Accept: accept,
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': API_VERSION,
          'User-Agent': USER_AGENT,
          ...(body === null ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      const classification = classifyGitHubReadFailure({
        method: normalizedMethod,
        networkError: true,
      });
      if (!classification.retryable) throw error;
      if (attempt < maxAttempts) {
        if (verifyIdentityBetweenRetries) await verifyRetryIdentity();
        await sleep(githubReadRetryDelayMs(attempt));
        continue;
      }
      throw new GitHubReadInfrastructureError({
        code: classification.code,
        method: normalizedMethod,
        path,
        attempts: attempt,
      });
    }

    const rawBytes = Buffer.from(await response.arrayBuffer());
    if (maxResponseBytes && rawBytes.length > maxResponseBytes) {
      throw new Error(`GitHub ${normalizedMethod} ${path} exceeded the ${maxResponseBytes}-byte response bound.`);
    }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
    const classification = classifyGitHubReadFailure({
      method: normalizedMethod,
      status: response.status,
      body: raw,
    });

    if (allowNotFound && response.status === 404 && !classification.retryable) return null;
    if (!response.ok) {
      if (classification.retryable) {
        if (attempt < maxAttempts) {
          if (verifyIdentityBetweenRetries) await verifyRetryIdentity();
          await sleep(githubReadRetryDelayMs(attempt));
          continue;
        }
        throw new GitHubReadInfrastructureError({
          code: classification.code,
          method: normalizedMethod,
          path,
          status: response.status,
          attempts: attempt,
        });
      }
      throw new Error(`GitHub ${normalizedMethod} ${path} failed (${response.status}): ${raw.slice(0, 500)}`);
    }
    if (accept.includes('diff')) return raw;
    return raw ? JSON.parse(raw) : null;
  }
  throw new Error(`GitHub ${normalizedMethod} ${path} exhausted an impossible read state.`);
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

async function postComment(owner, repo, prNumber, body) {
  return githubRequest(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    body: { body },
  });
}

async function postDisplayComment(owner, repo, prNumber, body) {
  // The immutable artifact is the merge authority. This comment is only a
  // discovery index and some GitHub App-triggered workflows cannot publish it
  // even with the bounded workflow permission. Preserve the exact artifact;
  // the protected merge consumer reads and validates it directly.
  try {
    return await postComment(owner, repo, prNumber, body);
  } catch (error) {
    console.warn(`INDEPENDENT_SECURITY_REVIEW_DISPLAY_COMMENT_UNAVAILABLE=${error instanceof Error ? error.message : String(error)}`);
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

function writeInfrastructureBlockedArtifact(error) {
  if (!(error instanceof GitHubReadInfrastructureError)) return null;
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.GITHUB_EVENT_NAME !== 'pull_request_target'
    || process.env.GITHUB_JOB !== INDEPENDENT_REVIEW_JOB) {
    return null;
  }
  const requestedPath = text(process.env.STEPHANOS_INDEPENDENT_REVIEW_ARTIFACT_PATH);
  if (requestedPath && fs.existsSync(resolve(requestedPath))) {
    return null;
  }
  const identity = readRunIdentity();
  const artifact = buildIndependentReviewInfrastructureBlockedArtifact({
    repository: identity.repository,
    prNumber: identity.prNumber,
    branch: identity.branch,
    sourceHead: identity.sourceHead,
    baseSha: identity.baseSha,
    workflowRunId: identity.runId,
    workflowRunAttempt: identity.runAttempt,
    createdAtUtc: new Date().toISOString(),
    failure: error,
  });
  const artifactPath = writeReviewArtifact(artifact);
  console.log('INDEPENDENT_SECURITY_REVIEW=REVIEW_INFRASTRUCTURE_BLOCKED');
  console.log(`INDEPENDENT_SECURITY_REVIEW_ARTIFACT_NAME=${artifact.artifactName}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_ARTIFACT_PATH=${artifactPath}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_ARTIFACT_PAYLOAD_SHA256=${artifact.payloadSha256}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_HEAD=${artifact.sourceHead}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_BASE=${artifact.baseSha}`);
  return artifactPath;
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Independent review may run only inside GitHub Actions.');
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request_target') throw new Error('Independent review requires pull_request_target.');
  if (process.env.GITHUB_JOB !== INDEPENDENT_REVIEW_JOB) throw new Error('Independent review job identity mismatch.');

  const identity = readRunIdentity();
  const {
    repository,
    owner,
    repo,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    runId,
    runAttempt,
  } = identity;
  retryIdentity = Object.freeze({
    owner,
    repo,
    prNumber,
    sourceHead,
    branch,
    baseSha,
  });

  const initialPullRequest = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  const initialMainRef = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/main`);
  if (text(initialPullRequest?.state).toLowerCase() !== 'open'
    || text(initialPullRequest?.head?.sha).toLowerCase() !== sourceHead
    || text(initialPullRequest?.head?.ref) !== branch
    || text(initialPullRequest?.base?.ref) !== 'main') {
    throw new Error('Pull-request identity changed before review.');
  }
  requireExactBase(initialPullRequest, initialMainRef, baseSha, 'pre-review');

  // Review the immutable head/base immediately. CI and unresolved-thread
  // evidence remain mandatory at the independent merge-consumption boundary;
  // serializing analysis behind them only delays feedback and wastes runners.
  const [files, diff] = await Promise.all([
    githubPages(`/repos/${owner}/${repo}/pulls/${prNumber}/files`),
    githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, { accept: 'application/vnd.github.v3.diff' }),
  ]);
  const protectedWorkflowPaths = PROTECTED_WORKFLOW_SOURCE_PATHS.filter((path) => (
    changedFilePaths(files).includes(path)
  ));
  const protectedWorkflowSources = await Promise.all(protectedWorkflowPaths.map((path) => (
    protectedWorkflowSourceAtHead(owner, repo, repository, path, sourceHead)
  )));

  const deterministicAnalysis = analyzeIndependentSecurityReview({
    repository,
    sourceHead,
    changedFiles: files,
    diff,
    protectedWorkflowSources,
    requireReviewerFilesInDiff: false,
  });
  const specialistPaths = qualifiedSpecialistEscalationPaths(deterministicAnalysis);
  const reviews = specialistPaths.length > 0
    ? await githubPages(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`)
    : [];
  const specialist = adjudicateQualifiedSpecialistReview({
    analysis: deterministicAnalysis,
    reviews,
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
  });
  const analysis = specialist.required && specialist.valid
    ? specialist.analysis
    : deterministicAnalysis;
  console.log(`SPECIALIST_REVIEW_ESTATE=${specialistPaths.length > 0 ? 'LOADED' : 'NOT_REQUIRED'}`);
  console.log(`SPECIALIST_REVIEW_DECISION=${specialist.required ? (specialist.valid ? 'SEALED' : 'REQUIRED') : 'NOT_REQUIRED'}`);
  console.log(`SPECIALIST_REVIEW_ID=${specialist.reviewId || ''}`);

  const bootstrapRequired = isApprovalBoundaryBootstrapAnalysis(analysis);
  const finalPullRequest = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  const finalMainRef = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/main`);
  if (text(finalPullRequest?.head?.sha).toLowerCase() !== sourceHead || text(finalPullRequest?.state).toLowerCase() !== 'open') {
    throw new Error('Pull-request head or state changed during review.');
  }
  requireExactBase(finalPullRequest, finalMainRef, baseSha, 'pre-artifact');
  const createdAtUtc = new Date().toISOString();
  if (analysis.finalVerdict !== 'INDEPENDENT_SECURITY_REVIEW_CLEAN' && !bootstrapRequired) {
    const artifact = buildIndependentReviewFindingsArtifact({
      repository,
      prNumber,
      sourceHead,
      baseSha,
      branch,
      workflowRunId: runId,
      workflowRunAttempt: runAttempt,
      createdAtUtc,
      analysis,
    });
    const artifactPath = writeReviewArtifact(artifact);
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
    console.log(`INDEPENDENT_SECURITY_REVIEW_ARTIFACT_NAME=${artifact.artifactName}`);
    console.log(`INDEPENDENT_SECURITY_REVIEW_ARTIFACT_PATH=${artifactPath}`);
    console.log(`INDEPENDENT_SECURITY_REVIEW_ARTIFACT_PAYLOAD_SHA256=${artifact.payloadSha256}`);
    throw new Error(`Independent security review found ${analysis.counts.P0} P0, ${analysis.counts.P1} P1 and ${analysis.counts.P2} P2 finding(s).`);
  }

  const artifact = buildIndependentReviewArtifact({
    repository,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    createdAtUtc,
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
      : 'This clean receipt was precomputed before and independently of the operator approval environment. It is bound to the exact reviewed head and exact reviewed base; any movement of either invalidates it. CI success and zero unresolved threads remain mandatory when the receipt is consumed. The reviewer has no merge, mark-ready, source-write, Battle Bridge, OpenClaw or runtime authority.',
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
  try {
    writeInfrastructureBlockedArtifact(error);
  } catch (artifactError) {
    console.error(`INDEPENDENT_SECURITY_REVIEW_INFRASTRUCTURE_ARTIFACT_BLOCKED=${artifactError instanceof Error ? artifactError.message : String(artifactError)}`);
  }
  console.error(`INDEPENDENT_SECURITY_REVIEW_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
