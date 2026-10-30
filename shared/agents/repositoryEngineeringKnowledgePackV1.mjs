import { createHash } from 'node:crypto';

export const REPOSITORY_ENGINEERING_KNOWLEDGE_PACK_SCHEMA_V1 = 'stephanos.repository-engineering-knowledge-pack.v1';
export const REPOSITORY_ENGINEERING_KNOWLEDGE_PACK_MAX_BYTES_V1 = 64 * 1024;

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const SAFE_REF = /^[a-z0-9][a-z0-9._:/#-]{0,159}$/i;
const CANONICAL_ISSUE_REF = /^#[1-9][0-9]{0,9}$/;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]{1,500}$/u;
const STRICT_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/i;
const ALLOWED_FRESHNESS = new Set(['CURRENT']);

export const REPOSITORY_ENGINEERING_KNOWLEDGE_PACK_AUTHORITY_V1 = Object.freeze({
  sourceMutationAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  accountAccessAllowed: false,
  spendingAllowed: false,
  providerSelectionAllowed: false,
  leaseSeizureAllowed: false,
  arbitraryCommandAllowed: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  for (const key of Object.keys(value)) value[key] = deepFreeze(value[key]);
  return Object.freeze(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function explicitTimestamp(value) {
  const normalized = text(value);
  const match = normalized.match(STRICT_TIMESTAMP);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);

  if (year < 1 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  if (offsetHour < 0 || offsetHour > 23 || offsetMinute < 0 || offsetMinute > 59) return null;

  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  const instant = new Date(parsed);
  const normalizedYear = instant.getUTCFullYear();
  if (normalizedYear < 1 || normalizedYear > 9999) return null;
  return instant.toISOString();
}

function exactSha(value) {
  const normalized = text(value).toLowerCase();
  return FULL_SHA.test(normalized) ? normalized : null;
}

function safeRepository(value) {
  const normalized = text(value).toLowerCase();
  if (!SAFE_REPOSITORY.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.length !== 2 || parts.some((part) => part === '.' || part === '..')) return null;
  return normalized;
}

function safeRef(value) {
  const normalized = text(value);
  return CANONICAL_ISSUE_REF.test(normalized) || SAFE_REF.test(normalized) ? normalized : null;
}

function safeText(value) {
  const normalized = text(value);
  return SAFE_TEXT.test(normalized) ? normalized : null;
}

function normalizePath(value) {
  const normalized = text(value);
  if (!normalized
    || normalized.includes('\\')
    || normalized.startsWith('/')
    || /^[a-z]:/i.test(normalized)
    || normalized.includes('//')) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  if (!/^[a-z0-9._/-]+$/i.test(normalized)) return null;
  return normalized;
}

function compareCanonicalText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizedList(value, {
  field,
  blockers,
  normalize = safeText,
  min = 0,
  max = 32,
  caseSensitive = false,
} = {}) {
  if (!Array.isArray(value)) {
    blockers.push(`${field}-must-be-array`);
    return [];
  }
  if (value.length < min) blockers.push(`${field}-too-short`);
  if (value.length > max) {
    blockers.push(`${field}-too-long`);
    return [];
  }
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const normalized = normalize(item);
    if (!normalized) {
      blockers.push(`${field}-item-invalid`);
      continue;
    }
    const key = caseSensitive ? normalized : normalized.toLowerCase();
    if (seen.has(key)) {
      blockers.push(`${field}-duplicate`);
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result.sort(compareCanonicalText);
}

function authorityIsZero(authority) {
  if (authority === null || authority === undefined) return true;
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) return false;
  return Object.values(authority).every((value) => value === false || value === null || value === undefined);
}

function buildValidatedPack(input, blockers) {
  const repository = safeRepository(input.repository);
  if (!repository) blockers.push('repository-invalid');

  const baseHead = exactSha(input.baseHead);
  const baseTree = exactSha(input.baseTree);
  if (!baseHead) blockers.push('base-head-invalid');
  if (!baseTree) blockers.push('base-tree-invalid');

  const createdAtUtc = explicitTimestamp(input.createdAtUtc);
  if (!createdAtUtc) blockers.push('created-at-invalid');

  const originatingGoalOrWorkId = safeRef(input.originatingGoalOrWorkId);
  if (!originatingGoalOrWorkId) blockers.push('originating-goal-or-work-id-invalid');

  const ownerRefs = normalizedList(input.ownerRefs, {
    field: 'owner-refs',
    blockers,
    normalize: safeRef,
    min: 1,
    max: 1,
  });

  const relatedGoalAndPrRefs = normalizedList(input.relatedGoalAndPrRefs ?? [], {
    field: 'related-goal-and-pr-refs',
    blockers,
    normalize: safeRef,
    max: 32,
  });
  const relevantPaths = normalizedList(input.relevantPaths, {
    field: 'relevant-paths',
    blockers,
    normalize: normalizePath,
    min: 1,
    max: 64,
    caseSensitive: true,
  });
  const interfacesAndSchemas = normalizedList(input.interfacesAndSchemas ?? [], {
    field: 'interfaces-and-schemas',
    blockers,
    max: 48,
  });
  const invariants = normalizedList(input.invariants, {
    field: 'invariants',
    blockers,
    min: 1,
    max: 48,
  });
  const forbiddenChanges = normalizedList(input.forbiddenChanges, {
    field: 'forbidden-changes',
    blockers,
    min: 1,
    max: 48,
  });
  const dependencies = normalizedList(input.dependencies ?? [], {
    field: 'dependencies',
    blockers,
    normalize: safeRef,
    max: 48,
  });
  const knownIncidentsAndFailureModes = normalizedList(input.knownIncidentsAndFailureModes ?? [], {
    field: 'known-incidents-and-failure-modes',
    blockers,
    max: 48,
  });
  const requiredTests = normalizedList(input.requiredTests, {
    field: 'required-tests',
    blockers,
    normalize: normalizePath,
    min: 1,
    max: 64,
    caseSensitive: true,
  });
  const externalEvidenceRefs = normalizedList(input.externalEvidenceRefs ?? [], {
    field: 'external-evidence-refs',
    blockers,
    normalize: safeRef,
    max: 48,
  });
  const methodRefs = normalizedList(input.methodRefs ?? [], {
    field: 'method-refs',
    blockers,
    normalize: safeRef,
    max: 48,
  });
  const acceptanceAndProofWriteback = normalizedList(input.acceptanceAndProofWriteback, {
    field: 'acceptance-and-proof-writeback',
    blockers,
    normalize: safeRef,
    min: 1,
    max: 32,
  });
  const conflicts = normalizedList(input.conflicts ?? [], {
    field: 'conflicts',
    blockers,
    max: 32,
  });
  if (conflicts.length) blockers.push('conflicting-knowledge-not-admissible');

  const freshness = text(input.freshness).toUpperCase();
  if (!ALLOWED_FRESHNESS.has(freshness)) blockers.push('freshness-not-current');

  const reviewAndRiskClass = safeRef(input.reviewAndRiskClass);
  if (!reviewAndRiskClass) blockers.push('review-and-risk-class-invalid');

  const maxBytes = Number(input.sizeBudget?.maxBytes ?? 24 * 1024);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > REPOSITORY_ENGINEERING_KNOWLEDGE_PACK_MAX_BYTES_V1) {
    blockers.push('size-budget-invalid');
  }

  if (typeof input.omittedSensitiveState !== 'boolean') blockers.push('omitted-sensitive-state-must-be-boolean');
  if (!authorityIsZero(input.authority)) blockers.push('authority-widening-rejected');

  return {
    schemaVersion: REPOSITORY_ENGINEERING_KNOWLEDGE_PACK_SCHEMA_V1,
    originatingGoalOrWorkId,
    repository,
    baseHead,
    baseTree,
    createdAtUtc,
    ownerRefs,
    relatedGoalAndPrRefs,
    relevantPaths,
    interfacesAndSchemas,
    invariants,
    forbiddenChanges,
    dependencies,
    knownIncidentsAndFailureModes,
    requiredTests,
    reviewAndRiskClass,
    externalEvidenceRefs,
    methodRefs,
    freshness,
    conflicts,
    sizeBudget: { maxBytes },
    omittedSensitiveState: input.omittedSensitiveState === true,
    acceptanceAndProofWriteback,
    authority: REPOSITORY_ENGINEERING_KNOWLEDGE_PACK_AUTHORITY_V1,
  };
}

export function validateRepositoryEngineeringKnowledgePackInputV1(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return deepFreeze({
      valid: false,
      blockers: ['input-must-be-object'],
      observedBytes: null,
      pack: null,
    });
  }

  const blockers = [];
  const candidate = buildValidatedPack(input, blockers);
  if (blockers.length === 0) {
    const identityPayload = canonicalJson(candidate);
    const packId = `repository-engineering-pack-${sha256(identityPayload).slice(0, 24)}`;
    const pack = deepFreeze({ ...candidate, packId });
    const observedBytes = Buffer.byteLength(canonicalJson(pack), 'utf8');
    if (observedBytes > pack.sizeBudget.maxBytes) blockers.push('pack-size-budget-exceeded');
    if (observedBytes > REPOSITORY_ENGINEERING_KNOWLEDGE_PACK_MAX_BYTES_V1) blockers.push('pack-absolute-size-limit-exceeded');
    return deepFreeze({
      valid: blockers.length === 0,
      blockers,
      observedBytes,
      pack: blockers.length === 0 ? pack : null,
    });
  }
  return deepFreeze({ valid: false, blockers: [...new Set(blockers)].sort(), observedBytes: null, pack: null });
}

export function buildRepositoryEngineeringKnowledgePackV1(input = {}) {
  const validation = validateRepositoryEngineeringKnowledgePackInputV1(input);
  if (!validation.valid) {
    throw new Error(`repository engineering knowledge pack rejected: ${validation.blockers.join(', ')}`);
  }
  return validation.pack;
}

export function isRepositoryEngineeringKnowledgePackCurrentV1(pack, { repository, baseHead, baseTree } = {}) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return false;
  const expectedRepository = safeRepository(repository);
  const expectedHead = exactSha(baseHead);
  const expectedTree = exactSha(baseTree);
  if (!expectedRepository || !expectedHead || !expectedTree) return false;

  const validation = validateRepositoryEngineeringKnowledgePackInputV1(pack);
  return Boolean(validation.valid
    && validation.pack
    && validation.pack.packId === pack.packId
    && canonicalJson(validation.pack) === canonicalJson(pack)
    && validation.pack.repository === expectedRepository
    && validation.pack.baseHead === expectedHead
    && validation.pack.baseTree === expectedTree);
}
