import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const SHARED_WORKSPACE_SCOPED_DELIVERY_STATUS_SCHEMA = 'stephanos.shared-workspace.scoped-delivery-status.v1';
export const SHARED_WORKSPACE_SCOPED_DELIVERY_STATUS_DIRECTORIES = Object.freeze([
  Object.freeze(['status']),
  Object.freeze(['proof']),
  Object.freeze(['receipts']),
  Object.freeze(['events']),
  Object.freeze(['github-command-mailbox']),
  Object.freeze(['evidence', 'receipts']),
]);
export const SHARED_WORKSPACE_SCOPED_DELIVERY_MAX_RECORDS = 512;
export const SHARED_WORKSPACE_SCOPED_DELIVERY_MAX_FILES_PER_DIRECTORY = 160;
export const SHARED_WORKSPACE_SCOPED_DELIVERY_MAX_FILE_BYTES = 64 * 1024;
export const SHARED_WORKSPACE_SCOPED_DELIVERY_DEFAULT_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

const FIXED_REPOSITORY = 'Cheekyfellastef/stephan-os';
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,159}$/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[a-z0-9][a-z0-9._\/-]{0,240}$/i;
const STATUS_KEYS = new Set([
  'status',
  'state',
  'classification',
  'finalverdict',
  'disposition',
  'reason',
  'blocker',
  'summary',
  'result',
]);
const HEAD_KEYS = Object.freeze({
  synced: new Set(['localheadafter', 'sourcehead', 'checkouthead', 'servedsourcehead']),
  built: new Set(['builtdisthead', 'buildhead', 'distcommit', 'distgitcommit']),
  served: new Set(['servedbrowserhead', 'servedhead', 'servedcommit', 'runtimecommit', 'servedgitcommit']),
});
const FEATURE_KEYS = Object.freeze({
  updatedMusicTileServed: new Set(['updatedmusictileserved']),
  playbackContinuedAfterRating: new Set(['playbackcontinuedafterrating']),
  autoUrlAndArtworkRuntimeProof: new Set([
    'autourlandartworkruntimeproof',
    'autourlandartworkproof',
    'musictileautourlandartworkpass',
  ]),
});

