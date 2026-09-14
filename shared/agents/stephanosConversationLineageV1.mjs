const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
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
export function resolveStephanosConversationLineage({ roundId = '', correlationId = '' } = {}) {
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
