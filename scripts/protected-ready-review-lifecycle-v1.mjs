#!/usr/bin/env node
// Fixed canonical READY -> exact-head review composition. No review, merge or
// bootstrap authority is inferred from a ready flag or a caller's clean boolean.
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as waitForObservation } from 'node:timers/promises';
import {
  READY_REVIEW_REPOSITORY as REPO, READY_REVIEW_PATH, READY_REVIEW_NAME,
  READY_REVIEW_PRODUCER_PATH, READY_REVIEW_PRODUCER_NAME,
  READY_REVIEW_HANDOFF_FILE, READY_REVIEW_RECEIPT_FILE, READY_REVIEW_MAX_BYTES,
  readyReviewAssert as requireProof, readyReviewSha256, readyReviewCanonical,
  readyReviewIdentity, readyReviewHandoffName, readyReviewReceiptName, readyReviewRunName,
  parseReadyReviewInputs, assertReadyReviewNormalizedInputs, assertReadyReviewPayload,
  assertReadyReviewSourceContext, assertReadyReviewTarget,
  assertReadyReviewOwner, assertReadyReviewHandoff, assertReadyReviewIndependent,
  assertReadyReviewRun, assertReadyReviewLaunchRun, assertReadyReviewJob, assertReadyReviewArtifact,
  buildReadyReviewHandoff, sealReadyReviewPayload, selectReadyReviewRun,
  validateProtectedReadyReviewLifecycleEvidence,
} from '../shared/agents/protectedReadyReviewLifecycleV1.mjs';
import { protectedWorkflowAuthorizationCommentSha256 } from '../shared/agents/protectedWorkflowDispatchMailboxV1.mjs';
import { INDEPENDENT_REVIEW_ARTIFACT_FILE, validateIndependentReviewArtifactSet } from '../shared/agents/operatorMergeReviewArtifactV1.mjs';
import {
  executePersonalRepositoryArtifactArchiveTransport,
  extractPersonalRepositoryArtifactZip,
} from '../shared/agents/operatorPersonalRepositoryMergeV1.mjs';
import { reviewExactHead } from './exact-head-review.mjs';
import { qualifyExactHeadReviewV1, validateOwnerEscalationCommentV1 } from './exact-head-qualified-escalation-v1.mjs';
import { planProtectedReadyExecutionRoute, PROTECTED_READY_EXECUTION_ROUTE } from '../shared/agents/protectedReadyExecutionRouteV1.mjs';

