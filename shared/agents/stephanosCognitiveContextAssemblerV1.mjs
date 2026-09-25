import {
  buildStephanosMemoryRetrievalPackV1,
} from './stephanosMemoryRetrievalPackV1.mjs';
import {
  buildStephanosProspectiveMemoryV1,
} from './stephanosProspectiveMemoryV1.mjs';

export const STEPHANOS_COGNITIVE_CONTEXT_SCHEMA_VERSION =
  'stephanos.cognitive-context-assembler.v1';

const PACK_SPECS = Object.freeze([
  Object.freeze({
    key: 'conversationalContinuity',
    packKind: 'CONVERSATIONAL_CONTINUITY_PACK',
    selectors: Object.freeze({ tag: 'continuity' }),
  }),
  Object.freeze({
    key: 'operatorRelationship',
    packKind: 'OPERATOR_RELATIONSHIP_PACK',
    selectors: Object.freeze({ tag: 'relationship' }),
  }),
  Object.freeze({
    key: 'prospectiveOpenLoops',
    packKind: 'PROSPECTIVE_OPEN_LOOPS_PACK',
    selectors: Object.freeze({ tag: 'prospective' }),
  }),
]);

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  durablePromotionAllowed: false,
  memoryDeleteAllowed: false,
  memoryCorrectionAllowed: false,
  sharedAuthorityClaimAllowed: false,
  reminderCreationAllowed: false,
  scheduleCreationAllowed: false,
  autoDispatchAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
});

function exactIso(value) {
  if (typeof value !== 'string' || !value) return '';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '';
  const normalized = new Date(parsed).toISOString();
  return normalized === value ? normalized : '';
}

function denseArray(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  if (value.length > maximum) return null;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return null;
  }
  return value;
}

function safeSummary(value, maximum = 800) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > maximum) return '';
  return normalized;
}

function readDataOnlyInput(value, allowedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { valid: false, error: 'input:data-only-object-required', values: null };
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return { valid: false, error: 'input:data-only-object-required', values: null };
    }
    if (Object.getOwnPropertySymbols(value).length) {
      return { valid: false, error: 'input:symbol-field-not-allowed', values: null };
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const unknownKeys = Object.keys(descriptors).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length) {
      return {
        valid: false,
        error: unknownKeys.map((key) => `input:unknown-field:${key}`),
        values: null,
      };
    }
    const values = Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        return { valid: false, error: `input:non-data-field:${key}`, values: null };
      }
      values[key] = descriptor.value;
    }
    return { valid: true, error: null, values };
  } catch {
    return { valid: false, error: 'input:data-only-object-required', values: null };
  }
}

function hasEvidence(record = {}) {
  return (Array.isArray(record.proofRefs) && record.proofRefs.length > 0)
    || (Array.isArray(record.sourceRefs) && record.sourceRefs.length > 0);
}

function isVerifiedRecord(record = {}) {
  return record.authorityClass === 'SHARED_AUTHORITY'
    && record.currentState === 'CURRENT'
    && ['FRESH', 'RECENT'].includes(record.freshness)
    && hasEvidence(record);
}

function isConflictingRecord(record = {}, contradictionIds = new Set()) {
  return record.freshness === 'CONFLICTING'
    || contradictionIds.has(record.recordId);
}

function projectPack(pack = {}) {
  const contradictions = new Set(pack.unresolvedContradictions || []);
  const verified = [];
  const unverified = [];
  for (const record of pack.selectedRecords || []) {
    const projected = Object.freeze({
      recordId: record.recordId,
      summary: record.summary,
      authorityClass: record.authorityClass,
      freshness: record.freshness,
      currentState: record.currentState,
      source: record.source,
      proofRefs: Object.freeze([...(record.proofRefs || [])]),
      sourceRefs: Object.freeze([...(record.sourceRefs || [])]),
      relationshipEvidenceClass: record.relationshipEvidenceClass,
      relatedGoalRef: record.relatedGoalRef,
      relatedPrRef: record.relatedPrRef,
    });
    if (isVerifiedRecord(record) && !isConflictingRecord(record, contradictions)) {
      verified.push(projected);
    } else {
      unverified.push(projected);
    }
  }
  return Object.freeze({
    packKind: pack.packKind,
    packId: pack.packId,
    verdict: pack.verdict,
    valid: pack.valid === true,
    verifiedRecords: Object.freeze(verified),
    unverifiedRecords: Object.freeze(unverified),
    unresolvedContradictions: Object.freeze([...(pack.unresolvedContradictions || [])]),
    omissionReasons: Object.freeze([...(pack.omissionReasons || [])]),
  });
}

function contextLine(prefix, items) {
  if (!items.length) return `${prefix}: none`;
  return `${prefix}: ${items.map((item) => item.summary).join(' | ')}`;
}

function hold(errors = []) {
  return Object.freeze({
    schemaVersion: STEPHANOS_COGNITIVE_CONTEXT_SCHEMA_VERSION,
    valid: false,
    verdict: 'SAFE_HOLD',
    asOfUtc: '',
    packs: Object.freeze({}),
    prospectiveMemory: null,
    verifiedMemory: Object.freeze([]),
    unverifiedMemory: Object.freeze([]),
    confirmedOpenLoops: Object.freeze([]),
    unverifiedOpenLoops: Object.freeze([]),
    contradictions: Object.freeze([]),
    contextBlock: '',
    authority: AUTHORITY,
    validationErrors: Object.freeze([...new Set(errors)]),
  });
}

