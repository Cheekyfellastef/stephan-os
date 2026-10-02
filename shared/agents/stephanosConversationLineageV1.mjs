const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const LINEAGE_FIELDS = new Set(['roundId', 'correlationId']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function snapshotLineageInput(input) {
  if (input === undefined) return { valid: true, value: {} };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, error: 'lineage-input-invalid' };
  }

  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    return { valid: false, error: 'lineage-input-invalid' };
  }

  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!LINEAGE_FIELDS.has(key)) return { valid: false, error: 'lineage-input-invalid' };
    if ('get' in descriptor || 'set' in descriptor) return { valid: false, error: 'lineage-input-invalid' };
  }

  return {
    valid: true,
    value: {
      roundId: descriptors.roundId?.value,
      correlationId: descriptors.correlationId?.value,
    },
  };
}

export const STEPHANOS_CONVERSATION_LINEAGE_SCHEMA_VERSION = 'stephanos.conversation-lineage.v1';

export const STEPHANOS_CONVERSATION_LINEAGE_KIND = Object.freeze({
  FORMAL_ROUND: 'FORMAL_ROUND',
  AMBIENT: 'AMBIENT',
});

/**
 * Resolve conversation lineage without forcing ambient questions to impersonate
 * formal ten-question capability rounds.
 *
 * Formal round records carry both roundId and correlationId and they must be
 * identical. Ambient records carry correlationId only. Supplying a different
 * roundId and correlationId is rejected fail-closed as mixed lineage.
 */
export function resolveStephanosConversationLineage(input = {}) {
  const snapshot = snapshotLineageInput(input);
  if (!snapshot.valid) {
    return Object.freeze({
      valid: false,
      schemaVersion: STEPHANOS_CONVERSATION_LINEAGE_SCHEMA_VERSION,
      kind: null,
      correlationId: '',
      roundId: '',
      errors: Object.freeze([snapshot.error]),
    });
  }

  const { roundId = '', correlationId = '' } = snapshot.value;
  const normalizedRoundId = safeId(roundId);
  const normalizedCorrelationId = safeId(correlationId);
  const errors = [];

  if (text(roundId) && !normalizedRoundId) errors.push('roundId-invalid');
  if (!normalizedCorrelationId) errors.push('correlationId-invalid');

  if (normalizedRoundId && normalizedCorrelationId && normalizedRoundId !== normalizedCorrelationId) {
    errors.push('mixed-formal-ambient-lineage');
  }

  if (errors.length > 0) {
    return Object.freeze({
      valid: false,
      schemaVersion: STEPHANOS_CONVERSATION_LINEAGE_SCHEMA_VERSION,
      kind: null,
      correlationId: normalizedCorrelationId,
      roundId: normalizedRoundId,
      errors: Object.freeze([...new Set(errors)]),
    });
  }

  const kind = normalizedRoundId
    ? STEPHANOS_CONVERSATION_LINEAGE_KIND.FORMAL_ROUND
    : STEPHANOS_CONVERSATION_LINEAGE_KIND.AMBIENT;

  return Object.freeze({
    valid: true,
    schemaVersion: STEPHANOS_CONVERSATION_LINEAGE_SCHEMA_VERSION,
    kind,
    correlationId: normalizedCorrelationId,
    roundId: normalizedRoundId,
    errors: Object.freeze([]),
  });
}

export function isStephanosFormalRoundLineage(lineage = {}) {
  return lineage?.valid === true
    && lineage?.kind === STEPHANOS_CONVERSATION_LINEAGE_KIND.FORMAL_ROUND
    && Boolean(safeId(lineage?.roundId))
    && lineage.roundId === lineage.correlationId;
}

export function isStephanosAmbientLineage(lineage = {}) {
  return lineage?.valid === true
    && lineage?.kind === STEPHANOS_CONVERSATION_LINEAGE_KIND.AMBIENT
    && !text(lineage?.roundId)
    && Boolean(safeId(lineage?.correlationId));
}