const MAX_PAGES = 6;
const DISPATCH_OBSERVATIONS = 6;
const DISPATCH_OBSERVATION_DELAY_MS = 5000;
const ROOT = `/repos/${REPO}`;
// Fixed read-only query. Callers supply only the exact PR number and an opaque
// pagination cursor, never a query, repository, field list or mutation.
const READY_THREADS_QUERY = `query($number:Int!,$after:String){repository(owner:"Cheekyfellastef",name:"stephan-os"){nameWithOwner pullRequest(number:$number){number state merged isDraft headRefName headRefOid baseRefName baseRefOid headRepository{nameWithOwner} reviewThreads(first:100,after:$after){totalCount nodes{id isResolved} pageInfo{hasNextPage endCursor}}}}}`;
const sha = readyReviewSha256;
const exact = (a, b) => JSON.stringify(readyReviewCanonical(a)) === JSON.stringify(readyReviewCanonical(b));
function apiId(value) {
  requireProof(Number.isSafeInteger(value) && value > 0, 'API_ID_INVALID');
  return value;
}
function apiSha(value) {
  requireProof(typeof value === 'string' && /^[a-f0-9]{40}$/.test(value), 'API_SHA_INVALID');
  return value;
}
const ownSource = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', shell: false }).trim();
function writeJson(path, value) {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  requireProof(Buffer.byteLength(bytes) <= READY_REVIEW_MAX_BYTES, 'LOCAL_PAYLOAD_TOO_LARGE');
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
}
function output(values, env = process.env) {
  requireProof(Boolean(env.GITHUB_OUTPUT), 'OUTPUT_PATH_MISSING');
  appendFileSync(env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}
export async function readReadyReviewCollection(api, path, key) {
  const items = [], seen = new Set();
  let total = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    requireProof(Number.isSafeInteger(body?.total_count) && body.total_count >= 0 && body.total_count <= MAX_PAGES * 100
      && (total === null || total === body.total_count) && Array.isArray(body[key]) && body[key].length <= 100,
    'COLLECTION_INCOMPLETE_OR_CHANGED');
    total = body.total_count;
    for (const item of body[key]) {
      requireProof(Number.isSafeInteger(item?.id) && item.id > 0 && !seen.has(item.id), 'COLLECTION_DUPLICATE');
      seen.add(item.id); items.push(item);
    }
    if (items.length === total) return items;
    requireProof(items.length < total && body[key].length === 100, 'COLLECTION_TRUNCATED');
  }
  throw new Error('PROTECTED_READY_REVIEW_BLOCKED:COLLECTION_LIMIT');
}
async function jobsFor(api, runId, attempt = 1) {
  return readReadyReviewCollection(api, `/actions/runs/${apiId(runId)}/attempts/${apiId(attempt)}/jobs?filter=all`, 'jobs');
}
function oneJob(jobs, name) {
  const selected = jobs.filter(job => job.name === name);
  requireProof(selected.length === 1, 'JOB_COUNT_NOT_ONE');
  return selected[0];
}
async function loadArtifact(api, download, artifactId, file) {
  const metadata = await api(`/actions/artifacts/${apiId(artifactId)}`);
  requireProof(metadata?.id === artifactId && metadata.expired === false
    && Number.isSafeInteger(metadata.size_in_bytes) && metadata.size_in_bytes > 0
    && metadata.size_in_bytes <= READY_REVIEW_MAX_BYTES && /^sha256:[a-f0-9]{64}$/.test(metadata.digest || ''),
  'ARTIFACT_SIZE_OR_DIGEST');
  const bytes = await download(artifactId);
  requireProof(Buffer.isBuffer(bytes) && bytes.length === metadata.size_in_bytes
    && bytes.length <= READY_REVIEW_MAX_BYTES && `sha256:${sha(bytes)}` === metadata.digest, 'ARTIFACT_ARCHIVE_DIGEST');
  const payload = JSON.parse(extractPersonalRepositoryArtifactZip(bytes, file).toString('utf8'));
  return { metadata, payload, archiveSha256: sha(bytes) };
}
async function uniqueArtifact(api, runId, name, expectedId = 0) {
  if (expectedId !== 0) apiId(expectedId);
  const artifacts = await readReadyReviewCollection(api, `/actions/runs/${apiId(runId)}/artifacts`, 'artifacts');
  const selected = artifacts.filter(a => a.name === name);
  requireProof(selected.length === 1 && (!expectedId || selected[0].id === expectedId), 'ARTIFACT_SET_NOT_UNIQUE');
  return selected[0].id;
}
export async function readReadyReviewTarget(api, identity, options) {
  const prNumber = apiId(identity.prNumber), sourceHead = apiSha(identity.sourceHead);
  const [pull, main, commit] = await Promise.all([api(`/pulls/${prNumber}`),
    api('/git/ref/heads/main'), api(`/git/commits/${sourceHead}`)]);
  const state = { pull, main, commit };
  assertReadyReviewTarget(state, identity, options);
  return state;
}
export async function loadReadyReviewIndependent(command, { api, download }) {
  readyReviewIdentity(command);
  const [definition, run, jobs, artifacts] = await Promise.all([
    api('/actions/workflows/independent-merge-security-review.yml'),
    api(`/actions/runs/${command.independentReviewRunId}`),
    jobsFor(api, command.independentReviewRunId, command.independentReviewRunAttempt),
    readReadyReviewCollection(api, `/actions/runs/${command.independentReviewRunId}/artifacts`, 'artifacts'),
  ]);
  const set = validateIndependentReviewArtifactSet({ total_count: artifacts.length, artifacts }, {
    workflowRunId: command.independentReviewRunId, workflowRunAttempt: command.independentReviewRunAttempt });
  requireProof(set.valid && set.artifact?.id === command.independentReviewArtifactId, 'INDEPENDENT_ARTIFACT_SET');
  const artifact = await loadArtifact(api, download, command.independentReviewArtifactId, INDEPENDENT_REVIEW_ARTIFACT_FILE);
  const evidence = { definition, run, jobs, ...artifact };
  assertReadyReviewIndependent(evidence, command);
  return evidence;
}

