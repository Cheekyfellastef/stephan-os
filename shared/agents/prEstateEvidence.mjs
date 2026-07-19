import {
  FULL_SHA_PATTERN,
  PLACEHOLDER_PATTERN,
  PR_DISPOSITIONS,
  VALID_DISPOSITIONS,
  asBooleanOrNull,
  asInteger,
  asPositiveInteger,
  asText,
  normalizeFiles,
  normalizeLabels,
  readAliasedField,
} from './prEstateContracts.mjs';
import {
  acceptanceGateIsPending,
  approvalGateIsPending,
} from './prEstateGateEvidence.mjs';

const CONTROLLED_DISPOSITION_HINTS = new Set([
  PR_DISPOSITIONS.ACTIVE_CANONICAL,
  PR_DISPOSITIONS.WAITING_ACCEPTANCE,
  PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL,
]);

export function normalizePr(input = {}, recordIndex = 0) {
  const numberField = readAliasedField(input, ['number', 'prNumber']);
  const headField = readAliasedField(input, ['headSha', 'headRefOid', 'head_sha']);
  const aheadField = readAliasedField(input, ['aheadBy', 'ahead_by']);
  const behindField = readAliasedField(input, ['behindBy', 'behind_by']);
  const containedField = readAliasedField(input, ['headContainedInBase']);
  const comparedHeadField = readAliasedField(input, ['comparedHeadSha', 'compared_head_sha']);
  const uniqueDeltaField = readAliasedField(input, ['uniqueDelta']);
  const dispositionHintField = readAliasedField(input, ['dispositionHint']);
  const baseField = readAliasedField(input, ['baseRefName', 'base']);
  const supersessionSourceField = readAliasedField(input, [
    'supersessionSourceHeadSha',
    'comparedSourceHeadSha',
    'supersession_source_head_sha',
  ]);
  const supersessionTargetPrField = readAliasedField(input, [
    'supersessionTargetPr',
    'comparedCanonicalPr',
    'supersession_target_pr',
  ]);
  const supersessionTargetHeadField = readAliasedField(input, [
    'supersessionTargetHeadSha',
    'comparedCanonicalHeadSha',
    'supersession_target_head_sha',
  ]);

  const number = asPositiveInteger(numberField.value, null);
  const headSha = asText(headField.value, '');
  const exactHeadKnown = FULL_SHA_PATTERN.test(headSha);
  const aheadBy = asInteger(aheadField.value, null);
  const behindBy = asInteger(behindField.value, null);
  const explicitContained = asBooleanOrNull(containedField.value);
  const comparedHeadSha = asText(comparedHeadField.value, '');
  const uniqueDelta = asBooleanOrNull(uniqueDeltaField.value);

  const identityAliasConflict = numberField.conflicting || headField.conflicting;
  const comparisonAliasConflict = aheadField.conflicting
    || behindField.conflicting
    || containedField.conflicting
    || comparedHeadField.conflicting
    || baseField.conflicting;
  const supersessionAliasConflict = supersessionSourceField.conflicting
    || supersessionTargetPrField.conflicting
    || supersessionTargetHeadField.conflicting;
  const evidenceAliasConflict = identityAliasConflict
    || comparisonAliasConflict
    || supersessionAliasConflict;

  const invalidAheadBy = aheadField.present && (!Number.isInteger(aheadBy) || aheadBy < 0);
  const invalidBehindBy = behindField.present && (!Number.isInteger(behindBy) || behindBy < 0);
  const invalidHeadContainedInBase = containedField.present && typeof containedField.value !== 'boolean';
  const comparisonEvidencePresent = aheadField.present || behindField.present || containedField.present;
  const comparisonEvidenceInvalid = invalidAheadBy
    || invalidBehindBy
    || invalidHeadContainedInBase
    || comparisonAliasConflict;
  const comparisonHeadKnown = FULL_SHA_PATTERN.test(comparedHeadSha);
  const comparisonHeadMatches = comparisonEvidencePresent
    && exactHeadKnown
    && comparisonHeadKnown
    && comparedHeadSha.toLowerCase() === headSha.toLowerCase();
  const comparisonHeadMismatch = comparisonEvidencePresent && !comparisonHeadMatches;
  const containmentContradiction = !comparisonEvidenceInvalid
    && explicitContained !== null
    && aheadBy !== null
    && ((explicitContained === false && aheadBy === 0) || (explicitContained === true && aheadBy > 0));
  const compareKnown = comparisonEvidencePresent
    && !comparisonEvidenceInvalid
    && !containmentContradiction
    && comparisonHeadMatches;
  const headContainedInBase = compareKnown
    && (explicitContained === true || (explicitContained === null && aheadBy === 0));

  const invalidUniqueDelta = uniqueDeltaField.present && typeof uniqueDeltaField.value !== 'boolean';
  const dispositionHint = VALID_DISPOSITIONS.has(dispositionHintField.value)
    ? dispositionHintField.value
    : '';
  const invalidDispositionHint = dispositionHintField.present
    && !VALID_DISPOSITIONS.has(dispositionHintField.value);

  return {
    recordIndex,
    number,
    state: asText(input.state, '').toLowerCase(),
    title: asText(input.title, ''),
    body: asText(input.body, ''),
    url: asText(input.url, ''),
    isDraft: input.isDraft === true || input.draft === true,
    headRefName: asText(input.headRefName ?? input.head, ''),
    headSha,
    exactHeadKnown,
    baseRefName: asText(baseField.value, ''),
    baseRefKnown: baseField.present && Boolean(asText(baseField.value, '')),
    createdAt: asText(input.createdAt ?? input.created_at, ''),
    updatedAt: asText(input.updatedAt ?? input.updated_at, ''),
    mergeable: asText(input.mergeable, 'UNKNOWN').toUpperCase(),
    labels: normalizeLabels(input.labels),
    changedFiles: normalizeFiles(input.changedFiles ?? input.files),
    aheadBy,
    behindBy,
    explicitContained,
    comparedHeadSha,
    comparisonEvidencePresent,
    compareKnown,
    comparisonEvidenceInvalid,
    evidenceAliasConflict,
    identityAliasConflict,
    comparisonAliasConflict,
    supersessionAliasConflict,
    invalidAheadBy,
    invalidBehindBy,
    invalidHeadContainedInBase,
    comparisonHeadKnown,
    comparisonHeadMatches,
    comparisonHeadMismatch,
    containmentContradiction,
    headContainedInBase,
    patchEquivalentTo: asPositiveInteger(input.patchEquivalentTo, null),
    uniqueDelta,
    invalidUniqueDelta,
    supersessionSourceHeadSha: asText(supersessionSourceField.value, ''),
    supersessionTargetPr: asPositiveInteger(supersessionTargetPrField.value, null),
    supersessionTargetHeadSha: asText(supersessionTargetHeadField.value, ''),
    activeHint: input.activeHint === true,
    dispositionHint,
    invalidDispositionHint,
  };
}

