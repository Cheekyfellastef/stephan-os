import {
  DEFAULT_STALE_AFTER_MS,
  SHARED_WORKSPACE_RECORD_KINDS,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

// Goal #1290: one canonical read-only projection of workspace metadata.
// Provenance links invite independent inspection; they never authenticate the claim.
export const SHARED_WORKSPACE_PROOF_INDEX_SCHEMA = 'stephanos.shared-workspace-proof-index.v1';
export const SHARED_WORKSPACE_PROOF_INDEX_LIMIT = 24;
export const PROOF_INDEX_STAGES = Object.freeze([
  'SOURCE_EDIT', 'TEST', 'CI', 'INDEPENDENT_REVIEW',
  'PROTECTED_MERGE', 'INSTALLED', 'SERVED', 'OS_PICKUP',
]);
const MAX_PROOF_REFS = 8;
const MAX_FUTURE_SKEW_MS = 60_000;
const GITHUB_ROOT = 'https://github.com/Cheekyfellastef/stephan-os';
const SHA = /^[a-f0-9]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const SAFE_NUMERIC = /^[1-9][0-9]{0,9}$/;
const STAGE_ALIASES = Object.freeze({
  SOURCE: 'SOURCE_EDIT', COMMIT: 'SOURCE_EDIT',
  FOCUSED_TEST: 'TEST', WORKFLOW: 'CI', REVIEW: 'INDEPENDENT_REVIEW',
  SPECIALIST_REVIEW: 'INDEPENDENT_REVIEW', MERGE: 'PROTECTED_MERGE',
  PICKUP: 'OS_PICKUP',
});
const PRIVATE_TEXT = /(?:BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|gh[pousr]_[a-z0-9_]+|sk-[a-z0-9_-]{12,}|xox[baprs]-|bearer\s+[a-z0-9._-]+|(?:token|secret|password|credential|api[_-]?key)\s*[:=]|[a-z]:\\|\\\\|\/(?:users|home|tmp|workspace)\/|\.env\b)/i;
const noAuthority = Object.freeze({
  mergeAuthority: false, sourceMutationAllowed: false,
  leaseSeizureAllowed: false, signerAuthority: false, reviewerQualification: false,
});

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : '';
}
function safeSha(value) {
  return typeof value === 'string' && SHA.test(value) ? value.toLowerCase() : '';
}
function cleanText(value, fallback = 'UNKNOWN', max = 200) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return PRIVATE_TEXT.test(normalized) ? '[REDACTED]' : normalized.slice(0, max);
}
function issueNumber(value) {
  if (typeof value !== 'string' && !Number.isSafeInteger(value)) return null;
  const normalized = String(value).trim().replace(/^#/, '');
  return SAFE_NUMERIC.test(normalized) ? Number(normalized) : null;
}
function externalId(value) {
  const s = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  const n = Number(s);
  return /^[1-9]\d{0,15}$/.test(s) && Number.isSafeInteger(n) ? n : null;
}
function safeProofRef(value) {
  if (typeof value !== 'string' || PRIVATE_TEXT.test(value) || value.length > 240) return false;
  const segments = value.split('/');
  if (segments.length === 1) return SAFE_ID.test(value);
  const prefix = segments[0] === 'proof' || segments[0] === 'proofs' || segments[0] === 'receipts'
    || (segments[0] === 'evidence' && segments[1] === 'receipts');
  return prefix && segments.length <= 5 && segments.every((part) => SAFE_ID.test(part));
}
function stageOf(record) {
  const value = cleanText(record.proofClass || record.proofStage || record.stage || record.evidenceClass, '', 70)
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return PROOF_INDEX_STAGES.includes(value) ? value : STAGE_ALIASES[value] || 'UNKNOWN';
}
function digestOf(value) {
  if (typeof value !== 'string') return '';
  const v = value.toLowerCase();
  return /^(?:sha256:)?[a-f0-9]{64}$/.test(v) ? v : '';
}
function frozenLinks({ issue, pr, head, runId, artifactId }) {
  const links = [];
  if (issue) links.push({ kind: 'issue', label: 'Goal #' + issue, url: GITHUB_ROOT + '/issues/' + issue });
  if (pr) links.push({ kind: 'pr', label: 'PR #' + pr, url: GITHUB_ROOT + '/pull/' + pr });
  if (head) links.push({ kind: 'commit', label: 'Source ' + head.slice(0, 8), url: GITHUB_ROOT + '/commit/' + head });
  if (runId) links.push({ kind: 'workflow', label: 'Run ' + runId, url: GITHUB_ROOT + '/actions/runs/' + runId });
  if (runId && artifactId) links.push({ kind: 'artifact', label: 'Artifact ' + artifactId, url: GITHUB_ROOT + '/actions/runs/' + runId + '/artifacts/' + artifactId });
  return Object.freeze(links.map((x) => Object.freeze(x)));
}
function projectRecord(record, nowMs, staleAfterMs, titles, heads) {
  const observedAtUtc = record.timestampUtc;
  const observed = Date.parse(observedAtUtc);
  const ageMs = Math.max(0, nowMs - observed);
  const future = observed - nowMs > MAX_FUTURE_SKEW_MS;
  const stale = future || ageMs > staleAfterMs;
  const issue = issueNumber(record.relatedIssue);
  const pr = issueNumber(record.relatedPr);
  const sourceHead = safeSha(record.sourceHead || record.headSha || record.expectedHead);
  const sourceTree = safeSha(record.sourceTree || record.treeSha);
  const baseSha = safeSha(record.baseSha || record.expectedBase);
  const runId = externalId(record.reviewRunId || record.workflowRunId || record.runId);
  const runAttempt = externalId(record.reviewRunAttempt || record.runAttempt);
  const artifactId = externalId(record.reviewArtifactId || record.artifactId);
  const artifactDigest = digestOf(record.reviewArtifactDigest || record.artifactDigest);
  const stage = stageOf(record);
  const claimStatus = cleanText(record.status || record.finalVerdict, 'UNKNOWN', 48);
  const reportedResult = /^(PASS|SUCCESS|READY|FAILED|FAIL|BLOCKED|DONE|UNKNOWN)$/.test(claimStatus.toUpperCase())
    ? claimStatus.toUpperCase() : 'UNKNOWN';
  let state = 'UNVERIFIED';
  let nextGate = 'VERIFY_ORIGINAL_SOURCE';
  if (stale) { state = 'STALE'; nextGate = 'REFRESH_AND_VERIFY_ORIGINAL_PROOF'; }
  if (/FAIL|ERROR|BLOCKED|DENIED|REJECTED/.test(claimStatus.toUpperCase())) {
    state = 'FAILED'; nextGate = 'INSPECT_ORIGINAL_FAILURE';
  }
  if (issue && sourceHead && heads.get(issue) && heads.get(issue) !== sourceHead) {
    state = 'SUPERSEDED'; nextGate = 'OBTAIN_CURRENT_HEAD_PROOF';
  }
  const links = frozenLinks({ issue, pr, head: sourceHead, runId, artifactId });
  const primarySourceLink = links.find((x) => x.kind === 'artifact')?.url
    || links.find((x) => x.kind === 'workflow')?.url
    || (pr && sourceHead ? GITHUB_ROOT + '/pull/' + pr + '/commits/' + sourceHead : '')
    || links.find((x) => x.kind === 'pr')?.url
    || links.find((x) => x.kind === 'issue')?.url || '';
  const participantId = safeId(record.participantId || record.sender) || 'UNKNOWN';
  return Object.freeze({
    proofId: safeId(record.proofId || record.receiptId) || 'UNKNOWN',
    kind: record.kind === SHARED_WORKSPACE_RECORD_KINDS.PROOF ? 'PROOF_RECORD' : 'RECEIPT_RECORD',
    participantId, participant: participantId,
    correlationId: safeId(record.correlationId) || 'UNKNOWN',
    timestampUtc: observedAtUtc, observedAtUtc, ageMs,
    observedAgeSeconds: Math.floor(ageMs / 1000),
    freshness: future ? 'FUTURE_DATED' : stale ? 'STALE' : 'CURRENT',
    claimStatus, summary: cleanText(record.summary, 'No summary supplied', 240),
    relatedIssue: issue ? '#' + issue : '', relatedPr: pr ? '#' + pr : '',
    goal: issue, goalTitle: titles.get(issue) || '', prNumber: pr,
    sourceHead, sourceTree, baseSha, stage, state, reportedResult,
    runId, runAttempt, artifactId, artifactDigest,
    sourceLink: primarySourceLink, sourceLinkTrust: primarySourceLink ? 'UNVERIFIED_METADATA' : 'NO_EXTERNAL_LINK',
    nextGate,
    links,
    proofRefs: Object.freeze((Array.isArray(record.proofRefs) ? record.proofRefs : []).filter(safeProofRef).slice(0, MAX_PROOF_REFS)),
    verification: 'VALID_WORKSPACE_RECORD_NOT_INDEPENDENTLY_VERIFIED',
    independentVerification: false, reviewerQualification: false,
    protectedMergeProven: false, installedProven: false, osPickupProven: false,
    authorizationGranted: false, approvalGranted: false,
  });
}
function filterNumber(value) {
  if (value === undefined || value === '') return { valid: true, value: null };
  const n = issueNumber(value);
  return { valid: Boolean(n), value: n };
}
function filterHead(value) {
  if (value === undefined || value === '') return { valid: true, value: '' };
  const sha = safeSha(value);
  return { valid: Boolean(sha), value: sha };
}

/**
 * The ONLY classification/normalisation implementation consumed by
 * the existing backend, Goal Dashboard, Agents Tile and ChatGPT relay.
 * Accepts record arrays already collected from the canonical workspace.
 */
export function projectSharedWorkspaceProofIndexV1(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(input.staleAfterMs) && input.staleAfterMs > 0
    ? input.staleAfterMs : DEFAULT_STALE_AFTER_MS;
  const maxItems = Number.isSafeInteger(input.maxItems)
    ? Math.min(SHARED_WORKSPACE_PROOF_INDEX_LIMIT, Math.max(1, input.maxItems))
    : SHARED_WORKSPACE_PROOF_INDEX_LIMIT;
  const available = input.sourceAvailable === true;
  const goal = filterNumber(input.goal);
  const pr = filterNumber(input.pr);
  const head = filterHead(input.head);
  const filterInvalid = !goal.valid || !pr.valid || !head.valid;
  const titles = new Map();
  for (const item of (Array.isArray(input.goalRecords) ? input.goalRecords : []).slice(0, 3000)) {
    const n = issueNumber(item?.relatedIssue || item?.issueNumber || item?.goalId);
    if (n && !titles.has(n)) titles.set(n, cleanText(item?.title, '', 160));
  }
  const heads = new Map();
  if (input.currentHeads && typeof input.currentHeads === 'object' && !Array.isArray(input.currentHeads)) {
    for (const [key, value] of Object.entries(input.currentHeads).slice(0, 60)) {
      const n = issueNumber(key), sha = safeSha(value);
      if (n && sha) heads.set(n, sha);
    }
  }
  const rawRecords = available && !filterInvalid
    ? [...(Array.isArray(input.proofRecords) ? input.proofRecords : []),
       ...(Array.isArray(input.receiptRecords) ? input.receiptRecords : [])]
    : [];
  let rejectedRecordCount = 0;
  const entriesByKey = new Map();
  for (const record of rawRecords.slice(0, 5000)) {
    if (!record || ![SHARED_WORKSPACE_RECORD_KINDS.PROOF, SHARED_WORKSPACE_RECORD_KINDS.RECEIPT].includes(record.kind)
      || !validateSharedWorkspaceRecord(record, { nowMs, staleAfterMs }).valid) {
      rejectedRecordCount++;
      continue;
    }
    const entry = projectRecord(record, nowMs, staleAfterMs, titles, heads);
    if (goal.value !== null && entry.goal !== goal.value) continue;
    if (pr.value !== null && entry.prNumber !== pr.value) continue;
    if (head.value && entry.sourceHead !== head.value) continue;
    const key = [entry.kind, entry.proofId, entry.sourceHead, entry.stage,
      entry.reportedResult, entry.timestampUtc, entry.runId, entry.runAttempt].join('|');
    if (!entriesByKey.has(key)) entriesByKey.set(key, entry);
  }
  const all = [...entriesByKey.values()].sort((a, b) => Date.parse(b.timestampUtc) - Date.parse(a.timestampUtc)
    || a.proofId.localeCompare(b.proofId));
  const entries = Object.freeze(all.slice(0, maxItems));
  const currentRecordCount = all.filter((x) => x.freshness === 'CURRENT').length;
  const state = filterInvalid ? 'INVALID_FILTER' : !available ? 'UNAVAILABLE'
    : !all.length ? 'UNKNOWN' : currentRecordCount ? 'RECORDED' : 'STALE';
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_PROOF_INDEX_SCHEMA,
    readOnly: true,
    source: 'EXISTING_SHARED_AGENT_WORKSPACE_PROOF_DIRECTORY',
    sourceAvailable: available,
    state, reason: filterInvalid ? 'PROOF_INDEX_FILTER_INVALID'
      : !available ? 'WORKSPACE_SOURCE_UNAVAILABLE'
      : !all.length ? 'NO_VALID_SCOPED_WORKSPACE_PROOF_RECORDS'
      : currentRecordCount ? 'WORKSPACE_RECORDS_VISIBLE_NOT_INDEPENDENTLY_ATTESTED'
      : 'ONLY_STALE_WORKSPACE_PROOF_RECORDS',
    projectedAtUtc: new Date(nowMs).toISOString(),
    totalValidRecords: all.length,
    currentRecordCount,
    staleRecordCount: all.length - currentRecordCount,
    rejectedRecordCount: rejectedRecordCount + Math.max(0, rawRecords.length - 5000),
    visibleCount: entries.length,
    omittedCount: Math.max(0, all.length - entries.length),
    entries,
    independentVerificationPerformed: false,
    grantsExecutionOrMergeAuthority: false,
  });
}

