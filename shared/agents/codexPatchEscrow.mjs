import { createHash } from 'node:crypto';

export const CODEX_PATCH_ESCROW_SCHEMA_VERSION = 'stephanos.codex.patch-escrow.v1';
export const CODEX_WORKSPACE_ATTEMPT_SCHEMA_VERSION = 'stephanos.codex.workspace-attempt.v1';
export const CODEX_PATCH_ESCROW_MAX_BYTES = 2 * 1024 * 1024;
export const CODEX_PATCH_ESCROW_MAX_CHUNKS = 100;
export const CODEX_PATCH_ESCROW_DEFAULT_CHUNK_CHARS = 24_000;

export const CODEX_WORKSPACE_STATE = Object.freeze({
  CREATED: 'CREATED',
  LEASED: 'LEASED',
  BUILT_LOCAL: 'BUILT_LOCAL',
  TESTED_LOCAL: 'TESTED_LOCAL',
  PATCH_ESCROWED: 'PATCH_ESCROWED',
  REMOTE_BRANCH_VERIFIED: 'REMOTE_BRANCH_VERIFIED',
  PR_LIVE: 'PR_LIVE',
  APPROVAL_READY: 'APPROVAL_READY',
  BLOCKED: 'BLOCKED',
});

export const CODEX_RECOVERY_DECISION = Object.freeze({
  REUSE_ACTIVE_ATTEMPT: 'REUSE_ACTIVE_ATTEMPT',
  PUBLISH_ESCROW: 'PUBLISH_ESCROW',
  TRACK_LIVE_PR: 'TRACK_LIVE_PR',
  START_NEW_ATTEMPT: 'START_NEW_ATTEMPT',
  BLOCK_CORRUPT_ESCROW: 'BLOCK_CORRUPT_ESCROW',
});

