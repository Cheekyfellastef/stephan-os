#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  readFileSync,
} from 'node:fs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
  validateIndependentReviewWorkflowRun,
} from '../shared/agents/operatorMergeApprovalGate.mjs';
import {
  INDEPENDENT_REVIEW_ARTIFACT_FILE,
  INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES,
  validateIndependentReviewArtifact,
  validateIndependentReviewArtifactSet,
} from '../shared/agents/operatorMergeReviewArtifactV1.mjs';
import {
  PROVENANCE_BOOTSTRAP_BRANCH,
  PROVENANCE_BOOTSTRAP_PR,
  validateProvenanceBootstrapFindingsCompatibilityV1,
} from '../shared/agents/operatorPersonalRepositoryProvenanceBootstrapV1.mjs';
import {
  validateIndependentReviewWorkflowDispatchExecutionV1,
} from '../shared/agents/independentReviewWorkflowDispatchExecutionV1.mjs';
import {
  independentReviewWorkflowDispatchRunNameV1,
} from '../shared/agents/independentReviewWorkflowDispatchLaunchReceiptV1.mjs';
import {
  PERSONAL_REPOSITORY_APPROVAL_JOB,
  PERSONAL_REPOSITORY_EVIDENCE_JOB,
  PERSONAL_REPOSITORY_MERGE_JOB,
  PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX,
  PERSONAL_REPOSITORY_REQUIRED_CHECK,
  buildPersonalRepositoryConfigurationEvidence,
  buildPersonalRepositoryApprovalReceipt,
  buildPersonalRepositoryCheckExpectation,
  executeBoundedPersonalRepositoryRead,
  executePersonalRepositoryArtifactArchiveTransport,
  extractPersonalRepositoryArtifactZip,
  parsePersonalRepositoryDispatchInputs,
  validatePersonalRepositoryApprovalReceipt,
  validatePersonalRepositoryCheckRuns,
  validatePersonalRepositoryCheckRunsWithBoundedReread,
  validatePersonalRepositoryConfiguration,
  validatePersonalRepositoryDispatchExecution,
  validatePersonalRepositoryDispatchWorkflowDefinition,
  validatePersonalRepositoryEvidence,
  validatePersonalRepositoryRulesetProofRequest,
  validatePersonalRepositoryRulesetProofResponse,
  validatePersonalRepositorySquashCompletion,
  validatePersonalRepositoryWorkflowRuns,
  validatePersonalRepositoryWorkflowRunHydration,
} from '../shared/agents/operatorPersonalRepositoryMergeV1.mjs';
import {
  PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
  PROTECTED_WORKFLOW_DISPATCH_ISSUE,
  PROTECTED_WORKFLOW_DISPATCH_OPERATION,
  PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
  validateProtectedWorkflowAuthorizationComment,
} from '../shared/agents/protectedWorkflowDispatchMailboxV1.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-personal-repository-protected-squash';
const MAX_API_PAGES = 20;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const COMPLETION_MARKER = '<!-- stephanos-personal-repository-protected-squash-completion -->';
const MAILBOX_TRANSPORT_ACTOR = 'github-actions[bot]';
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
  const raw = text(value);
  if (!/^[1-9][0-9]*$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
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
  authorization = 'required',
} = {}) {
  if (!['required', 'omit', 'ruleset-proof'].includes(authorization)) {
    fail('GitHub API authorization mode is invalid.', { authorization });
  }
  if (authorization === 'omit' && (method !== 'GET' || body !== null)) {
    fail('Unauthenticated GitHub API access is restricted to bounded GET requests.', { path, method });
  }
  const rulesetProofRequest = validatePersonalRepositoryRulesetProofRequest({
    path,
    method,
    body,
    repository: process.env.GITHUB_REPOSITORY,
  });
  if (authorization === 'ruleset-proof' && !rulesetProofRequest.valid) {
    fail('Ruleset proof token is restricted to bounded repository-configuration GET requests.', {
      path,
      method,
      blockers: rulesetProofRequest.blockers,
    });
  }
  const token = authorization === 'ruleset-proof'
    ? text(process.env.STEPHANOS_RULESET_PROOF_TOKEN)
    : text(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  if (authorization === 'required' && !token) fail('GitHub Actions token is required.');
  if (authorization === 'ruleset-proof' && !token) fail('Protected ruleset proof token is required.');
  const { response, result: bytes } = await executeBoundedPersonalRepositoryRead({
    path,
    method,
    body,
    request: () => fetch(`https://api.github.com${path}`, {
      method,
      redirect: authorization === 'ruleset-proof' ? 'error' : 'follow',
      headers: {
        Accept: accept,
        ...(authorization === 'omit' ? {} : { Authorization: `Bearer ${token}` }),
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': USER_AGENT,
        ...(body === null ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    }),
    validateResponse: authorization === 'ruleset-proof'
      ? (response) => validatePersonalRepositoryRulesetProofResponse({ path, response })
      : null,
    consume: async (boundedResponse) => Buffer.from(await boundedResponse.arrayBuffer()),
  });
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

async function apiArtifactArchive(path, repository, maxBytes) {
  const token = text(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  if (!token) fail('GitHub Actions token is required.');
  return executePersonalRepositoryArtifactArchiveTransport({
    path,
    repository,
    maxBytes,
    requestApiRedirect: (request) => fetch(request.url, {
      method: request.method,
      body: request.body,
      redirect: request.redirect,
      headers: {
        ...request.headers,
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': USER_AGENT,
      },
    }),
    requestArchive: (request) => fetch(request.url, {
      method: request.method,
      body: request.body,
      redirect: request.redirect,
      headers: {
        ...request.headers,
        'User-Agent': USER_AGENT,
      },
    }),
  });
}

async function apiCollection(path, itemKey = null, options = {}) {
  const separator = path.includes('?') ? '&' : '?';
  const items = [];
  let expectedTotal = null;
  for (let page = 1; page <= MAX_API_PAGES; page += 1) {
    const payload = await apiJson(`${path}${separator}per_page=100&page=${page}`, options);
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

function mailboxTransportActor(run = {}) {
  return text(run?.triggering_actor?.login || run?.actor?.login).toLowerCase();
}

async function proveMailboxAuthorization(context, run) {
  const transportActor = mailboxTransportActor(run);
  if (transportActor !== MAILBOX_TRANSPORT_ACTOR) {
    fail('Protected merge workflow transport actor is not the canonical GitHub Actions mailbox transport.', {
      blockers: ['personal-repository-mailbox-transport-actor-mismatch'],
      transportActor,
    });
  }
  const runStartedAt = new Date(run?.created_at || 0);
  if (!Number.isFinite(runStartedAt.getTime())) {
    fail('Protected merge workflow start time is invalid.', {
      blockers: ['personal-repository-mailbox-run-time-invalid'],
    });
  }
  const comment = await apiJson(
    `/repos/${context.owner}/${context.repo}/issues/comments/${context.authorizationCommentId}`,
  );
  const identity = context.dispatch.identity;
  const validation = validateProtectedWorkflowAuthorizationComment(comment, {
    operation: PROTECTED_WORKFLOW_DISPATCH_OPERATION,
    repository: PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
    issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
    operatorApproval: 'operator-approved',
    mode: identity.mode,
    prNumber: identity.prNumber,
    expectedBranch: identity.branch,
    expectedHead: identity.sourceHead,
    expectedHeadTree: identity.sourceTree,
    expectedBase: identity.baseSha,
    independentReviewRunId: identity.independentReviewWorkflowRunId,
    independentReviewRunAttempt: identity.independentReviewWorkflowRunAttempt,
    independentReviewArtifactId: identity.independentReviewArtifactId,
    independentReviewArtifactDigest: identity.independentReviewArtifactDigest,
    independentReviewPayloadSha256: identity.independentReviewPayloadSha256,
  }, {
    now: runStartedAt,
    expectedCommentId: context.authorizationCommentId,
  });
  if (!validation.ok) {
    fail('Owner-authored protected merge authorization provenance is missing, stale or mismatched.', {
      blockers: [validation.blocker],
      details: validation.details || {},
    });
  }
  return Object.freeze({
    commentId: validation.commentId,
    requestId: validation.command.requestId,
    operatorAuthor: PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
    transportActor,
    authorizedAtUtc: validation.authoredAtUtc,
  });
}

async function currentWorkflowExecution(context) {
  const definitions = (await apiCollection(
    `/repos/${context.owner}/${context.repo}/actions/workflows`,
    'workflows',
  )).items;
  const definitionValidation = validatePersonalRepositoryDispatchWorkflowDefinition(definitions);
  if (!definitionValidation.valid) {
    fail('Protected merge workflow definition is missing, inactive or ambiguous.', {
      blockers: [
        'CONFIGURATION_NOT_PROVED:personal-repository-workflow-definition',
        ...definitionValidation.blockers,
      ],
    });
  }
  const definition = definitionValidation.definition;
  const run = await apiJson(`/repos/${context.owner}/${context.repo}/actions/runs/${context.runId}`);
  const authorization = await proveMailboxAuthorization(context, run);
  const dispatchRuns = (await apiCollection(
    `/repos/${context.owner}/${context.repo}/actions/workflows/${definition.id}/runs?event=workflow_dispatch`,
    'workflow_runs',
  )).items;
  let execution = validatePersonalRepositoryDispatchExecution({
    definitions,
    run,
    priorRuns: dispatchRuns,
  }, {
    repository: context.repository,
    sourceHead: context.dispatch.identity.sourceHead,
    baseSha: context.dispatch.identity.baseSha,
    workflowRunId: context.runId,
    workflowRunAttempt: context.runAttempt,
    mailboxAuthorization: authorization,
  });
  if (execution.replayRunIds.length !== 0) {
    if (execution.blockers.includes('personal-repository-prior-run-attempt-limit-exceeded')) {
      fail('Prior protected merge attempts exceed the bounded all-attempt proof estate.', {
        blockers: ['personal-repository-prior-run-attempt-limit-exceeded'],
        observedAttempts: execution.sameBasePriorAttemptCount,
      });
    }
    if (execution.replayRunIds.length > PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX) {
      fail('Prior protected merge attempts exceed the bounded job-proof estate.', {
        blockers: ['personal-repository-prior-run-jobs-limit-exceeded'],
        priorRunIds: execution.replayRunIds,
      });
    }
    const priorRunJobSets = await Promise.all(execution.replayRunIds.map(async (runId) => ({
      runId,
      jobs: (await apiCollection(`/repos/${context.owner}/${context.repo}/actions/runs/${runId}/jobs?filter=all`, 'jobs')).items,
    })));
    execution = validatePersonalRepositoryDispatchExecution({
      definitions,
      run,
      priorRuns: dispatchRuns,
      priorRunJobSets,
    }, {
      repository: context.repository,
      sourceHead: context.dispatch.identity.sourceHead,
      baseSha: context.dispatch.identity.baseSha,
      workflowRunId: context.runId,
      workflowRunAttempt: context.runAttempt,
      mailboxAuthorization: authorization,
    });
  }

  const expectedDisplayTitle = `Protected operator merge ${context.dispatch.identity.sourceHead}`;
  const transportActor = mailboxTransportActor(run);
  const runIdentityMismatches = [...new Set([
    ...execution.currentMismatches,
    ...(text(run?.name) === expectedDisplayTitle ? [] : ['run-name']),
    ...(text(run?.display_title) === expectedDisplayTitle ? [] : ['display-title']),
    ...(transportActor === MAILBOX_TRANSPORT_ACTOR ? [] : ['transport-actor']),
  ])];
  if (runIdentityMismatches.length !== 0) {
    fail('Current workflow run is not the exact mailbox-transported trusted-main execution.', {
      blockers: ['personal-repository-workflow-run-identity-mismatch'],
      mismatches: runIdentityMismatches,
    });
  }
  if (execution.blockers.length !== 0) {
    fail('Protected merge workflow execution evidence is incomplete or invalid.', {
      blockers: execution.blockers,
    });
  }
  if (execution.malformedPriorRunIds.length !== 0) {
    fail('A source-matching prior dispatch has malformed or ambiguous workflow identity.', {
      blockers: ['personal-repository-prior-attempt-invalid'],
      priorRunIds: execution.malformedPriorRunIds.filter(Boolean),
    });
  }
  if (execution.replayRunIds.length !== 0) {
    fail('A prior operator-dispatched personal-repository merge attempt already exists for this exact PR head.', {
      blockers: ['personal-repository-prior-attempt-exists'],
      priorRunIds: execution.replayRunIds,
    });
  }

  return {
    definitions,
    definition,
    run,
    authorization,
    transportActor,
    retryablePriorRunIds: execution.retryablePriorRunIds,
    retryablePriorFailures: execution.retryablePriorFailures,
  };
}

async function pullRequestReviewState(owner, repo, prNumber) {
  const query = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewDecision mergeable mergeStateStatus reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}}}}`;
  const payload = await apiJson('/graphql', {
    method: 'POST',
    body: { query, variables: { owner, repo, number: prNumber } },
  });
  const pullRequest = payload?.data?.repository?.pullRequest;
  const threads = pullRequest?.reviewThreads;
  if (!pullRequest
    || !Object.hasOwn(pullRequest, 'reviewDecision')
    || !Object.hasOwn(pullRequest, 'mergeable')
    || !Object.hasOwn(pullRequest, 'mergeStateStatus')
    || !threads
    || threads.pageInfo?.hasNextPage) {
    fail('Pull-request review and conversation evidence is unavailable or exceeds the bound.', {
      blockers: ['CONFIGURATION_NOT_PROVED:personal-repository-review-conversations'],
    });
  }
  return {
    reviewDecision: pullRequest.reviewDecision,
    mergeable: pullRequest.mergeable,
    mergeStateStatus: pullRequest.mergeStateStatus,
    unresolvedThreadCount: (threads.nodes || []).filter((thread) => thread?.isResolved !== true).length,
  };
}

async function hydrateExactHeadWorkflowRuns(context, sourceHead, summaries) {
  const details = await Promise.all((Array.isArray(summaries) ? summaries : []).map((run) => (
    apiJson(`/repos/${context.owner}/${context.repo}/actions/runs/${run?.id}`)
  )));
  const validation = validatePersonalRepositoryWorkflowRunHydration(
    summaries,
    details,
    { sourceHead },
  );
  if (!validation.valid) {
    fail('Exact-head workflow run summaries could not be bound to full run identities.', {
      blockers: validation.blockers,
    });
  }
  return validation.runs;
}

function configurationSnapshot(repository, environment, activeRules, rulesets) {
  return sha256(JSON.stringify(buildPersonalRepositoryConfigurationEvidence({
    repository,
    environment,
    activeRules,
    rulesets,
  })));
}

async function collectRulesetConfiguration(
  context,
  repository,
  environment,
  integrationId,
) {
  let activeRules = null;
  const rulesets = [];
  const readBlockers = [];
  const publicRepository = repository?.private === false
    && text(repository?.visibility).toLowerCase() === 'public';
  if (!publicRepository) {
    readBlockers.push('CONFIGURATION_NOT_PROVED:personal-repository-public-rules-api');
  } else {
    try {
      activeRules = (await apiCollection(
        `/repos/${context.owner}/${context.repo}/rules/branches/main`,
        null,
        { authorization: 'ruleset-proof' },
      )).items;
    } catch {
      readBlockers.push('CONFIGURATION_NOT_PROVED:personal-repository-active-main-rules-api');
    }
  }
  const rulesetIds = [...new Set((activeRules || [])
    .map((rule) => exactPositiveInteger(rule?.ruleset_id))
    .filter(Boolean))];
  for (const rulesetId of rulesetIds) {
    try {
      rulesets.push(await apiJson(
        `/repos/${context.owner}/${context.repo}/rulesets/${rulesetId}?includes_parents=true`,
        { authorization: 'ruleset-proof' },
      ));
    } catch {
      readBlockers.push(`CONFIGURATION_NOT_PROVED:personal-repository-ruleset-detail:${rulesetId}`);
    }
  }
  const validation = validatePersonalRepositoryConfiguration({
    repository,
    environment,
    activeRules,
    rulesets,
  }, {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
    requireBypassProof: true,
  });
  const blockers = [...new Set([...readBlockers, ...validation.blockers])];
  if (blockers.length) {
    fail('Protected environment or active no-bypass personal-repository ruleset is not exact.', {
      blockers,
      note: 'Unreadable protection or bypass evidence is blocking.',
    });
  }
  return Object.freeze({
    ...validation,
    configurationSnapshotSha256: configurationSnapshot(repository, environment, activeRules, rulesets),
  });
}

async function loadSelectedIndependentReview(context, identity, environmentName) {
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
  const selected = context.dispatch.identity;
  const run = await apiJson(
    `/repos/${context.owner}/${context.repo}/actions/runs/${selected.independentReviewWorkflowRunId}`,
  );
  const jobs = (await apiCollection(
    `/repos/${context.owner}/${context.repo}/actions/runs/${selected.independentReviewWorkflowRunId}/attempts/${selected.independentReviewWorkflowRunAttempt}/jobs?filter=all`,
    'jobs',
  )).items;
  const reviewEvent = text(run?.event);
  const workflowValidation = reviewEvent === 'workflow_dispatch'
    ? validateIndependentReviewWorkflowDispatchExecutionV1(run, jobs, {
      repository: context.repository,
      prNumber: identity.prNumber,
      expectedHead: identity.sourceHead,
      expectedBranch: identity.branch,
      expectedBaseSha: identity.baseSha,
      expectedWorkflowId: definition.id,
      workflowRunId: selected.independentReviewWorkflowRunId,
      workflowRunAttempt: selected.independentReviewWorkflowRunAttempt,
    })
    : validateIndependentReviewWorkflowRun(run, jobs, {
      repository: context.repository,
      prNumber: identity.prNumber,
      expectedHead: identity.sourceHead,
      expectedBranch: identity.branch,
      expectedBaseBranch: 'main',
      expectedBaseSha: identity.baseSha,
      expectedWorkflowId: definition.id,
      workflowRunId: selected.independentReviewWorkflowRunId,
      workflowRunAttempt: selected.independentReviewWorkflowRunAttempt,
      expectedWorkflowRunName: independentReviewWorkflowDispatchRunNameV1({
        prNumber: identity.prNumber,
        sourceHead: identity.sourceHead,
        handoffBindingSha256: 'legacy-pull-request-target',
      }),
    });
  const provenanceBootstrapCandidate = !workflowValidation.valid
    && identity.prNumber === PROVENANCE_BOOTSTRAP_PR
    && identity.branch === PROVENANCE_BOOTSTRAP_BRANCH;
  if (!workflowValidation.valid && !provenanceBootstrapCandidate) {
    fail('Selected independent review run is failed, stale or ambiguously bound.', {
      blockers: workflowValidation.blockers,
    });
  }
  const artifactCollection = await apiCollection(
    `/repos/${context.owner}/${context.repo}/actions/runs/${selected.independentReviewWorkflowRunId}/artifacts`,
    'artifacts',
  );
  const artifactSet = validateIndependentReviewArtifactSet({
    total_count: artifactCollection.totalCount,
    artifacts: artifactCollection.items,
  }, {
    workflowRunId: selected.independentReviewWorkflowRunId,
    workflowRunAttempt: selected.independentReviewWorkflowRunAttempt,
  });
  if (!artifactSet.valid || artifactSet.artifactId !== selected.independentReviewArtifactId) {
    fail('Selected independent review artifact identity is missing, duplicate or stale.', {
      blockers: [...artifactSet.blockers, 'personal-repository-selected-review-artifact-mismatch'],
    });
  }
  const archiveBytes = await apiArtifactArchive(
    `/repos/${context.owner}/${context.repo}/actions/artifacts/${artifactSet.artifactId}/zip`,
    context.repository,
    INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES,
  );
  if (archiveBytes.length !== artifactSet.sizeInBytes) fail('Independent review artifact archive size changed.');
  const archiveDigest = `sha256:${sha256(archiveBytes)}`;
  if (archiveDigest !== artifactSet.archiveDigest
    || archiveDigest !== selected.independentReviewArtifactDigest) {
    fail('Independent review artifact archive digest changed or differs from the operator-selected identity.');
  }
  const artifact = parseJson(
    extractPersonalRepositoryArtifactZip(archiveBytes, INDEPENDENT_REVIEW_ARTIFACT_FILE).toString('utf8'),
    'Independent review artifact payload is invalid JSON.',
  );
  if (provenanceBootstrapCandidate) {
    const encodedPath = (value) => value.split('/').map(encodeURIComponent).join('/');
    const [workflowFile, gateFile] = await Promise.all([
      apiJson(`/repos/${context.owner}/${context.repo}/contents/${encodedPath('.github/workflows/operator-merge-approval-gate.yml')}?ref=${encodeURIComponent(identity.sourceHead)}`),
      apiJson(`/repos/${context.owner}/${context.repo}/contents/${encodedPath('shared/agents/operatorMergeApprovalGate.mjs')}?ref=${encodeURIComponent(identity.sourceHead)}`),
    ]);
    const decodeExactSource = (payload, expectedPath) => {
      if (payload?.type !== 'file'
        || payload?.path !== expectedPath
        || payload?.encoding !== 'base64'
        || !text(payload?.sha)
        || typeof payload?.content !== 'string') {
        fail('Provenance bootstrap exact-head source evidence is missing or malformed.', {
          blockers: ['provenance-bootstrap-source-evidence-invalid'],
          path: expectedPath,
        });
      }
      return Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8');
    };
    const compatibility = validateProvenanceBootstrapFindingsCompatibilityV1({
      artifact,
      run,
      jobs,
      workflowSource: decodeExactSource(workflowFile, '.github/workflows/operator-merge-approval-gate.yml'),
      gateSource: decodeExactSource(gateFile, 'shared/agents/operatorMergeApprovalGate.mjs'),
    }, {
      sourceHead: identity.sourceHead,
      baseSha: identity.baseSha,
      workflowRunId: selected.independentReviewWorkflowRunId,
      workflowRunAttempt: selected.independentReviewWorkflowRunAttempt,
      protectedEnvironmentAdmitted: environmentName === OPERATOR_MERGE_ENVIRONMENT,
      environmentName,
    });
    if (artifact.payloadSha256 !== selected.independentReviewPayloadSha256 || !compatibility.valid) {
      fail('Selected provenance-bootstrap findings artifact is invalid, stale or not independently bounded.', {
        blockers: compatibility.blockers,
      });
    }
    return Object.freeze({
      workflowRunId: selected.independentReviewWorkflowRunId,
      workflowRunAttempt: selected.independentReviewWorkflowRunAttempt,
      artifactId: selected.independentReviewArtifactId,
      artifactDigest: selected.independentReviewArtifactDigest,
      payloadSha256: selected.independentReviewPayloadSha256,
      reviewMode: compatibility.reviewMode,
      findings: compatibility.findings,
    });
  }

  const validation = validateIndependentReviewArtifact(artifact, {
    repository: context.repository,
    prNumber: identity.prNumber,
    branch: identity.branch,
    expectedHead: identity.sourceHead,
    expectedBaseSha: identity.baseSha,
    workflowRunId: selected.independentReviewWorkflowRunId,
    workflowRunAttempt: selected.independentReviewWorkflowRunAttempt,
  });
  if (!validation.valid
    || artifact.payloadSha256 !== selected.independentReviewPayloadSha256
    || artifact.reviewMode !== 'clean-independent'
    || artifact.receipt?.verdict !== 'clean'
    || artifact.receipt?.blocker !== ''
    || !Array.isArray(artifact.receipt?.findings)
    || artifact.receipt.findings.length !== 0) {
    fail('Selected independent review payload is invalid, stale or not clean.', {
      blockers: validation.blockers,
    });
  }
  return Object.freeze({
    workflowRunId: selected.independentReviewWorkflowRunId,
    workflowRunAttempt: selected.independentReviewWorkflowRunAttempt,
    artifactId: selected.independentReviewArtifactId,
    artifactDigest: selected.independentReviewArtifactDigest,
    payloadSha256: selected.independentReviewPayloadSha256,
    reviewMode: artifact.reviewMode,
    findings: Object.freeze([]),
  });
}

async function readPersonalRepositoryAuthoritySnapshot(context, identity) {
  const [
    execution,
    repository,
    pullRequest,
    liveMainRef,
    headCommit,
    comparison,
    review,
    environment,
  ] = await Promise.all([
    currentWorkflowExecution(context),
    apiJson(`/repos/${context.owner}/${context.repo}`, { authorization: 'ruleset-proof' }),
    apiJson(`/repos/${context.owner}/${context.repo}/pulls/${identity.prNumber}`),
    apiJson(`/repos/${context.owner}/${context.repo}/git/ref/heads/main`),
    apiJson(`/repos/${context.owner}/${context.repo}/git/commits/${identity.sourceHead}`),
    apiJson(`/repos/${context.owner}/${context.repo}/compare/${identity.baseSha}...${identity.sourceHead}`),
    pullRequestReviewState(context.owner, context.repo, identity.prNumber),
    apiJson(`/repos/${context.owner}/${context.repo}/environments/operator-merge-approval`),
  ]);
  const independentReview = await loadSelectedIndependentReview(
    context,
    identity,
    text(environment?.name),
  );
  return Object.freeze({
    execution,
    repository,
    pullRequest,
    liveMainRef,
    headCommit,
    comparison,
    review,
    environment,
    independentReview,
  });
}

async function collectEvidence(context, expected = {}) {
  const identity = context.dispatch.identity;
  const [initialAuthority, workflowRuns, checkRuns, commitStatuses] = await Promise.all([
    readPersonalRepositoryAuthoritySnapshot(context, identity),
    apiCollection(`/repos/${context.owner}/${context.repo}/actions/runs?head_sha=${identity.sourceHead}`, 'workflow_runs'),
    apiCollection(`/repos/${context.owner}/${context.repo}/commits/${identity.sourceHead}/check-runs?filter=latest`, 'check_runs'),
    apiCollection(`/repos/${context.owner}/${context.repo}/commits/${identity.sourceHead}/statuses`, null),
  ]);
  const { review, independentReview } = initialAuthority;
  const initialWorkflowRuns = await hydrateExactHeadWorkflowRuns(
    context,
    identity.sourceHead,
    workflowRuns.items,
  );
  const initialCheckSnapshot = Object.freeze({
    checkRuns: checkRuns.items,
    workflowRuns: initialWorkflowRuns,
    commitStatuses: commitStatuses.items,
  });
  const checkExpectation = buildPersonalRepositoryCheckExpectation({
    repository: context.repository,
    identity,
    mergeStateStatus: review.mergeStateStatus,
  });
  if (!checkExpectation.valid) {
    fail('Exact check expectation is incomplete or unsafe.', {
      blockers: checkExpectation.blockers,
    });
  }
  const checks = await validatePersonalRepositoryCheckRunsWithBoundedReread({
    readSnapshot: async (attempt) => {
      if (attempt === 1) return initialCheckSnapshot;
      const [freshWorkflowRunSummaries, freshCheckRuns, freshCommitStatuses] = await Promise.all([
        apiCollection(`/repos/${context.owner}/${context.repo}/actions/runs?head_sha=${identity.sourceHead}`, 'workflow_runs'),
        apiCollection(`/repos/${context.owner}/${context.repo}/commits/${identity.sourceHead}/check-runs?filter=latest`, 'check_runs'),
        apiCollection(`/repos/${context.owner}/${context.repo}/commits/${identity.sourceHead}/statuses`, null),
      ]);
      const freshWorkflowRuns = await hydrateExactHeadWorkflowRuns(
        context,
        identity.sourceHead,
        freshWorkflowRunSummaries.items,
      );
      return Object.freeze({
        checkRuns: freshCheckRuns.items,
        workflowRuns: freshWorkflowRuns,
        commitStatuses: freshCommitStatuses.items,
      });
    },
    expected: checkExpectation.expected,
    options: { cleanIndependentReviewProved: independentReview.reviewMode === 'clean-independent' },
  });
  if (!checks.valid) {
    fail('One or more exact-head checks are pending, failed, stale or outside the reviewed escalation.', {
      blockers: checks.blockers,
      snapshotAttempts: checks.snapshotAttempts,
    });
  }
  const refreshedAuthority = await readPersonalRepositoryAuthoritySnapshot(context, identity);
  const refreshedCheckExpectation = buildPersonalRepositoryCheckExpectation({
    repository: context.repository,
    identity,
    mergeStateStatus: refreshedAuthority.review.mergeStateStatus,
  });
  if (!refreshedCheckExpectation.valid) {
    fail('Refreshed exact check expectation is incomplete or unsafe.', {
      blockers: refreshedCheckExpectation.blockers,
    });
  }
  const finalChecks = validatePersonalRepositoryCheckRuns(
    checks.selectedSnapshot.checkRuns,
    checks.selectedSnapshot.workflowRuns,
    checks.selectedSnapshot.commitStatuses,
    refreshedCheckExpectation.expected,
    { cleanIndependentReviewProved: refreshedAuthority.independentReview.reviewMode === 'clean-independent' },
  );
  if (!finalChecks.valid) {
    fail('Authority changed after exact-head check convergence.', {
      blockers: finalChecks.blockers,
    });
  }
  const {
    execution,
    repository,
    pullRequest,
    liveMainRef,
    headCommit,
    comparison,
    review: refreshedReview,
    environment,
    independentReview: refreshedIndependentReview,
  } = refreshedAuthority;
  const acceptedWorkflowRuns = checks.selectedSnapshot.workflowRuns;
  const evidence = validatePersonalRepositoryEvidence({
    repository: context.repository,
    repositoryOwnerType: repository?.owner?.type,
    eventName: process.env.GITHUB_EVENT_NAME,
    triggeringActor: execution.authorization.operatorAuthor,
    workflowRunId: context.runId,
    workflowRunAttempt: context.runAttempt,
    pullRequest,
    liveMainRef,
    headCommit,
    comparison,
    ...refreshedReview,
  }, {
    ...identity,
    workflowRunId: context.runId,
    workflowRunAttempt: context.runAttempt,
    ...expected,
  }, {
    cleanIndependentReviewProved: refreshedIndependentReview.reviewMode === 'clean-independent',
    reviewEscalationChecksProved: finalChecks.valid,
  });
  if (!evidence.valid) {
    fail('Personal-repository PR, exact head/tree/base or review state is stale.', {
      blockers: evidence.blockers,
    });
  }
  const workflows = validatePersonalRepositoryWorkflowRuns(
    execution.definitions,
    acceptedWorkflowRuns,
    evidence.identity,
  );
  if (!workflows.valid) {
    fail('One or more required exact-head hosted workflows are not successful and exact.', {
      blockers: workflows.blockers,
    });
  }
  const sourceProof = workflows.evidence.find((item) => item.name === 'Protected Operator Merge Source Proof');
  if (!exactPositiveInteger(sourceProof?.checkSuiteId)) {
    fail('Protected source-proof check-suite identity is missing.');
  }
  const checkSuite = await apiJson(`/repos/${context.owner}/${context.repo}/check-suites/${sourceProof.checkSuiteId}`);
  const integrationId = exactPositiveInteger(checkSuite?.app?.id);
  if (!integrationId || text(checkSuite?.head_sha).toLowerCase() !== evidence.identity.sourceHead) {
    fail('Protected source-proof integration identity is missing or stale.');
  }
  const configuration = await collectRulesetConfiguration(
    context,
    repository,
    environment,
    integrationId,
  );
  const packet = Object.freeze({
    schemaVersion: 'stephanos.personal-repository-evidence.v1',
    ...evidence.identity,
    workflowDefinitionId: execution.definition.id,
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    requiredCheckIntegrationId: integrationId,
    activeRulesetIds: configuration.activeRulesetIds,
    configurationSnapshotSha256: configuration.configurationSnapshotSha256,
    retryablePriorFailures: execution.retryablePriorFailures,
    workflows: workflows.evidence,
    checks: finalChecks.evidence,
    independentReview: refreshedIndependentReview,
  });
  const evidenceSha256 = sha256(JSON.stringify(canonicalJson(packet)));
  return {
    evidence,
    workflows,
    checks: finalChecks,
    configuration,
    independentReview: refreshedIndependentReview,
    packet,
    evidenceSha256,
  };
}

function expectedAdmittedEvidence() {
  const expected = {
    repository: text(process.env.STEPHANOS_EXPECTED_REPOSITORY),
    prNumber: positiveInteger(process.env.STEPHANOS_EXPECTED_PR_NUMBER),
    branch: text(process.env.STEPHANOS_EXPECTED_BRANCH),
    sourceHead: text(process.env.STEPHANOS_EXPECTED_SOURCE_HEAD).toLowerCase(),
    sourceTree: text(process.env.STEPHANOS_EXPECTED_SOURCE_TREE).toLowerCase(),
    baseSha: text(process.env.STEPHANOS_EXPECTED_BASE_SHA).toLowerCase(),
    workflowRunId: positiveInteger(process.env.STEPHANOS_EXPECTED_WORKFLOW_RUN_ID),
    workflowRunAttempt: positiveInteger(process.env.STEPHANOS_EXPECTED_WORKFLOW_RUN_ATTEMPT),
    evidenceSha256: text(process.env.STEPHANOS_EXPECTED_EVIDENCE_SHA256).toLowerCase(),
  };
  if (!expected.repository || !expected.prNumber || !expected.branch
    || !/^[a-f0-9]{40}$/.test(expected.sourceHead)
    || !/^[a-f0-9]{40}$/.test(expected.sourceTree)
    || !/^[a-f0-9]{40}$/.test(expected.baseSha)
    || !expected.workflowRunId || !expected.workflowRunAttempt
    || !/^[a-f0-9]{64}$/.test(expected.evidenceSha256)) {
    fail('Protected evidence-admission identity is incomplete or unsafe.');
  }
  return expected;
}

function decodeApprovalReceipt(value) {
  const encoded = text(value);
  if (!encoded || encoded.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    fail('Protected approval receipt transport is missing or invalid.');
  }
  return parseJson(Buffer.from(encoded, 'base64url').toString('utf8'), 'Protected approval receipt was invalid JSON.');
}

async function postCompletionComment(context, completion, receipt) {
  const body = `${COMPLETION_MARKER}\n## Protected personal-repository squash merge completed\n\n\`\`\`json\n${JSON.stringify({
    schemaVersion: 'stephanos.personal-repository-merge-completion.v1',
    repository: context.repository,
    prNumber: receipt.prNumber,
    branch: receipt.branch,
    sourceHead: receipt.sourceHead,
    sourceTree: receipt.sourceTree,
    baseSha: receipt.baseSha,
    mergeCommit: completion.mergeSha,
    mainTree: completion.treeSha,
    workflowRunId: context.runId,
    workflowRunAttempt: context.runAttempt,
    environment: receipt.environment,
    independentReviewWorkflowRunId: receipt.independentReviewWorkflowRunId,
    independentReviewWorkflowRunAttempt: receipt.independentReviewWorkflowRunAttempt,
    independentReviewArtifactId: receipt.independentReviewArtifactId,
    independentReviewArtifactDigest: receipt.independentReviewArtifactDigest,
    independentReviewPayloadSha256: receipt.independentReviewPayloadSha256,
    evidenceSha256: receipt.evidenceSha256,
    mergeMethod: 'squash',
    sourceBranchRetained: true,
  }, null, 2)}\n\`\`\`\n\nThis receipt is bound to one owner-authored mailbox authorization, one GitHub Actions transport run, one protected-environment approval, one exact source head/base and one immutable independent-review artifact.`;
  await apiJson(`/repos/${context.owner}/${context.repo}/issues/${receipt.prNumber}/comments`, {
    method: 'POST',
    body: { body },
  });
}