export async function readReadyReviewUnresolvedThreads(readThreadsPage, identity) {
  apiId(identity.prNumber); apiSha(identity.sourceHead); apiSha(identity.baseSha);
  requireProof(typeof readThreadsPage === 'function', 'REVIEW_THREADS_READ_UNAVAILABLE');
  const seen = new Set(), cursors = new Set();
  let cursor = null, total = null, unresolved = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await readThreadsPage(identity.prNumber, cursor);
    requireProof(body && (!Object.hasOwn(body, 'errors') || (Array.isArray(body.errors) && body.errors.length === 0)),
      'REVIEW_THREADS_QUERY_ERROR');
    const repository = body.data?.repository, pull = repository?.pullRequest, threads = pull?.reviewThreads;
    requireProof(repository?.nameWithOwner === REPO && pull?.number === identity.prNumber
      && pull.state === 'OPEN' && pull.merged === false && pull.isDraft === true
      && pull.headRepository?.nameWithOwner === REPO && pull.headRefName === identity.branch
      && pull.headRefOid === identity.sourceHead && pull.baseRefName === 'main' && pull.baseRefOid === identity.baseSha,
    'REVIEW_THREADS_IDENTITY_CHANGED');
    requireProof(Number.isSafeInteger(threads?.totalCount) && threads.totalCount >= 0 && threads.totalCount <= MAX_PAGES * 100
      && (total === null || total === threads.totalCount) && Array.isArray(threads.nodes) && threads.nodes.length <= 100
      && typeof threads.pageInfo?.hasNextPage === 'boolean', 'REVIEW_THREADS_INCOMPLETE_OR_CHANGED');
    total = threads.totalCount;
    for (const thread of threads.nodes) {
      requireProof(typeof thread?.id === 'string' && thread.id.length > 0 && thread.id.length <= 200
        && !seen.has(thread.id) && typeof thread.isResolved === 'boolean', 'REVIEW_THREAD_UNKNOWN_OR_DUPLICATE');
      seen.add(thread.id);
      if (!thread.isResolved) unresolved += 1;
    }
    if (threads.pageInfo.hasNextPage === false) {
      requireProof(seen.size === total, 'REVIEW_THREADS_TRUNCATED');
      return unresolved;
    }
    const next = threads.pageInfo.endCursor;
    requireProof(seen.size < total && threads.nodes.length === 100 && typeof next === 'string'
      && next.length > 0 && next.length <= 1024 && !cursors.has(next), 'REVIEW_THREADS_TRUNCATED_OR_CURSOR');
    cursors.add(next); cursor = next;
  }
  throw new Error('PROTECTED_READY_REVIEW_BLOCKED:REVIEW_THREADS_LIMIT');
}

