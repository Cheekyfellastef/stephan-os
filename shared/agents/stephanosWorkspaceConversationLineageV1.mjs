import {
  STEPHANOS_CONVERSATION_LINEAGE_KIND,
  resolveStephanosConversationLineage,
} from './stephanosConversationLineageV1.mjs';
import { validateStephanosAmbientCapabilityQuestion } from './stephanosAmbientCapabilityQuestionV1.mjs';
import { validateStephanosCapabilityQuestion } from './stephanosConversationalCapabilityLadderV1.mjs';

export const STEPHANOS_WORKSPACE_CONVERSATION_LINEAGE_SCHEMA_VERSION = 'stephanos.workspace-conversation-lineage.v1';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ownDataValue(object, key) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return { valid: false, value: undefined };
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) return { valid: false, value: undefined };
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return { valid: true, value: undefined };
  if (descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
    return { valid: false, value: undefined };
  }
  return { valid: true, value: descriptor.value };
}

/**
 * Resolve the conversation lineage carried by a persisted Shared Workspace
 * conversation record without forcing ambient questions to invent a roundId.
 *
 * Formal payloads may carry roundId and must bind it exactly to the workspace
 * correlationId. Ambient payloads omit roundId and inherit only the durable
 * workspace correlationId. Accessor-bearing inputs fail closed.
 */
export function resolveStephanosWorkspaceConversationLineage(record, payload) {
  const recordCorrelation = ownDataValue(record, 'correlationId');
  const payloadRound = ownDataValue(payload, 'roundId');
  if (!recordCorrelation.valid || !payloadRound.valid) {
    return Object.freeze({
      valid: false,
      schemaVersion: STEPHANOS_WORKSPACE_CONVERSATION_LINEAGE_SCHEMA_VERSION,
      kind: null,
      correlationId: '',
      roundId: '',
      errors: Object.freeze(['workspace-conversation-lineage-input-invalid']),
    });
  }

  const correlationId = text(recordCorrelation.value);
  const suppliedRoundId = text(payloadRound.value);
  const lineage = resolveStephanosConversationLineage({
    correlationId,
    ...(suppliedRoundId ? { roundId: suppliedRoundId } : {}),
  });

  if (!lineage.valid) {
    return Object.freeze({
      valid: false,
      schemaVersion: STEPHANOS_WORKSPACE_CONVERSATION_LINEAGE_SCHEMA_VERSION,
      kind: null,
      correlationId: lineage.correlationId,
      roundId: lineage.roundId,
      errors: lineage.errors,
    });
  }

  return Object.freeze({
    valid: true,
    schemaVersion: STEPHANOS_WORKSPACE_CONVERSATION_LINEAGE_SCHEMA_VERSION,
    kind: lineage.kind,
    correlationId: lineage.correlationId,
    roundId: lineage.roundId,
    ambient: lineage.kind === STEPHANOS_CONVERSATION_LINEAGE_KIND.AMBIENT,
    formalRound: lineage.kind === STEPHANOS_CONVERSATION_LINEAGE_KIND.FORMAL_ROUND,
    errors: Object.freeze([]),
  });
}

/**
 * Validate a workspace question against the contract selected by its resolved
 * lineage. This is the bounded adapter seam used to stop ambient questions
 * being forced through the formal ten-question-round validator.
 */
export function validateStephanosWorkspaceQuestionByLineage(record, payload, options = {}) {
  const lineage = resolveStephanosWorkspaceConversationLineage(record, payload);
  if (!lineage.valid) {
    return Object.freeze({ valid: false, lineage, question: null, errors: lineage.errors });
  }

  const validation = lineage.ambient
    ? validateStephanosAmbientCapabilityQuestion(payload, options.ambientQuestionValidationOptions)
    : validateStephanosCapabilityQuestion(payload, options.questionValidationOptions);
  const errors = Object.freeze([...(validation.errors || [])]);

  return Object.freeze({
    valid: Boolean(validation.valid),
    lineage,
    question: validation.valid ? (validation.question || payload) : null,
    errors,
  });
}
