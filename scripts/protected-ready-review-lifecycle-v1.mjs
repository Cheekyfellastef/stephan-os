#!/usr/bin/env node
// Fixed canonical READY -> exact-head review composition. No review, merge or
// bootstrap authority is inferred from a ready flag or a caller's clean boolean.
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as waitForObservation } from 'node:timers/promises';
import { inflateRawSync } from 'node:zlib';
import {
  READY_REVIEW_REPOSITORY as REPO, READY_REVIEW_PATH, READY_REVIEW_NAME,
  READY_REVIEW_PRODUCER_PATH, READY_REVIEW_PRODUCER_NAME,
  READY_REVIEW_HANDOFF_FILE, READY_REVIEW_RECEIPT_FILE, READY_REVIEW_RECOVERY_RECEIPT_FILE, READY_REVIEW_MAX_BYTES,
  readyReviewAssert as requireProof, readyReviewSha256, readyReviewCanonical,
  readyReviewIdentity, readyReviewHandoffName, readyReviewReceiptName, readyReviewRecoveryReceiptName, readyReviewRunName,
  parseReadyReviewInputs, assertReadyReviewNormalizedInputs, assertReadyReviewPayload,
  assertReadyReviewSourceContext, assertReadyReviewRecoverySourceContext, assertReadyReviewTarget, assertReadyReviewRecoveryTarget,
  assertReadyReviewOwner, assertReadyReviewHandoff, assertReadyReviewIndependent,
  assertReadyReviewRun, assertReadyReviewLaunchRun, assertReadyReviewJob, assertReadyReviewArtifact,
  assertReadyReviewFailedRun, assertReadyReviewRecoveryRun, buildReadyReviewRecoveryContinuity,
  buildReadyReviewHandoff, sealReadyReviewPayload, selectReadyReviewRun,
  validateProtectedReadyReviewLifecycleEvidence, validateProtectedReadyReviewRecoveryEvidence,
} from '../shared/agents/protectedReadyReviewLifecycleV1.mjs';
import { protectedWorkflowAuthorizationCommentSha256 } from '../shared/agents/protectedWorkflowDispatchMailboxV1.mjs';
import { INDEPENDENT_REVIEW_ARTIFACT_FILE, validateIndependentReviewArtifactSet } from '../shared/agents/operatorMergeReviewArtifactV1.mjs';
import {
  executePersonalRepositoryArtifactArchiveTransport,
  extractPersonalRepositoryArtifactZip,
} from '../shared/agents/operatorPersonalRepositoryMergeV1.mjs';
import { reviewExactHead } from './exact-head-review.mjs';
import { qualifyExactHeadReviewV1, qualifyProtectedReadyDraftReviewV1, qualifyProtectedReadyRecoveryReviewV1,
  validateOwnerEscalationCommentV1 } from './exact-head-qualified-escalation-v1.mjs';
import { planProtectedReadyExecutionRoute, PROTECTED_READY_EXECUTION_ROUTE } from '../shared/agents/protectedReadyExecutionRouteV1.mjs';