function text(value, fallback = '') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizedKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizePrNumber(value) {
  const raw = text(value).replace(/^#/, '');
  if (!/^\d{1,7}$/.test(raw)) return 0;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeId(value) {
  const out = text(value);
  return SAFE_ID.test(out) ? out : '';
}

function recordId(record = {}) {
  for (const key of [
    'recordId', 'receiptId', 'statusId', 'proofId', 'eventId', 'messageId',
    'handoffId', 'requestId', 'taskId', 'id',
  ]) {
    const candidate = safeId(record?.[key]);
    if (candidate) return candidate;
  }
  return '';
}

function collectPairs(value, output = [], depth = 0, seen = new WeakSet()) {
  if (depth > 7 || output.length >= 320) return output;
  if (Array.isArray(value)) {
    if (seen.has(value)) return output;
    seen.add(value);
    for (const item of value.slice(0, 80)) collectPairs(item, output, depth + 1, seen);
    return output;
  }
  if (!plainObject(value)) return output;
  if (seen.has(value)) return output;
  seen.add(value);
  for (const [key, child] of Object.entries(value).slice(0, 120)) {
    if (child === null || child === undefined || ['string', 'number', 'boolean'].includes(typeof child)) {
      output.push({ key: normalizedKey(key), value: child });
    } else {
      collectPairs(child, output, depth + 1, seen);
    }
    if (output.length >= 320) break;
  }
  return output;
}

function boundedJson(record) {
  try {
    const json = JSON.stringify(record);
    return typeof json === 'string' ? json.slice(0, SHARED_WORKSPACE_SCOPED_DELIVERY_MAX_FILE_BYTES) : '';
  } catch {
    return '';
  }
}

function statusText(record = {}) {
  return collectPairs(record)
    .filter((pair) => STATUS_KEYS.has(pair.key) && typeof pair.value !== 'boolean')
    .map((pair) => text(pair.value).toUpperCase())
    .filter(Boolean)
    .join(' | ');
}

function valueForKeys(record, keys) {
  return collectPairs(record)
    .filter((pair) => keys.has(pair.key))
    .map((pair) => pair.value);
}

function exactHeadForKeys(record, keys, expectedHead) {
  return valueForKeys(record, keys).some((value) => text(value).toLowerCase() === expectedHead);
}

function booleanForKeys(record, keys) {
  return valueForKeys(record, keys).some((value) => value === true || text(value).toLowerCase() === 'true');
}

function safeProofRefs(record = {}) {
  const refs = [];
  for (const pair of collectPairs(record)) {
    if (pair.key !== 'proofrefs' && pair.key !== 'refs') continue;
    if (typeof pair.value === 'string' && SAFE_PROOF_REF.test(pair.value)) refs.push(pair.value);
  }
  const direct = [record.proofRefs, record.refs].flatMap((value) => Array.isArray(value) ? value : []);
  for (const ref of direct.map(String)) if (SAFE_PROOF_REF.test(ref)) refs.push(ref);
  return [...new Set(refs)].slice(0, 20);
}

function relatedPrMatches(record, prNumber) {
  return normalizePrNumber(record?.relatedPr ?? record?.prNumber ?? record?.pullRequestNumber) === prNumber;
}

const IDENTITY_KEYS = Object.freeze({
  repository: new Set(['repository', 'repositoryfullname', 'repofullname']),
  pr: new Set(['relatedpr', 'prnumber', 'pullrequestnumber']),
  merge: new Set([
    'mergecommit', 'expectedhead', 'localheadafter', 'sourcehead', 'checkouthead', 'servedsourcehead',
    'builtdisthead', 'buildhead', 'distcommit', 'distgitcommit',
    'servedbrowserhead', 'servedhead', 'servedcommit', 'runtimecommit', 'servedgitcommit',
  ]),
  deployment: new Set(['deploymentrequestid', 'correlationid', 'requestid']),
  feature: new Set(['featureid']),
});
const ALL_STAGE_HEAD_KEYS = new Set([
  ...HEAD_KEYS.synced,
  ...HEAD_KEYS.built,
  ...HEAD_KEYS.served,
]);
const EXPLICIT_MERGE_IDENTITY_KEYS = new Set(['mergecommit']);

function exactTextForKeys(record, keys, expected) {
  const normalizedExpected = text(expected).toLowerCase();
  return Boolean(normalizedExpected) && valueForKeys(record, keys)
    .some((value) => text(value).toLowerCase() === normalizedExpected);
}

function exactPrForKeys(record, expectedPr) {
  return valueForKeys(record, IDENTITY_KEYS.pr)
    .some((value) => normalizePrNumber(value) === expectedPr);
}

function identityMatches(record, subject) {
  return exactTextForKeys(record, IDENTITY_KEYS.repository, subject.repository)
    && exactPrForKeys(record, subject.prNumber)
    && exactTextForKeys(record, IDENTITY_KEYS.merge, subject.mergeCommit)
    && exactTextForKeys(record, IDENTITY_KEYS.deployment, subject.deploymentRequestId)
    && exactTextForKeys(record, IDENTITY_KEYS.feature, subject.featureId);
}

function hasConflictingStageHead(record, expectedHead) {
  return valueForKeys(record, ALL_STAGE_HEAD_KEYS).some((value) => {
    const candidate = text(value).toLowerCase();
    return FULL_SHA.test(candidate) && candidate !== expectedHead;
  });
}

function trustedStatusStageHead(record, keys, expectedHead, trustedStatusPattern) {
  if (hasConflictingStageHead(record, expectedHead)) return false;
  const stageValues = valueForKeys(record, keys);
  if (stageValues.length) {
    return stageValues.some((value) => text(value).toLowerCase() === expectedHead);
  }
  return exactTextForKeys(record, EXPLICIT_MERGE_IDENTITY_KEYS, expectedHead)
    && trustedStatusPattern.test(statusText(record));
}

function safeSummary(record = {}) {
  const summary = text(record.summary || record.title || record.reason || record.disposition || record.status || record.state);
  if (!summary) return '';
  return summary.length > 500 ? summary.slice(0, 500) + '…' : summary;
}

function evidenceRecord(record = {}) {
  return Object.freeze({
    recordId: recordId(record),
    schemaVersion: text(record.schemaVersion),
    kind: text(record.kind),
    timestampUtc: text(record.timestampUtc || record.acceptedAt || record.completedAt || record.updatedAt),
    status: text(record.status || record.state || record.classification || record.finalVerdict || record.disposition),
    summary: safeSummary(record),
    proofRefs: safeProofRefs(record),
  });
}

function latestBlockedRecord(records) {
  return records.find((record) => {
    const status = statusText(record);
    if (!status) return false;
    const blocked = /(?:^|\W)(BLOCKED|FAILED|FAILURE|ERROR)(?:$|\W)/.test(status);
    const recovered = /(?:^|\W)(PASS|SUCCESS|SUCCEEDED|COMPLETE|COMPLETED|READY)(?:$|\W)/.test(status);
    return blocked && !recovered;
  }) || null;
}

function stageResult(pass, evidence = [], unknownReason = 'NO_MATCHING_EVIDENCE') {
  return Object.freeze({
    status: pass ? 'PASS' : 'UNKNOWN',
    reason: pass ? 'EXACT_EVIDENCE_MATCHED' : unknownReason,
    proofRefs: [...new Set(evidence.flatMap((record) => safeProofRefs(record)))].slice(0, 20),
  });
}

export function validateDeliveryStatusSubject(input = {}) {
  const errors = [];
  if (!plainObject(input)) return Object.freeze({ ok: false, errors: ['subject-not-object'], normalized: null });
  const allowedKeys = new Set(['repository', 'prNumber', 'mergeCommit', 'deploymentRequestId', 'featureId']);
  for (const key of Object.keys(input)) if (!allowedKeys.has(key)) errors.push('unsupported-subject-field:' + key);

  const repository = text(input.repository);
  const prNumber = normalizePrNumber(input.prNumber);
  const mergeCommit = text(input.mergeCommit).toLowerCase();
  const deploymentRequestId = safeId(input.deploymentRequestId);
  const featureId = safeId(input.featureId);

  if (repository !== FIXED_REPOSITORY) errors.push('repository-not-allowlisted');
  if (!prNumber) errors.push('invalid-pr-number');
  if (!FULL_SHA.test(mergeCommit)) errors.push('invalid-merge-commit');
  if (text(input.deploymentRequestId) && deploymentRequestId !== text(input.deploymentRequestId)) errors.push('invalid-deployment-request-id');
  if (text(input.featureId) && featureId !== text(input.featureId)) errors.push('invalid-feature-id');

  return Object.freeze({
    ok: errors.length === 0,
    errors,
    normalized: errors.length ? null : Object.freeze({
      repository,
      prNumber,
      mergeCommit,
      deploymentRequestId,
      featureId,
    }),
  });
}

export function buildScopedDeliveryStatusProjection({
  subject: subjectInput,
  records = [],
  timestampUtc = new Date(0).toISOString(),
  nowMs = Date.parse(timestampUtc),
  staleAfterMs = SHARED_WORKSPACE_SCOPED_DELIVERY_DEFAULT_STALE_AFTER_MS,
  loadStatus = null,
} = {}) {
  const validated = validateDeliveryStatusSubject(subjectInput);
  if (!validated.ok) {
    return Object.freeze({
      schemaVersion: SHARED_WORKSPACE_SCOPED_DELIVERY_STATUS_SCHEMA,
      projectionKind: 'scoped-delivery-status',
      aggregationOk: false,
      aggregationReason: 'DELIVERY_STATUS_SUBJECT_INVALID',
      overallStatus: 'BLOCKED',
      live: false,
      blocker: validated.errors[0] || 'invalid-subject',
      subject: null,
      stages: null,
      matchedRecordCount: 0,
      evidence: [],
      proofRefs: [],
      freshnessUtc: timestampUtc,
      arbitraryFilesystemAccess: false,
      commandExecutionAccess: false,
      sourceMutationAccess: false,
    });
  }

  const subject = validated.normalized;
  const matching = (Array.isArray(records) ? records : [])
    .filter((record) => plainObject(record) && identityMatches(record, subject))
    .sort((left, right) => timestampMs(right.timestampUtc || right.acceptedAt || right.completedAt || right.updatedAt)
      - timestampMs(left.timestampUtc || left.acceptedAt || left.completedAt || left.updatedAt));

  const requestEvidence = matching.filter((record) => /(?:^|\W)(ACCEPTED|REQUEST_ACCEPTED)(?:$|\W)/.test(statusText(record)));
  const syncEvidence = matching.filter((record) => trustedStatusStageHead(
    record,
    HEAD_KEYS.synced,
    subject.mergeCommit,
    /SYNC_FAST_FORWARD_APPLIED|SYNC_NO_CHANGE|SOURCE_SYNC_PASS|SOURCE_AND_RUNTIME_EXACT_HEAD/,
  ));
  const buildEvidence = matching.filter((record) => exactHeadForKeys(record, HEAD_KEYS.built, subject.mergeCommit));
  const serveEvidence = matching.filter((record) => trustedStatusStageHead(
    record,
    HEAD_KEYS.served,
    subject.mergeCommit,
    /SOURCE_AND_RUNTIME_EXACT_HEAD|SERVED_EXACT_HEAD|RUNTIME_EXACT_HEAD/,
  ));
  const updatedEvidence = matching.filter((record) => booleanForKeys(record, FEATURE_KEYS.updatedMusicTileServed));
  const playbackEvidence = matching.filter((record) => booleanForKeys(record, FEATURE_KEYS.playbackContinuedAfterRating));
  const artworkEvidence = matching.filter((record) => booleanForKeys(record, FEATURE_KEYS.autoUrlAndArtworkRuntimeProof));

  const latest = matching[0] || null;
  const latestEvidenceAt = text(latest?.timestampUtc || latest?.acceptedAt || latest?.completedAt || latest?.updatedAt);
  const latestMs = timestampMs(latestEvidenceAt);
  const effectiveNow = Number.isFinite(nowMs) ? nowMs : Date.parse(timestampUtc);
  const stale = Boolean(latestMs && Number.isFinite(effectiveNow) && effectiveNow - latestMs > staleAfterMs);
  const blockedRecord = latestBlockedRecord(matching);

  const requestAccepted = requestEvidence.length > 0;
  const synced = syncEvidence.length > 0;
  const built = buildEvidence.length > 0;
  const served = serveEvidence.length > 0;
  const updatedMusicTileServed = updatedEvidence.length > 0;
  const playbackContinuedAfterRating = playbackEvidence.length > 0;
  const autoUrlAndArtworkRuntimeProof = artworkEvidence.length > 0;
  const featureProven = updatedMusicTileServed && playbackContinuedAfterRating && autoUrlAndArtworkRuntimeProof;
  const live = served && featureProven && !stale && !blockedRecord;

  let overallStatus = 'NO_MATCHING_RUNTIME_EVIDENCE';
  if (blockedRecord) overallStatus = 'BLOCKED';
  else if (stale && matching.length) overallStatus = 'STALE_OR_REGRESSED';
  else if (live) overallStatus = 'LIVE';
  else if (served) overallStatus = 'SERVED_NOT_FEATURE_PROVEN';
  else if (built) overallStatus = 'BUILT_NOT_SERVED';
  else if (synced) overallStatus = 'ON_BATTLE_BRIDGE_DISK';
  else if (requestAccepted || matching.length) overallStatus = 'MERGED_NOT_SYNCED';

  const proofRefs = [...new Set(matching.flatMap((record) => safeProofRefs(record)))].slice(0, 30);
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_SCOPED_DELIVERY_STATUS_SCHEMA,
    projectionKind: 'scoped-delivery-status',
    aggregationOk: loadStatus?.ok !== false,
    aggregationReason: text(loadStatus?.reason, matching.length ? 'SCOPED_DELIVERY_EVIDENCE_MATCHED' : 'NO_MATCHING_RUNTIME_EVIDENCE'),
    subject,
    overallStatus,
    live,
    blocker: blockedRecord ? safeSummary(blockedRecord) || statusText(blockedRecord) : '',
    latestEvidenceAt,
    freshness: stale ? 'STALE' : (latest ? 'CURRENT' : 'UNKNOWN'),
    matchedRecordCount: matching.length,
    stages: Object.freeze({
      githubMerge: Object.freeze({ status: 'EXTERNAL_GITHUB_AUTHORITY', mergeCommit: subject.mergeCommit }),
      deploymentRequest: stageResult(requestAccepted, requestEvidence),
      sourceSync: stageResult(synced, syncEvidence),
      build: stageResult(built, buildEvidence),
      servedRuntime: stageResult(served, serveEvidence),
      featureProof: Object.freeze({
        status: featureProven ? 'PASS' : 'UNKNOWN',
        reason: featureProven ? 'ALL_REQUIRED_FEATURE_PROOFS_MATCHED' : 'FEATURE_PROOF_INCOMPLETE',
        updatedMusicTileServed,
        playbackContinuedAfterRating,
        autoUrlAndArtworkRuntimeProof,
        proofRefs: [...new Set([
          ...updatedEvidence,
          ...playbackEvidence,
          ...artworkEvidence,
        ].flatMap((record) => safeProofRefs(record)))].slice(0, 20),
      }),
    }),
    evidence: matching.slice(0, 12).map(evidenceRecord),
    proofRefs,
    freshnessUtc: timestampUtc,
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  });
}

