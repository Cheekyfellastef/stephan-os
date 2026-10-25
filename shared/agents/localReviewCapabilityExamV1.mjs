import { createHash, createPublicKey, verify } from 'node:crypto';

// Evaluation of externally captured qualification evidence, never a trust grant.
// Untrusted sources (including a local model or a GitHub comment) cannot
// register themselves as qualified reviewers or change merge/security policy.
export const LOCAL_REVIEW_EXAM_SCHEMA = 'stephanos.local-review-capability-exam.v1';
export const LOCAL_REVIEW_EXAM_VERSION = 1;
export const LOCAL_REVIEW_EXAM_CHALLENGES = Object.freeze([
  'readonly-device-identity',
  'exact-source-head',
  'bounded-file-inspection',
  'source-mutation-denial',
  'task-reentry-observation',
  'full-diff-review',
  'adversarial-finding-detection',
  'reviewer-implementer-separation',
  'meter-exhaustion-failover',
  'replay-and-head-change-denial',
]);
export const LOCAL_REVIEW_EXAM_PRIVILEGED = Object.freeze([
  'native-windows-identity',
  'original-writer-negative-write',
  'direct-and-task-reentry-denial',
  'separate-protected-signers',
  'independently-audited-commissioning',
]);
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const IDENT = /^[a-z][a-z0-9._:-]{3,119}$/;
const REPO = /^[a-z0-9._-]+\/[a-z0-9._-]+$/i;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const keys = (value, expected) => value && typeof value === 'object'
  && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const sha = data => createHash('sha256').update(data).digest('hex');
const text = value => typeof value === 'string' ? value : '';
const frozenDenial = Object.freeze({
  qualifiedWindowsSpecialist: false,
  independentSecurityReviewSatisfied: false,
  protectedMergeAuthority: false,
  sourceMutationAuthority: false,
  leaseReleaseAuthority: false,
  serviceInstallationAuthority: false,
  signedWindowsCustodyProven: false,
});
const report = (status, blockers, data = {}) => Object.freeze({
  schemaVersion: LOCAL_REVIEW_EXAM_SCHEMA,
  status,
  blockers: Object.freeze([...new Set(blockers)]),
  ...data,
  ...frozenDenial,
});

/**
 * Caller passes signed receipts acquired by an independent trusted transport.
 * The pin passed in trust is NOT authenticated by this function. Only
 * production host configuration can establish that pin's trusted origin.
 */