const MAX_PAGES = 6;
const DISPATCH_OBSERVATIONS = 6;
const DISPATCH_OBSERVATION_DELAY_MS = 5000;
const MAX_PATCH_BYTES = 2_000_000;
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
function zipCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function extractReadyReviewDiagnosticZip(bytes) {
  const expected = new Set(['input.json', 'ready-context.json', 'changed-files.txt', 'pull-request.patch']);
  requireProof(Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes.length <= READY_REVIEW_MAX_BYTES,
    'DIAGNOSTIC_ZIP_SIZE');
  const end = bytes.length - 22;
  requireProof(bytes.readUInt32LE(end) === 0x06054b50 && bytes.readUInt16LE(end + 4) === 0
    && bytes.readUInt16LE(end + 6) === 0 && bytes.readUInt16LE(end + 8) === expected.size
    && bytes.readUInt16LE(end + 10) === expected.size && bytes.readUInt16LE(end + 20) === 0,
  'DIAGNOSTIC_ZIP_END');
  const centralSize = bytes.readUInt32LE(end + 12), centralOffset = bytes.readUInt32LE(end + 16);
  requireProof(centralOffset > 0 && centralOffset + centralSize === end, 'DIAGNOSTIC_ZIP_CENTRAL_BOUNDARY');
  const files = new Map(), ranges = [];
  let cursor = centralOffset;
  for (let index = 0; index < expected.size; index += 1) {
    requireProof(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50, 'DIAGNOSTIC_ZIP_CENTRAL');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16), compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42), recordEnd = cursor + 46 + nameLength + extraLength + commentLength;
    requireProof((flags & ~0x0808) === 0 && [0, 8].includes(method) && uncompressedSize <= MAX_PATCH_BYTES
      && compressedSize <= READY_REVIEW_MAX_BYTES && nameLength > 0 && recordEnd <= end,
    'DIAGNOSTIC_ZIP_CENTRAL_FIELDS');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength), name = nameBytes.toString('utf8');
    requireProof(Buffer.from(name, 'utf8').equals(nameBytes) && expected.has(name) && !files.has(name),
      'DIAGNOSTIC_ZIP_NAME');
    requireProof(localOffset + 30 <= centralOffset && bytes.readUInt32LE(localOffset) === 0x04034b50,
      'DIAGNOSTIC_ZIP_LOCAL');
    const localFlags = bytes.readUInt16LE(localOffset + 6), localMethod = bytes.readUInt16LE(localOffset + 8);
    const localNameLength = bytes.readUInt16LE(localOffset + 26), localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength, dataEnd = dataOffset + compressedSize;
    requireProof(localFlags === flags && localMethod === method && localName.equals(nameBytes)
      && dataEnd <= centralOffset && !ranges.some(([from, to]) => localOffset < to && dataEnd > from),
    'DIAGNOSTIC_ZIP_LOCAL_FIELDS');
    if ((flags & 0x0008) === 0) requireProof(bytes.readUInt32LE(localOffset + 14) === crc
      && bytes.readUInt32LE(localOffset + 18) === compressedSize
      && bytes.readUInt32LE(localOffset + 22) === uncompressedSize, 'DIAGNOSTIC_ZIP_LOCAL_METADATA');
    const compressed = bytes.subarray(dataOffset, dataEnd);
    let payload;
    try { payload = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_PATCH_BYTES }); }
    catch { requireProof(false, 'DIAGNOSTIC_ZIP_DECOMPRESSION'); }
    requireProof(payload.length === uncompressedSize && zipCrc32(payload) === crc, 'DIAGNOSTIC_ZIP_PAYLOAD');
    files.set(name, payload); ranges.push([localOffset, dataEnd]); cursor = recordEnd;
  }
  requireProof(cursor === end && files.size === expected.size && [...expected].every(name => files.has(name)),
    'DIAGNOSTIC_ZIP_SET');
  return files;
}
async function loadReadyReviewDiagnostic(api, download, artifactId, run, identity) {
  const metadata = await api(`/actions/artifacts/${apiId(artifactId)}`);
  requireProof(metadata?.id === artifactId && metadata.name === `exact-head-review-${identity.prNumber}-${identity.sourceHead}`
    && metadata.expired === false && metadata.workflow_run?.id === run.id
    && Number.isSafeInteger(metadata.size_in_bytes) && metadata.size_in_bytes > 0
    && metadata.size_in_bytes <= READY_REVIEW_MAX_BYTES && /^sha256:[a-f0-9]{64}$/.test(metadata.digest || ''),
  'DIAGNOSTIC_ARTIFACT_METADATA');
  const bytes = await download(artifactId);
  requireProof(Buffer.isBuffer(bytes) && bytes.length === metadata.size_in_bytes
    && `sha256:${sha(bytes)}` === metadata.digest, 'DIAGNOSTIC_ARTIFACT_ARCHIVE');
  const files = extractReadyReviewDiagnosticZip(bytes);
  const read = file => files.get(file).toString('utf8');
  const input = JSON.parse(read('input.json'));
  const readyContext = JSON.parse(read('ready-context.json'));
  const changedFilesText = read('changed-files.txt');
  const patch = read('pull-request.patch');
  assertReadyReviewInput(input, identity);
  requireProof(changedFilesText === `${input.changedFiles.join('\n')}\n` && patch === input.patch,
    'DIAGNOSTIC_INPUT_FILES_CHANGED');
  return { metadata, archiveSha256: sha(bytes), input, readyContext, changedFilesText, patch };
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

// Count the whole live file estate and bind both ends of its full diff read.
// A partial page or a draft transition cannot become reviewed source input.
function assertReadyReviewPatchEstate(patch, files) {
  let output;
  try {
    // --numstat disables application. Git parses the unchanged stdin patch,
    // including every hunk count; no path argument, shell or write is allowed.
    output = execFileSync('git', ['apply', '--numstat', '-z', '--'], {
      input: patch, shell: false, timeout: 10_000, maxBuffer: MAX_PATCH_BYTES,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { requireProof(false, 'PREFLIGHT_PATCH_STRUCTURE'); }
  const stats = new TextDecoder('utf-8', { fatal: true }).decode(output);
  requireProof(stats.endsWith('\0'), 'PREFLIGHT_PATCH_FILE_ESTATE');
  const records = stats.slice(0, -1).split('\0');
  requireProof(records.length === files.length, 'PREFLIGHT_PATCH_FILE_ESTATE');
  const expected = new Map(files.map(file => [file.filename, file])), seen = new Set();
  for (const record of records) {
    const match = record.match(/^(0|[1-9][0-9]*|-)\t(0|[1-9][0-9]*|-)\t([^\0]+)$/);
    requireProof(match && expected.has(match[3]) && !seen.has(match[3]), 'PREFLIGHT_PATCH_FILE_ESTATE');
    const file = expected.get(match[3]);
    const binary = match[1] === '-' && match[2] === '-';
    requireProof(binary ? file.additions === 0 && file.deletions === 0
      : match[1] !== '-' && match[2] !== '-'
        && Number(match[1]) === file.additions && Number(match[2]) === file.deletions,
    'PREFLIGHT_PATCH_FILE_STATS');
    seen.add(match[3]);
  }
}

export async function readReadyReviewInput(identity, { api, readPatch, expectedDraft } = {}) {
  requireProof(typeof readPatch === 'function' && typeof expectedDraft === 'boolean', 'PREFLIGHT_INPUT_TRANSPORT');
  const before = await readReadyReviewTarget(api, identity, { allowDraft: expectedDraft });
  const count = before.pull.changed_files;
  requireProof(before.pull.draft === expectedDraft && Number.isSafeInteger(count)
    && count > 0 && count <= MAX_PAGES * 100, 'PREFLIGHT_FILE_ESTATE_UNPROVEN');
  const changedFiles = [], files = [], seen = new Set();
  for (let page = 1; changedFiles.length < count; page += 1) {
    const rows = await api(`/pulls/${apiId(identity.prNumber)}/files?per_page=100&page=${page}`);
    requireProof(Array.isArray(rows) && rows.length === Math.min(100, count - changedFiles.length),
      'PREFLIGHT_FILES_INCOMPLETE');
    for (const row of rows) {
      requireProof(typeof row?.filename === 'string' && row.filename.length > 0 && row.filename.length <= 1024
        && !/[\u0000\r\n]/.test(row.filename) && !seen.has(row.filename), 'PREFLIGHT_FILE_INVALID_OR_DUPLICATE');
      requireProof(Number.isSafeInteger(row.additions) && row.additions >= 0
        && Number.isSafeInteger(row.deletions) && row.deletions >= 0, 'PREFLIGHT_FILE_STATS_UNPROVEN');
      seen.add(row.filename); changedFiles.push(row.filename); files.push(row);
    }
  }
  const patch = await readPatch(identity.prNumber);
  const input = assertReadyReviewInput({ repository: REPO, prNumber: identity.prNumber,
    headSha: identity.sourceHead, baseSha: identity.baseSha, changedFiles, patch }, identity);
  assertReadyReviewPatchEstate(patch, files);
  const after = await readReadyReviewTarget(api, identity, { allowDraft: expectedDraft });
  requireProof(after.pull.draft === expectedDraft && after.pull.changed_files === count, 'PREFLIGHT_FILE_ESTATE_CHANGED');
  return input;
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

function assertReadyReviewInput(input, identity) {
  requireProof(input?.repository === identity.repository && input.prNumber === identity.prNumber
    && input.headSha === identity.sourceHead && input.baseSha === identity.baseSha
    && Array.isArray(input.changedFiles) && input.changedFiles.length > 0
    && input.changedFiles.length <= MAX_PAGES * 100
    && input.changedFiles.every(path => typeof path === 'string' && path.length > 0 && path.length <= 1024)
    && new Set(input.changedFiles).size === input.changedFiles.length
    && typeof input.patch === 'string' && input.patch.startsWith('diff --git ')
    && Buffer.byteLength(input.patch) <= MAX_PATCH_BYTES, 'PREFLIGHT_ENGINE_INPUT_BINDING');
  return input;
}

async function qualifyReadyReviewReceipt(input, engineReceipt, command, independentReviewMode,
  { api, download, now, allowDraft = false, recoveryCurrentMainSha = '', recoveryLiveBaseSha = '' }) {
  let qualification = null, escalationComment = null;
  if (engineReceipt.verdict !== 'STEPHANOS_REVIEW_PASS' || engineReceipt.findings.length !== 0) {
    const qualify = recoveryCurrentMainSha ? qualifyProtectedReadyRecoveryReviewV1
      : allowDraft ? qualifyProtectedReadyDraftReviewV1 : qualifyExactHeadReviewV1;
    qualification = await qualify(input, engineReceipt, { api, download,
      unzip: bytes => extractPersonalRepositoryArtifactZip(bytes, INDEPENDENT_REVIEW_ARTIFACT_FILE).toString('utf8'),
      nowMs: Date.parse(now), currentMainSha: recoveryCurrentMainSha, liveBaseSha: recoveryLiveBaseSha });
    escalationComment = await api(`/issues/comments/${apiId(qualification.ownerCommentId)}`);
    escalationMatchesReady(escalationComment, { patchSha256: sha(input.patch) }, command, input, now);
    requireProof(qualification.reviewMode === independentReviewMode, 'QUALIFICATION_MODE_CHANGED');
  }
  return { qualification, escalationComment };
}

async function preflightReadyReviewExactHead({ command, independent, expectedDraft, api, download, readExactHeadInput,
  now = () => new Date().toISOString() }) {
  const identity = readyReviewIdentity(command);
  const mode = assertReadyReviewIndependent(independent, command);
  requireProof(expectedDraft === false || mode === 'clean-independent', 'DRAFT_BOOTSTRAP_READY_NOT_AUTHORIZED');
  requireProof(typeof readExactHeadInput === 'function', 'PREFLIGHT_ENGINE_INPUT_READER_UNAVAILABLE');
  const input = assertReadyReviewInput(await readExactHeadInput(identity, { expectedDraft }), identity);
  const engineReceipt = reviewExactHead(input);
  const qualification = await qualifyReadyReviewReceipt(input, engineReceipt, command, mode,
    { api, download, now: now(), allowDraft: expectedDraft });
  const final = await readReadyReviewTarget(api, identity, { allowDraft: expectedDraft });
  requireProof(final.pull.draft === expectedDraft && final.pull.changed_files === input.changedFiles.length,
    'PREFLIGHT_FILE_ESTATE_CHANGED');
  return { input, engineReceipt, ...qualification };
}

// This happens before the new route mutates draft state. A legacy READY packet
// without a full review selection keeps its old behavior and never gets a proof.
export async function prepareReadyReviewProducer({ command, comment, env = process.env,
  sourceSha = ownSource(), api, download, readThreadsPage, readExactHeadInput,
  now = () => new Date().toISOString() }) {
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
  const preflight = await preflightReadyReviewExactHead({ command, independent,
    expectedDraft: state.pull.draft, api, download, readExactHeadInput, now });
  const { input, engineReceipt } = preflight;
  // Read the immutable owner before the final complete thread inventory. The
  // synchronous check below still expires that same owner window after it.
  const finalOwner = await api(`/issues/comments/${apiId(comment.id)}`);
  const unresolvedReviewThreads = state.pull.draft
    ? await readReadyReviewUnresolvedThreads(readThreadsPage, identity) : null;
  const route = planProtectedReadyExecutionRoute({ repository: identity.repository, prNumber: identity.prNumber,
    branch: identity.branch, head: identity.sourceHead, headTree: identity.sourceTree, base: identity.baseSha,
    alreadyReady: state.pull.draft === false, readyTransitionAuthorized: true, exactHeadReviewClean: mode === 'clean-independent',
    unresolvedReviewThreads, protectedMailboxAvailable: true });
  requireProof(route.route === (state.pull.draft ? PROTECTED_READY_EXECUTION_ROUTE.PROTECTED_MAILBOX
    : PROTECTED_READY_EXECUTION_ROUTE.ALREADY_READY), route.blocker || 'READY_ROUTE_NOT_AUTHORIZED');
  assertReadyReviewOwner(finalOwner, command, now(),
    comment.id, protectedWorkflowAuthorizationCommentSha256(comment));
  return { command, comment: liveComment, run, definition, sourceSha, beforeDraft: state.pull.draft,
    unresolvedReviewThreads, preflight: { patchSha256: sha(input.patch),
      changedFilesSha256: sha(JSON.stringify(input.changedFiles)), engineReceipt,
      qualification: preflight.qualification, escalationCommentId: preflight.escalationComment?.id || 0 } };
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
async function recoveryRuns(api, currentMainSha) {
  return readReadyReviewCollection(api,
    `/actions/workflows/stephanos-exact-head-review.yml/runs?event=issue_comment&head_sha=${apiSha(currentMainSha)}`, 'workflow_runs');
}
function selectReadyReviewRecoveryRun(runs, identity, currentMainSha, expectedRunId = 0) {
  requireProof(Array.isArray(runs), 'RECOVERY_RUN_INVENTORY');
  const pattern = /^protected-ready-review-recovery-pr-([1-9][0-9]*)-comment-([1-9][0-9]*)-source-([a-f0-9]{40})$/;
  const seen = new Set(), matches = [];
  for (const run of runs) {
    requireProof(Number.isSafeInteger(run?.id) && run.id > 0 && !seen.has(run.id), 'RECOVERY_RUN_INVENTORY_AMBIGUOUS');
    seen.add(run.id);
    const match = String(run?.display_title || '').match(pattern);
    if (match && Number(match[1]) === identity.prNumber && match[3] === currentMainSha) matches.push(run);
  }
  requireProof(matches.length === 1 && (!expectedRunId || matches[0].id === expectedRunId), 'RECOVERY_RUN_NOT_UNIQUE');
  return { run: matches[0], commentId: Number(String(matches[0].display_title).match(pattern)[2]) };
}

async function readReadyReviewRecoveryTarget(api, identity, currentMainSha) {
  const [pull, main, commit] = await Promise.all([api(`/pulls/${apiId(identity.prNumber)}`),
    api('/git/ref/heads/main'), api(`/git/commits/${apiSha(identity.sourceHead)}`)]);
  const state = { pull, main, commit };
  assertReadyReviewRecoveryTarget(state, identity, currentMainSha);
  return state;
}
function handoffInputs(handoff, artifactId) {
  return { pr_number: String(handoff.identity.prNumber), source_head: handoff.identity.sourceHead,
    base_sha: handoff.identity.baseSha, ready_run_id: String(handoff.producerRunId),
    ready_artifact_id: String(artifactId), ready_receipt_sha256: handoff.payloadSha256 };
}
export async function dispatchReadyReview({ inputs, env = process.env, sourceSha = ownSource(), api, download,
  dispatch, readExactHeadInput, now = () => new Date().toISOString(), wait = waitForObservation }) {
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
  const independent = await loadReadyReviewIndependent(payload.command, { api, download });
  await preflightReadyReviewExactHead({ command: payload.command, independent, expectedDraft: false,
    api, download, readExactHeadInput, now });
  requireProof(selectReadyReviewRun(await lifecycleRuns(api, identity), identity, { absentAllowed: true }) === null,
    'REVIEW_ALREADY_DISPATCHED_FOR_EXACT_TUPLE');
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
  const patchSha256 = sha(input.patch), changedFilesSha256 = sha(JSON.stringify(input.changedFiles));
  const { qualification, escalationComment } = await qualifyReadyReviewReceipt(input, engineReceipt,
    handoff.command, independentReviewMode, { api, download, now: now() });
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

function recoveryEscalationIntent(comment, repository, prNumber) {
  requireProof(comment?.user?.login === 'Cheekyfellastef' && comment.user.id === 267490109
    && comment.author_association === 'OWNER' && comment.issue_url === `https://api.github.com/repos/${repository}/issues/${prNumber}`
    && comment.created_at === comment.updated_at, 'RECOVERY_OWNER_COMMENT_PROVENANCE');
  const match = String(comment.body || '').replace(/\r\n/g, '\n')
    .match(/^```stephanos-exact-head-qualified-review-v1\n([\s\S]{1,5000}?)\n```(?:\n|$)/);
  requireProof(match, 'RECOVERY_ESCALATION_PACKET');
  let packet;
  try { packet = JSON.parse(match[1]); } catch { requireProof(false, 'RECOVERY_ESCALATION_JSON'); }
  requireProof(packet?.schemaVersion === 'stephanos.exact-head-qualified-escalation.v1'
    && packet.operation === 'AUTHORIZE_EXACT_HEAD_REVIEW_ESCALATION' && packet.repository === repository
    && packet.prNumber === prNumber && packet.scope === 'exact-head-review-only'
    && /^[a-f0-9]{40}$/.test(packet.expectedHead || '') && /^[a-f0-9]{40}$/.test(packet.expectedBase || '')
    && /^[a-f0-9]{64}$/.test(packet.patchSha256 || ''), 'RECOVERY_ESCALATION_IDENTITY');
  return packet;
}

export async function prepareReadyReviewRecovery({ comment, env = process.env, sourceSha = ownSource(), api, download,
  now = new Date().toISOString() }) {
  assertReadyReviewRecoverySourceContext(env, sourceSha);
  apiId(comment?.id);
  const prNumber = Number(String(comment.issue_url || '').match(/\/issues\/([1-9][0-9]*)$/)?.[1] || 0);
  apiId(prNumber);
  const intent = recoveryEscalationIntent(comment, REPO, prNumber);
  const lookupIdentity = { repository: REPO, prNumber, sourceHead: intent.expectedHead, baseSha: intent.expectedBase };
  const oldInventory = await lifecycleRuns(api, lookupIdentity);
  const failedCandidate = selectReadyReviewRun(oldInventory, lookupIdentity, { absentAllowed: true });
  if (failedCandidate === null) return null;
  const [failedRun, definition, failedJobs, failedArtifacts] = await Promise.all([
    api(`/actions/runs/${apiId(failedCandidate.id)}`), api('/actions/workflows/stephanos-exact-head-review.yml'),
    jobsFor(api, failedCandidate.id), readReadyReviewCollection(api, `/actions/runs/${apiId(failedCandidate.id)}/artifacts`, 'artifacts'),
  ]);
  const diagnosticName = `exact-head-review-${prNumber}-${intent.expectedHead}`;
  const diagnosticArtifacts = failedArtifacts.filter(artifact => artifact.name === diagnosticName);
  const lifecycleArtifacts = failedArtifacts.filter(artifact => artifact.name === readyReviewReceiptName(failedRun.id));
  requireProof(failedArtifacts.length === 1 && diagnosticArtifacts.length === 1 && lifecycleArtifacts.length === 0,
    'RECOVERY_FAILED_ARTIFACT_SET');
  const diagnostic = await loadReadyReviewDiagnostic(api, download, diagnosticArtifacts[0].id, failedRun, lookupIdentity);
  const parsed = parseReadyReviewInputs(diagnostic.readyContext?.inputs);
  requireProof(parsed.prNumber === prNumber && parsed.sourceHead === intent.expectedHead
    && parsed.baseSha === intent.expectedBase && diagnostic.readyContext?.review?.run?.id === failedRun.id,
  'RECOVERY_DIAGNOSTIC_CONTEXT');
  const handoff = await loadReadyReviewHandoff(parsed, { api, download });
  const identity = assertReadyReviewHandoff(handoff);
  const failedJob = oneJob(failedJobs, 'exact-head-review');
  assertReadyReviewFailedRun(failedRun, definition, identity, handoff.artifact.payload, failedJob);
  const liveComment = await api(`/issues/comments/${apiId(comment.id)}`);
  requireProof(protectedWorkflowAuthorizationCommentSha256(liveComment) === protectedWorkflowAuthorizationCommentSha256(comment),
    'RECOVERY_TRIGGER_COMMENT_CHANGED');
  const owner = escalationMatchesReady(liveComment, { patchSha256: sha(diagnostic.input.patch) },
    handoff.artifact.payload.command, diagnostic.input, now);
  requireProof(owner.commentId === comment.id, 'RECOVERY_TRIGGER_COMMENT_ID');
  const [currentRun, currentJobs, independent, compare, correctionCommit] = await Promise.all([
    api(`/actions/runs/${apiId(Number(env.GITHUB_RUN_ID))}`), jobsFor(api, Number(env.GITHUB_RUN_ID)),
    loadReadyReviewIndependent(handoff.artifact.payload.command, { api, download }),
    api(`/compare/${apiSha(identity.baseSha)}...${apiSha(sourceSha)}`),
    api(`/commits/${apiSha(sourceSha)}`),
  ]);
  const currentJob = oneJob(currentJobs, 'exact-head-review');
  assertReadyReviewRecoveryRun(currentRun, definition, identity, { commentId: comment.id, sourceSha, terminal: false });
  assertReadyReviewJob(currentJob, currentRun, 'exact-head-review', { terminal: false });
  selectReadyReviewRecoveryRun(await recoveryRuns(api, sourceSha), identity, sourceSha, currentRun.id);
  const continuity = buildReadyReviewRecoveryContinuity(compare, correctionCommit, identity, sourceSha,
    diagnostic.input.changedFiles);
  const independentReviewMode = assertReadyReviewIndependent(independent, handoff.artifact.payload.command);
  const engineReceipt = reviewExactHead(diagnostic.input);
  requireProof(engineReceipt.verdict === 'STEPHANOS_REVIEW_FINDINGS' && engineReceipt.findings.length > 0
    && engineReceipt.findings.every(finding => finding.severity === 'P2'
      && ['AUTHORITY_SURFACE_CHANGED', 'DYNAMIC_EXECUTION'].includes(finding.code)), 'RECOVERY_ENGINE_NOT_QUALIFIABLE');
  const targetState = await readReadyReviewRecoveryTarget(api, identity, sourceSha);
  const target = { currentMainSha: sourceSha, prBaseSha: targetState.pull.base.sha,
    sourceHead: identity.sourceHead, sourceTree: identity.sourceTree, mergeable: true };
  return { sourceSha, startedAt: now, comment: liveComment, identity, handoff, independent, continuity,
    failedReview: { run: failedRun, definition, job: failedJob, lifecycleArtifacts, diagnosticArtifacts, diagnostic },
    recovery: { run: currentRun, definition, job: currentJob }, independentReviewMode, target };
}

export async function executeReadyReviewRecovery({ prepared, env = process.env, sourceSha = ownSource(), api, download,
  now = () => new Date().toISOString() }) {
  assertReadyReviewRecoverySourceContext(env, sourceSha);
  requireProof(prepared.sourceSha === sourceSha && prepared.recovery.run.id === Number(env.GITHUB_RUN_ID),
    'RECOVERY_EXECUTION_SOURCE');
  const identity = assertReadyReviewHandoff(prepared.handoff);
  assertReadyReviewFailedRun(prepared.failedReview.run, prepared.failedReview.definition, identity,
    prepared.handoff.artifact.payload, prepared.failedReview.job);
  assertReadyReviewRecoveryRun(prepared.recovery.run, prepared.recovery.definition, identity,
    { commentId: prepared.comment.id, sourceSha, terminal: false });
  assertReadyReviewJob(prepared.recovery.job, prepared.recovery.run, 'exact-head-review', { terminal: false });
  const input = assertReadyReviewInput(prepared.failedReview.diagnostic.input, identity);
  const targetState = await readReadyReviewRecoveryTarget(api, identity, sourceSha);
  const target = { currentMainSha: sourceSha, prBaseSha: targetState.pull.base.sha,
    sourceHead: identity.sourceHead, sourceTree: identity.sourceTree, mergeable: true };
  requireProof(exact(target, prepared.target), 'RECOVERY_TARGET_CHANGED');
  const [liveCompare, liveCorrectionCommit] = await Promise.all([
    api(`/compare/${apiSha(identity.baseSha)}...${apiSha(sourceSha)}`), api(`/commits/${apiSha(sourceSha)}`),
  ]);
  const liveContinuity = buildReadyReviewRecoveryContinuity(liveCompare, liveCorrectionCommit,
    identity, sourceSha, input.changedFiles);
  requireProof(exact(liveContinuity, prepared.continuity), 'RECOVERY_CONTINUITY_CHANGED');
  const engineReceipt = reviewExactHead(input);
  requireProof(engineReceipt.verdict === 'STEPHANOS_REVIEW_FINDINGS' && engineReceipt.findings.length > 0
    && engineReceipt.findings.every(finding => finding.severity === 'P2'
      && ['AUTHORITY_SURFACE_CHANGED', 'DYNAMIC_EXECUTION'].includes(finding.code)), 'RECOVERY_ENGINE_NOT_QUALIFIABLE');
  const independentReviewMode = assertReadyReviewIndependent(prepared.independent, prepared.handoff.artifact.payload.command);
  const { qualification, escalationComment } = await qualifyReadyReviewReceipt(input, engineReceipt,
    prepared.handoff.artifact.payload.command, independentReviewMode, { api, download, now: now(),
      recoveryCurrentMainSha: sourceSha, recoveryLiveBaseSha: target.prBaseSha });
  requireProof(escalationComment?.id === prepared.comment.id
    && protectedWorkflowAuthorizationCommentSha256(escalationComment) === protectedWorkflowAuthorizationCommentSha256(prepared.comment),
  'RECOVERY_ESCALATION_NOT_TRIGGER');
  selectReadyReviewRecoveryRun(await recoveryRuns(api, sourceSha), identity, sourceSha, prepared.recovery.run.id);
  const finalTargetState = await readReadyReviewRecoveryTarget(api, identity, sourceSha);
  requireProof(exact(target, { currentMainSha: sourceSha, prBaseSha: finalTargetState.pull.base.sha,
    sourceHead: identity.sourceHead, sourceTree: identity.sourceTree, mergeable: true }), 'FINAL_RECOVERY_TARGET_CHANGED');
  const diagnostic = prepared.failedReview.diagnostic;
  return sealReadyReviewPayload({ schemaVersion: 'stephanos.protected-ready-review-recovery-receipt.v1', identity,
    recoveryRunId: prepared.recovery.run.id, recoveryRunAttempt: 1, recoverySourceSha: sourceSha,
    failedReviewRunId: prepared.failedReview.run.id, failedReviewRunAttempt: 1,
    failedDiagnosticArtifactId: diagnostic.metadata.id, failedDiagnosticArtifactDigest: diagnostic.metadata.digest,
    failedDiagnosticArchiveSha256: diagnostic.archiveSha256, handoffRunId: prepared.handoff.artifact.payload.producerRunId,
    handoffArtifactId: prepared.handoff.artifact.metadata.id, handoffArtifactDigest: prepared.handoff.artifact.metadata.digest,
    handoffPayloadSha256: prepared.handoff.artifact.payload.payloadSha256, startedAt: prepared.startedAt, finishedAt: now(),
    patchSha256: sha(input.patch), changedFilesSha256: sha(JSON.stringify(input.changedFiles)), target, continuity: prepared.continuity,
    engineReceipt, independentReviewMode, qualification, escalationCommentId: escalationComment.id,
    escalationCommentSha256: protectedWorkflowAuthorizationCommentSha256(escalationComment) });
}

// The protected collector calls this twice, including its final authority read.
// Base-headed dispatch runs remain separate records; no PR check row is forged.
export async function loadProtectedReadyReviewLifecycle({ identity, skippedRunIds, api, download, selectedReview }) {
  requireProof(Array.isArray(skippedRunIds) && skippedRunIds.length > 0, 'DRAFT_SKIP_NOT_OBSERVED');
  const selected = selectReadyReviewRun(await lifecycleRuns(api, identity), identity, { absentAllowed: true });
  if (selected === null) {
    const recoveryInventory = await recoveryRuns(api, identity.baseSha);
    const matching = recoveryInventory.filter(run => String(run?.display_title || '')
      .startsWith(`protected-ready-review-recovery-pr-${identity.prNumber}-`));
    if (matching.length === 0) return null;
    const selectedRecovery = selectReadyReviewRecoveryRun(recoveryInventory, identity, identity.baseSha);
    const [run, definition, jobs] = await Promise.all([api(`/actions/runs/${selectedRecovery.run.id}`),
      api('/actions/workflows/stephanos-exact-head-review.yml'), jobsFor(api, selectedRecovery.run.id)]);
    const artifactId = await uniqueArtifact(api, run.id, readyReviewRecoveryReceiptName(run.id));
    const artifact = await loadArtifact(api, download, artifactId, READY_REVIEW_RECOVERY_RECEIPT_FILE);
    const receipt = artifact.payload;
    assertReadyReviewPayload(receipt);
    const handoff = await loadReadyReviewHandoff({ prNumber: receipt.identity.prNumber,
      sourceHead: receipt.identity.sourceHead, baseSha: receipt.identity.baseSha,
      readyRunId: receipt.handoffRunId, readyArtifactId: receipt.handoffArtifactId,
      handoffSha256: receipt.handoffPayloadSha256 }, { api, download });
    const command = handoff.artifact.payload.command;
    // Recovery authenticates the immutable historical selection carried by the
    // original READY handoff. The protected merge collector separately proves
    // its current-base selection before and after check convergence; equating
    // those two review identities would make every legitimate recovery stale.
    const failedRunId = apiId(receipt.failedReviewRunId);
    const [failedRun, failedJobs, failedArtifacts, check, independent, escalationComment] = await Promise.all([
      api(`/actions/runs/${failedRunId}`), jobsFor(api, failedRunId),
      readReadyReviewCollection(api, `/actions/runs/${failedRunId}/artifacts`, 'artifacts'),
      api(`/check-runs/${apiId(oneJob(jobs, 'exact-head-review').id)}`),
      loadReadyReviewIndependent(command, { api, download }), api(`/issues/comments/${apiId(receipt.escalationCommentId)}`),
    ]);
    const diagnosticName = `exact-head-review-${receipt.identity.prNumber}-${receipt.identity.sourceHead}`;
    const diagnosticArtifacts = failedArtifacts.filter(value => value.name === diagnosticName);
    const lifecycleArtifacts = failedArtifacts.filter(value => value.name === readyReviewReceiptName(failedRunId));
    requireProof(failedArtifacts.length === 1 && diagnosticArtifacts.length === 1 && lifecycleArtifacts.length === 0,
      'RECOVERY_FAILED_ARTIFACT_SET');
    const diagnostic = await loadReadyReviewDiagnostic(api, download, diagnosticArtifacts[0].id, failedRun, receipt.identity);
    const failedJob = oneJob(failedJobs, 'exact-head-review');
    const recoveryJob = oneJob(jobs, 'exact-head-review');
    escalationMatchesReady(escalationComment, receipt, command, diagnostic.input, receipt.finishedAt);
    const proof = { handoff, failedReview: { run: failedRun, definition, job: failedJob,
      lifecycleArtifacts, diagnosticArtifacts, diagnostic }, recovery: { run, definition, job: recoveryJob, check, artifact },
    independent, escalationComment };
    for (const skippedId of skippedRunIds) {
      const validation = validateProtectedReadyReviewRecoveryEvidence(proof, identity, skippedId);
      requireProof(validation.valid, validation.blocker);
    }
    const [compare, correctionCommit] = await Promise.all([
      api(`/compare/${apiSha(receipt.identity.baseSha)}...${apiSha(identity.baseSha)}`),
      api(`/commits/${apiSha(identity.baseSha)}`),
    ]);
    requireProof(exact(buildReadyReviewRecoveryContinuity(compare, correctionCommit, receipt.identity,
      identity.baseSha, diagnostic.input.changedFiles), receipt.continuity), 'FINAL_RECOVERY_CONTINUITY_CHANGED');
    selectReadyReviewRecoveryRun(await recoveryRuns(api, identity.baseSha), identity, identity.baseSha, run.id);
    await readReadyReviewRecoveryTarget(api, receipt.identity, identity.baseSha);
    return proof;
  }
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
  if (selectedReview) requireProof(command.independentReviewRunId === (selectedReview.workflowRunId
      ?? selectedReview.independentReviewWorkflowRunId)
    && command.independentReviewRunAttempt === (selectedReview.workflowRunAttempt
      ?? selectedReview.independentReviewWorkflowRunAttempt)
    && command.independentReviewArtifactId === (selectedReview.artifactId
      ?? selectedReview.independentReviewArtifactId)
    && command.independentReviewArtifactDigest === (selectedReview.artifactDigest
      ?? selectedReview.independentReviewArtifactDigest)
    && command.independentReviewPayloadSha256 === (selectedReview.payloadSha256
      ?? selectedReview.independentReviewPayloadSha256),
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
  const readPatch = async prNumber => {
    const response = await fetch(`https://api.github.com${ROOT}/pulls/${apiId(prNumber)}`, {
      method: 'GET', redirect: 'error',
      headers: { ...headers, Accept: 'application/vnd.github.v3.diff', 'Accept-Encoding': 'identity' },
      signal: AbortSignal.timeout(30_000),
    });
    requireProof(response.status === 200 && response.headers?.get?.('content-range') === null,
      'PREFLIGHT_PATCH_RESPONSE_NOT_COMPLETE');
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    requireProof(['application/vnd.github.diff', 'application/vnd.github.v3.diff'].includes(mediaType),
      'PREFLIGHT_PATCH_MEDIA_TYPE');
    const encoding = response.headers.get('content-encoding');
    requireProof(encoding === null || encoding.trim().toLowerCase() === 'identity', 'PREFLIGHT_PATCH_CONTENT_ENCODING');
    const length = response.headers.get('content-length');
    requireProof(length === null || (/^(?:0|[1-9][0-9]*)$/.test(length)
      && Number.isSafeInteger(Number(length)) && Number(length) <= MAX_PATCH_BYTES), 'PREFLIGHT_PATCH_LENGTH');
    requireProof(typeof response.body?.[Symbol.asyncIterator] === 'function', 'PREFLIGHT_PATCH_STREAM_UNAVAILABLE');
    const chunks = []; let size = 0;
    // Retain only bounded bytes, require normal EOF, and bind any declared wire
    // length to identity encoding. The fetch deadline also aborts body reads.
    for await (const chunk of response.body) {
      requireProof(chunk instanceof Uint8Array, 'PREFLIGHT_PATCH_STREAM_INVALID');
      size += chunk.byteLength;
      requireProof(size <= MAX_PATCH_BYTES, 'PREFLIGHT_PATCH_TOO_LARGE');
      chunks.push(chunk);
    }
    requireProof(length === null || size === Number(length), 'PREFLIGHT_PATCH_LENGTH');
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
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
  const readExactHeadInput = (identity, { expectedDraft } = {}) =>
    readReadyReviewInput(identity, { api, readPatch, expectedDraft });
  return { api, download, dispatch, readThreadsPage, readExactHeadInput, readPatch };
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
  } else if (mode === 'recovery-prepare') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    requireProof(event.repository?.full_name === REPO && event.issue?.pull_request, 'RECOVERY_EVENT');
    const prepared = await prepareReadyReviewRecovery({ comment: event.comment, ...transport });
    output({ ready_recovery: prepared ? 'true' : 'false' });
    if (prepared) {
      mkdirSync('review-proof', { recursive: true });
      writeJson('review-proof/ready-recovery-context.json', prepared);
      writeJson('review-proof/input.json', prepared.failedReview.diagnostic.input);
    }
  } else if (mode === 'recovery-review') {
    const prepared = JSON.parse(readFileSync('review-proof/ready-recovery-context.json', 'utf8'));
    const receipt = await executeReadyReviewRecovery({ prepared, ...transport });
    writeJson('review-proof/receipt.json', receipt.engineReceipt);
    writeJson(READY_REVIEW_RECOVERY_RECEIPT_FILE, receipt);
    console.log(`PROTECTED_READY_REVIEW_RECOVERY=${receipt.engineReceipt.verdict};FAILED_RUN=${receipt.failedReviewRunId}`);
  } else throw new Error('PROTECTED_READY_REVIEW_BLOCKED:UNKNOWN_FIXED_OPERATION');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
