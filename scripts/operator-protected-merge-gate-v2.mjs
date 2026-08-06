#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
  validateIndependentReviewWorkflowRun,
} from '../shared/agents/operatorMergeApprovalGate.mjs';
import {
  MERGE_QUEUE_REQUIRED_CHECK,
  MERGE_QUEUE_WORKFLOW_NAME,
  MERGE_QUEUE_WORKFLOW_PATH,
  buildMergeQueueApprovalReceipt,
  validateMergeGroupEvidence,
  validateMergeQueueApprovalReceipt,
  validateMergeQueueConfiguration,
} from '../shared/agents/operatorMergeBaseBindingV1.mjs';
import {
  INDEPENDENT_REVIEW_ARTIFACT_FILE,
  INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES,
  validateIndependentReviewArtifact,
  validateIndependentReviewArtifactSet,
} from '../shared/agents/operatorMergeReviewArtifactV1.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-merge-queue-required-check';
const MAX_API_PAGES = 20;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const EVIDENCE_JOB = 'merge-group-evidence';
const APPROVAL_JOB = MERGE_QUEUE_REQUIRED_CHECK;
const mode = String(process.argv[2] || '').trim().toLowerCase();

class GateError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.details = details;
  }
}

function fail(message, details = {}) {
  throw new GateError(message, details);
}

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function exactPositiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function parseJson(raw, message) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(message, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function githubResponse(path, {
  method = 'GET',
  body = null,
  accept = 'application/vnd.github+json',
  maxBytes = MAX_JSON_BYTES,
} = {}) {
  const token = text(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  if (!token) fail('GitHub Actions token is required.');
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
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    fail('GitHub API response exceeded the bounded maximum.', {
      path,
      observedBytes: bytes.length,
      maxBytes,
    });
  }
  const raw = bytes.toString('utf8');
  if (!response.ok) {
    throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${raw.slice(0, 500)}`);
  }
  return { response, bytes, raw };
}

async function apiJson(path, options = {}) {
  const { raw } = await githubResponse(path, options);
  return raw ? parseJson(raw, `GitHub JSON response for ${path} was invalid.`) : null;
}

async function apiBytes(path, maxBytes) {
  const { bytes } = await githubResponse(path, {
    accept: 'application/octet-stream',
    maxBytes,
  });
  return bytes;
}

async function apiCollection(path, itemKey = null) {
  const separator = path.includes('?') ? '&' : '?';
  const items = [];
  let expectedTotal = null;
  for (let page = 1; page <= MAX_API_PAGES; page += 1) {
    const payload = await apiJson(`${path}${separator}per_page=100&page=${page}`);
    const pageItems = itemKey ? payload?.[itemKey] : payload;
    if (!Array.isArray(pageItems)) {
      fail('GitHub paginated response had an invalid collection.', { path, itemKey, page });
    }
    if (itemKey && Number.isSafeInteger(payload?.total_count)) {
      if (expectedTotal === null) expectedTotal = payload.total_count;
      if (expectedTotal !== payload.total_count) {
        fail('GitHub paginated total changed during the bounded read.', { path, page });
      }
    }
    items.push(...pageItems);
    if (pageItems.length < 100) {
      if (expectedTotal !== null && expectedTotal !== items.length) {
        fail('GitHub pagination did not return the declared complete collection.', {
          path,
          expectedTotal,
          observedTotal: items.length,
        });
      }
      return { items, totalCount: expectedTotal ?? items.length };
    }
  }
  fail('GitHub pagination exceeded the bounded maximum.', { path, pages: MAX_API_PAGES });
}

function canonicalWorkflowPath(run, repository, baseRef) {
  let path = text(run?.path);
  if (path.startsWith(`${repository}/`)) path = path.slice(repository.length + 1);
  const at = path.indexOf('@');
  if (at === -1) return path;
  if (at === 0 || at === path.length - 1 || path.indexOf('@', at + 1) !== -1) return '';
  const suffix = path.slice(at + 1);
  const baseBranch = text(baseRef).replace(/^refs\/heads\//, '');
  if (![baseRef, baseBranch].includes(suffix)) return '';
  return path.slice(0, at);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function appendOutputs(values) {
  const outputPath = text(process.env.GITHUB_OUTPUT);
  if (!outputPath) fail('GitHub output path is required.');
  appendFileSync(
    outputPath,
    `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
    'utf8',
  );
}

async function currentWorkflowExecution(repository, owner, repo, mergeGroup, runId, runAttempt) {
  const definitions = (await apiCollection(
    `/repos/${owner}/${repo}/actions/workflows`,
    'workflows',
  )).items;
  const pathMatches = definitions.filter((workflow) => workflow?.path === MERGE_QUEUE_WORKFLOW_PATH);
  const definition = pathMatches[0];
  if (pathMatches.length !== 1
    || definition?.name !== MERGE_QUEUE_WORKFLOW_NAME
    || definition?.state !== 'active'
    || !exactPositiveInteger(definition?.id)) {
    fail('Merge-queue workflow definition is missing, inactive or ambiguous.', {
      blockers: ['CONFIGURATION_NOT_PROVED:merge-queue-workflow-definition'],
    });
  }
  const run = await apiJson(`/repos/${owner}/${repo}/actions/runs/${runId}`);
  if (exactPositiveInteger(run?.id) !== runId
    || exactPositiveInteger(run?.run_attempt) !== runAttempt
    || exactPositiveInteger(run?.workflow_id) !== definition.id
    || run?.name !== MERGE_QUEUE_WORKFLOW_NAME
    || run?.event !== 'merge_group'
    || text(run?.repository?.full_name) !== repository
    || text(run?.head_sha).toLowerCase() !== text(mergeGroup?.head_sha).toLowerCase()
    || canonicalWorkflowPath(run, repository, text(mergeGroup?.base_ref)) !== MERGE_QUEUE_WORKFLOW_PATH
    || !['queued', 'in_progress'].includes(text(run?.status).toLowerCase())) {
    fail('Current workflow run is not the exact active merge-group required check.', {
      blockers: ['merge-group-workflow-run-identity-mismatch'],
    });
  }
  const checkSuiteId = exactPositiveInteger(run?.check_suite_id);
  if (!checkSuiteId) {
    fail('Current required-check integration cannot be derived.', {
      blockers: ['CONFIGURATION_NOT_PROVED:required-check-suite'],
    });
  }
  let checkSuite;
  try {
    checkSuite = await apiJson(`/repos/${owner}/${repo}/check-suites/${checkSuiteId}`);
  } catch (error) {
    fail('Current required-check integration is not readable.', {
      blockers: ['CONFIGURATION_NOT_PROVED:required-check-integration-api'],
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const integrationId = exactPositiveInteger(checkSuite?.app?.id);
  if (!integrationId || exactPositiveInteger(checkSuite?.id) !== checkSuiteId
    || text(checkSuite?.head_sha).toLowerCase() !== text(mergeGroup?.head_sha).toLowerCase()) {
    fail('Current required-check integration evidence is incomplete or stale.', {
      blockers: ['CONFIGURATION_NOT_PROVED:required-check-integration'],
    });
  }
  return {
    workflowDefinitionId: definition.id,
    checkSuiteId,
    integrationId,
  };
}

async function pullRequestReviewState(owner, repo, prNumber) {
  const query = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewDecision mergeable reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}}}}`;
  const payload = await apiJson('/graphql', {
    method: 'POST',
    body: { query, variables: { owner, repo, number: prNumber } },
  });
  const pullRequest = payload?.data?.repository?.pullRequest;
  const threads = pullRequest?.reviewThreads;
  if (!pullRequest
    || !Object.hasOwn(pullRequest, 'reviewDecision')
    || !Object.hasOwn(pullRequest, 'mergeable')
    || !threads
    || threads.pageInfo?.hasNextPage) {
    fail('Pull-request review and conversation evidence is unavailable or exceeds the bound.', {
      blockers: ['CONFIGURATION_NOT_PROVED:pull-request-review-conversations'],
    });
  }
  return {
    reviewDecision: pullRequest.reviewDecision,
    mergeable: pullRequest.mergeable,
    unresolvedThreadCount: (threads.nodes || []).filter((thread) => thread?.isResolved !== true).length,
  };
}

async function collectMergeGroupEvidence(context, expected = {}) {
  const associated = (await apiCollection(
    `/repos/${context.owner}/${context.repo}/commits/${context.mergeGroupSha}/pulls`,
  )).items;
  const associatedPrNumber = associated.length === 1 ? exactPositiveInteger(associated[0]?.number) : 0;
  const pullRequest = associatedPrNumber
    ? await apiJson(`/repos/${context.owner}/${context.repo}/pulls/${associatedPrNumber}`)
    : {};
  const liveMainRef = await apiJson(`/repos/${context.owner}/${context.repo}/git/ref/heads/main`);
  const review = associatedPrNumber
    ? await pullRequestReviewState(context.owner, context.repo, associatedPrNumber)
    : { reviewDecision: null, mergeable: null, unresolvedThreadCount: -1 };
  const validation = validateMergeGroupEvidence({
    repository: context.repository,
    eventName: process.env.GITHUB_EVENT_NAME,
    action: context.event.action,
    mergeGroup: context.event.merge_group,
    associatedPullRequests: associated,
    pullRequest,
    liveMainRef,
    ...review,
    workflowRunId: context.runId,
    workflowRunAttempt: context.runAttempt,
  }, expected);
  if (!validation.valid) {
    fail('Merge-group identity, associated PR, current head/base, native change-request state or conversations are stale.', {
      blockers: validation.blockers,
      associatedPullRequestCount: associated.length,
    });
  }
  return { validation, pullRequest, review };
}

async function collectQueueConfiguration(context, expectedIntegrationId) {
  let activeRules = null;
  const rulesets = [];
  const readBlockers = [];
  try {
    activeRules = (await apiCollection(
      `/repos/${context.owner}/${context.repo}/rules/branches/main`,
    )).items;
  } catch (error) {
    readBlockers.push('CONFIGURATION_NOT_PROVED:active-main-rules-api');
  }
  const rulesetIds = [...new Set((activeRules || [])
    .map((rule) => exactPositiveInteger(rule?.ruleset_id))
    .filter(Boolean))];
  for (const rulesetId of rulesetIds) {
    try {
      rulesets.push(await apiJson(
        `/repos/${context.owner}/${context.repo}/rulesets/${rulesetId}?includes_parents=true`,
      ));
    } catch (error) {
      readBlockers.push(`CONFIGURATION_NOT_PROVED:ruleset-detail-read:${rulesetId}`);
    }
  }
  const validation = validateMergeQueueConfiguration({ activeRules, rulesets }, {
    requiredCheck: MERGE_QUEUE_REQUIRED_CHECK,
    expectedIntegrationId,
  });
  const blockers = [...new Set([...readBlockers, ...validation.blockers])];
  if (blockers.length) {
    fail('Active main single-owner review rule, one-entry MERGE queue settings or no-bypass policy are not proved.', {
      blockers,
      note: 'Ordinary GITHUB_TOKEN access may not expose ruleset bypass actors; absence of readable evidence is blocking.',
    });
  }
  return validation;
}

function runUnzip(args, message, maxBuffer = INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES + 1) {
  const result = spawnSync('unzip', args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer,
  });
  if (result.status !== 0) {
    fail(message, { stderr: result.stderr || result.error?.message || '' });
  }
  return result.stdout || '';
}

async function loadIndependentReview(context, groupIdentity) {
  const definitions = (await apiCollection(
    `/repos/${context.owner}/${context.repo}/actions/workflows`,
    'workflows',
  )).items;
  const matches = definitions.filter((workflow) => workflow?.path === INDEPENDENT_REVIEW_WORKFLOW_PATH);
  const definition = matches[0];
  if (matches.length !== 1
    || definition?.name !== INDEPENDENT_REVIEW_WORKFLOW_NAME
    || definition?.state !== 'active'
    || !exactPositiveInteger(definition?.id)) {
    fail('Independent review workflow definition is unavailable or ambiguous.');
  }
  const runs = (await apiCollection(
    `/repos/${context.owner}/${context.repo}/actions/workflows/${definition.id}/runs?event=pull_request_target`,
    'workflow_runs',
  )).items;
  const scopedRuns = runs.filter((run) => {
    const pullRequests = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
    if (pullRequests.length !== 1) return false;
    const pullRequest = pullRequests[0];
    return exactPositiveInteger(pullRequest?.number) === groupIdentity.prNumber
      && text(pullRequest?.head?.sha).toLowerCase() === groupIdentity.sourceHead
      && text(pullRequest?.head?.ref) === groupIdentity.branch
      && text(pullRequest?.base?.sha).toLowerCase() === groupIdentity.baseSha
      && text(pullRequest?.base?.ref) === 'main';
  }).sort((left, right) => (
    exactPositiveInteger(right?.run_number) - exactPositiveInteger(left?.run_number)
    || exactPositiveInteger(right?.id) - exactPositiveInteger(left?.id)
  ));
  const run = scopedRuns[0];
  if (!run) fail('No independent review run is bound to the exact associated PR head and base.');
  const workflowRunId = exactPositiveInteger(run.id);
  const workflowRunAttempt = exactPositiveInteger(run.run_attempt);
  const jobs = (await apiCollection(
    `/repos/${context.owner}/${context.repo}/actions/runs/${workflowRunId}/attempts/${workflowRunAttempt}/jobs?filter=all`,
    'jobs',
  )).items;
  const workflowValidation = validateIndependentReviewWorkflowRun(run, jobs, {
    repository: context.repository,
    prNumber: groupIdentity.prNumber,
    expectedHead: groupIdentity.sourceHead,
    expectedBranch: groupIdentity.branch,
    expectedBaseBranch: 'main',
    expectedBaseSha: groupIdentity.baseSha,
    expectedWorkflowId: definition.id,
    workflowRunId,
    workflowRunAttempt,
  });
  if (!workflowValidation.valid) {
    fail('Independent review run is failed, stale or ambiguously bound.', {
      blockers: workflowValidation.blockers,
    });
  }

  const artifactCollection = await apiCollection(
    `/repos/${context.owner}/${context.repo}/actions/runs/${workflowRunId}/artifacts`,
    'artifacts',
  );
  const artifactSet = validateIndependentReviewArtifactSet({
    total_count: artifactCollection.totalCount,
    artifacts: artifactCollection.items,
  }, {
    workflowRunId,
    workflowRunAttempt,
  });
  if (!artifactSet.valid) {
    fail('Independent review artifact identity is missing, duplicate or stale.', {
      blockers: artifactSet.blockers,
    });
  }
  const archiveBytes = await apiBytes(
    `/repos/${context.owner}/${context.repo}/actions/artifacts/${artifactSet.artifactId}/zip`,
    INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES,
  );
  if (archiveBytes.length !== artifactSet.sizeInBytes) {
    fail('Independent review artifact archive size differs from its metadata.');
  }
  const archiveDigest = `sha256:${sha256(archiveBytes)}`;
  if (archiveDigest !== artifactSet.archiveDigest) {
    fail('Independent review artifact archive digest differs from its metadata.');
  }
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'stephanos-merge-queue-review-'));
  const archivePath = join(temporaryDirectory, 'review.zip');
  try {
    writeFileSync(archivePath, archiveBytes, { flag: 'wx', mode: 0o600 });
    const entries = runUnzip(['-Z1', archivePath], 'Independent review artifact directory is unreadable.')
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length !== 1 || entries[0] !== INDEPENDENT_REVIEW_ARTIFACT_FILE) {
      fail('Independent review artifact must contain exactly the canonical result file.', { entries });
    }
    const artifact = parseJson(
      runUnzip(
        ['-p', archivePath, INDEPENDENT_REVIEW_ARTIFACT_FILE],
        'Independent review artifact payload is unreadable.',
      ),
      'Independent review artifact payload is invalid JSON.',
    );
    const validation = validateIndependentReviewArtifact(artifact, {
      repository: context.repository,
      prNumber: groupIdentity.prNumber,
      branch: groupIdentity.branch,
      expectedHead: groupIdentity.sourceHead,
      expectedBaseSha: groupIdentity.baseSha,
      workflowRunId,
      workflowRunAttempt,
    });
    if (!validation.valid) {
      fail('Independent review artifact is invalid or stale.', { blockers: validation.blockers });
    }
    return {
      workflowRunId,
      workflowRunAttempt,
      artifactId: artifactSet.artifactId,
      artifactDigest: archiveDigest,
      payloadSha256: artifact.payloadSha256,
      reviewMode: artifact.reviewMode,
      findings: artifact.receipt.findings,
    };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function evidencePacket(context, groupEvidence, configuration, execution, independentReview) {
  return Object.freeze({
    schemaVersion: 'stephanos.merge-queue-evidence.v1',
    repository: groupEvidence.identity.repository,
    prNumber: groupEvidence.identity.prNumber,
    branch: groupEvidence.identity.branch,
    sourceHead: groupEvidence.identity.sourceHead,
    baseSha: groupEvidence.identity.baseSha,
    mergeGroupSha: groupEvidence.identity.mergeGroupSha,
    workflowRunId: context.runId,
    workflowRunAttempt: context.runAttempt,
    requiredCheck: MERGE_QUEUE_REQUIRED_CHECK,
    requiredCheckIntegrationId: execution.integrationId,
    workflowDefinitionId: execution.workflowDefinitionId,
    checkSuiteId: execution.checkSuiteId,
    activeRulesetIds: configuration.activeRulesetIds,
    queue: configuration.queue,
    pullRequestRule: configuration.pullRequest,
    independentReview: Object.freeze(independentReview),
  });
}

async function collectEvidence(context, expected = {}) {
  const group = await collectMergeGroupEvidence(context, expected);
  const execution = await currentWorkflowExecution(
    context.repository,
    context.owner,
    context.repo,
    context.event.merge_group,
    context.runId,
    context.runAttempt,
  );
  const configuration = await collectQueueConfiguration(context, execution.integrationId);
  const independentReview = await loadIndependentReview(context, group.validation.identity);
  const packet = evidencePacket(context, group.validation, configuration, execution, independentReview);
  const evidenceSha256 = sha256(JSON.stringify(canonicalJson(packet)));
  return {
    groupEvidence: group.validation,
    configuration,
    independentReview,
    packet,
    evidenceSha256,
  };
}

function expectedEvidenceIdentity() {
  const expected = {
    repository: text(process.env.STEPHANOS_EXPECTED_REPOSITORY),
    prNumber: positiveInteger(process.env.STEPHANOS_EXPECTED_PR_NUMBER),
    sourceHead: text(process.env.STEPHANOS_EXPECTED_SOURCE_HEAD).toLowerCase(),
    baseSha: text(process.env.STEPHANOS_EXPECTED_BASE_SHA).toLowerCase(),
    mergeGroupSha: text(process.env.STEPHANOS_EXPECTED_MERGE_GROUP_SHA).toLowerCase(),
    workflowRunId: positiveInteger(process.env.STEPHANOS_EXPECTED_WORKFLOW_RUN_ID),
    workflowRunAttempt: positiveInteger(process.env.STEPHANOS_EXPECTED_WORKFLOW_RUN_ATTEMPT),
    evidenceSha256: text(process.env.STEPHANOS_EXPECTED_EVIDENCE_SHA256).toLowerCase(),
  };
  if (!expected.repository
    || !expected.prNumber
    || !/^[a-f0-9]{40}$/.test(expected.sourceHead)
    || !/^[a-f0-9]{40}$/.test(expected.baseSha)
    || !/^[a-f0-9]{40}$/.test(expected.mergeGroupSha)
    || !expected.workflowRunId
    || !expected.workflowRunAttempt
    || !/^[a-f0-9]{64}$/.test(expected.evidenceSha256)) {
    fail('Pre-environment merge-group evidence identity is incomplete or unsafe.');
  }
  return expected;
}

async function main() {
  if (!['evidence', 'approve'].includes(mode)) fail('Mode must be evidence or approve.');
  if (process.env.GITHUB_ACTIONS !== 'true') fail('Merge queue check may run only inside GitHub Actions.');
  if (process.env.GITHUB_EVENT_NAME !== 'merge_group') fail('Merge queue check requires merge_group.');
  if (text(process.env.GITHUB_JOB) !== (mode === 'evidence' ? EVIDENCE_JOB : APPROVAL_JOB)) {
    fail('Merge queue mode does not match the trusted workflow job.');
  }
  const eventPath = text(process.env.GITHUB_EVENT_PATH);
  const event = parseJson(readFileSync(eventPath, 'utf8'), 'GitHub merge-group event payload was invalid.');
  if (event.action !== 'checks_requested') fail('Merge queue check requires checks_requested.');
  const repository = text(process.env.GITHUB_REPOSITORY || event?.repository?.full_name);
  const [owner, repo] = repository.split('/');
  const runId = positiveInteger(process.env.GITHUB_RUN_ID);
  const runAttempt = positiveInteger(process.env.GITHUB_RUN_ATTEMPT);
  const mergeGroupSha = text(event?.merge_group?.head_sha).toLowerCase();
  const baseSha = text(event?.merge_group?.base_sha).toLowerCase();
  if (!owner || !repo || !runId || !runAttempt
    || !/^[a-f0-9]{40}$/.test(mergeGroupSha)
    || !/^[a-f0-9]{40}$/.test(baseSha)
    || text(event?.merge_group?.base_ref) !== 'refs/heads/main') {
    fail('Merge-group event identity is incomplete or unsafe.');
  }
  const context = {
    event,
    repository,
    owner,
    repo,
    runId,
    runAttempt,
    mergeGroupSha,
    baseSha,
  };

  if (mode === 'evidence') {
    const evidence = await collectEvidence(context);
    const identity = evidence.groupEvidence.identity;
    appendOutputs({
      repository: identity.repository,
      pr_number: identity.prNumber,
      source_head: identity.sourceHead,
      base_sha: identity.baseSha,
      merge_group_sha: identity.mergeGroupSha,
      workflow_run_id: identity.workflowRunId,
      workflow_run_attempt: identity.workflowRunAttempt,
      evidence_sha256: evidence.evidenceSha256,
    });
    process.stdout.write(`${JSON.stringify({
      finalStatus: 'MERGE_QUEUE_EVIDENCE_READY_BEFORE_PROTECTED_ENVIRONMENT',
      mutationAuthority: false,
      proofScope: 'exact-merge-group-required-check-only',
      evidenceSha256: evidence.evidenceSha256,
      ...identity,
      independentReview: evidence.independentReview,
      queue: evidence.configuration.queue,
    }, null, 2)}\n`);
    return;
  }

  const expected = expectedEvidenceIdentity();
  const evidence = await collectEvidence(context, expected);
  if (evidence.evidenceSha256 !== expected.evidenceSha256) {
    fail('Merge-group evidence changed after protected approval was requested.', {
      blockers: ['merge-group-evidence-digest-mismatch'],
      expectedEvidenceSha256: expected.evidenceSha256,
      observedEvidenceSha256: evidence.evidenceSha256,
    });
  }
  const receipt = buildMergeQueueApprovalReceipt({
    groupEvidence: evidence.groupEvidence,
    configuration: evidence.configuration,
    independentReviewWorkflowRunId: evidence.independentReview.workflowRunId,
    independentReviewWorkflowRunAttempt: evidence.independentReview.workflowRunAttempt,
    independentReviewArtifactId: evidence.independentReview.artifactId,
    independentReviewArtifactDigest: evidence.independentReview.artifactDigest,
    independentReviewPayloadSha256: evidence.independentReview.payloadSha256,
    evidenceSha256: evidence.evidenceSha256,
    approvedAtUtc: new Date().toISOString(),
  });
  const receiptValidation = validateMergeQueueApprovalReceipt(receipt, {
    ...receipt,
    repository: expected.repository,
    prNumber: expected.prNumber,
    sourceHead: expected.sourceHead,
    baseSha: expected.baseSha,
    mergeGroupSha: expected.mergeGroupSha,
    workflowRunId: expected.workflowRunId,
    workflowRunAttempt: expected.workflowRunAttempt,
    evidenceSha256: expected.evidenceSha256,
  });
  if (!receiptValidation.valid) {
    fail('Protected merge-queue approval receipt is stale or invalid.', {
      blockers: receiptValidation.blockers,
    });
  }
  process.stdout.write(`${JSON.stringify({
    finalStatus: 'MERGE_QUEUE_REQUIRED_CHECK_READY',
    mutationAuthority: false,
    proofScope: 'exact-merge-group-required-check-only',
    receipt,
  }, null, 2)}\n`);
}

main().catch((error) => {
  const details = error instanceof GateError ? error.details : {};
  process.stderr.write(`${JSON.stringify({
    finalStatus: 'MERGE_QUEUE_REQUIRED_CHECK_BLOCKED',
    mutationAuthority: false,
    message: error instanceof Error ? error.message : String(error),
    ...details,
  }, null, 2)}\n`);
  process.exitCode = 1;
});