export function buildStephanosCognitiveContextV1(input = {}) {
  const allowedKeys = new Set(['asOfUtc', 'memoryRecords', 'openLoops']);
  const observedInput = readDataOnlyInput(input, allowedKeys);
  if (!observedInput.valid) {
    const errors = Array.isArray(observedInput.error) ? observedInput.error : [observedInput.error];
    return hold(errors);
  }

  const asOfUtc = exactIso(observedInput.values.asOfUtc);
  const memoryRecords = denseArray(observedInput.values.memoryRecords, 2_000);
  const openLoops = denseArray(observedInput.values.openLoops, 512);
  const errors = [];
  if (!asOfUtc) errors.push('asOfUtc-invalid');
  if (!memoryRecords) errors.push('memoryRecords-must-be-dense-bounded-array');
  if (!openLoops) errors.push('openLoops-must-be-dense-bounded-array');
  if (errors.length) return hold(errors);

  const packs = {};
  for (const spec of PACK_SPECS) {
    const pack = buildStephanosMemoryRetrievalPackV1({
      packKind: spec.packKind,
      records: memoryRecords,
      selectors: spec.selectors,
      budget: { maxRecords: 16, maxBytes: 16 * 1024 },
      asOfUtc,
    });
    if (!pack.valid) {
      errors.push(...pack.validationErrors.map((error) => `${spec.key}:${error}`));
    }
    packs[spec.key] = projectPack(pack);
  }

  const prospectiveMemory = buildStephanosProspectiveMemoryV1({
    observedAtUtc: asOfUtc,
    openLoops,
  });
  if (!prospectiveMemory.valid) {
    errors.push(...prospectiveMemory.validationErrors.map((error) => `prospectiveMemory:${error}`));
  }
  if (errors.length) return hold(errors);

  const verifiedMemory = Object.freeze(
    Object.values(packs).flatMap((pack) => pack.verifiedRecords),
  );
  const unverifiedMemory = Object.freeze(
    Object.values(packs).flatMap((pack) => pack.unverifiedRecords),
  );
  const projectOpenLoop = (loop) => Object.freeze({
    loopId: loop.loopId,
    continuityKey: loop.continuityKey,
    loopClass: loop.loopClass,
    summary: loop.summary,
    whyItMatters: loop.whyItMatters,
    state: loop.state,
    authorityClass: loop.authorityClass,
    freshness: loop.freshness,
    promotionState: loop.promotionState,
    proofRefs: Object.freeze([...(loop.proofRefs || [])]),
    sourceRefs: Object.freeze([...(loop.sourceRefs || [])]),
    overdue: loop.overdue,
    ownerRef: loop.ownerRef,
  });
  const activeOpenLoops = prospectiveMemory.activeOpenLoops || [];
  const confirmedOpenLoops = Object.freeze(
    activeOpenLoops
      .filter((loop) => loop.freshness === 'FRESH')
      .map(projectOpenLoop),
  );
  const unverifiedOpenLoops = Object.freeze(
    activeOpenLoops
      .filter((loop) => loop.freshness !== 'FRESH')
      .map(projectOpenLoop),
  );
  const contradictions = Object.freeze([
    ...new Set([
      ...Object.values(packs).flatMap((pack) => pack.unresolvedContradictions),
      ...(prospectiveMemory.continuityConflicts || []).map(
        (conflict) => `open-loop:${conflict.continuityKey}`,
      ),
      ...unverifiedOpenLoops
        .filter((loop) => loop.freshness === 'CONFLICTING')
        .map((loop) => `open-loop:${loop.continuityKey}`),
    ]),
  ]);

  const contextBlock = [
    'Stephanos governed cognitive context:',
    `asOfUtc: ${asOfUtc}`,
    contextLine('verifiedMemory', verifiedMemory),
    contextLine('unverifiedMemory', unverifiedMemory),
    confirmedOpenLoops.length
      ? `confirmedOpenLoops: ${confirmedOpenLoops.map((loop) => `${loop.loopClass}:${loop.summary}`).join(' | ')}`
      : 'confirmedOpenLoops: none',
    unverifiedOpenLoops.length
      ? `unverifiedOpenLoops: ${unverifiedOpenLoops.map((loop) => `${loop.freshness}:${loop.loopClass}:${loop.summary}`).join(' | ')}`
      : 'unverifiedOpenLoops: none',
    `contradictions: ${contradictions.join(' | ') || 'none'}`,
    'Use verifiedMemory only when canonical evidence/provenance is present. Treat unverifiedMemory and unverifiedOpenLoops only as lower-authority context and never state them as current fact or commitment without corroboration. Only FRESH confirmed open loops may be resumed conversationally; none grant scheduling, command, source, merge, deployment or runtime authority. Keep contradictions explicit.',
  ].join('\n');

  return Object.freeze({
    schemaVersion: STEPHANOS_COGNITIVE_CONTEXT_SCHEMA_VERSION,
    valid: true,
    verdict: contradictions.length ? 'READY_WITH_CONTRADICTIONS' : 'READY',
    asOfUtc,
    packs: Object.freeze(packs),
    prospectiveMemory,
    verifiedMemory,
    unverifiedMemory,
    confirmedOpenLoops,
    unverifiedOpenLoops,
    contradictions,
    contextBlock,
    authority: AUTHORITY,
    validationErrors: Object.freeze([]),
  });
}