export async function loadScopedDeliveryStatusEvidence({
  workspaceRoot,
  repoRoot,
  subject,
  nowMs = Date.now(),
  readdirFn = readdir,
  readFileFn = readFile,
} = {}) {
  const validated = validateDeliveryStatusSubject(subject);
  if (!validated.ok) return Object.freeze({ ok: false, reason: 'DELIVERY_STATUS_SUBJECT_INVALID', records: [], errors: validated.errors });
  const records = [];
  let scannedFileCount = 0;

  for (const segments of SHARED_WORKSPACE_SCOPED_DELIVERY_STATUS_DIRECTORIES) {
    const resolved = resolveSharedWorkspacePath({ root: workspaceRoot, repoRoot, segments });
    if (!resolved.ok) continue;
    let names = [];
    try {
      names = await readdirFn(resolved.path);
    } catch {
      continue;
    }
    const boundedNames = names
      .filter((name) => /^[a-z0-9][a-z0-9._-]{0,160}\.json$/i.test(name))
      .sort()
      .reverse()
      .slice(0, SHARED_WORKSPACE_SCOPED_DELIVERY_MAX_FILES_PER_DIRECTORY);
    for (const name of boundedNames) {
      scannedFileCount += 1;
      if (records.length >= SHARED_WORKSPACE_SCOPED_DELIVERY_MAX_RECORDS) break;
      try {
        const raw = await readFileFn(join(resolved.path, name), 'utf8');
        if (Buffer.byteLength(raw, 'utf8') > SHARED_WORKSPACE_SCOPED_DELIVERY_MAX_FILE_BYTES) continue;
        const record = JSON.parse(raw);
        if (!plainObject(record)) continue;
        const validation = validateSharedWorkspaceRecord(record, { nowMs });
        if (!validation.valid && !text(record.schemaVersion).startsWith('stephanos.')) continue;
        records.push(record);
      } catch {
        // Malformed evidence is ignored and cannot manufacture a status.
      }
    }
    if (records.length >= SHARED_WORKSPACE_SCOPED_DELIVERY_MAX_RECORDS) break;
  }

  records.sort((left, right) => timestampMs(right.timestampUtc || right.acceptedAt || right.completedAt || right.updatedAt)
    - timestampMs(left.timestampUtc || left.acceptedAt || left.completedAt || left.updatedAt));
  return Object.freeze({
    ok: true,
    reason: records.length ? 'SCOPED_DELIVERY_EVIDENCE_LOADED' : 'NO_SCOPED_DELIVERY_EVIDENCE_FILES',
    records: records.slice(0, SHARED_WORKSPACE_SCOPED_DELIVERY_MAX_RECORDS),
    scannedFileCount,
  });
}