function ambiguous(reason, blocker) {
  return { disposition: PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED, reason, blockers: [blocker] };
}

function supersessionProof(pr, targetPr, canonicalRecord) {
  if (!targetPr) return { valid: false, blocker: 'canonical-survivor-required', reason: 'supersession has no canonical target' };
  if (pr.number === targetPr) return { valid: false, blocker: 'self-supersession-target', reason: 'supersession cannot target the source PR itself' };
  if (pr.uniqueDelta === true) return { valid: false, blocker: 'contradictory-supersession-evidence', reason: 'supersession evidence conflicts with an explicit unique delta' };
  if (!(pr.patchEquivalentTo === targetPr || pr.uniqueDelta === false)) {
    return { valid: false, blocker: 'patch-equivalence-or-unique-delta-required', reason: 'supersession lacks equivalence or explicit no-unique-delta evidence' };
  }
  if (!pr.exactHeadKnown || !FULL_SHA_PATTERN.test(pr.supersessionSourceHeadSha) || pr.supersessionSourceHeadSha.toLowerCase() !== pr.headSha.toLowerCase()) {
    return { valid: false, blocker: 'supersession-source-head-mismatch', reason: 'supersession evidence is not tied to the current source head' };
  }
  if (pr.supersessionTargetPr !== targetPr) {
    return { valid: false, blocker: 'supersession-target-pr-mismatch', reason: 'supersession evidence names a different canonical PR' };
  }
  if (!canonicalRecord || !canonicalRecord.exactHeadKnown) {
    return { valid: false, blocker: 'canonical-record-required', reason: 'current canonical record is missing from the snapshot' };
  }
  if (!FULL_SHA_PATTERN.test(pr.supersessionTargetHeadSha) || pr.supersessionTargetHeadSha.toLowerCase() !== canonicalRecord.headSha.toLowerCase()) {
    return { valid: false, blocker: 'supersession-target-head-mismatch', reason: 'supersession evidence is not tied to the current canonical head' };
  }
  return { valid: true, blocker: '', reason: '' };
}

