import {
  PLACEHOLDER_PATTERN,
  PR_DISPOSITIONS,
  PR_ESTATE_KIND,
  PR_ESTATE_SCHEMA_VERSION,
  TERMINAL_DISPOSITIONS,
  VALID_DISPOSITIONS,
  asText,
  unique,
} from './prEstateContracts.mjs';
import {
  classifyPr,
  evidenceFor,
  normalizePr,
  requireCapturedHeadSha,
} from './prEstateEvidence.mjs';
import {
  buildFamilyMaps,
  deriveImplicitFamilies,
  familyStatus,
} from './prEstateFamilies.mjs';

export {
  PR_DISPOSITIONS,
  PR_ESTATE_KIND,
  PR_ESTATE_SCHEMA_VERSION,
  requireCapturedHeadSha,
};

const CONTROLLED_NON_TERMINAL_DISPOSITIONS = new Set([
  PR_DISPOSITIONS.ACTIVE_CANONICAL,
  PR_DISPOSITIONS.WAITING_ACCEPTANCE,
  PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL,
]);

function fullSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value || ''));
}

function sameSha(left, right) {
  return fullSha(left) && fullSha(right) && String(left).toLowerCase() === String(right).toLowerCase();
}

export function buildPrEstateLedger(input = {}) {
  if (!Array.isArray(input.pullRequests)) throw new Error('pullRequests array is required');
  if (input.families !== undefined && !Array.isArray(input.families)) throw new Error('families array is required');

  const normalizedPrs = input.pullRequests.map((pr, index) => normalizePr(pr, index));
  const normalizedPrByNumber = new Map(
    normalizedPrs.filter((pr) => Number.isInteger(pr.number)).map((pr) => [pr.number, pr]),
  );
  const { byId: explicitFamiliesById, byPr: explicitFamilyByPr } = buildFamilyMaps(input.families || []);
  const implicitFamilyByPr = deriveImplicitFamilies(normalizedPrs, explicitFamilyByPr);
  const allFamiliesById = new Map(explicitFamiliesById);
  for (const family of implicitFamilyByPr.values()) allFamiliesById.set(family.id, family);

  const entries = normalizedPrs.map((pr) => {
    const family = Number.isInteger(pr.number)
      ? (explicitFamilyByPr.get(pr.number) || implicitFamilyByPr.get(pr.number) || null)
      : null;
    const canonicalRecord = family?.canonicalPr
      ? (normalizedPrByNumber.get(family.canonicalPr) || null)
      : null;
    const placeholder = PLACEHOLDER_PATTERN.test(`${pr.title}\n${pr.body}`);
    const result = classifyPr(pr, family, canonicalRecord);
    return {
      recordIndex: pr.recordIndex,
      number: pr.number,
      state: pr.state,
      title: pr.title,
      url: pr.url,
      familyId: family?.id || null,
      familyLabel: family?.label || null,
      canonicalPr: family?.canonicalPr ?? null,
      disposition: result.disposition,
      reason: result.reason,
      blockers: result.blockers,
      evidence: evidenceFor(pr, family, placeholder, canonicalRecord),
      headRefName: pr.headRefName,
      headSha: pr.headSha,
      baseRefName: pr.baseRefName,
      isDraft: pr.isDraft,
      updatedAt: pr.updatedAt,
    };
  }).sort((a, b) => (b.number ?? -1) - (a.number ?? -1) || a.recordIndex - b.recordIndex);

  const familyGroups = new Map();
  for (const entry of entries) {
    const id = entry.familyId
      || (Number.isInteger(entry.number) ? `single-pr-${entry.number}` : `single-record-${entry.recordIndex}`);
    const group = familyGroups.get(id) || [];
    group.push(entry);
    familyGroups.set(id, group);
  }

  const families = [...familyGroups.entries()].map(([id, familyEntries]) => {
    const family = allFamiliesById.get(id) || {
      id,
      label: familyEntries[0]?.title || id,
      members: familyEntries.map((entry) => entry.number).filter(Number.isInteger),
      canonicalPr: familyEntries[0]?.canonicalPr ?? null,
      selectionBasis: '',
    };
    const summary = familyStatus(familyEntries, family);
    return {
      id,
      label: family.label,
      members: familyEntries.map((entry) => entry.number).filter(Number.isInteger).sort((a, b) => a - b),
      canonicalPr: family.canonicalPr,
      selectionBasis: family.selectionBasis || '',
      status: summary.status,
      blockers: summary.blockers,
      dispositions: Object.fromEntries(
        familyEntries.map((entry) => [entry.number ?? `record-${entry.recordIndex}`, entry.disposition]),
      ),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const dispositionCounts = Object.fromEntries(
    Object.values(PR_DISPOSITIONS).map((value) => [value, 0]),
  );
  for (const entry of entries) dispositionCounts[entry.disposition] += 1;

  const recoveryPriority = {
    [PR_DISPOSITIONS.RECOVER_UNIQUE_WORK]: 1,
    [PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED]: 2,
    [PR_DISPOSITIONS.WAITING_ACCEPTANCE]: 3,
    [PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL]: 4,
    [PR_DISPOSITIONS.ACTIVE_CANONICAL]: 5,
  };
  const recoveryQueue = entries
    .filter((entry) => !TERMINAL_DISPOSITIONS.has(entry.disposition))
    .sort((a, b) => (
      (recoveryPriority[a.disposition] ?? 99) - (recoveryPriority[b.disposition] ?? 99)
      || (b.number ?? -1) - (a.number ?? -1)
    ))
    .map((entry) => ({
      number: entry.number,
      recordIndex: entry.recordIndex,
      familyId: entry.familyId,
      disposition: entry.disposition,
      nextAction: entry.blockers[0] || 'continue-canonical-lane',
    }));

  const blockers = unique(
    families.flatMap((family) => family.blockers.map((blocker) => `${family.id}:${blocker}`)),
  );
  const finalVerdict = blockers.length === 0
    && recoveryQueue.every((item) => CONTROLLED_NON_TERMINAL_DISPOSITIONS.has(item.disposition))
    ? 'PR_ESTATE_CONTROLLED'
    : 'PR_ESTATE_RECONCILIATION_REQUIRED';

  return {
    schemaVersion: PR_ESTATE_SCHEMA_VERSION,
    kind: PR_ESTATE_KIND,
    generatedAt: asText(input.generatedAt, 'pending'),
    repository: asText(input.repository, 'unknown'),
    inputRecordCount: entries.length,
    openPrCount: entries.filter((entry) => entry.state === 'open').length,
    dispositionCounts,
    finalVerdict,
    blockers,
    families,
    entries,
    recoveryQueue,
    safety: {
      readOnly: true,
      closesPullRequests: false,
      deletesBranches: false,
      mergesPullRequests: false,
      unknownEvidenceFailsClosed: true,
    },
  };
}

export function validatePrEstateLedger(ledger = {}) {
  const errors = [];
  if (ledger.schemaVersion !== PR_ESTATE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (ledger.kind !== PR_ESTATE_KIND) errors.push('invalid-kind');
  if (!Array.isArray(ledger.entries)) errors.push('entries-missing');
  if (!Array.isArray(ledger.families)) errors.push('families-missing');
  if (!Array.isArray(ledger.recoveryQueue)) errors.push('recovery-queue-missing');

  for (const entry of ledger.entries || []) {
    const identity = entry.number ?? `record-${entry.recordIndex ?? 'unknown'}`;
    const evidence = entry.evidence || {};
    if (!Number.isInteger(entry.number)) errors.push(`invalid-pr-number:record-${entry.recordIndex ?? 'unknown'}`);
    if (entry.state !== 'open') errors.push(`non-open-pr-record:${identity}`);
    if (!VALID_DISPOSITIONS.has(entry.disposition)) errors.push(`invalid-disposition:${identity}`);

    if (evidence.comparisonEvidenceInvalid === true && entry.disposition !== PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED) {
      errors.push(`terminal-with-invalid-comparison-evidence:${identity}`);
    }
    if (evidence.comparisonHeadMismatch === true && entry.disposition !== PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED) {
      errors.push(`terminal-with-stale-comparison-head:${identity}`);
    }
    if (evidence.containmentContradiction === true && entry.disposition !== PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED) {
      errors.push(`terminal-with-contradictory-containment:${identity}`);
    }
    if (TERMINAL_DISPOSITIONS.has(entry.disposition) && evidence.exactHeadKnown !== true) {
      errors.push(`terminal-without-exact-head:${identity}`);
    }

    if (entry.disposition === PR_DISPOSITIONS.ALREADY_IN_MAIN) {
      if (evidence.compareKnown !== true || evidence.comparisonHeadMatches !== true) {
        errors.push(`already-in-main-without-exact-compare:${identity}`);
      }
      if (evidence.headContainedInBase !== true || evidence.uniqueDelta === true) {
        errors.push(`already-in-main-without-containment:${identity}`);
      }
    }

    if (entry.disposition === PR_DISPOSITIONS.PLACEHOLDER_FAILED) {
      if (evidence.placeholderFailureMarker !== true) errors.push(`placeholder-failed-without-marker:${identity}`);
      if (evidence.compareKnown !== true || evidence.comparisonHeadMatches !== true) {
        errors.push(`placeholder-failed-without-exact-compare:${identity}`);
      }
      if (evidence.headContainedInBase !== true || evidence.uniqueDelta === true) {
        errors.push(`placeholder-failed-without-no-unique-delta:${identity}`);
      }
    }

    if (entry.disposition === PR_DISPOSITIONS.SUPERSEDED) {
      const canonicalTarget = entry.canonicalPr;
      const explicitTarget = evidence.explicitSupersededBy ?? null;
      if (evidence.uniqueDelta === true) errors.push(`superseded-with-unique-delta:${identity}`);
      if (!canonicalTarget) errors.push(`superseded-without-canonical:${identity}`);
      if (evidence.familyCanonicalPr !== undefined && evidence.familyCanonicalPr !== null && evidence.familyCanonicalPr !== canonicalTarget) {
        errors.push(`superseded-with-family-canonical-mismatch:${identity}`);
      }
      if (explicitTarget !== null && explicitTarget !== canonicalTarget) {
        errors.push(`superseded-target-not-canonical:${identity}`);
      }
      if (!(evidence.patchEquivalentTo === canonicalTarget || evidence.uniqueDelta === false)) {
        errors.push(`superseded-without-equivalence:${identity}`);
      }
      if (!sameSha(evidence.supersessionSourceHeadSha, entry.headSha)) {
        errors.push(`superseded-without-current-source-head:${identity}`);
      }
      if (evidence.supersessionTargetPr !== canonicalTarget) {
        errors.push(`superseded-with-wrong-target-pr:${identity}`);
      }
      if (!sameSha(evidence.supersessionTargetHeadSha, evidence.canonicalCurrentHeadSha)) {
        errors.push(`superseded-without-current-target-head:${identity}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length ? 'PR_ESTATE_LEDGER_INVALID' : 'PR_ESTATE_LEDGER_VALID',
  };
}

export function renderPrEstateReport(ledger = {}) {
  const lines = [
    '# Stephanos PR Estate Report',
    '',
    `Repository: ${ledger.repository || 'unknown'}`,
    `Generated: ${ledger.generatedAt || 'pending'}`,
    `Input records: ${ledger.inputRecordCount ?? ledger.openPrCount ?? 0}`,
    `Open PRs: ${ledger.openPrCount ?? 0}`,
    `Final verdict: ${ledger.finalVerdict || 'unknown'}`,
    '',
    '## Dispositions',
  ];
  for (const disposition of Object.values(PR_DISPOSITIONS)) {
    lines.push(`- ${disposition}: ${ledger.dispositionCounts?.[disposition] ?? 0}`);
  }
  lines.push('', '## Families requiring reconciliation');
  const blockedFamilies = (ledger.families || [])
    .filter((family) => family.status !== 'CONTROLLED' && family.status !== 'TERMINAL_READY');
  if (!blockedFamilies.length) lines.push('- none');
  for (const family of blockedFamilies) {
    lines.push(`- ${family.id}: ${family.members.map((number) => `#${number}`).join(', ') || 'invalid record'} | ${family.blockers.join('; ')}`);
  }
  lines.push('', '## Recovery queue');
  if (!(ledger.recoveryQueue || []).length) lines.push('- none');
  for (const item of ledger.recoveryQueue || []) {
    const identity = Number.isInteger(item.number) ? `#${item.number}` : `record-${item.recordIndex}`;
    lines.push(`- ${identity} | ${item.disposition} | ${item.familyId || 'unfamilied'} | ${item.nextAction}`);
  }
  lines.push(
    '',
    '## Safety',
    '- read-only classifier',
    '- no PR close, merge, branch deletion, reset, rebase or source mutation',
    '- incomplete evidence fails closed',
  );
  return `${lines.join('\n')}\n`;
}