// This happens before the new route mutates draft state. A legacy READY packet
// without a full review selection keeps its old behavior and never gets a proof.
export async function prepareReadyReviewProducer({ command, comment, env = process.env,
  sourceSha = ownSource(), api, download, readThreadsPage, now = () => new Date().toISOString() }) {
  const identity = readyReviewIdentity(command);
  assertReadyReviewSourceContext(env, sourceSha, identity.baseSha, 'dispatch');
  apiId(comment?.id);
  const [run, definition, liveComment, independent, state] = await Promise.all([
    api(`/actions/runs/${env.GITHUB_RUN_ID}`), api('/actions/workflows/protected-workflow-dispatch-mailbox.yml'),
    api(`/issues/comments/${comment.id}`), loadReadyReviewIndependent(command, { api, download }),
    readReadyReviewTarget(api, identity, { allowDraft: true }),
  ]);
  assertReadyReviewOwner(liveComment, command, now(), comment.id, protectedWorkflowAuthorizationCommentSha256(comment));
  assertReadyReviewRun(run, definition, identity, { producer: true, terminal: false, commentId: comment.id });
  requireProof(run.id === Number(env.GITHUB_RUN_ID), 'PRODUCER_RUN_ID');
  const mode = assertReadyReviewIndependent(independent, command);
  requireProof(state.pull.draft === false || mode === 'clean-independent', 'DRAFT_BOOTSTRAP_READY_NOT_AUTHORIZED');
  const unresolvedReviewThreads = state.pull.draft
    ? await readReadyReviewUnresolvedThreads(readThreadsPage, identity) : null;
  const route = planProtectedReadyExecutionRoute({ repository: identity.repository, prNumber: identity.prNumber,
    branch: identity.branch, head: identity.sourceHead, headTree: identity.sourceTree, base: identity.baseSha,
    alreadyReady: state.pull.draft === false, readyTransitionAuthorized: true, exactHeadReviewClean: mode === 'clean-independent',
    unresolvedReviewThreads, protectedMailboxAvailable: true });
  requireProof(route.route === (state.pull.draft ? PROTECTED_READY_EXECUTION_ROUTE.PROTECTED_MAILBOX
    : PROTECTED_READY_EXECUTION_ROUTE.ALREADY_READY), route.blocker || 'READY_ROUTE_NOT_AUTHORIZED');
  assertReadyReviewOwner(await api(`/issues/comments/${apiId(comment.id)}`), command, now(),
    comment.id, protectedWorkflowAuthorizationCommentSha256(comment));
  return { command, comment: liveComment, run, definition, sourceSha, beforeDraft: state.pull.draft, unresolvedReviewThreads };
}
export async function finishReadyReviewProducer(prepared, lifecycleResult, { api, env = process.env,
  now = new Date().toISOString(), path = READY_REVIEW_HANDOFF_FILE } = {}) {
  const identity = readyReviewIdentity(prepared.command);
  await readReadyReviewTarget(api, identity);
  const comment = await api(`/issues/comments/${apiId(prepared.comment.id)}`);
  assertReadyReviewOwner(comment, prepared.command, now, prepared.comment.id,
    protectedWorkflowAuthorizationCommentSha256(prepared.comment));
  const handoff = buildReadyReviewHandoff({ ...prepared, comment, lifecycleResult, observedAt: now });
  writeJson(path, handoff);
  output({ ready_review: 'true', ready_review_sha256: handoff.payloadSha256,
    ready_review_pr: identity.prNumber, ready_review_head: identity.sourceHead, ready_review_base: identity.baseSha }, env);
  return handoff;
}

