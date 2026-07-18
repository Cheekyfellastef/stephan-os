export const PR_ESTATE_SCHEMA_VERSION = 'stephanos.pr-estate.v1';
export const PR_ESTATE_KIND = 'stephanos.pr-estate.ledger';

export const PR_DISPOSITIONS = Object.freeze({
  ACTIVE_CANONICAL: 'ACTIVE_CANONICAL',
  WAITING_ACCEPTANCE: 'WAITING_ACCEPTANCE',
  WAITING_OPERATOR_APPROVAL: 'WAITING_OPERATOR_APPROVAL',
  RECOVER_UNIQUE_WORK: 'RECOVER_UNIQUE_WORK',
  SUPERSEDED: 'SUPERSEDED',
  ALREADY_IN_MAIN: 'ALREADY_IN_MAIN',
  PLACEHOLDER_FAILED: 'PLACEHOLDER_FAILED',
  AMBIGUOUS_REVIEW_REQUIRED: 'AMBIGUOUS_REVIEW_REQUIRED',
});

const VALID_DISPOSITIONS = new Set(Object.values(PR_DISPOSITIONS));
const PLACEHOLDER_PATTERN = /codex generated this pull request, but encountered an unexpected error after generation/i;
const ACCEPTANCE_PATTERN = /(?:live|windows|battle bridge|browser|runtime|on-headset|whatsapp|quest).*acceptance|acceptance.*(?:required|pending|remain|gate)|live proof.*required|browser proof.*required/i;
const APPROVAL_PATTERN = /exact[- ]head.*approval|required.*operator approval|do not merge without.*approval|merge.*explicit approval/i;
const SAFE_FAMILY_ID = /^[a-z0-9][a-z0-9-]{0,100}$/;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function asBooleanOrNull(value) {
  return value === true ? true : (value === false ? false : null);
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return unique(labels.map((label) => asText(label?.name ?? label, '')).filter(Boolean)).sort();
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) return [];
  return unique(files.map((file) => asText(file?.path ?? file?.filename ?? file, '')).filter(Boolean)).sort();
}

function normalizePr(input = {}) {
  const number = asInteger(input.number ?? input.prNumber, null);
  const state = asText(input.state, 'open').toLowerCase();
  const body = asText(input.body, '');
  const title = asText(input.title, '');
  const aheadBy = asInteger(input.aheadBy ?? input.ahead_by, null);
  const behindBy = asInteger(input.behindBy ?? input.behind_by, null);
  const explicitContained = asBooleanOrNull(input.headContainedInBase);
  const compareKnown = aheadBy !== null || explicitContained !== null;
  const headContainedInBase = explicitContained === true || (aheadBy === 0 && compareKnown);

  return {
    number,
    state,
    title,
    body,
    url: asText(input.url, ''),
    isDraft: input.isDraft === true || input.draft === true,
    headRefName: asText(input.headRefName ?? input.head, ''),
    headSha: asText(input.headSha ?? input.headRefOid ?? input.head_sha, ''),
    baseRefName: asText(input.baseRefName ?? input.base, 'main'),
    createdAt: asText(input.createdAt ?? input.created_at, ''),
    updatedAt: asText(input.updatedAt ?? input.updated_at, ''),
    mergeable: asText(input.mergeable, 'UNKNOWN').toUpperCase(),
    labels: normalizeLabels(input.labels),
    changedFiles: normalizeFiles(input.changedFiles ?? input.files),
    aheadBy,
    behindBy,
    compareKnown,
    headContainedInBase,
    patchEquivalentTo: asInteger(input.patchEquivalentTo, null),
    uniqueDelta: asBooleanOrNull(input.uniqueDelta),
    activeHint: input.activeHint === true,
    dispositionHint: VALID_DISPOSITIONS.has(input.dispositionHint) ? input.dispositionHint : '',
  };
}

