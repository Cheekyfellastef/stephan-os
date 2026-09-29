import {
  GENERIC_PLACEHOLDER_TITLE_KEY,
  PR_DISPOSITIONS,
  SAFE_FAMILY_ID,
  TERMINAL_DISPOSITIONS,
  asPositiveInteger,
  asText,
  hasOwn,
  isPlainObject,
} from './prEstateContracts.mjs';

export function normalizeFamily(input = {}) {
  if (!isPlainObject(input)) throw new Error('PR estate family record must be an object');
  const id = asText(input.id, '');
  if (!SAFE_FAMILY_ID.test(id)) throw new Error(`invalid PR estate family id: ${id || '<empty>'}`);
  const membersField = hasOwn(input, 'members') ? input.members : input.prs;
  if (!Array.isArray(membersField)) throw new Error(`family ${id} members array is required`);
  const members = membersField.map((value) => {
    const parsed = asPositiveInteger(value, null);
    if (parsed === null) throw new Error(`invalid family member in ${id}: ${String(value)}`);
    return parsed;
  });
  if (new Set(members).size !== members.length) throw new Error(`duplicate family member in ${id}`);
  members.sort((a, b) => a - b);

  const canonicalProvided = hasOwn(input, 'canonicalPr') && input.canonicalPr !== null && input.canonicalPr !== undefined;
  const canonicalPr = canonicalProvided ? asPositiveInteger(input.canonicalPr, null) : null;
  if (canonicalProvided && canonicalPr === null) throw new Error(`invalid canonicalPr in family ${id}`);
  if (canonicalPr !== null && !members.includes(canonicalPr)) throw new Error(`canonical PR #${canonicalPr} is not a member of family ${id}`);

  const rawSupersededBy = input.supersededBy ?? {};
  if (!isPlainObject(rawSupersededBy)) throw new Error(`family ${id} supersededBy must be an object`);
  const supersededBy = {};
  for (const [key, value] of Object.entries(rawSupersededBy)) {
    const prNumber = asPositiveInteger(key, null);
    const target = asPositiveInteger(value, null);
    if (prNumber === null || target === null) throw new Error(`invalid supersededBy mapping in family ${id}`);
    if (!members.includes(prNumber)) throw new Error(`superseded PR #${prNumber} is not a member of family ${id}`);
    if (!members.includes(target)) throw new Error(`superseding PR #${target} is not a member of family ${id}`);
    if (canonicalPr === null) throw new Error(`family ${id} supersededBy mapping requires canonicalPr`);
    if (target !== canonicalPr) throw new Error(`superseding PR #${target} is not canonical PR #${canonicalPr} for family ${id}`);
    if (prNumber === canonicalPr) throw new Error(`canonical PR #${canonicalPr} cannot supersede itself in family ${id}`);
    supersededBy[prNumber] = target;
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

export function buildFamilyMaps(families) {
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

export function deriveImplicitFamilies(prs, familyByPr) {
  const groups = new Map();
  for (const pr of prs) {
    if (familyByPr.has(pr.number)) continue;
    const key = titleKey(pr.title);
    if (!key || key === GENERIC_PLACEHOLDER_TITLE_KEY) continue;
    const group = groups.get(key) || [];
    group.push(pr.number);
    groups.set(key, group);
  }
  const implicitByPr = new Map();
  for (const [key, rawMembers] of groups) {
    const members = rawMembers.filter(Number.isInteger);
    if (members.length < 2) continue;
    members.sort((a, b) => a - b);
    const family = {
      id: `title-${key.replace(/\s+/g, '-').slice(0, 80)}`,
      label: `Exact-title duplicate: ${key}`,
      members,
      canonicalPr: null,
      supersededBy: {},
      selectionBasis: 'exact-title-match',
      notes: 'Implicit family; canonical selection requires review.',
    };
    for (const number of members) implicitByPr.set(number, family);
  }
  return implicitByPr;
}


export function familyStatus(entries, family) {
  const active = entries.filter((entry) => [PR_DISPOSITIONS.ACTIVE_CANONICAL, PR_DISPOSITIONS.WAITING_ACCEPTANCE, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL].includes(entry.disposition));
  const unresolved = entries.filter((entry) => [PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED, PR_DISPOSITIONS.RECOVER_UNIQUE_WORK].includes(entry.disposition));
  const blockers = [];
  if (active.length > 1) blockers.push(`multiple-active-canonical-candidates:${active.map((entry) => entry.number).join(',')}`);
  if (entries.length > 1 && !family?.canonicalPr) blockers.push('canonical-selection-required');
  if (unresolved.length) blockers.push(`unresolved-members:${unresolved.map((entry) => entry.number ?? `record-${entry.recordIndex}`).join(',')}`);
  if (blockers.length) return { status: 'RECONCILIATION_REQUIRED', blockers };
  if (entries.every((entry) => TERMINAL_DISPOSITIONS.has(entry.disposition))) return { status: 'TERMINAL_READY', blockers };
  return { status: 'CONTROLLED', blockers };
}