export async function loadReadyReviewHandoff(inputs, { api, download, terminal = true, at = null,
  requireDispatchJob = terminal } = {}) {
  assertReadyReviewNormalizedInputs(inputs);
  const [run, definition, jobs] = await Promise.all([api(`/actions/runs/${inputs.readyRunId}`),
    api('/actions/workflows/protected-workflow-dispatch-mailbox.yml'), jobsFor(api, inputs.readyRunId)]);
  await uniqueArtifact(api, run.id, readyReviewHandoffName(run.id), inputs.readyArtifactId);
  const artifact = await loadArtifact(api, download, inputs.readyArtifactId, READY_REVIEW_HANDOFF_FILE);
  const payload = artifact.payload;
  assertReadyReviewPayload(payload);
  requireProof(payload?.payloadSha256 === inputs.handoffSha256 && payload.identity?.prNumber === inputs.prNumber
    && payload.identity?.sourceHead === inputs.sourceHead && payload.identity?.baseSha === inputs.baseSha,
  'DISPATCH_HANDOFF_BINDING');
  const ownerComment = await api(`/issues/comments/${apiId(payload.authorizationCommentId)}`);
  const evidence = { run, definition, job: oneJob(jobs, 'dispatch'), ownerComment, artifact };
  assertReadyReviewHandoff(evidence, { terminal, at });
  if (requireDispatchJob) {
    evidence.dispatchJob = oneJob(jobs, 'review-ready');
    assertReadyReviewJob(evidence.dispatchJob, run, 'review-ready', {
      terminal: terminal || evidence.dispatchJob.status === 'completed' });
  }
  return evidence;
}
async function lifecycleRuns(api, identity) {
  return readReadyReviewCollection(api,
    `/actions/workflows/stephanos-exact-head-review.yml/runs?event=workflow_dispatch&head_sha=${apiSha(identity.baseSha)}`, 'workflow_runs');
}
function handoffInputs(handoff, artifactId) {
  return { pr_number: String(handoff.identity.prNumber), source_head: handoff.identity.sourceHead,
    base_sha: handoff.identity.baseSha, ready_run_id: String(handoff.producerRunId),
    ready_artifact_id: String(artifactId), ready_receipt_sha256: handoff.payloadSha256 };
}
export async function dispatchReadyReview({ inputs, env = process.env, sourceSha = ownSource(), api, download,
  dispatch, now = () => new Date().toISOString(), wait = waitForObservation }) {
  const parsed = parseReadyReviewInputs(inputs);
  assertReadyReviewSourceContext(env, sourceSha, parsed.baseSha, 'review-ready');
  requireProof(parsed.readyRunId === Number(env.GITHUB_RUN_ID), 'DISPATCH_PRODUCER_MUST_BE_SELF');
  const handoff = await loadReadyReviewHandoff(parsed, { api, download, terminal: false, at: now(), requireDispatchJob: true });
  assertReadyReviewJob(handoff.dispatchJob, handoff.run, 'review-ready', { terminal: false });
  const payload = handoff.artifact.payload, identity = payload.identity;
  const existing = selectReadyReviewRun(await lifecycleRuns(api, identity), identity, { absentAllowed: true });
  // ALREADY_READY, a second comment, a failed prior run, or a rerun never grants
  // another launch for the same PR/head/base. No retry counter or time renewal.
  requireProof(existing === null, 'REVIEW_ALREADY_DISPATCHED_FOR_EXACT_TUPLE');
  await readReadyReviewTarget(api, identity);
  const owner = await api(`/issues/comments/${apiId(payload.authorizationCommentId)}`);
  assertReadyReviewOwner(owner, payload.command, now(), payload.authorizationCommentId, payload.authorizationCommentSha256);
  requireProof(typeof dispatch === 'function', 'FIXED_DISPATCH_UNAVAILABLE');
  await dispatch('/actions/workflows/stephanos-exact-head-review.yml/dispatches', {
    ref: 'main', inputs: handoffInputs(payload, handoff.artifact.metadata.id),
  });
  // A 204 alone does not prove when the run becomes visible. Observe the one
  // accepted run while this job is active. Never POST again or renew the owner
  // window; queued is launch evidence only, not review or merge evidence.
  for (let observation = 1; observation <= DISPATCH_OBSERVATIONS; observation += 1) {
    assertReadyReviewOwner(owner, payload.command, now(), payload.authorizationCommentId, payload.authorizationCommentSha256);
    const selected = selectReadyReviewRun(await lifecycleRuns(api, identity), identity, { absentAllowed: true });
    if (selected) {
      const [run, definition, liveOwner] = await Promise.all([api(`/actions/runs/${apiId(selected.id)}`),
        api('/actions/workflows/stephanos-exact-head-review.yml'), api(`/issues/comments/${apiId(payload.authorizationCommentId)}`)]);
      assertReadyReviewLaunchRun(run, definition, identity, { readyRunId: parsed.readyRunId, handoffSha256: parsed.handoffSha256 });
      requireProof(run.id === selected.id && Date.parse(run.created_at) >= Date.parse(handoff.job.completed_at)
        && Date.parse(run.created_at) >= Date.parse(handoff.dispatchJob.started_at)
        && Date.parse(run.created_at) <= Date.parse(now()), 'LAUNCH_RUN_TIME_OR_ID');
      await readReadyReviewTarget(api, identity);
      requireProof(selectReadyReviewRun(await lifecycleRuns(api, identity), identity)?.id === run.id, 'LAUNCH_RUN_ESTATE_CHANGED');
      assertReadyReviewOwner(liveOwner, payload.command, now(), payload.authorizationCommentId, payload.authorizationCommentSha256);
      return { verdict: 'PROTECTED_READY_REVIEW_DISPATCHED', prNumber: identity.prNumber,
        sourceHead: identity.sourceHead, handoffPayloadSha256: payload.payloadSha256,
        reviewRunId: run.id, launchStatus: run.status };
    }
    if (observation < DISPATCH_OBSERVATIONS) await wait(DISPATCH_OBSERVATION_DELAY_MS);
  }
  throw new Error('PROTECTED_READY_REVIEW_BLOCKED:DISPATCHED_RUN_NOT_OBSERVED');
}