export function classifyPr(pr, family, canonicalRecord) {
  const bodyAndTitle = `${pr.title}\n${pr.body}`;
  const placeholder = PLACEHOLDER_PATTERN.test(bodyAndTitle);
  const acceptanceGate = acceptanceGateIsPending(bodyAndTitle);
  const approvalGate = approvalGateIsPending(bodyAndTitle);
  const explicitSupersededBy = family?.supersededBy?.[pr.number] ?? null;
  const canonicalPr = family?.canonicalPr ?? null;
  const familySize = family?.members?.length ?? 1;

  if (pr.evidenceAliasConflict) return ambiguous('evidence aliases contain conflicting values', 'conflicting-evidence-alias');
  if (pr.number === null || pr.state !== 'open') return ambiguous(pr.number === null ? 'missing valid PR number' : `expected open PR evidence, received state=${pr.state}`, 'invalid-or-non-open-pr-record');
  if (pr.invalidDispositionHint) return ambiguous('disposition hint is present but unsupported', 'invalid-disposition-hint');
  if (pr.comparisonEvidenceInvalid || pr.invalidUniqueDelta) return ambiguous('evidence contains a malformed value', 'invalid-comparison-evidence');
  if (pr.comparisonEvidencePresent && (!pr.exactHeadKnown || !pr.comparisonHeadKnown)) return ambiguous('comparison evidence lacks a valid exact head SHA', 'exact-head-evidence-required');
  if (pr.comparisonHeadMismatch) return ambiguous('comparison evidence is not tied to the declared PR head', 'comparison-head-mismatch');
  if (pr.containmentContradiction) return ambiguous('compare evidence contradicts explicit containment evidence', 'contradictory-containment-evidence');

  if (pr.dispositionHint) {
    if (CONTROLLED_DISPOSITION_HINTS.has(pr.dispositionHint) && canonicalPr !== null && canonicalPr !== pr.number) {
      return ambiguous(`controlled disposition hint conflicts with configured canonical PR #${canonicalPr}`, 'noncanonical-controlled-disposition-hint');
    }
    if (CONTROLLED_DISPOSITION_HINTS.has(pr.dispositionHint) && acceptanceGate) {
      return { disposition: PR_DISPOSITIONS.WAITING_ACCEPTANCE, reason: 'outstanding acceptance gate overrides controlled disposition hint', blockers: ['acceptance-proof-required'] };
    }
    if (CONTROLLED_DISPOSITION_HINTS.has(pr.dispositionHint) && approvalGate) {
      return { disposition: PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL, reason: 'outstanding operator approval gate overrides controlled disposition hint', blockers: ['operator-approval-required'] };
    }
    if (pr.dispositionHint === PR_DISPOSITIONS.ALREADY_IN_MAIN) {
      if (pr.baseRefName !== 'main') return ambiguous('already-in-main hint was compared against a non-main base', 'branch-to-main-compare-required');
      if (!pr.compareKnown || !pr.headContainedInBase || pr.uniqueDelta === true) return ambiguous('already-in-main hint lacks exact non-conflicting containment evidence', 'containment-evidence-required');
    }
    if (pr.dispositionHint === PR_DISPOSITIONS.PLACEHOLDER_FAILED) {
      if (!placeholder) return ambiguous('placeholder-failed hint lacks Codex failure marker', 'placeholder-failure-marker-required');
      if (pr.baseRefName !== 'main') return ambiguous('placeholder-failed hint was compared against a non-main base', 'branch-to-main-compare-required');
      if (!pr.compareKnown || !pr.headContainedInBase || pr.uniqueDelta === true) return ambiguous('placeholder-failed hint lacks exact no-unique-delta evidence', 'placeholder-no-unique-delta-evidence-required');
    }
    if (pr.dispositionHint === PR_DISPOSITIONS.SUPERSEDED) {
      const proof = supersessionProof(pr, explicitSupersededBy ?? canonicalPr, canonicalRecord);
      if (!proof.valid) return ambiguous(proof.reason, proof.blocker);
    }
    return { disposition: pr.dispositionHint, reason: 'explicit validated disposition hint', blockers: [] };
  }

  if (placeholder) {
    if (!pr.compareKnown) return ambiguous('Codex placeholder PR has no branch-to-main compare evidence tied to the exact head', 'placeholder-branch-delta-unknown');
    if (pr.baseRefName !== 'main') return ambiguous('Codex placeholder compare evidence targets a non-main base', 'branch-to-main-compare-required');
    if (pr.headContainedInBase && pr.uniqueDelta === true) return ambiguous('placeholder containment evidence conflicts with an explicit unique delta', 'conflicting-placeholder-delta-evidence');
    if (!pr.headContainedInBase && pr.uniqueDelta === false) return ambiguous('placeholder compare evidence conflicts with an explicit no-unique-delta claim', 'conflicting-placeholder-delta-evidence');
    if (pr.headContainedInBase) return { disposition: PR_DISPOSITIONS.PLACEHOLDER_FAILED, reason: 'Codex placeholder branch has no commits unique to current base', blockers: [] };
    return { disposition: PR_DISPOSITIONS.RECOVER_UNIQUE_WORK, reason: 'Codex placeholder branch still has commits unique to current base', blockers: ['inspect-and-recover-placeholder-delta'] };
  }

  if (pr.headContainedInBase) {
    if (pr.baseRefName !== 'main') return ambiguous('containment evidence targets a non-main base and cannot prove the PR is already in main', 'branch-to-main-compare-required');
    if (pr.uniqueDelta === true) return ambiguous('containment evidence conflicts with an explicit unique delta', 'conflicting-unique-delta-evidence');
    return { disposition: PR_DISPOSITIONS.ALREADY_IN_MAIN, reason: 'exact compare evidence shows no commits unique to the PR head', blockers: [] };
  }

  if (explicitSupersededBy !== null) {
    if (pr.uniqueDelta === true && pr.patchEquivalentTo === explicitSupersededBy) return ambiguous('patch equivalence contradicts an explicit unique delta', 'contradictory-supersession-evidence');
    if (pr.uniqueDelta === true) return { disposition: PR_DISPOSITIONS.RECOVER_UNIQUE_WORK, reason: `PR has unique work not yet proven in canonical PR #${explicitSupersededBy}`, blockers: ['transplant-unique-delta'] };
    const proof = supersessionProof(pr, explicitSupersededBy, canonicalRecord);
    if (proof.valid) return { disposition: PR_DISPOSITIONS.SUPERSEDED, reason: `exact-head evidence shows PR is covered by canonical PR #${explicitSupersededBy}`, blockers: [] };
    return ambiguous(proof.reason, proof.blocker);
  }

  if (canonicalPr === pr.number) {
    if (acceptanceGate) return { disposition: PR_DISPOSITIONS.WAITING_ACCEPTANCE, reason: 'canonical family survivor is explicitly waiting for live acceptance proof', blockers: ['acceptance-proof-required'] };
    if (approvalGate) return { disposition: PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL, reason: 'canonical family survivor is explicitly waiting for operator approval', blockers: ['operator-approval-required'] };
    return { disposition: PR_DISPOSITIONS.ACTIVE_CANONICAL, reason: 'selected canonical survivor for its capability family', blockers: [] };
  }

  if (familySize > 1) {
    if (canonicalPr === null) return ambiguous(`duplicate family ${family.id} has no selected canonical survivor`, 'canonical-selection-required');
    if (pr.uniqueDelta === true && pr.patchEquivalentTo === canonicalPr) return ambiguous('patch equivalence contradicts an explicit unique delta', 'contradictory-supersession-evidence');
    if (pr.uniqueDelta === true) return { disposition: PR_DISPOSITIONS.RECOVER_UNIQUE_WORK, reason: `non-canonical family member has unique work relative to #${canonicalPr}`, blockers: ['transplant-unique-delta'] };
    const proof = supersessionProof(pr, canonicalPr, canonicalRecord);
    if (proof.valid) return { disposition: PR_DISPOSITIONS.SUPERSEDED, reason: `exact-head evidence shows non-canonical member is covered by #${canonicalPr}`, blockers: [] };
    return ambiguous(proof.reason || `non-canonical family member requires comparison with #${canonicalPr}`, proof.blocker || 'unique-delta-analysis-required');
  }

  if (acceptanceGate) return { disposition: PR_DISPOSITIONS.WAITING_ACCEPTANCE, reason: 'PR explicitly documents an outstanding live acceptance gate', blockers: ['acceptance-proof-required'] };
  if (approvalGate) return { disposition: PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL, reason: 'PR explicitly documents an outstanding operator approval gate', blockers: ['operator-approval-required'] };
  if (pr.activeHint) return { disposition: PR_DISPOSITIONS.ACTIVE_CANONICAL, reason: 'explicit active canonical hint', blockers: [] };

  const reasons = [];
  if (!pr.compareKnown) reasons.push('branch-to-main compare evidence missing');
  if (pr.mergeable === 'UNKNOWN') reasons.push('mergeability evidence missing');
  return { disposition: PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED, reason: reasons.length ? reasons.join('; ') : 'open PR has no durable estate disposition evidence', blockers: ['estate-disposition-review-required'] };
}

