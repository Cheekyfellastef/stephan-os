#!/usr/bin/env node

import fs from 'node:fs';

import {
  DEFAULT_REVIEW_RECEIPT_TIMEOUT_MS,
  EXACT_HEAD_REVIEW_DECISION,
  EXACT_HEAD_REVIEW_MARKERS,
  buildMissingReceiptEscalationComment,
  buildReviewDispatchComment,
  buildReviewReceiptComment,
  candidateReviewPrNumbers,
  canonicalLaneEvidence,
  exactHeadReviewProgress,
  evaluateExactHeadReviewDispatch,
  explicitOwnerExactHeadReviewRequest,
  parseOptionalManualPrNumber,
} from '../shared/agents/exactHeadReviewDispatchCoordinator.mjs';
import {
  MACHINE_COORDINATOR_SENTINEL_LOGIN,
  REVIEW_COORDINATOR_CREDENTIAL_SOURCE,
  normalizeReviewCoordinatorMarkerComments,
  selectReviewCoordinatorCredential,
  validateReviewCoordinatorCredential,
} from '../shared/agents/exactHeadReviewCoordinatorAuthority.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
  PROTECTED_REVIEW_MARKER,
} from '../shared/agents/operatorMergeApprovalGate.mjs';
import {
  INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES,
  validateIndependentReviewArtifact,
} from '../shared/agents/operatorMergeReviewArtifactV1.mjs';
import {
  mapGitHubIndependentReviewJobV1,
  mapGitHubIndependentReviewRunV1,
} from '../shared/agents/exactHeadIndependentReviewRunV1.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-exact-head-review-dispatch-v1';
const MAX_GITHUB_PAGES = 20;
const MAX_INDEPENDENT_REVIEW_SESSIONS = 20;
const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({
  login: 'github-actions[bot]',
  type: 'bot',
  id: 41898282,
});

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function positiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readJson(path) {
  if (!path || !fs.existsSync(path)) return {};
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function triggeringIndependentReviewArtifact() {
  const required = text(process.env.STEPHANOS_TRIGGER_REVIEW_ARTIFACT_REQUIRED).toLowerCase() === 'true';
  if (!required) return null;
  const path = text(process.env.STEPHANOS_TRIGGER_REVIEW_ARTIFACT_PATH);
  if (!path || !fs.existsSync(path)) {
    throw new Error('the triggering independent-review artifact is required but unavailable');
  }
  const size = fs.statSync(path).size;
  if (size < 1 || size > INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES) {
    throw new Error('the triggering independent-review artifact exceeds its bounded size');
  }
  const artifact = readJson(path);
  const expectedRunId = positiveInteger(process.env.STEPHANOS_TRIGGER_REVIEW_RUN_ID, 0);
  const expectedRunAttempt = positiveInteger(process.env.STEPHANOS_TRIGGER_REVIEW_RUN_ATTEMPT, 0);
  if (!expectedRunId || !expectedRunAttempt
      || artifact?.workflowRunId !== expectedRunId
      || artifact?.workflowRunAttempt !== expectedRunAttempt) {
    throw new Error('the triggering independent-review artifact does not match the workflow-run event');
  }
  return artifact;
}

function appendOutput(name, value) {
  const outputPath = text(process.env.GITHUB_OUTPUT);
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`);
}

function repositoryParts(repository) {
  const match = text(repository).match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error('GITHUB_REPOSITORY must be owner/name');
  return { owner: match[1], repo: match[2] };
}

function trustedLaneAuthorityLogin(repositoryOwner) {
  const login = [
    process.env.STEPHANOS_REVIEW_LANE_AUTHORITY_LOGIN,
    process.env.STEPHANOS_REVIEW_COORDINATOR_LOGIN,
    repositoryOwner,
  ].map((value) => text(value)).find(Boolean) || '';
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) {
    throw new Error('review lane authority must name one GitHub actor');
  }
  return login;
}

async function githubRequest(path, { method = 'GET', body = null, token, accept = 'application/vnd.github+json' } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: accept,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    const message = typeof payload === 'object' && payload ? payload.message : raw;
    throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${text(message, 'unknown error')}`);
  }
  return payload;
}