export async function prepareReadyReview({ inputs, env = process.env, sourceSha = ownSource(), api, download,
  now = new Date().toISOString() }) {
  const parsed = parseReadyReviewInputs(inputs);
  assertReadyReviewSourceContext(env, sourceSha, parsed.baseSha, 'exact-head-review');
  const handoff = await loadReadyReviewHandoff(parsed, { api, download, terminal: false, at: now, requireDispatchJob: true });
  const identity = handoff.artifact.payload.identity;
  const [run, definition, jobs, independent, inventory] = await Promise.all([
    api(`/actions/runs/${env.GITHUB_RUN_ID}`), api('/actions/workflows/stephanos-exact-head-review.yml'),
    jobsFor(api, Number(env.GITHUB_RUN_ID)), loadReadyReviewIndependent(handoff.artifact.payload.command, { api, download }),
    lifecycleRuns(api, identity),
  ]);
  requireProof(selectReadyReviewRun(inventory, identity)?.id === run.id && run.id === Number(env.GITHUB_RUN_ID), 'REVIEW_RUN_NOT_UNIQUE');
  assertReadyReviewRun(run, definition, identity, { terminal: false, readyRunId: parsed.readyRunId,
    handoffSha256: parsed.handoffSha256 });
  const job = oneJob(jobs, 'exact-head-review');
  assertReadyReviewJob(job, run, 'exact-head-review', { terminal: false });
  const reviewMode = assertReadyReviewIndependent(independent, handoff.artifact.payload.command);
  requireProof(!handoff.artifact.payload.beforeDraft || reviewMode === 'clean-independent', 'DRAFT_BOOTSTRAP_READY_NOT_AUTHORIZED');
  await readReadyReviewTarget(api, identity);
  return { inputs, sourceSha, startedAt: now, handoff, independent, review: { run, definition, job } };
}
function escalationMatchesReady(comment, receipt, command, input, at) {
  const owner = validateOwnerEscalationCommentV1(comment, input, receipt.patchSha256, Date.parse(at));
  requireProof(owner.reviewRunId === command.independentReviewRunId
    && owner.reviewRunAttempt === command.independentReviewRunAttempt
    && owner.reviewArtifactId === command.independentReviewArtifactId
    && owner.reviewArtifactDigest === command.independentReviewArtifactDigest
    && owner.reviewPayloadSha256 === command.independentReviewPayloadSha256, 'ESCALATION_DIFFERENT_FROM_OWNER_READY_SELECTION');
  return owner;
}
export async function executeReadyReview({ prepared, input, env = process.env, sourceSha = ownSource(), api, download,
  now = () => new Date().toISOString() }) {
  const parsed = parseReadyReviewInputs(prepared.inputs);
  assertReadyReviewSourceContext(env, sourceSha, parsed.baseSha, 'exact-head-review');
  const identity = assertReadyReviewHandoff(prepared.handoff, { terminal: false, at: prepared.startedAt });
  const handoff = prepared.handoff.artifact.payload;
  requireProof(prepared.review.run.id === Number(env.GITHUB_RUN_ID) && prepared.sourceSha === sourceSha
    && exact(parsed, parseReadyReviewInputs(handoffInputs(handoff, prepared.handoff.artifact.metadata.id)))
    && input.repository === identity.repository && input.prNumber === identity.prNumber
    && input.headSha === identity.sourceHead && input.baseSha === identity.baseSha, 'ENGINE_INPUT_BINDING');
  assertReadyReviewRun(prepared.review.run, prepared.review.definition, identity, { terminal: false,
    readyRunId: parsed.readyRunId, handoffSha256: parsed.handoffSha256 });
  assertReadyReviewJob(prepared.review.job, prepared.review.run, 'exact-head-review', { terminal: false });
  const independentReviewMode = assertReadyReviewIndependent(prepared.independent, handoff.command);
  await readReadyReviewTarget(api, identity);
  // Both clean and findings results are created by the unchanged trusted engine
  // over the complete live PR input. The READY record never supplies a verdict.
  const engineReceipt = reviewExactHead(input);
  let qualification = null, escalationComment = null;
  const patchSha256 = sha(input.patch), changedFilesSha256 = sha(JSON.stringify(input.changedFiles));
  if (engineReceipt.verdict !== 'STEPHANOS_REVIEW_PASS' || engineReceipt.findings.length !== 0) {
    qualification = await qualifyExactHeadReviewV1(input, engineReceipt, { api, download,
      unzip: bytes => extractPersonalRepositoryArtifactZip(bytes, INDEPENDENT_REVIEW_ARTIFACT_FILE).toString('utf8'),
      nowMs: Date.parse(now()) });
    escalationComment = await api(`/issues/comments/${apiId(qualification.ownerCommentId)}`);
    escalationMatchesReady(escalationComment, { patchSha256 }, handoff.command, input, now());
    requireProof(qualification.reviewMode === independentReviewMode, 'QUALIFICATION_MODE_CHANGED');
  }
  requireProof(selectReadyReviewRun(await lifecycleRuns(api, identity), identity)?.id === prepared.review.run.id,
    'REVIEW_RUN_ESTATE_CHANGED');
  const owner = await api(`/issues/comments/${apiId(handoff.authorizationCommentId)}`);
  assertReadyReviewOwner(owner, handoff.command, prepared.startedAt, handoff.authorizationCommentId, handoff.authorizationCommentSha256);
  await readReadyReviewTarget(api, identity);
  return sealReadyReviewPayload({ schemaVersion: 'stephanos.protected-ready-review-receipt.v1', identity,
    reviewRunId: prepared.review.run.id, reviewRunAttempt: 1, reviewSourceSha: sourceSha,
    handoffRunId: handoff.producerRunId, handoffArtifactId: prepared.handoff.artifact.metadata.id,
    handoffArtifactDigest: prepared.handoff.artifact.metadata.digest, handoffPayloadSha256: handoff.payloadSha256,
    startedAt: prepared.startedAt, finishedAt: now(), patchSha256, changedFilesSha256, engineReceipt,
    independentReviewMode, qualification, escalationCommentId: escalationComment?.id || 0,
    escalationCommentSha256: escalationComment ? protectedWorkflowAuthorizationCommentSha256(escalationComment) : '' });
}