function normalizeFamily(input = {}) {
  const id = asText(input.id, '');
  if (!SAFE_FAMILY_ID.test(id)) throw new Error(`invalid PR estate family id: ${id || '<empty>'}`);
  const members = unique((Array.isArray(input.members) ? input.members : input.prs || []).map((value) => asInteger(value, null)).filter(Number.isInteger)).sort((a, b) => a - b);
  const canonicalPr = asInteger(input.canonicalPr, null);
  const supersededBy = {};
  for (const [key, value] of Object.entries(input.supersededBy || {})) {
    const prNumber = asInteger(key, null);
    const target = asInteger(value, null);
    if (prNumber !== null && target !== null) supersededBy[prNumber] = target;
  }
  return {
    id,
    label: asText(input.label, id),
    members,
    canonicalPr,
    supersededBy,
    selectionBasis: asText(input.selectionBasis, ''),
    notes: asText(input.notes, ''),
  };
}

function buildFamilyMaps(families) {
  const byId = new Map();
  const byPr = new Map();
  for (const rawFamily of families || []) {
    const family = normalizeFamily(rawFamily);
    if (byId.has(family.id)) throw new Error(`duplicate PR estate family id: ${family.id}`);
    byId.set(family.id, family);
    for (const prNumber of family.members) {
      if (byPr.has(prNumber)) throw new Error(`PR #${prNumber} appears in multiple estate families`);
      byPr.set(prNumber, family);
    }
  }
  return { byId, byPr };
}