/** A deliberately smaller metadata-only view of the same canonical projector. */
export function projectSharedWorkspaceProofIndex({ feed = {}, goal, pr, head, nowMs, limit = 20, currentHeads = {} } = {}) {
  const available = feed?.state === 'ready' || feed?.state === 'stale';
  const result = projectSharedWorkspaceProofIndexV1({
    sourceAvailable: available,
    proofRecords: feed?.records?.proofRecords,
    receiptRecords: feed?.records?.receiptRecords,
    goalRecords: feed?.records?.goalRecords,
    goal, pr, head, nowMs, maxItems: limit, currentHeads,
  });
  const state = result.state === 'INVALID_FILTER' ? 'INVALID_FILTER'
    : !available ? 'INACCESSIBLE' : feed?.state === 'stale' ? 'STALE' : 'READY';
  // No local proofRefs or summaries leave this endpoint or Agents Tile facade.
  const entries = Object.freeze(result.entries.map((x) => Object.freeze({
    proofId: x.proofId, kind: x.kind, goal: x.goal, goalTitle: x.goalTitle,
    prNumber: x.prNumber, participant: x.participant, sourceHead: x.sourceHead,
    sourceTree: x.sourceTree, baseSha: x.baseSha, stage: x.stage,
    state: x.state, reportedResult: x.reportedResult, runId: x.runId,
    runAttempt: x.runAttempt, artifactId: x.artifactId,
    artifactDigest: x.artifactDigest, observedAtUtc: x.observedAtUtc,
    observedAgeSeconds: x.observedAgeSeconds, sourceLink: x.sourceLink,
    sourceLinkTrust: x.sourceLinkTrust, nextGate: x.nextGate,
    independentVerification: false, reviewerQualification: false,
    protectedMergeProven: false, installedProven: false, osPickupProven: false,
  })));
  const blockers = state === 'INVALID_FILTER' ? ['PROOF_INDEX_FILTER_INVALID']
    : state === 'INACCESSIBLE' ? ['WORKSPACE_FEED_UNAVAILABLE']
    : entries.length ? ['EXTERNAL_PROOF_VERIFICATION_NOT_COMMISSIONED']
    : ['NO_SCOPED_WORKSPACE_PROOF_RECORDS'];
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_PROOF_INDEX_SCHEMA,
    readOnly: true, authority: noAuthority, state,
    source: result.source, total: result.totalValidRecords,
    shown: entries.length, truncated: result.omittedCount > 0,
    goal: result.state === 'INVALID_FILTER' ? null : filterNumber(goal).value,
    prNumber: result.state === 'INVALID_FILTER' ? null : filterNumber(pr).value,
    sourceHead: result.state === 'INVALID_FILTER' ? '' : filterHead(head).value,
    entries, blockers: Object.freeze(blockers),
    nextAction: state === 'INACCESSIBLE' ? 'Restore the canonical workspace feed.'
      : 'Verify original GitHub/native evidence for the exact head before any stage is considered PROVEN.',
    independentVerificationPerformed: false, grantsExecutionOrMergeAuthority: false,
  });
}