export const CODEX_PATCH_TEST_PROFILES = Object.freeze([
  'shared-workspace',
  'shared-agents',
  'node-changed',
]);

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,159}$/i;
const SAFE_BRANCH_PATTERN = /^patch-escrow\/issue-[1-9][0-9]*-[a-f0-9]{12}$/;
const FORBIDDEN_PATH_PATTERN = /(^|\/)(apps\/stephanos\/dist|stephanos-server\/data|runtime|runtime-data|root-data|node_modules|\.git)(\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|pfx|key)$/i;
const SECRET_PATH_PATTERN = /(?:^|\/)(?:secrets?|tokens?|credentials?|private[-_ ]?keys?)(?:\/|$)/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function integer(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function uniqueSorted(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => normalizePath(value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizePath(value) {
  return text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function isoTime(value) {
  const candidate = text(value);
  const milliseconds = Date.parse(candidate);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : '';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function patchBuffer(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(String(value ?? ''), 'utf8');
}

function safeJobId(value, issueNumber) {
  const fallback = `codex-job-${issueNumber}`;
  const candidate = text(value, fallback).toLowerCase();
  return SAFE_ID_PATTERN.test(candidate) ? candidate : fallback;
}

function safeLeaseOwner(value) {
  const candidate = text(value).toLowerCase();
  return SAFE_ID_PATTERN.test(candidate) ? candidate : '';
}

function addSeconds(timestampUtc, seconds) {
  const milliseconds = Date.parse(timestampUtc);
  if (!Number.isFinite(milliseconds)) return '';
  return new Date(milliseconds + Math.max(1, integer(seconds, 900)) * 1000).toISOString();
}

function safeFile(path) {
  const normalized = normalizePath(path);
  return Boolean(normalized)
    && !normalized.startsWith('/')
    && !/^[a-z]:\//i.test(normalized)
    && !normalized.split('/').includes('..')
    && !FORBIDDEN_PATH_PATTERN.test(normalized)
    && !SECRET_PATH_PATTERN.test(normalized)
    && !/secret|token|credential/i.test(normalized);
}

export function derivePatchEscrowBranch(issueNumber, patchSha256) {
  const issue = integer(issueNumber);
  const hash = text(patchSha256).toLowerCase();
  if (issue < 1 || !SHA256_PATTERN.test(hash)) return '';
  return `patch-escrow/issue-${issue}-${hash.slice(0, 12)}`;
}

export function createCodexWorkspaceAttempt(input = {}) {
  const issueNumber = integer(input.issueNumber);
  const attemptNumber = Math.max(1, integer(input.attemptNumber, 1));
  const createdAtUtc = isoTime(input.createdAtUtc) || 'pending';
  const jobId = safeJobId(input.jobId, issueNumber || 0);
  const attemptId = `${jobId}-a${String(attemptNumber).padStart(3, '0')}`;
  const workspaceId = `ws-${attemptId}`;
  const leaseOwner = safeLeaseOwner(input.leaseOwner);
  const leaseExpiresAtUtc = leaseOwner && createdAtUtc !== 'pending'
    ? addSeconds(createdAtUtc, input.leaseSeconds)
    : '';

  return Object.freeze({
    schemaVersion: CODEX_WORKSPACE_ATTEMPT_SCHEMA_VERSION,
    issueNumber,
    jobId,
    attemptNumber,
    attemptId,
    workspaceId,
    baseSha: text(input.baseSha).toLowerCase(),
    targetBranch: text(input.targetBranch),
    codexTaskId: text(input.codexTaskId),
    leaseOwner,
    leaseExpiresAtUtc,
    heartbeatAtUtc: leaseOwner ? createdAtUtc : '',
    createdAtUtc,
    updatedAtUtc: createdAtUtc,
    state: leaseOwner ? CODEX_WORKSPACE_STATE.LEASED : CODEX_WORKSPACE_STATE.CREATED,
    localHeadSha: '',
    patchSha256: '',
    patchRef: '',
    remoteHeadSha: '',
    prNumber: null,
    blockers: Object.freeze([]),
  });
}

export function validateCodexWorkspaceAttempt(attempt = {}) {
  const errors = [];
  if (attempt.schemaVersion !== CODEX_WORKSPACE_ATTEMPT_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (!Number.isSafeInteger(attempt.issueNumber) || attempt.issueNumber < 1) errors.push('invalid-issue-number');
  if (!SAFE_ID_PATTERN.test(text(attempt.jobId))) errors.push('invalid-job-id');
  if (!Number.isSafeInteger(attempt.attemptNumber) || attempt.attemptNumber < 1) errors.push('invalid-attempt-number');
  if (attempt.attemptId !== `${attempt.jobId}-a${String(attempt.attemptNumber).padStart(3, '0')}`) errors.push('invalid-attempt-id');
  if (attempt.workspaceId !== `ws-${attempt.attemptId}`) errors.push('invalid-workspace-id');
  if (text(attempt.baseSha) && !SHA_PATTERN.test(text(attempt.baseSha))) errors.push('invalid-base-sha');
  if (!Object.values(CODEX_WORKSPACE_STATE).includes(attempt.state)) errors.push('invalid-state');
  if (attempt.leaseOwner && !isoTime(attempt.leaseExpiresAtUtc)) errors.push('invalid-lease-expiry');
  if (attempt.localHeadSha && !SHA_PATTERN.test(attempt.localHeadSha)) errors.push('invalid-local-head-sha');
  if (attempt.patchSha256 && !SHA256_PATTERN.test(attempt.patchSha256)) errors.push('invalid-patch-sha256');
  if (attempt.remoteHeadSha && !SHA_PATTERN.test(attempt.remoteHeadSha)) errors.push('invalid-remote-head-sha');
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    finalVerdict: errors.length ? 'CODEX_WORKSPACE_ATTEMPT_BLOCKED' : 'CODEX_WORKSPACE_ATTEMPT_PASS',
  });
}

export function workspaceLeaseIsActive(attempt = {}, nowUtc = new Date().toISOString()) {
  if (!attempt.leaseOwner) return false;
  const expires = Date.parse(attempt.leaseExpiresAtUtc);
  const now = Date.parse(nowUtc);
  return Number.isFinite(expires) && Number.isFinite(now) && expires > now;
}

export function renewCodexWorkspaceLease(attempt = {}, input = {}) {
  const validation = validateCodexWorkspaceAttempt(attempt);
  if (!validation.valid) return Object.freeze({ ok: false, reason: validation.errors[0], attempt });
  const nowUtc = isoTime(input.nowUtc);
  const leaseOwner = safeLeaseOwner(input.leaseOwner);
  if (!nowUtc || !leaseOwner) return Object.freeze({ ok: false, reason: 'invalid-lease-renewal', attempt });
  if (workspaceLeaseIsActive(attempt, nowUtc) && attempt.leaseOwner !== leaseOwner) {
    return Object.freeze({ ok: false, reason: 'lease-owned-by-another-workspace', attempt });
  }
  const next = Object.freeze({
    ...attempt,
    leaseOwner,
    heartbeatAtUtc: nowUtc,
    leaseExpiresAtUtc: addSeconds(nowUtc, input.leaseSeconds),
    updatedAtUtc: nowUtc,
    state: CODEX_WORKSPACE_STATE.LEASED,
  });
  return Object.freeze({ ok: true, reason: 'LEASE_RENEWED', attempt: next });
}

export function attachLocalBuildEvidence(attempt = {}, input = {}) {
  const localHeadSha = text(input.localHeadSha).toLowerCase();
  const patchSha = text(input.patchSha256).toLowerCase();
  const patchRef = text(input.patchRef);
  const tested = input.testsPassed === true;
  if (!SHA_PATTERN.test(localHeadSha)) return Object.freeze({ ok: false, reason: 'invalid-local-head-sha', attempt });
  if (patchSha && !SHA256_PATTERN.test(patchSha)) return Object.freeze({ ok: false, reason: 'invalid-patch-sha256', attempt });
  const state = patchSha && patchRef
    ? CODEX_WORKSPACE_STATE.PATCH_ESCROWED
    : tested
      ? CODEX_WORKSPACE_STATE.TESTED_LOCAL
      : CODEX_WORKSPACE_STATE.BUILT_LOCAL;
  return Object.freeze({
    ok: true,
    reason: state,
    attempt: Object.freeze({
      ...attempt,
      localHeadSha,
      patchSha256: patchSha,
      patchRef,
      updatedAtUtc: isoTime(input.updatedAtUtc) || attempt.updatedAtUtc,
      state,
    }),
  });
}

export function attachRemotePublicationEvidence(attempt = {}, input = {}) {
  const remoteHeadSha = text(input.remoteHeadSha).toLowerCase();
  const branch = text(input.branch);
  const prNumber = integer(input.prNumber);
  if (input.remoteHeadReachable !== true) return Object.freeze({ ok: false, reason: 'remote-head-not-proven', attempt });
  if (!SHA_PATTERN.test(remoteHeadSha)) return Object.freeze({ ok: false, reason: 'invalid-remote-head-sha', attempt });
  if (!branch || branch !== attempt.targetBranch) return Object.freeze({ ok: false, reason: 'remote-branch-mismatch', attempt });
  const state = prNumber > 0 ? CODEX_WORKSPACE_STATE.PR_LIVE : CODEX_WORKSPACE_STATE.REMOTE_BRANCH_VERIFIED;
  return Object.freeze({
    ok: true,
    reason: state,
    attempt: Object.freeze({
      ...attempt,
      remoteHeadSha,
      prNumber: prNumber > 0 ? prNumber : null,
      updatedAtUtc: isoTime(input.verifiedAtUtc) || attempt.updatedAtUtc,
      state,
    }),
  });
}

export function createPatchEscrowBundle(input = {}) {
  const issueNumber = integer(input.issueNumber);
  const rawPatch = patchBuffer(input.patch);
  const patchSha256 = sha256(rawPatch);
  const branch = derivePatchEscrowBranch(issueNumber, patchSha256);
  const changedFiles = uniqueSorted(input.changedFiles);
  const baseSha = text(input.baseSha).toLowerCase();
  const chunkChars = Math.max(4, integer(input.chunkChars, CODEX_PATCH_ESCROW_DEFAULT_CHUNK_CHARS));
  const safeChunkChars = chunkChars - (chunkChars % 4);
  const encoded = rawPatch.toString('base64');
  const dataChunks = [];
  for (let offset = 0; offset < encoded.length; offset += safeChunkChars) {
    dataChunks.push(encoded.slice(offset, offset + safeChunkChars));
  }
  if (!dataChunks.length) dataChunks.push('');
  const bundleId = `patch-issue-${issueNumber}-${patchSha256.slice(0, 12)}`;
  const chunks = dataChunks.map((data, index) => {
    const decoded = Buffer.from(data, 'base64');
    return Object.freeze({
      schemaVersion: CODEX_PATCH_ESCROW_SCHEMA_VERSION,
      kind: 'PATCH_ESCROW_CHUNK_V1',
      bundleId,
      index: index + 1,
      count: dataChunks.length,
      byteLength: decoded.length,
      sha256: sha256(decoded),
      data,
    });
  });
  const manifest = Object.freeze({
    schemaVersion: CODEX_PATCH_ESCROW_SCHEMA_VERSION,
    kind: 'PATCH_ESCROW_MANIFEST_V1',
    bundleId,
    issueNumber,
    baseBranch: text(input.baseBranch, 'main'),
    baseSha,
    targetBranch: branch,
    patchSha256,
    patchByteLength: rawPatch.length,
    chunkCount: chunks.length,
    changedFiles: Object.freeze(changedFiles),
    testProfile: text(input.testProfile),
    commitMessage: text(input.commitMessage),
    prTitle: text(input.prTitle),
    prBody: text(input.prBody),
    noMerge: true,
  });
  return Object.freeze({ manifest, chunks: Object.freeze(chunks) });
}

export function validatePatchEscrowManifest(manifest = {}) {
  const errors = [];
  if (manifest.schemaVersion !== CODEX_PATCH_ESCROW_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (manifest.kind !== 'PATCH_ESCROW_MANIFEST_V1') errors.push('invalid-kind');
  if (!/^patch-issue-[1-9][0-9]*-[a-f0-9]{12}$/.test(text(manifest.bundleId))) errors.push('invalid-bundle-id');
  if (!Number.isSafeInteger(manifest.issueNumber) || manifest.issueNumber < 1) errors.push('invalid-issue-number');
  if (manifest.baseBranch !== 'main') errors.push('invalid-base-branch');
  if (!SHA_PATTERN.test(text(manifest.baseSha))) errors.push('invalid-base-sha');
  if (!SHA256_PATTERN.test(text(manifest.patchSha256))) errors.push('invalid-patch-sha256');
  if (manifest.targetBranch !== derivePatchEscrowBranch(manifest.issueNumber, manifest.patchSha256)) errors.push('invalid-target-branch');
  if (!SAFE_BRANCH_PATTERN.test(text(manifest.targetBranch))) errors.push('unsafe-target-branch');
  if (!Number.isSafeInteger(manifest.patchByteLength) || manifest.patchByteLength < 1 || manifest.patchByteLength > CODEX_PATCH_ESCROW_MAX_BYTES) errors.push('invalid-patch-byte-length');
  if (!Number.isSafeInteger(manifest.chunkCount) || manifest.chunkCount < 1 || manifest.chunkCount > CODEX_PATCH_ESCROW_MAX_CHUNKS) errors.push('invalid-chunk-count');
  const changedFiles = uniqueSorted(manifest.changedFiles);
  if (!changedFiles.length || changedFiles.length !== (Array.isArray(manifest.changedFiles) ? manifest.changedFiles.length : 0)) errors.push('invalid-changed-files');
  const unsafeFiles = changedFiles.filter((path) => !safeFile(path));
  if (unsafeFiles.length) errors.push(`unsafe-changed-files:${unsafeFiles.join(',')}`);
  if (!CODEX_PATCH_TEST_PROFILES.includes(manifest.testProfile)) errors.push('invalid-test-profile');
  if (!text(manifest.commitMessage) || text(manifest.commitMessage).length > 200) errors.push('invalid-commit-message');
  if (!text(manifest.prTitle) || text(manifest.prTitle).length > 200) errors.push('invalid-pr-title');
  if (text(manifest.prBody).length > 10_000) errors.push('invalid-pr-body');
  if (manifest.noMerge !== true) errors.push('merge-boundary-missing');
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    finalVerdict: errors.length ? 'PATCH_ESCROW_MANIFEST_BLOCKED' : 'PATCH_ESCROW_MANIFEST_PASS',
  });
}

export function reassemblePatchEscrow(manifest = {}, chunks = []) {
  const manifestValidation = validatePatchEscrowManifest(manifest);
  if (!manifestValidation.valid) {
    return Object.freeze({ ok: false, reason: manifestValidation.errors[0], manifestValidation });
  }
  const matching = chunks.filter((chunk) => chunk?.bundleId === manifest.bundleId);
  if (matching.length !== manifest.chunkCount) return Object.freeze({ ok: false, reason: 'missing-or-duplicate-chunks' });
  const byIndex = new Map();
  for (const chunk of matching) {
    if (chunk.schemaVersion !== CODEX_PATCH_ESCROW_SCHEMA_VERSION || chunk.kind !== 'PATCH_ESCROW_CHUNK_V1') return Object.freeze({ ok: false, reason: 'invalid-chunk-contract' });
    if (!Number.isSafeInteger(chunk.index) || chunk.index < 1 || chunk.index > manifest.chunkCount) return Object.freeze({ ok: false, reason: 'invalid-chunk-index' });
    if (chunk.count !== manifest.chunkCount || byIndex.has(chunk.index)) return Object.freeze({ ok: false, reason: 'missing-or-duplicate-chunks' });
    const decoded = Buffer.from(text(chunk.data), 'base64');
    if (decoded.length !== chunk.byteLength) return Object.freeze({ ok: false, reason: `chunk-${chunk.index}-length-mismatch` });
    if (sha256(decoded) !== chunk.sha256) return Object.freeze({ ok: false, reason: `chunk-${chunk.index}-hash-mismatch` });
    byIndex.set(chunk.index, decoded);
  }
  const ordered = [];
  for (let index = 1; index <= manifest.chunkCount; index += 1) {
    if (!byIndex.has(index)) return Object.freeze({ ok: false, reason: 'missing-or-duplicate-chunks' });
    ordered.push(byIndex.get(index));
  }
  const patch = Buffer.concat(ordered);
  if (patch.length !== manifest.patchByteLength) return Object.freeze({ ok: false, reason: 'patch-length-mismatch' });
  if (sha256(patch) !== manifest.patchSha256) return Object.freeze({ ok: false, reason: 'patch-hash-mismatch' });
  return Object.freeze({ ok: true, reason: 'PATCH_ESCROW_VERIFIED', patch, manifest });
}

function render(marker, payload) {
  return `${marker}\n${JSON.stringify(payload, null, 2)}\nEND_${marker}`;
}

export function renderPatchEscrowManifestComment(manifest) {
  return render('PATCH_ESCROW_MANIFEST_V1', manifest);
}

export function renderPatchEscrowChunkComment(chunk) {
  return render('PATCH_ESCROW_CHUNK_V1', chunk);
}

export function renderPatchEscrowPublishComment(bundleId) {
  return render('PATCH_ESCROW_PUBLISH_V1', { bundleId: text(bundleId) });
}

function parseMarkedJson(body, marker) {
  const source = String(body ?? '');
  const start = source.indexOf(`${marker}\n`);
  const endMarker = `\nEND_${marker}`;
  if (start < 0) return null;
  const end = source.indexOf(endMarker, start + marker.length + 1);
  if (end < 0) return null;
  const raw = source.slice(start + marker.length + 1, end).trim();
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parsePatchEscrowComment(body) {
  for (const marker of ['PATCH_ESCROW_MANIFEST_V1', 'PATCH_ESCROW_CHUNK_V1', 'PATCH_ESCROW_PUBLISH_V1']) {
    const payload = parseMarkedJson(body, marker);
    if (payload) return Object.freeze({ marker, payload });
  }
  return null;
}

export function planCodexWorkspaceRecovery(input = {}) {
  const attempts = Array.isArray(input.attempts) ? input.attempts : [];
  const nowUtc = isoTime(input.nowUtc) || new Date().toISOString();
  const validAttempts = attempts.filter((attempt) => validateCodexWorkspaceAttempt(attempt).valid);
  const sorted = [...validAttempts].sort((left, right) => right.attemptNumber - left.attemptNumber);
  const live = sorted.find((attempt) => attempt.state === CODEX_WORKSPACE_STATE.PR_LIVE && attempt.remoteHeadSha && attempt.prNumber);
  if (live) return Object.freeze({ decision: CODEX_RECOVERY_DECISION.TRACK_LIVE_PR, attempt: live, finalVerdict: 'CODEX_RECOVERY_TRACK_LIVE_PR' });
  const active = sorted.find((attempt) => workspaceLeaseIsActive(attempt, nowUtc));
  if (active) return Object.freeze({ decision: CODEX_RECOVERY_DECISION.REUSE_ACTIVE_ATTEMPT, attempt: active, finalVerdict: 'CODEX_RECOVERY_REUSE_ACTIVE_ATTEMPT' });
  const escrowed = sorted.find((attempt) => attempt.state === CODEX_WORKSPACE_STATE.PATCH_ESCROWED && SHA256_PATTERN.test(attempt.patchSha256) && attempt.patchRef);
  if (escrowed) return Object.freeze({ decision: CODEX_RECOVERY_DECISION.PUBLISH_ESCROW, attempt: escrowed, finalVerdict: 'CODEX_RECOVERY_PUBLISH_ESCROW' });
  const corrupt = sorted.find((attempt) => attempt.state === CODEX_WORKSPACE_STATE.PATCH_ESCROWED);
  if (corrupt) return Object.freeze({ decision: CODEX_RECOVERY_DECISION.BLOCK_CORRUPT_ESCROW, attempt: corrupt, finalVerdict: 'CODEX_RECOVERY_BLOCK_CORRUPT_ESCROW' });
  return Object.freeze({
    decision: CODEX_RECOVERY_DECISION.START_NEW_ATTEMPT,
    nextAttemptNumber: sorted.length ? sorted[0].attemptNumber + 1 : 1,
    finalVerdict: 'CODEX_RECOVERY_START_NEW_ATTEMPT',
  });
}
