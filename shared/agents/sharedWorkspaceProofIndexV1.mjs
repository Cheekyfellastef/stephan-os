import {
  DEFAULT_STALE_AFTER_MS,
  SHARED_WORKSPACE_RECORD_KINDS,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

// A projection of existing proof/ records, NOT another proof writer or approval authority.
export const SHARED_WORKSPACE_PROOF_INDEX_SCHEMA = 'stephanos.shared-workspace-proof-index.v1';
export const SHARED_WORKSPACE_PROOF_INDEX_LIMIT = 24;
const MAX_PROOF_REFS = 8;
const MAX_FUTURE_SKEW_MS = 60_000;
const GITHUB_REPOSITORY = 'https://github.com/Cheekyfellastef/stephan-os';
const SHA = /^[a-f0-9]{40}$/i;
const SAFE_REF_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const PRIVATE_TEXT = /(?:BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|gh[pousr]_[a-z0-9_]+|sk-[a-z0-9_-]{12,}|xox[baprs]-|bearer\s+[a-z0-9._-]+|(?:token|secret|password|credential|api[_-]?key)\s*[:=]|[a-z]:\\|\\\\|\/(?:users|home|tmp|workspace)\/|\.env\b)/i;

function plainText(value, fallback = 'UNKNOWN', maxLength = 200) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return PRIVATE_TEXT.test(normalized) ? '[REDACTED]' : normalized.slice(0, maxLength);
}

function safeId(value) {
  return typeof value === 'string' && SAFE_REF_SEGMENT.test(value) ? value : '';
}

function issueNumber(value) {
  const match = /^#?([1-9]\d{0,6})$/.exec(String(value ?? '').trim());
  return match ? match[1] : '';
}

function safeProofRef(value) {
  if (typeof value !== 'string' || PRIVATE_TEXT.test(value) || value.length > 240) return false;
  const segments = value.split('/');
  if (segments.length === 1) return SAFE_REF_SEGMENT.test(value);
  const allowedPrefix = segments[0] === 'proof' || segments[0] === 'proofs' || segments[0] === 'receipts'
    || (segments[0] === 'evidence' && segments[1] === 'receipts');
  return allowedPrefix && segments.length <= 5 && segments.every((part) => SAFE_REF_SEGMENT.test(part));
}

function projectProof(record, nowMs, staleAfterMs) {
  const observed = Date.parse(record.timestampUtc);
  const ageMs = Math.max(0, nowMs - observed);
  const future = observed - nowMs > MAX_FUTURE_SKEW_MS;
  const stale = future || ageMs > staleAfterMs;
  const issue = issueNumber(record.relatedIssue);
  const pr = issueNumber(record.relatedPr);
  const sourceHead = SHA.test(String(record.sourceHead || '')) ? String(record.sourceHead).toLowerCase() : '';
  const links = [];
  if (issue) links.push(Object.freeze({ kind: 'issue', label: 'Goal #' + issue, url: GITHUB_REPOSITORY + '/issues/' + issue }));
  if (pr) links.push(Object.freeze({ kind: 'pr', label: 'PR #' + pr, url: GITHUB_REPOSITORY + '/pull/' + pr }));
  if (sourceHead) links.push(Object.freeze({ kind: 'commit', label: 'Source ' + sourceHead.slice(0, 8), url: GITHUB_REPOSITORY + '/commit/' + sourceHead }));
  return Object.freeze({
    proofId: safeId(record.proofId) || 'UNKNOWN',
    participantId: safeId(record.participantId) || 'UNKNOWN',
    correlationId: safeId(record.correlationId) || 'UNKNOWN',
    timestampUtc: record.timestampUtc,
    ageMs,
    freshness: future ? 'FUTURE_DATED' : stale ? 'STALE' : 'CURRENT',
    claimStatus: plainText(record.status, 'UNKNOWN', 48),
    summary: plainText(record.summary, 'No summary supplied', 240),
    relatedIssue: issue ? '#' + issue : '',
    relatedPr: pr ? '#' + pr : '',
    proofRefs: Object.freeze((Array.isArray(record.proofRefs) ? record.proofRefs : [])
      .filter(safeProofRef).slice(0, MAX_PROOF_REFS)),
    links: Object.freeze(links),
    verification: 'VALID_WORKSPACE_RECORD_NOT_INDEPENDENTLY_VERIFIED',
    authorizationGranted: false,
    approvalGranted: false,
  });
}

export function projectSharedWorkspaceProofIndexV1(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(input.staleAfterMs) && input.staleAfterMs > 0
    ? input.staleAfterMs : DEFAULT_STALE_AFTER_MS;
  const maxItems = Number.isSafeInteger(input.maxItems)
    ? Math.min(SHARED_WORKSPACE_PROOF_INDEX_LIMIT, Math.max(1, input.maxItems))
    : SHARED_WORKSPACE_PROOF_INDEX_LIMIT;
  const available = input.sourceAvailable === true;
  const records = available && Array.isArray(input.proofRecords) ? input.proofRecords : [];
  const valid = [];
  let rejectedCount = 0;
  for (const record of records) {
    if (!record || record.kind !== SHARED_WORKSPACE_RECORD_KINDS.PROOF
      || !validateSharedWorkspaceRecord(record, { nowMs, staleAfterMs }).valid) {
      rejectedCount++;
      continue;
    }
    valid.push(record);
  }
  valid.sort((a, b) => Date.parse(b.timestampUtc) - Date.parse(a.timestampUtc)
    || String(a.proofId).localeCompare(String(b.proofId)));
  const entries = Object.freeze(valid.slice(0, maxItems).map((record) => projectProof(record, nowMs, staleAfterMs)));
  const currentCount = valid.filter((record) => {
    const observed = Date.parse(record.timestampUtc);
    return observed - nowMs <= MAX_FUTURE_SKEW_MS && nowMs - observed <= staleAfterMs;
  }).length;
  const state = !available ? 'UNAVAILABLE' : !valid.length ? 'UNKNOWN' : currentCount ? 'RECORDED' : 'STALE';
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_PROOF_INDEX_SCHEMA,
    readOnly: true,
    source: 'EXISTING_SHARED_AGENT_WORKSPACE_PROOF_DIRECTORY',
    sourceAvailable: available,
    state,
    reason: !available ? 'WORKSPACE_SOURCE_UNAVAILABLE'
      : !valid.length ? 'NO_VALID_WORKSPACE_PROOF_RECORDS'
      : currentCount ? 'WORKSPACE_RECORDS_VISIBLE_NOT_INDEPENDENTLY_ATTESTED'
      : 'ONLY_STALE_WORKSPACE_PROOF_RECORDS',
    projectedAtUtc: new Date(nowMs).toISOString(),
    totalValidRecords: valid.length,
    currentRecordCount: currentCount,
    staleRecordCount: valid.length - currentCount,
    rejectedRecordCount: rejectedCount,
    visibleCount: entries.length,
    omittedCount: Math.max(0, valid.length - entries.length),
    entries,
    independentVerificationPerformed: false,
    grantsExecutionOrMergeAuthority: false,
  });
}