async function main() {
  if (!['evidence', 'approve', 'merge'].includes(mode)) fail('Mode must be evidence, approve or merge.');
  if (process.env.GITHUB_ACTIONS !== 'true') fail('Protected personal-repository merge may run only inside GitHub Actions.');
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') fail('Protected personal-repository merge requires workflow_dispatch.');
  const expectedJob = mode === 'evidence'
    ? PERSONAL_REPOSITORY_EVIDENCE_JOB
    : mode === 'approve'
      ? PERSONAL_REPOSITORY_APPROVAL_JOB
      : PERSONAL_REPOSITORY_MERGE_JOB;
  if (text(process.env.GITHUB_JOB) !== expectedJob) fail('Personal-repository mode does not match the trusted workflow job.');
  const eventPath = text(process.env.GITHUB_EVENT_PATH);
  if (!eventPath) fail('GitHub event path is required.');
  const event = parseJson(readFileSync(eventPath, 'utf8'), 'GitHub workflow-dispatch event payload was invalid.');
  const dispatch = parsePersonalRepositoryDispatchInputs(event.inputs);
  if (!dispatch.valid) fail('Workflow-dispatch inputs are incomplete or unsafe.', { blockers: dispatch.blockers });
  const authorizationCommentId = positiveInteger(event?.inputs?.authorization_comment_id);
  const environmentAuthorizationCommentId = positiveInteger(process.env.STEPHANOS_AUTHORIZATION_COMMENT_ID);
  if (!authorizationCommentId || environmentAuthorizationCommentId !== authorizationCommentId) {
    fail('Mailbox authorization comment identity is missing or does not match the protected workflow environment.', {
      blockers: ['personal-repository-mailbox-authorization-comment-id-mismatch'],
    });
  }
  const repository = text(process.env.GITHUB_REPOSITORY || event?.repository?.full_name);
  const [owner, repo] = repository.split('/');
  const runId = positiveInteger(process.env.GITHUB_RUN_ID);
  const runAttempt = positiveInteger(process.env.GITHUB_RUN_ATTEMPT);
  if (!owner || !repo || !runId || !runAttempt) fail('GitHub workflow run identity is incomplete or unsafe.');
  const context = { event, dispatch, repository, owner, repo, runId, runAttempt, authorizationCommentId };

  if (mode === 'evidence') {
    const collected = await collectEvidence(context);
    const identity = collected.evidence.identity;
    appendOutputs({
      repository: identity.repository,
      pr_number: identity.prNumber,
      branch: identity.branch,
      source_head: identity.sourceHead,
      source_tree: identity.sourceTree,
      base_sha: identity.baseSha,
      workflow_run_id: identity.workflowRunId,
      workflow_run_attempt: identity.workflowRunAttempt,
      evidence_sha256: collected.evidenceSha256,
    });
    process.stdout.write(`${JSON.stringify({
      finalStatus: 'PERSONAL_REPOSITORY_EVIDENCE_READY_AFTER_PROTECTED_ADMISSION',
      mutationAuthority: false,
      evidenceSha256: collected.evidenceSha256,
      ...identity,
      independentReview: collected.independentReview,
      retryablePriorFailures: collected.packet.retryablePriorFailures,
      requiredWorkflowRuns: collected.workflows.evidence,
      activeRulesetIds: collected.configuration.activeRulesetIds,
    }, null, 2)}\n`);
    return;
  }

  const expected = expectedAdmittedEvidence();
  const collected = await collectEvidence(context, expected);
  if (collected.evidenceSha256 !== expected.evidenceSha256) {
    fail('Personal-repository evidence changed after protected evidence admission.', {
      blockers: ['personal-repository-evidence-digest-mismatch'],
      expectedEvidenceSha256: expected.evidenceSha256,
      observedEvidenceSha256: collected.evidenceSha256,
    });
  }

  if (mode === 'approve') {
    const receipt = buildPersonalRepositoryApprovalReceipt({
      evidence: collected.evidence,
      workflows: collected.workflows,
      configuration: collected.configuration,
      independentReviewWorkflowRunId: collected.independentReview.workflowRunId,
      independentReviewWorkflowRunAttempt: collected.independentReview.workflowRunAttempt,
      independentReviewArtifactId: collected.independentReview.artifactId,
      independentReviewArtifactDigest: collected.independentReview.artifactDigest,
      independentReviewPayloadSha256: collected.independentReview.payloadSha256,
      evidenceSha256: collected.evidenceSha256,
      approvedAtUtc: new Date().toISOString(),
    });
    const encodedReceipt = Buffer.from(JSON.stringify(receipt), 'utf8').toString('base64url');
    appendOutputs({
      approval_receipt: encodedReceipt,
      approval_receipt_sha256: sha256(JSON.stringify(canonicalJson(receipt))),
    });
    process.stdout.write(`${JSON.stringify({
      finalStatus: 'PERSONAL_REPOSITORY_PROTECTED_APPROVAL_READY',
      mutationAuthority: false,
      receipt,
    }, null, 2)}\n`);
    return;
  }

  const receipt = decodeApprovalReceipt(process.env.STEPHANOS_APPROVAL_RECEIPT);
  const receiptValidation = validatePersonalRepositoryApprovalReceipt(receipt, {
    ...expected,
    independentReviewWorkflowRunId: dispatch.identity.independentReviewWorkflowRunId,
    independentReviewWorkflowRunAttempt: dispatch.identity.independentReviewWorkflowRunAttempt,
    independentReviewArtifactId: dispatch.identity.independentReviewArtifactId,
    independentReviewArtifactDigest: dispatch.identity.independentReviewArtifactDigest,
    independentReviewPayloadSha256: dispatch.identity.independentReviewPayloadSha256,
    evidenceSha256: expected.evidenceSha256,
  });
  if (!receiptValidation.valid) {
    fail('Protected personal-repository approval receipt is stale or invalid.', {
      blockers: receiptValidation.blockers,
    });
  }
  const mergeResponse = await apiJson(`/repos/${owner}/${repo}/pulls/${receipt.prNumber}/merge`, {
    method: 'PUT',
    body: {
      merge_method: 'squash',
      sha: receipt.sourceHead,
    },
  });
  const mergedPullRequest = await apiJson(`/repos/${owner}/${repo}/pulls/${receipt.prNumber}`);
  const liveMainRef = await apiJson(`/repos/${owner}/${repo}/git/ref/heads/main`);
  const mergeCommit = await apiJson(`/repos/${owner}/${repo}/git/commits/${text(mergeResponse?.sha).toLowerCase()}`);
  let branchRef = {};
  try {
    branchRef = await apiJson(`/repos/${owner}/${repo}/git/ref/heads/${receipt.branch.split('/').map(encodeURIComponent).join('/')}`);
  } catch {
    branchRef = {};
  }
  const completion = validatePersonalRepositorySquashCompletion({
    mergeResponse,
    pullRequest: mergedPullRequest,
    liveMainRef,
    mergeCommit,
    branchRef,
  }, receipt);
  if (!completion.valid) {
    fail('GitHub squash merge completed without exact bounded completion proof.', {
      blockers: completion.blockers,
      mergeResponse,
    });
  }
  await postCompletionComment(context, completion, receipt);
  process.stdout.write(`${JSON.stringify({
    finalStatus: 'PERSONAL_REPOSITORY_PROTECTED_SQUASH_MERGED',
    mutationAuthority: 'exact-head-squash-and-bounded-receipt-only',
    repository,
    prNumber: receipt.prNumber,
    sourceHead: receipt.sourceHead,
    sourceTree: receipt.sourceTree,
    baseSha: receipt.baseSha,
    mergeCommit: completion.mergeSha,
    mainTree: completion.treeSha,
    sourceBranchRetained: true,
    evidenceSha256: receipt.evidenceSha256,
  }, null, 2)}\n`);
}

main().catch((error) => {
  const details = error instanceof GateError ? error.details : {};
  process.stderr.write(`${JSON.stringify({
    finalStatus: 'PERSONAL_REPOSITORY_PROTECTED_MERGE_BLOCKED',
    mutationAuthority: mode === 'merge' ? 'not-proved' : false,
    message: error instanceof Error ? error.message : String(error),
    ...details,
  }, null, 2)}\n`);
  process.exitCode = 1;
});