export function assessLocalReviewCapabilityExam(input = {}, { nowMs = Date.now(), trust = {} } = {}) {
  const blockers = [];
  const repository = text(input.repository);
  const head = text(input.sourceHead);
  const base = text(input.baseSha);
  const implementer = text(input.implementerPrincipal);
  const reviewer = text(input.reviewerPrincipal);
  const auditor = text(input.auditorPrincipal);
  if (!REPO.test(repository) || !SHA40.test(head) || !SHA40.test(base) || head === base) {
    blockers.push('EXACT_SOURCE_IDENTITY_MISSING');
  }
  if (!IDENT.test(implementer) || !IDENT.test(reviewer) || !IDENT.test(auditor)
      || new Set([implementer, reviewer, auditor]).size !== 3) {
    blockers.push('THREE_INDEPENDENT_PRINCIPALS_REQUIRED');
  }
  if (input.implementerProvider === input.reviewerProvider || !IDENT.test(text(input.implementerProvider))
      || !IDENT.test(text(input.reviewerProvider))) {
    blockers.push('SEPARATE_IMPLEMENTER_REVIEW_PROVIDER_REQUIRED');
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) blockers.push('TRUSTED_CLOCK_MISSING');
  const receipts = Array.isArray(input.receipts) && input.receipts.length <= 32 ? input.receipts : [];
  if (!Array.isArray(input.receipts) || input.receipts.length > 32) blockers.push('RECEIPT_ESTATE_UNBOUNDED');
  const seen = new Set();
  const accepted = new Set();
  const allChallenges = [...LOCAL_REVIEW_EXAM_CHALLENGES, ...LOCAL_REVIEW_EXAM_PRIVILEGED];
  const forbidden = new Set([...allChallenges]);
  for (const item of receipts) {
    const required = ['schemaVersion', 'challengeId', 'repository', 'sourceHead', 'baseSha',
      'reviewerPrincipal', 'auditorPrincipal', 'observedAtUtc', 'outcome', 'evidenceSha256', 'signatureBase64'];
    if (!keys(item, required) || !forbidden.has(item?.challengeId)) {
      blockers.push('RECEIPT_SCHEMA_OR_SCOPE_INVALID');
      continue;
    }
    if (seen.has(item.challengeId)) {
      blockers.push('DUPLICATE_CHALLENGE_RECEIPT');
      continue;
    }
    seen.add(item.challengeId);
    if (item.schemaVersion !== LOCAL_REVIEW_EXAM_SCHEMA || item.repository !== repository
      || item.sourceHead !== head || item.baseSha !== base
      || item.reviewerPrincipal !== reviewer || item.auditorPrincipal !== auditor
      || item.outcome !== 'passed' || !SHA64.test(text(item.evidenceSha256))) {
      blockers.push('CHALLENGE_SOURCE_OR_OUTCOME_MISMATCH');
      continue;
    }
    const timestamp = text(item.observedAtUtc);
    const observedAt = Date.parse(timestamp);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp)
      || !Number.isFinite(observedAt) || observedAt > nowMs
      || nowMs - observedAt > MAX_AGE_MS) {
      blockers.push('CHALLENGE_STALE_OR_FUTURE');
      continue;
    }
    // Reconstruct receipt without the signature in the same fixed schema order.
    const { signatureBase64, ...unsigned } = item;
    const bytes = Buffer.from(LOCAL_REVIEW_EXAM_SCHEMA + '\0' + JSON.stringify(unsigned), 'utf8');
    const signature = Buffer.from(text(signatureBase64), 'base64');
    const b64canonical = signature.length === 64 && signature.toString('base64') === signatureBase64;
    const publicKeyPem = text(trust.pinnedAuditorPublicKeyPem);
    const pinnedDigest = text(trust.pinnedAuditorPublicKeySha256);
    if (!publicKeyPem || !SHA64.test(pinnedDigest) || sha(Buffer.from(publicKeyPem)) !== pinnedDigest) {
      blockers.push('INDEPENDENT_AUDITOR_TRUST_PIN_MISSING');
      continue;
    }
    try {
      const key = createPublicKey(publicKeyPem);
      if (key.asymmetricKeyType !== 'ed25519' || !b64canonical || !verify(null, bytes, key, signature)) {
        blockers.push('AUDITOR_SIGNATURE_INVALID');
        continue;
      }
    } catch {
      blockers.push('AUDITOR_SIGNATURE_INVALID');
      continue;
    }
    accepted.add(item.challengeId);
  }
  const missingCore = LOCAL_REVIEW_EXAM_CHALLENGES.filter(id => !accepted.has(id));
  const missingWindows = LOCAL_REVIEW_EXAM_PRIVILEGED.filter(id => !accepted.has(id));
  if (missingCore.length) blockers.push('BASELINE_CHALLENGES_NOT_PROVEN');
  // A signed receipt proves an assertion by a pinned key, not that that key
  // belongs to an independently provisioned Windows/host auditor.
  if (trust.provisioningVerified !== true) blockers.push('AUDITOR_PROVISIONING_NOT_VERIFIED');
  if (!input.hardcodedCodexSpecialistGateStillRequired) blockers.push('CURRENT_WINDOWS_SPECIALIST_GATE_NOT_ACKNOWLEDGED');
  const status = blockers.length ? 'QUALIFICATION_EVIDENCE_HELD' : 'QUALIFICATION_EVIDENCE_READY_FOR_INDEPENDENT_ADMISSION';
  return report(status, blockers, {
    sourceHead: SHA40.test(head) ? head : '',
    baseSha: SHA40.test(base) ? base : '',
    challengeCount: accepted.size,
    baselineChallengeCount: LOCAL_REVIEW_EXAM_CHALLENGES.length,
    baselineEvidenceComplete: missingCore.length === 0 && blockers.length === 0,
    missingBaseline: Object.freeze(missingCore),
    missingPrivileged: Object.freeze(missingWindows),
    windowsEvidenceComplete: missingWindows.length === 0 && blockers.length === 0,
    nextGate: missingCore.length > 0 ? 'CAPTURE_AND_AUTHENTICATE_BASELINE_EXAM'
      : missingWindows.length > 0 ? 'INDEPENDENT_WINDOWS_SPECIALIST_AND_PHYSICAL_EXAM'
      : 'EXTERNAL_TRUST_BOOTSTRAP_AND_PROTECTED_POLICY_REVIEW',
    // A passing skill exam is not a signed, independent GitHub specialist
    // approval and cannot change the policy that currently pins Codex.
    currentWindowsReviewProvider: 'chatgpt-codex-connector',
    historicalOriginalExecutionOutcome: 'UNKNOWN',
  });
}