export function evidenceFor(pr, family, placeholder, canonicalRecord) {
  return {
    compareKnown: pr.compareKnown,
    comparisonEvidencePresent: pr.comparisonEvidencePresent,
    comparedHeadSha: pr.comparedHeadSha,
    baseRefName: pr.baseRefName,
    baseRefKnown: pr.baseRefKnown,
    comparisonHeadKnown: pr.comparisonHeadKnown,
    comparisonHeadMatches: pr.comparisonHeadMatches,
    comparisonHeadMismatch: pr.comparisonHeadMismatch,
    exactHeadKnown: pr.exactHeadKnown,
    headSha: pr.headSha,
    comparisonEvidenceInvalid: pr.comparisonEvidenceInvalid,
    evidenceAliasConflict: pr.evidenceAliasConflict,
    identityAliasConflict: pr.identityAliasConflict,
    comparisonAliasConflict: pr.comparisonAliasConflict,
    supersessionAliasConflict: pr.supersessionAliasConflict,
    invalidAheadBy: pr.invalidAheadBy,
    invalidBehindBy: pr.invalidBehindBy,
    invalidHeadContainedInBase: pr.invalidHeadContainedInBase,
    invalidUniqueDelta: pr.invalidUniqueDelta,
    invalidDispositionHint: pr.invalidDispositionHint,
    aheadBy: pr.aheadBy,
    behindBy: pr.behindBy,
    headContainedInBase: pr.headContainedInBase,
    containmentContradiction: pr.containmentContradiction,
    changedFileCount: pr.changedFiles.length,
    patchEquivalentTo: pr.patchEquivalentTo,
    uniqueDelta: pr.uniqueDelta,
    supersessionSourceHeadSha: pr.supersessionSourceHeadSha,
    supersessionTargetPr: pr.supersessionTargetPr,
    supersessionTargetHeadSha: pr.supersessionTargetHeadSha,
    canonicalCurrentHeadSha: canonicalRecord?.headSha || '',
    placeholderFailureMarker: placeholder,
    familyCanonicalPr: family?.canonicalPr ?? null,
    explicitSupersededBy: family?.supersededBy?.[pr.number] ?? null,
  };
}

export function requireCapturedHeadSha(value, prNumber = 'unknown') {
  const sha = asText(value, '');
  if (!FULL_SHA_PATTERN.test(sha)) throw new Error(`PR #${prNumber} captured headRefOid is missing or invalid`);
  return sha;
}