// The protected collector calls this twice, including its final authority read.
// Base-headed dispatch runs remain separate records; no PR check row is forged.
export async function loadProtectedReadyReviewLifecycle({ identity, skippedRunIds, api, download, selectedReview }) {
  requireProof(Array.isArray(skippedRunIds) && skippedRunIds.length > 0, 'DRAFT_SKIP_NOT_OBSERVED');
  const selected = selectReadyReviewRun(await lifecycleRuns(api, identity), identity, { absentAllowed: true });
  if (selected === null) return null;
  const [run, definition, jobs] = await Promise.all([api(`/actions/runs/${selected.id}`),
    api('/actions/workflows/stephanos-exact-head-review.yml'), jobsFor(api, selected.id)]);
  const artifactId = await uniqueArtifact(api, run.id, readyReviewReceiptName(run.id));
  const artifact = await loadArtifact(api, download, artifactId, READY_REVIEW_RECEIPT_FILE);
  const receipt = artifact.payload;
  assertReadyReviewPayload(receipt);
  requireProof(receipt.escalationCommentId === 0 || (Number.isSafeInteger(receipt.escalationCommentId)
    && receipt.escalationCommentId > 0), 'ESCALATION_COMMENT_ID_INVALID');
  const handoff = await loadReadyReviewHandoff({ prNumber: identity.prNumber, sourceHead: identity.sourceHead,
    baseSha: identity.baseSha, readyRunId: receipt.handoffRunId, readyArtifactId: receipt.handoffArtifactId,
    handoffSha256: receipt.handoffPayloadSha256 }, { api, download });
  const command = handoff.artifact.payload.command;
  if (selectedReview) requireProof(command.independentReviewRunId === selectedReview.independentReviewWorkflowRunId
    && command.independentReviewRunAttempt === selectedReview.independentReviewWorkflowRunAttempt
    && command.independentReviewArtifactId === selectedReview.independentReviewArtifactId
    && command.independentReviewArtifactDigest === selectedReview.independentReviewArtifactDigest
    && command.independentReviewPayloadSha256 === selectedReview.independentReviewPayloadSha256,
  'MERGE_SELECTION_DIFFERS_FROM_OWNER_READY');
  const job = oneJob(jobs, 'exact-head-review');
  const [check, independent, escalationComment] = await Promise.all([api(`/check-runs/${apiId(job.id)}`),
    loadReadyReviewIndependent(command, { api, download }),
    receipt.escalationCommentId ? api(`/issues/comments/${apiId(receipt.escalationCommentId)}`) : null]);
  if (escalationComment) escalationMatchesReady(escalationComment, receipt, command, {
    repository: identity.repository, prNumber: identity.prNumber, headSha: identity.sourceHead, baseSha: identity.baseSha,
  }, receipt.finishedAt);
  const proof = { handoff, review: { run, definition, job, check, artifact }, independent, escalationComment };
  for (const skippedId of skippedRunIds) {
    const validation = validateProtectedReadyReviewLifecycleEvidence(proof, identity, skippedId);
    requireProof(validation.valid, validation.blocker);
  }
  requireProof(selectReadyReviewRun(await lifecycleRuns(api, identity), identity)?.id === run.id, 'FINAL_RUN_ESTATE_CHANGED');
  await readReadyReviewTarget(api, identity);
  return proof;
}

