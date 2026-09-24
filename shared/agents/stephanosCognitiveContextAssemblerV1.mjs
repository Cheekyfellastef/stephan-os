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

function isVerifiedRecord(record = {}) {
  return record.authorityClass === 'SHARED_AUTHORITY'
    && record.currentState === 'CURRENT'
    && ['FRESH', 'RECENT'].includes(record.freshness);
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
    contradictions: Object.freeze([]),
    contextBlock: '',
    authority: AUTHORITY,
    validationErrors: Object.freeze([...new Set(errors)]),
  });
}

export function buildStephanosCognitiveContextV1(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return hold(['input:data-only-object-required']);
  }
  const allowedKeys = new Set(['asOfUtc', 'memoryRecords', 'openLoops']);
  const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) return hold(unknownKeys.map((key) => `input:unknown-field:${key}`));

  const asOfUtc = exactIso(input.asOfUtc);
  const memoryRecords = denseArray(input.memoryRecords, 2_000);
  const openLoops = denseArray(input.openLoops, 512);
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
  const confirmedOpenLoops = Object.freeze(
    (prospectiveMemory.activeOpenLoops || []).map((loop) => Object.freeze({
      loopId: loop.loopId,
      continuityKey: loop.continuityKey,
      loopClass: loop.loopClass,
      summary: loop.summary,
      whyItMatters: loop.whyItMatters,
      state: loop.state,
      overdue: loop.overdue,
      ownerRef: loop.ownerRef,
    })),
  );
  const contradictions = Object.freeze([
    ...new Set([
      ...Object.values(packs).flatMap((pack) => pack.unresolvedContradictions),
      ...(prospectiveMemory.continuityConflicts || []).map(
        (conflict) => `open-loop:${conflict.continuityKey}`,
      ),
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
    `contradictions: ${contradictions.join(' | ') || 'none'}`,
    'Use verifiedMemory as evidence-backed continuity context. Treat unverifiedMemory only as lower-authority context and never state it as fact without corroboration. Confirmed open loops may be resumed conversationally but grant no scheduling, command, source, merge, deployment or runtime authority. Keep contradictions explicit.',
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
    contradictions,
    contextBlock,
    authority: AUTHORITY,
    validationErrors: Object.freeze([]),
  });
}