function titleKey(title) {
  return asText(title, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function deriveImplicitFamilies(prs, familyByPr) {
  const groups = new Map();
  for (const pr of prs) {
    if (familyByPr.has(pr.number)) continue;
    const key = titleKey(pr.title);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(pr.number);
    groups.set(key, group);
  }
  const implicitByPr = new Map();
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const id = `title-${key.replace(/\s+/g, '-').slice(0, 80)}`;
    const family = { id, label: `Exact-title duplicate: ${key}`, members: members.sort((a, b) => a - b), canonicalPr: null, supersededBy: {}, selectionBasis: 'exact-title-match', notes: 'Implicit family; canonical selection requires review.' };
    for (const number of members) implicitByPr.set(number, family);
  }
  return implicitByPr;
}

function evidenceFor(pr, family) {
  return {
    compareKnown: pr.compareKnown,
    aheadBy: pr.aheadBy,
    behindBy: pr.behindBy,
    headContainedInBase: pr.headContainedInBase,
    changedFileCount: pr.changedFiles.length,
    patchEquivalentTo: pr.patchEquivalentTo,
    uniqueDelta: pr.uniqueDelta,
    familyCanonicalPr: family?.canonicalPr ?? null,
    explicitSupersededBy: family?.supersededBy?.[pr.number] ?? null,
  };
}

function classifyPr(pr, family) {
  const bodyAndTitle = `${pr.title}\n${pr.body}`;
  const placeholder = PLACEHOLDER_PATTERN.test(bodyAndTitle);
  const acceptanceGate = ACCEPTANCE_PATTERN.test(bodyAndTitle);
  const approvalGate = APPROVAL_PATTERN.test(bodyAndTitle);
  const explicitSupersededBy = family?.supersededBy?.[pr.number] ?? null;
  const canonicalPr = family?.canonicalPr ?? null;
  const familySize = family?.members?.length ?? 1;
  const reasons = [];

  if (pr.number === null || pr.state !== 'open') {
    return {
      disposition: PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED,
      reason: pr.number === null ? 'missing valid PR number' : `expected open PR evidence, received state=${pr.state}`,
      blockers: ['invalid-or-non-open-pr-record'],
    };
  }

  if (pr.dispositionHint) {
    if ([PR_DISPOSITIONS.ALREADY_IN_MAIN, PR_DISPOSITIONS.PLACEHOLDER_FAILED].includes(pr.dispositionHint) && !pr.compareKnown) {
      return { disposition: PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED, reason: 'terminal disposition hint lacks compare evidence', blockers: ['compare-evidence-required'] };
    }
    if (pr.dispositionHint === PR_DISPOSITIONS.SUPERSEDED && !explicitSupersededBy && !pr.patchEquivalentTo) {
      return { disposition: PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED, reason: 'superseded hint lacks canonical target evidence', blockers: ['canonical-survivor-required'] };
    }
    return { disposition: pr.dispositionHint, reason: 'explicit validated disposition hint', blockers: [] };
  }

  if (placeholder) {
    if (!pr.compareKnown) return { disposition: PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED, reason: 'Codex placeholder PR has no branch-to-main compare evidence', blockers: ['placeholder-branch-delta-unknown'] };
    if (pr.headContainedInBase) return { disposition: PR_DISPOSITIONS.PLACEHOLDER_FAILED, reason: 'Codex placeholder branch has no commits unique to current base', blockers: [] };
    return { disposition: PR_DISPOSITIONS.RECOVER_UNIQUE_WORK, reason: 'Codex placeholder branch still has commits unique to current base', blockers: ['inspect-and-recover-placeholder-delta'] };
  }

  if (pr.headContainedInBase) {
    return { disposition: PR_DISPOSITIONS.ALREADY_IN_MAIN, reason: 'compare evidence shows no commits unique to the PR head', blockers: [] };
  }

  if (explicitSupersededBy !== null) {
    if (pr.patchEquivalentTo === explicitSupersededBy || pr.uniqueDelta === false) {
      return { disposition: PR_DISPOSITIONS.SUPERSEDED, reason: `evidence shows PR is covered by canonical PR #${explicitSupersededBy}`, blockers: [] };
    }
    if (pr.uniqueDelta === true) {
      return { disposition: PR_DISPOSITIONS.RECOVER_UNIQUE_WORK, reason: `PR has unique work not yet proven in canonical PR #${explicitSupersededBy}`, blockers: ['transplant-unique-delta'] };
    }
    return { disposition: PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED, reason: `family marks PR as superseded by #${explicitSupersededBy}, but equivalence evidence is missing`, blockers: ['patch-equivalence-or-unique-delta-required'] };
  }

  if (canonicalPr === pr.number) {
    if (acceptanceGate) return { disposition: PR_DISPOSITIONS.WAITING_ACCEPTANCE, reason: 'canonical family survivor is explicitly waiting for live acceptance proof', blockers: ['acceptance-proof-required'] };
    if (approvalGate) return { disposition: PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL, reason: 'canonical family survivor is explicitly waiting for operator approval', blockers: ['operator-approval-required'] };
    return { disposition: PR_DISPOSITIONS.ACTIVE_CANONICAL, reason: 'selected canonical survivor for its capability family', blockers: [] };
  }

  if (familySize > 1) {
    if (canonicalPr === null) {
      return { disposition: PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED, reason: `duplicate family ${family.id} has no selected canonical survivor`, blockers: ['canonical-selection-required'] };
    }
    if (pr.uniqueDelta === true) return { disposition: PR_DISPOSITIONS.RECOVER_UNIQUE_WORK, reason: `non-canonical family member has unique work relative to #${canonicalPr}`, blockers: ['transplant-unique-delta'] };
    if (pr.uniqueDelta === false || pr.patchEquivalentTo === canonicalPr) return { disposition: PR_DISPOSITIONS.SUPERSEDED, reason: `non-canonical family member is fully covered by #${canonicalPr}`, blockers: [] };
    return { disposition: PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED, reason: `non-canonical family member requires comparison with #${canonicalPr}`, blockers: ['unique-delta-analysis-required'] };
  }

  if (acceptanceGate) return { disposition: PR_DISPOSITIONS.WAITING_ACCEPTANCE, reason: 'PR explicitly documents an outstanding live acceptance gate', blockers: ['acceptance-proof-required'] };
  if (approvalGate) return { disposition: PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL, reason: 'PR explicitly documents an outstanding operator approval gate', blockers: ['operator-approval-required'] };
  if (pr.activeHint) return { disposition: PR_DISPOSITIONS.ACTIVE_CANONICAL, reason: 'explicit active canonical hint', blockers: [] };

  if (!pr.compareKnown) reasons.push('branch-to-main compare evidence missing');
  if (pr.mergeable === 'UNKNOWN') reasons.push('mergeability evidence missing');
  return {
    disposition: PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED,
    reason: reasons.length ? reasons.join('; ') : 'open PR has no durable estate disposition evidence',
    blockers: ['estate-disposition-review-required'],
  };
}

function familyStatus(entries, family) {
  const active = entries.filter((entry) => [PR_DISPOSITIONS.ACTIVE_CANONICAL, PR_DISPOSITIONS.WAITING_ACCEPTANCE, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL].includes(entry.disposition));
  const unresolved = entries.filter((entry) => [PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED, PR_DISPOSITIONS.RECOVER_UNIQUE_WORK].includes(entry.disposition));
  const blockers = [];
  if (active.length > 1) blockers.push(`multiple-active-canonical-candidates:${active.map((entry) => entry.number).join(',')}`);
  if (entries.length > 1 && !family?.canonicalPr) blockers.push('canonical-selection-required');
  if (unresolved.length) blockers.push(`unresolved-members:${unresolved.map((entry) => entry.number).join(',')}`);
  let status = 'CONTROLLED';
  if (blockers.length) status = 'RECONCILIATION_REQUIRED';
  else if (entries.every((entry) => [PR_DISPOSITIONS.SUPERSEDED, PR_DISPOSITIONS.ALREADY_IN_MAIN, PR_DISPOSITIONS.PLACEHOLDER_FAILED].includes(entry.disposition))) status = 'TERMINAL_READY';
  return { status, blockers };
}

export function buildPrEstateLedger(input = {}) {
  const normalizedPrs = (Array.isArray(input.pullRequests) ? input.pullRequests : []).map(normalizePr).filter((pr) => pr.state === 'open');
  const { byId: explicitFamiliesById, byPr: explicitFamilyByPr } = buildFamilyMaps(input.families || []);
  const implicitFamilyByPr = deriveImplicitFamilies(normalizedPrs, explicitFamilyByPr);
  const allFamiliesById = new Map(explicitFamiliesById);
  for (const family of implicitFamilyByPr.values()) allFamiliesById.set(family.id, family);

  const entries = normalizedPrs.map((pr) => {
    const family = explicitFamilyByPr.get(pr.number) || implicitFamilyByPr.get(pr.number) || null;
    const result = classifyPr(pr, family);
    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      familyId: family?.id || null,
      familyLabel: family?.label || null,
      canonicalPr: family?.canonicalPr ?? null,
      disposition: result.disposition,
      reason: result.reason,
      blockers: result.blockers,
      evidence: evidenceFor(pr, family),
      headRefName: pr.headRefName,
      headSha: pr.headSha,
      baseRefName: pr.baseRefName,
      isDraft: pr.isDraft,
      updatedAt: pr.updatedAt,
    };
  }).sort((a, b) => b.number - a.number);

  const familyGroups = new Map();
  for (const entry of entries) {
    const id = entry.familyId || `single-pr-${entry.number}`;
    const group = familyGroups.get(id) || [];
    group.push(entry);
    familyGroups.set(id, group);
  }

  const families = [...familyGroups.entries()].map(([id, familyEntries]) => {
    const family = allFamiliesById.get(id) || { id, label: familyEntries[0]?.title || id, members: familyEntries.map((entry) => entry.number), canonicalPr: familyEntries[0]?.canonicalPr ?? null, selectionBasis: '', notes: '' };
    const summary = familyStatus(familyEntries, family);
    return {
      id,
      label: family.label,
      members: familyEntries.map((entry) => entry.number).sort((a, b) => a - b),
      canonicalPr: family.canonicalPr,
      selectionBasis: family.selectionBasis || '',
      status: summary.status,
      blockers: summary.blockers,
      dispositions: Object.fromEntries(familyEntries.map((entry) => [entry.number, entry.disposition])),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const dispositionCounts = Object.fromEntries(Object.values(PR_DISPOSITIONS).map((value) => [value, 0]));
  for (const entry of entries) dispositionCounts[entry.disposition] += 1;

  const recoveryPriority = {
    [PR_DISPOSITIONS.RECOVER_UNIQUE_WORK]: 1,
    [PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED]: 2,
    [PR_DISPOSITIONS.WAITING_ACCEPTANCE]: 3,
    [PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL]: 4,
    [PR_DISPOSITIONS.ACTIVE_CANONICAL]: 5,
    [PR_DISPOSITIONS.SUPERSEDED]: 6,
    [PR_DISPOSITIONS.PLACEHOLDER_FAILED]: 7,
    [PR_DISPOSITIONS.ALREADY_IN_MAIN]: 8,
  };
  const recoveryQueue = entries
    .filter((entry) => ![PR_DISPOSITIONS.ALREADY_IN_MAIN, PR_DISPOSITIONS.SUPERSEDED, PR_DISPOSITIONS.PLACEHOLDER_FAILED].includes(entry.disposition))
    .sort((a, b) => recoveryPriority[a.disposition] - recoveryPriority[b.disposition] || b.number - a.number)
    .map((entry) => ({ number: entry.number, familyId: entry.familyId, disposition: entry.disposition, nextAction: entry.blockers[0] || 'continue-canonical-lane' }));

  const blockers = unique(families.flatMap((family) => family.blockers.map((blocker) => `${family.id}:${blocker}`)));
  const finalVerdict = blockers.length === 0 && recoveryQueue.every((item) => [PR_DISPOSITIONS.ACTIVE_CANONICAL, PR_DISPOSITIONS.WAITING_ACCEPTANCE, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL].includes(item.disposition))
    ? 'PR_ESTATE_CONTROLLED'
    : 'PR_ESTATE_RECONCILIATION_REQUIRED';

  return {
    schemaVersion: PR_ESTATE_SCHEMA_VERSION,
    kind: PR_ESTATE_KIND,
    generatedAt: asText(input.generatedAt, 'pending'),
    repository: asText(input.repository, 'unknown'),
    openPrCount: entries.length,
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
    if (!Number.isInteger(entry.number)) errors.push('invalid-pr-number');
    if (!VALID_DISPOSITIONS.has(entry.disposition)) errors.push(`invalid-disposition:${entry.number}`);
    if (entry.disposition === PR_DISPOSITIONS.ALREADY_IN_MAIN && entry.evidence?.headContainedInBase !== true) errors.push(`already-in-main-without-containment:${entry.number}`);
    if (entry.disposition === PR_DISPOSITIONS.SUPERSEDED && !entry.canonicalPr && !entry.evidence?.explicitSupersededBy) errors.push(`superseded-without-canonical:${entry.number}`);
  }
  return { valid: errors.length === 0, errors, finalVerdict: errors.length ? 'PR_ESTATE_LEDGER_INVALID' : 'PR_ESTATE_LEDGER_VALID' };
}

export function renderPrEstateReport(ledger = {}) {
  const lines = [
    '# Stephanos PR Estate Report',
    '',
    `Repository: ${ledger.repository || 'unknown'}`,
    `Generated: ${ledger.generatedAt || 'pending'}`,
    `Open PRs: ${ledger.openPrCount ?? 0}`,
    `Final verdict: ${ledger.finalVerdict || 'unknown'}`,
    '',
    '## Dispositions',
  ];
  for (const disposition of Object.values(PR_DISPOSITIONS)) lines.push(`- ${disposition}: ${ledger.dispositionCounts?.[disposition] ?? 0}`);
  lines.push('', '## Families requiring reconciliation');
  const blockedFamilies = (ledger.families || []).filter((family) => family.status !== 'CONTROLLED' && family.status !== 'TERMINAL_READY');
  if (!blockedFamilies.length) lines.push('- none');
  for (const family of blockedFamilies) lines.push(`- ${family.id}: ${family.members.map((number) => `#${number}`).join(', ')} | ${family.blockers.join('; ')}`);
  lines.push('', '## Recovery queue');
  if (!(ledger.recoveryQueue || []).length) lines.push('- none');
  for (const item of ledger.recoveryQueue || []) lines.push(`- #${item.number} | ${item.disposition} | ${item.familyId || 'unfamilied'} | ${item.nextAction}`);
  lines.push('', '## Safety', '- read-only classifier', '- no PR close, merge, branch deletion, reset, rebase or source mutation', '- incomplete evidence fails closed');
  return `${lines.join('\n')}\n`;
}