async function githubPages(path, { token, itemKey = null } = {}) {
  const separator = path.includes('?') ? '&' : '?';
  const items = [];
  for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
    const payload = await githubRequest(`${path}${separator}per_page=100&page=${page}`, { token });
    const pageItems = itemKey ? payload?.[itemKey] : payload;
    if (!Array.isArray(pageItems)) throw new Error(`GitHub pagination payload for ${path} is not an array`);
    items.push(...pageItems);
    if (pageItems.length < 100) break;
    if (page === MAX_GITHUB_PAGES) {
      throw new Error(`GitHub pagination exceeded ${MAX_GITHUB_PAGES * 100} records for ${path}; refusing partial evidence`);
    }
  }
  return items;
}

function mapComment(comment) {
  return {
    id: comment?.id ?? null,
    body: text(comment?.body),
    user: {
      login: text(comment?.user?.login),
      type: text(comment?.user?.type),
      id: comment?.user?.id ?? null,
    },
    createdAt: comment?.created_at ?? null,
    updatedAt: comment?.updated_at ?? null,
  };
}

function mapReview(review) {
  return {
    id: review?.id ?? null,
    body: text(review?.body),
    commitId: text(review?.commit_id),
    user: {
      login: text(review?.user?.login),
      type: text(review?.user?.type),
      id: review?.user?.id ?? null,
    },
    submittedAt: review?.submitted_at ?? null,
  };
}

function mapWorkflowRun(run) {
  return {
    id: run?.id ?? null,
    name: text(run?.name),
    workflowPath: text(run?.path),
    headSha: text(run?.head_sha),
    status: text(run?.status),
    conclusion: text(run?.conclusion),
    event: text(run?.event),
    runAttempt: Number(run?.run_attempt ?? 0),
    createdAt: run?.created_at ?? null,
    updatedAt: run?.updated_at ?? null,
    completedAt: run?.updated_at ?? null,
    htmlUrl: text(run?.html_url),
  };
}