export function readyReviewTransports(env = process.env) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  requireProof(Boolean(token), 'GITHUB_TOKEN_REQUIRED');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'stephanos-protected-ready-review-v1' };
  const api = async path => {
    requireProof(path.startsWith('/') && !path.startsWith('//'), 'API_PATH');
    const response = await fetch(`https://api.github.com${ROOT}${path}`, { redirect: 'error', headers });
    requireProof(response.ok, `API_READ_${response.status}`);
    const raw = await response.text();
    requireProof(Buffer.byteLength(raw) <= 8 * 1024 * 1024, 'API_RESPONSE_TOO_LARGE');
    return JSON.parse(raw);
  };
  const download = id => executePersonalRepositoryArtifactArchiveTransport({ repository: REPO,
    path: `${ROOT}/actions/artifacts/${apiId(id)}/zip`, maxBytes: READY_REVIEW_MAX_BYTES,
    requestApiRedirect: r => fetch(r.url, { method: r.method, body: r.body, redirect: r.redirect,
      headers: { ...r.headers, ...headers } }),
    requestArchive: r => fetch(r.url, { method: r.method, body: r.body, redirect: r.redirect, headers: r.headers }),
  });
  const dispatch = async (path, body) => {
    requireProof(path === '/actions/workflows/stephanos-exact-head-review.yml/dispatches'
      && body.ref === 'main', 'FIXED_DISPATCH_ONLY');
    parseReadyReviewInputs(body.inputs);
    const response = await fetch(`https://api.github.com${ROOT}${path}`, { method: 'POST', redirect: 'error',
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    requireProof(response.status === 204, `DISPATCH_${response.status}`);
  };
  const readThreadsPage = async (prNumber, after) => {
    apiId(prNumber);
    requireProof(prNumber <= 2147483647 && (after === null || (typeof after === 'string'
      && after.length > 0 && after.length <= 1024)), 'REVIEW_THREADS_QUERY_INPUT');
    const response = await fetch('https://api.github.com/graphql', { method: 'POST', redirect: 'error',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: READY_THREADS_QUERY, variables: { number: prNumber, after } }) });
    requireProof(response.ok, `REVIEW_THREADS_API_${response.status}`);
    const raw = await response.text();
    requireProof(Buffer.byteLength(raw) <= READY_REVIEW_MAX_BYTES, 'REVIEW_THREADS_RESPONSE_TOO_LARGE');
    return JSON.parse(raw);
  };
  return { api, download, dispatch, readThreadsPage };
}
async function main() {
  const mode = process.argv[2], transport = readyReviewTransports();
  if (mode === 'dispatch') {
    const inputs = { pr_number: process.env.READY_REVIEW_PR, source_head: process.env.READY_REVIEW_HEAD,
      base_sha: process.env.READY_REVIEW_BASE, ready_run_id: process.env.GITHUB_RUN_ID,
      ready_artifact_id: process.env.READY_REVIEW_ARTIFACT_ID, ready_receipt_sha256: process.env.READY_REVIEW_SHA256 };
    console.log(JSON.stringify(await dispatchReadyReview({ inputs, ...transport })));
  } else if (mode === 'prepare') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    requireProof(event.repository?.full_name === REPO, 'EVENT_REPOSITORY');
    const prepared = await prepareReadyReview({ inputs: event.inputs, ...transport });
    mkdirSync('review-proof', { recursive: true });
    writeJson('review-proof/ready-context.json', prepared);
  } else if (mode === 'review') {
    const prepared = JSON.parse(readFileSync('review-proof/ready-context.json', 'utf8'));
    const input = JSON.parse(readFileSync('review-proof/input.json', 'utf8'));
    const receipt = await executeReadyReview({ prepared, input, ...transport });
    writeJson('review-proof/receipt.json', receipt.engineReceipt);
    writeJson(READY_REVIEW_RECEIPT_FILE, receipt);
    console.log(`PROTECTED_READY_REVIEW=${receipt.engineReceipt.verdict};INDEPENDENT_MODE=${receipt.independentReviewMode}`);
  } else throw new Error('PROTECTED_READY_REVIEW_BLOCKED:UNKNOWN_FIXED_OPERATION');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