async function unresolvedThreadCount(owner, repo, prNumber, token) {
  const query = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}}}}`;
  const payload = await githubRequest('/graphql', {
    method: 'POST',
    body: { query, variables: { owner, repo, number: prNumber } },
    token,
  });
  const threads = payload?.data?.repository?.pullRequest?.reviewThreads;
  if (!threads || threads.pageInfo?.hasNextPage) {
    throw new Error('Review-thread evidence is missing or exceeds the bounded first page.');
  }
  return (threads.nodes || []).filter((thread) => thread?.isResolved !== true).length;
}

function exactGitHubActionsReviewer(comment = {}) {
  return text(comment?.user?.login).toLowerCase() === TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    && text(comment?.user?.type).toLowerCase() === TRUSTED_GITHUB_ACTIONS_REVIEWER.type
    && Number(comment?.user?.id) === TRUSTED_GITHUB_ACTIONS_REVIEWER.id;
}

function trustedArtifactIndex(comment, laneAuthorityLogin) {
  const login = text(comment?.user?.login).toLowerCase();
  return comment?.body?.includes(`<!-- ${EXACT_HEAD_REVIEW_MARKERS.ARTIFACT_INDEX} -->`)
    && (login === text(laneAuthorityLogin).toLowerCase() || exactGitHubActionsReviewer(comment));
}

function candidateIndependentReviewSessions(comments = [], { laneAuthorityLogin = '', artifact = null } = {}) {
  const sessions = new Map();
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!exactGitHubActionsReviewer(comment) && !trustedArtifactIndex(comment, laneAuthorityLogin)) continue;
    const body = text(comment?.body);
    if (!body.includes(PROTECTED_REVIEW_MARKER)) continue;
    for (const match of body.matchAll(/github-actions-independent-review-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)/g)) {
      const workflowRunId = positiveInteger(match[1], 0);
      const workflowRunAttempt = positiveInteger(match[2], 0);
      if (!workflowRunId || !workflowRunAttempt) continue;
      sessions.set(`${workflowRunId}:${workflowRunAttempt}`, { workflowRunId, workflowRunAttempt });
      if (sessions.size >= MAX_INDEPENDENT_REVIEW_SESSIONS) return [...sessions.values()];
    }
  }
  const workflowRunId = positiveInteger(artifact?.workflowRunId, 0);
  const workflowRunAttempt = positiveInteger(artifact?.workflowRunAttempt, 0);
  if (workflowRunId && workflowRunAttempt && sessions.size < MAX_INDEPENDENT_REVIEW_SESSIONS) {
    sessions.set(`${workflowRunId}:${workflowRunAttempt}`, { workflowRunId, workflowRunAttempt });
  }
  return [...sessions.values()];
}

async function loadIndependentReviewEvidence({ owner, repo, repository, token, comments, laneAuthorityLogin, artifact, pr }) {
  const sessions = candidateIndependentReviewSessions(comments, { laneAuthorityLogin, artifact });
  const empty = {
    independentReviewWorkflowId: 0,
    independentReviewRuns: [],
    independentReviewJobsByRunId: {},
    independentReviewArtifactComments: [],
  };
  if (!sessions.length) return empty;

  const definitions = await githubPages(`/repos/${owner}/${repo}/actions/workflows`, {
    token,
    itemKey: 'workflows',
  });
  const pathMatches = definitions.filter((workflow) => (
    text(workflow?.path) === INDEPENDENT_REVIEW_WORKFLOW_PATH
  ));
  const nameCollisions = definitions.filter((workflow) => (
    text(workflow?.name) === INDEPENDENT_REVIEW_WORKFLOW_NAME
    && text(workflow?.path) !== INDEPENDENT_REVIEW_WORKFLOW_PATH
  ));
  const definition = pathMatches.length === 1 ? pathMatches[0] : null;
  const independentReviewWorkflowId = definition
    && text(definition?.name) === INDEPENDENT_REVIEW_WORKFLOW_NAME
    && text(definition?.state).toLowerCase() === 'active'
    && nameCollisions.length === 0
    ? positiveInteger(definition?.id, 0)
    : 0;
  if (!independentReviewWorkflowId) return empty;

  const independentReviewRuns = [];
  const independentReviewJobsByRunId = {};
  for (const session of sessions) {
    try {
      const rawRun = await githubRequest(
        `/repos/${owner}/${repo}/actions/runs/${session.workflowRunId}`,
        { token },
      );
      const rawJobs = await githubPages(
        `/repos/${owner}/${repo}/actions/runs/${session.workflowRunId}/attempts/${session.workflowRunAttempt}/jobs`,
        { token, itemKey: 'jobs' },
      );
      independentReviewRuns.push(mapGitHubIndependentReviewRunV1(rawRun));
      independentReviewJobsByRunId[String(session.workflowRunId)] = rawJobs.map(mapGitHubIndependentReviewJobV1);
    } catch (error) {
      console.warn(`INDEPENDENT_REVIEW_EVIDENCE_UNAVAILABLE=${session.workflowRunId}:${session.workflowRunAttempt}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const independentReviewArtifactComments = [];
  if (artifact) {
    const validation = validateIndependentReviewArtifact(artifact, {
      repository,
      prNumber: positiveInteger(pr?.number, 0),
      branch: text(pr?.head?.ref),
      expectedHead: text(pr?.head?.sha).toLowerCase(),
      expectedBaseSha: text(pr?.base?.sha).toLowerCase(),
      workflowRunId: positiveInteger(artifact?.workflowRunId, 0),
      workflowRunAttempt: positiveInteger(artifact?.workflowRunAttempt, 0),
    });
    if (!validation.valid) {
      throw new Error(`triggering independent-review artifact is invalid: ${validation.blockers.join(', ')}`);
    }
    independentReviewArtifactComments.push({
      id: `artifact-${artifact.workflowRunId}-attempt-${artifact.workflowRunAttempt}`,
      body: [
        PROTECTED_REVIEW_MARKER,
        '```json',
        JSON.stringify(artifact.receipt, null, 2),
        '```',
      ].join('\n'),
      user: {
        login: 'github-actions[bot]',
        type: 'Bot',
        id: 41898282,
      },
      createdAt: artifact.createdAtUtc,
    });
  }
  return {
    independentReviewWorkflowId,
    independentReviewRuns,
    independentReviewJobsByRunId,
    independentReviewArtifactComments,
  };
}

async function listOpenPullRequests({ owner, repo, token }) {
  return githubPages(`/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc`, { token });
}

async function loadPrContext({ owner, repo, repository, token, prNumber, laneAuthorityLogin, triggeringArtifact = null, rawPr = null, mappedComments = null }) {
  const pr = rawPr ?? await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, { token });
  const [comments, reviews, runs, unresolvedThreads] = await Promise.all([
    mappedComments ?? githubPages(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, { token }).then((items) => items.map(mapComment)),
    githubPages(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, { token }).then((items) => items.map(mapReview)),
    githubPages(
      `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(text(pr?.head?.sha))}&event=pull_request`,
      { token, itemKey: 'workflow_runs' },
    ).then((items) => items.map(mapWorkflowRun)),
    unresolvedThreadCount(owner, repo, prNumber, token),
  ]);
  const independentReviewEvidence = await loadIndependentReviewEvidence({
    owner,
    repo,
    repository,
    token,
    comments,
    laneAuthorityLogin,
    artifact: triggeringArtifact,
    pr,
  });
  const laneEvidence = canonicalLaneEvidence(comments, {
    prNumber,
    trustedCoordinatorLogin: laneAuthorityLogin,
  });
  return {
    rawPr: pr,
    comments: [...comments, ...independentReviewEvidence.independentReviewArtifactComments],
    reviews,
    workflowRuns: runs,
    unresolvedThreadCount: unresolvedThreads,
    ...independentReviewEvidence,
    canonicalLaneConfirmed: laneEvidence.confirmed,
    canonicalLaneCommentId: laneEvidence.commentId,
    pr: {
      number: positiveInteger(pr?.number),
      state: text(pr?.state),
      baseRef: text(pr?.base?.ref),
      baseSha: text(pr?.base?.sha),
      headRef: text(pr?.head?.ref),
      headSha: text(pr?.head?.sha),
      sameRepository: text(pr?.head?.repo?.full_name).toLowerCase() === repository.toLowerCase(),
    },
  };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const items = Array.from(values || []);
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
  return results;
}

async function postPrComment({ owner, repo, token, prNumber, body }) {
  const result = await githubRequest(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    body: { body },
    token,
  });
  return result?.id ?? null;
}

async function discoverCanonicalContexts({ owner, repo, repository, token, laneAuthorityLogin, triggeringArtifact }) {
  const openPullRequests = await listOpenPullRequests({ owner, repo, token });
  const candidates = (await mapWithConcurrency(openPullRequests, 8, async (rawPr) => {
    const prNumber = positiveInteger(rawPr?.number);
    if (!prNumber) return null;
    const mappedComments = (await githubPages(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, { token })).map(mapComment);
    const laneEvidence = canonicalLaneEvidence(mappedComments, {
      prNumber,
      trustedCoordinatorLogin: laneAuthorityLogin,
    });
    return laneEvidence.confirmed ? { prNumber, rawPr, mappedComments } : null;
  })).filter(Boolean);
  return mapWithConcurrency(candidates, 4, (candidate) => loadPrContext({
    owner,
    repo,
    repository,
    token,
    laneAuthorityLogin,
    triggeringArtifact,
    ...candidate,
  }));
}

async function loadRequestedCanonicalContexts({
  owner,
  repo,
  repository,
  token,
  laneAuthorityLogin,
  prNumbers,
  triggeringArtifact,
  explicitOwnerReviewRequest = null,
}) {
  const contexts = await mapWithConcurrency([...new Set(prNumbers)], 4, (prNumber) => loadPrContext({
    owner,
    repo,
    repository,
    token,
    prNumber,
    laneAuthorityLogin,
    triggeringArtifact,
  }));
  return contexts.map((context) => {
    const explicitMatch = explicitOwnerReviewRequest?.authorized === true
      && context.pr.number === explicitOwnerReviewRequest.prNumber
      && context.pr.headSha === explicitOwnerReviewRequest.headSha;
    if (!context.canonicalLaneConfirmed && !explicitMatch) return null;
    return {
      ...context,
      ownerExactHeadReviewRequested: explicitMatch,
      ownerExactHeadReviewCommentId: explicitMatch ? explicitOwnerReviewRequest.commentId : null,
    };
  }).filter(Boolean);
}

function appendSummary(lines) {
  const summaryPath = text(process.env.GITHUB_STEP_SUMMARY);
  if (!summaryPath) return;
  fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`);
}

async function main() {
  const repository = text(process.env.GITHUB_REPOSITORY);
  const { owner, repo } = repositoryParts(repository);
  const credential = selectReviewCoordinatorCredential(process.env);
  const token = credential.token;
  if (!token) throw new Error('a bounded GitHub token is required');
  const laneAuthorityLogin = trustedLaneAuthorityLogin(owner);
  const authenticatedUser = credential.source === REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GITHUB_ACTIONS
    ? {}
    : await githubRequest('/user', { token });
  const coordinatorActor = validateReviewCoordinatorCredential({
    credential,
    authenticatedUser,
    laneAuthorityLogin,
    environment: process.env,
  });
  if (!coordinatorActor.valid) {
    throw new Error(`bounded GitHub token actor is not authorised: ${coordinatorActor.reason}`);
  }
  console.log(`EXACT_HEAD_REVIEW_COORDINATOR_ACTOR=${coordinatorActor.actorLogin}`);
  console.log(`EXACT_HEAD_REVIEW_COORDINATOR_MODE=${coordinatorActor.mode}`);
  console.log(`EXACT_HEAD_REVIEW_COORDINATOR_CREDENTIAL_SOURCE=${coordinatorActor.credentialSource}`);
  console.log(`EXACT_HEAD_REVIEW_LANE_AUTHORITY=${laneAuthorityLogin}`);

  const event = readJson(text(process.env.GITHUB_EVENT_PATH));
  const triggeringArtifact = triggeringIndependentReviewArtifact();
  const planOnly = text(process.env.STEPHANOS_EXACT_HEAD_REVIEW_PLAN_ONLY).toLowerCase() === 'true';
  const manualPrNumber = parseOptionalManualPrNumber(process.env.STEPHANOS_EXACT_HEAD_REVIEW_PR);
  const explicitOwnerReviewRequest = explicitOwnerExactHeadReviewRequest({ event, laneAuthorityLogin });
  const requestedNumbers = candidateReviewPrNumbers({ event, manualPrNumber });
  const contextLoader = requestedNumbers.length ? loadRequestedCanonicalContexts : discoverCanonicalContexts;
  const contexts = await contextLoader({
    owner,
    repo,
    repository,
    token,
    laneAuthorityLogin,
    prNumbers: requestedNumbers,
    triggeringArtifact,
    explicitOwnerReviewRequest,
  });

  if (planOnly) {
    const targets = contexts
      .map((context) => ({ prNumber: context.pr.number }))
      .filter((target) => Number.isSafeInteger(target.prNumber) && target.prNumber > 0)
      .sort((left, right) => left.prNumber - right.prNumber);
    console.log(`EXACT_HEAD_REVIEW_PLAN_TARGETS=${JSON.stringify(targets)}`);
    appendOutput('targets', JSON.stringify(targets));
    appendOutput('decision', targets.length ? 'PLAN_READY' : 'NO_CANONICAL_LANE');
    return;
  }
  if (contexts.length > 1) {
    throw new Error('mutation execution requires exactly one PR-scoped coordinator target');
  }

  if (requestedNumbers.length && contexts.length === 0) {
    console.log('EXACT_HEAD_REVIEW_DISPATCH_DECISION=REQUESTED_PR_NOT_CANONICAL');
    appendOutput('decision', 'REQUESTED_PR_NOT_CANONICAL');
    return;
  }
  if (contexts.length === 0) {
    console.log('EXACT_HEAD_REVIEW_DISPATCH_DECISION=NO_CANONICAL_LANE');
    appendOutput('decision', 'NO_CANONICAL_LANE');
    return;
  }
  const timeoutMinutes = positiveInteger(process.env.STEPHANOS_REVIEW_RECEIPT_TIMEOUT_MINUTES, Math.round(DEFAULT_REVIEW_RECEIPT_TIMEOUT_MS / 60000));
  const deferMissingReceiptEscalation = text(process.env.STEPHANOS_DEFER_MISSING_RECEIPT_ESCALATION).toLowerCase() === 'true';
  const results = [];
  let stalled = false;
  for (const context of contexts.sort((left, right) => left.pr.number - right.pr.number)) {
    const coordinatorComments = normalizeReviewCoordinatorMarkerComments(context.comments, { laneAuthorityLogin });
    const decision = evaluateExactHeadReviewDispatch({
      repository,
      now: new Date().toISOString(),
      receiptTimeoutMs: timeoutMinutes * 60 * 1000,
      trustedCoordinatorLogin: MACHINE_COORDINATOR_SENTINEL_LOGIN,
      canonicalLaneConfirmed: context.canonicalLaneConfirmed,
      ownerExactHeadReviewRequested: context.ownerExactHeadReviewRequested === true,
      pr: context.pr,
      workflowRuns: context.workflowRuns,
      independentReviewWorkflowId: context.independentReviewWorkflowId,
      independentReviewRuns: context.independentReviewRuns,
      independentReviewJobsByRunId: context.independentReviewJobsByRunId,
      unresolvedThreadCount: context.unresolvedThreadCount,
      comments: coordinatorComments,
      reviews: context.reviews,
    });
    const progress = exactHeadReviewProgress(decision.decision);
    console.log(`EXACT_HEAD_REVIEW_DISPATCH_DECISION_PR_${decision.prNumber}=${decision.decision}`);
    console.log(`EXACT_HEAD_REVIEW_PROGRESS_PR_${decision.prNumber}=${progress}`);
    console.log(`EXACT_HEAD_REVIEW_HEAD_PR_${decision.prNumber}=${decision.exactHead}`);
    console.log(`EXACT_HEAD_REVIEW_REASON_PR_${decision.prNumber}=${decision.reason}`);

    let commentId = null;
    switch (decision.decision) {
      case EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW:
        commentId = await postPrComment({
          owner,
          repo,
          token,
          prNumber: decision.prNumber,
          body: buildReviewDispatchComment({ prNumber: decision.prNumber, headSha: decision.exactHead }),
        });
        console.log(`EXACT_HEAD_REVIEW_DISPATCH_COMMENT_ID=${commentId}`);
        appendOutput('comment_id', commentId ?? '');
        break;

      case EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT:
        commentId = await postPrComment({
          owner,
          repo,
          token,
          prNumber: decision.prNumber,
          body: buildReviewReceiptComment({
            prNumber: decision.prNumber,
            headSha: decision.exactHead,
            externalReceiptId: decision.externalReceiptId,
            providerNeutralReceipt: decision.providerNeutralReceipt,
          }),
        });
        console.log(`EXACT_HEAD_REVIEW_RECEIPT_COMMENT_ID=${commentId}`);
        appendOutput('comment_id', commentId ?? '');
        break;

      case EXACT_HEAD_REVIEW_DECISION.ESCALATE_MISSING_RECEIPT:
        if (deferMissingReceiptEscalation) {
          console.log('EXACT_HEAD_REVIEW_ESCALATION_DEFERRED_FOR_RECOVERY=true');
          appendOutput('recovery_deferred', 'true');
          break;
        }
        commentId = await postPrComment({
          owner,
          repo,
          token,
          prNumber: decision.prNumber,
          body: buildMissingReceiptEscalationComment({
            prNumber: decision.prNumber,
            headSha: decision.exactHead,
            timeoutMinutes,
            dispatchCommentId: decision.dispatchCommentId,
          }),
        });
        console.log(`EXACT_HEAD_REVIEW_ESCALATION_COMMENT_ID=${commentId}`);
        appendOutput('comment_id', commentId ?? '');
        stalled = true;
        break;

      case EXACT_HEAD_REVIEW_DECISION.STALLED_MISSING_RECEIPT:
        if (deferMissingReceiptEscalation) {
          console.log('EXACT_HEAD_REVIEW_STALL_DEFERRED_FOR_RECOVERY=true');
          appendOutput('recovery_deferred', 'true');
        } else {
          stalled = true;
        }
        break;

      default:
        break;
    }
    results.push({
      prNumber: decision.prNumber,
      exactHead: decision.exactHead,
      decision: decision.decision,
      progress,
      reason: decision.reason,
      commentId,
    });
  }

  const single = results.length === 1 ? results[0] : null;
  appendOutput('decision', single?.decision ?? 'MULTIPLE_PR_RESULTS');
  appendOutput('progress', single?.progress ?? 'MULTIPLE_PR_RESULTS');
  appendOutput('pr_number', single?.prNumber ?? '');
  appendOutput('exact_head', single?.exactHead ?? '');
  appendOutput('reason', single?.reason ?? `${results.length} independent canonical review lanes evaluated`);
  appendOutput('results', JSON.stringify(results));
  appendOutput('retry_targets', JSON.stringify(results.filter((result) => [
    EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW,
    EXACT_HEAD_REVIEW_DECISION.WAIT_REVIEW_RECEIPT,
    EXACT_HEAD_REVIEW_DECISION.ESCALATE_MISSING_RECEIPT,
    EXACT_HEAD_REVIEW_DECISION.STALLED_MISSING_RECEIPT,
  ].includes(result.decision)).map(({ prNumber, exactHead }) => ({ prNumber, exactHead }))));
  appendSummary([
    '## Exact-head review coordination',
    '',
    '| PR | Exact head | Progress | Decision |',
    '|---:|---|---|---|',
    ...results.map((result) => `| #${result.prNumber} | \`${result.exactHead.slice(0, 12)}\` | ${result.progress} | ${result.decision} |`),
  ]);
  if (stalled) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`EXACT_HEAD_REVIEW_DISPATCH_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
