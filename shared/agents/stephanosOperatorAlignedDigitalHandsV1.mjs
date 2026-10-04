import { createHash } from 'node:crypto';

import {
  STEPHANOS_OPERATOR_KNOWLEDGE_CLASS,
  STEPHANOS_OPERATOR_KNOWLEDGE_TWIN_SCHEMA_VERSION,
} from './stephanosOperatorKnowledgeTwinV1.mjs';

export const STEPHANOS_OPERATOR_ALIGNED_HANDS_SCHEMA_VERSION =
  'stephanos.operator-aligned-digital-hands.v1';

export const STEPHANOS_OPERATOR_ALIGNED_HANDS_DECISION = Object.freeze({
  ALIGNED_FOR_DELEGATION_PLANNING: 'ALIGNED_FOR_DELEGATION_PLANNING',
  OPERATOR_APPROVAL_REQUIRED: 'OPERATOR_APPROVAL_REQUIRED',
  ALIGNMENT_EVIDENCE_INSUFFICIENT: 'ALIGNMENT_EVIDENCE_INSUFFICIENT',
  CONFLICTING_OPERATOR_GUIDANCE: 'CONFLICTING_OPERATOR_GUIDANCE',
  SAFE_HOLD: 'SAFE_HOLD',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const MAX_INTENT_TEXT = 2400;
const MAX_ACTION_TEXT = 2400;
const MAX_REFS = 64;
const ACTION_CLASSES = new Set([
  'READ_ONLY_RESEARCH',
  'PLAN',
  'DELEGATE_BOUNDED_WORK',
  'PREPARE_CHANGE',
  'MUTATE_SOURCE',
  'MERGE',
  'DEPLOY',
  'EXTERNAL_ACCOUNT_ACTION',
  'SPEND_MONEY',
]);

const INPUT_KEYS = Object.freeze([
  'observedAtUtc',
  'operatorIntent',
  'knowledgeTwin',
  'proposedAction',
]);
const INTENT_KEYS = Object.freeze([
  'intentId',
  'statement',
  'sourceRefs',
]);
const ACTION_KEYS = Object.freeze([
  'actionId',
  'actionClass',
  'summary',
  'targetSystem',
  'requestedBy',
  'sourceRefs',
]);

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  durablePromotionAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  accountMutationAllowed: false,
  spendingAllowed: false,
  leaseSeizureAllowed: false,
  parallelControllerAllowed: false,
  bypassApprovalAllowed: false,
  dispatchThroughCanonicalFabricRequired: true,
});

function exactObject(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return null;
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return null;
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function exactIso(value) {
  if (typeof value !== 'string' || !value) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

function safeText(value, maximum) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum;
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : '';
}

function denseRefs(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_REFS) return null;
    const out = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || typeof value[index] !== 'string') return null;
      const ref = value[index].trim();
      if (!ref || ref.length > 260) return null;
      out.push(ref);
    }
    return Object.freeze([...new Set(out)]);
  } catch {
    return null;
  }
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeHold(errors) {
  return Object.freeze({
    schemaVersion: STEPHANOS_OPERATOR_ALIGNED_HANDS_SCHEMA_VERSION,
    kind: 'stephanos.operator_aligned_digital_hands',
    alignmentId: '',
    decision: STEPHANOS_OPERATOR_ALIGNED_HANDS_DECISION.SAFE_HOLD,
    operatorIntent: null,
    proposedAction: null,
    alignmentEvidence: Object.freeze([]),
    conflictingGuidance: Object.freeze([]),
    requiredNextGate: 'DO_NOT_DISPATCH',
    authority: AUTHORITY,
    valid: false,
    validationErrors: Object.freeze([...new Set(errors)]),
  });
}

function currentKnowledge(twin) {
  const historical = new Set(
    Array.isArray(twin?.historicalLinks)
      ? twin.historicalLinks.map((link) => link?.olderKnowledgeId).filter(Boolean)
      : [],
  );
  const eligibleClasses = new Set([
    STEPHANOS_OPERATOR_KNOWLEDGE_CLASS.KNOWLEDGE,
    STEPHANOS_OPERATOR_KNOWLEDGE_CLASS.DECISION,
    STEPHANOS_OPERATOR_KNOWLEDGE_CLASS.PREFERENCE,
    STEPHANOS_OPERATOR_KNOWLEDGE_CLASS.LESSON,
    STEPHANOS_OPERATOR_KNOWLEDGE_CLASS.GOAL,
    STEPHANOS_OPERATOR_KNOWLEDGE_CLASS.OPEN_THREAD,
    STEPHANOS_OPERATOR_KNOWLEDGE_CLASS.CORRECTION,
  ]);
  return Object.freeze(
    (Array.isArray(twin?.visibleItems) ? twin.visibleItems : [])
      .filter((item) => item?.role === 'operator')
      .filter((item) => eligibleClasses.has(item?.knowledgeClass))
      .filter((item) => !historical.has(item?.knowledgeId))
      .map((item) => Object.freeze({
        knowledgeId: item.knowledgeId,
        knowledgeClass: item.knowledgeClass,
        text: item.text,
        createdAtUtc: item.createdAtUtc,
        sourceRefs: item.sourceRefs,
      })),
  );
}

function conflictsFor(action, evidence) {
  const normalizedAction = action.summary.toLowerCase();
  const conflicts = [];
  const stopTerms = new Set([
    'about', 'after', 'again', 'being', 'could', 'current', 'existing', 'their',
    'there', 'these', 'those', 'through', 'using', 'would', 'should', 'create',
    'make', 'with', 'from', 'into', 'that', 'this',
  ]);
  for (const item of evidence) {
    const statement = String(item.text || '').toLowerCase();
    const matches = [...statement.matchAll(/\b(?:do not|don't|never|must not|stop|avoid|forbid|forbidden)\b/g)];
    if (!matches.length) continue;
    const lastNegative = matches.at(-1);
    const forbiddenClause = statement
      .slice((lastNegative.index || 0) + lastNegative[0].length)
      .split(/[.;!?]/, 1)[0]
      .replace(/[^a-z0-9 ]+/g, ' ')
      .trim();
    const forbiddenTerms = forbiddenClause
      .split(/\s+/)
      .filter((term) => term.length >= 4)
      .filter((term) => !stopTerms.has(term));
    if (!forbiddenTerms.length) continue;
    const overlap = forbiddenTerms.filter((term) => normalizedAction.includes(term));
    const minimumMatches = forbiddenTerms.length === 1 ? 1 : 2;
    if (overlap.length >= minimumMatches) {
      conflicts.push(Object.freeze({
        knowledgeId: item.knowledgeId,
        knowledgeClass: item.knowledgeClass,
        reason: 'PROPOSED_ACTION_OVERLAPS_EXPLICIT_NEGATIVE_OPERATOR_GUIDANCE',
        matchingTerms: Object.freeze(overlap.slice(0, 8)),
        sourceRefs: item.sourceRefs,
      }));
    }
  }
  return Object.freeze(conflicts);
}

function actionNeedsReservedApproval(actionClass) {
  return new Set([
    'MUTATE_SOURCE',
    'MERGE',
    'DEPLOY',
    'EXTERNAL_ACCOUNT_ACTION',
    'SPEND_MONEY',
  ]).has(actionClass);
}

export function buildStephanosOperatorAlignedDigitalHandsV1(input = {}) {
  const top = exactObject(input, INPUT_KEYS);
  if (!top) return safeHold(['input-invalid-exact-data-shape']);

  const errors = [];
  const observedAtMs = exactIso(top.observedAtUtc);
  if (observedAtMs === null) errors.push('observedAtUtc-invalid');

  const intent = exactObject(top.operatorIntent, INTENT_KEYS);
  if (!intent) errors.push('operatorIntent-invalid-exact-data-shape');
  const action = exactObject(top.proposedAction, ACTION_KEYS);
  if (!action) errors.push('proposedAction-invalid-exact-data-shape');

  if (intent) {
    if (!safeId(intent.intentId)) errors.push('operatorIntent:intentId-invalid');
    if (!safeText(intent.statement, MAX_INTENT_TEXT)) errors.push('operatorIntent:statement-invalid');
    if (!denseRefs(intent.sourceRefs)) errors.push('operatorIntent:sourceRefs-invalid');
  }
  if (action) {
    if (!safeId(action.actionId)) errors.push('proposedAction:actionId-invalid');
    if (!ACTION_CLASSES.has(action.actionClass)) errors.push('proposedAction:actionClass-invalid');
    if (!safeText(action.summary, MAX_ACTION_TEXT)) errors.push('proposedAction:summary-invalid');
    if (!safeId(action.targetSystem)) errors.push('proposedAction:targetSystem-invalid');
    if (action.requestedBy !== 'stephanos') errors.push('proposedAction:requestedBy-must-be-stephanos');
    if (!denseRefs(action.sourceRefs)) errors.push('proposedAction:sourceRefs-invalid');
  }

  const twin = top.knowledgeTwin;
  if (!twin || typeof twin !== 'object' || Array.isArray(twin)) {
    errors.push('knowledgeTwin-required');
  } else {
    if (twin.schemaVersion !== STEPHANOS_OPERATOR_KNOWLEDGE_TWIN_SCHEMA_VERSION) errors.push('knowledgeTwin:schemaVersion-mismatch');
    if (twin.valid !== true) errors.push('knowledgeTwin:not-valid');
    if (!safeId(twin.twinId)) errors.push('knowledgeTwin:twinId-invalid');
    if (twin.authority?.memoryWriteAllowed !== false) errors.push('knowledgeTwin:authority-widened');
  }

  if (errors.length) return safeHold(errors);

  const evidence = currentKnowledge(twin);
  if (evidence.length === 0) {
    return Object.freeze({
      ...safeHold([]),
      alignmentId: `alignment-${digest({ intent, action, twinId: twin.twinId }).slice(0, 24)}`,
      decision: STEPHANOS_OPERATOR_ALIGNED_HANDS_DECISION.ALIGNMENT_EVIDENCE_INSUFFICIENT,
      operatorIntent: intent,
      proposedAction: action,
      requiredNextGate: 'REQUIRE_OPERATOR_INTENT_OR_CURRENT_KNOWLEDGE_EVIDENCE',
      valid: true,
      validationErrors: Object.freeze([]),
    });
  }

  const conflictingGuidance = conflictsFor(action, evidence);
  if (conflictingGuidance.length) {
    return Object.freeze({
      schemaVersion: STEPHANOS_OPERATOR_ALIGNED_HANDS_SCHEMA_VERSION,
      kind: 'stephanos.operator_aligned_digital_hands',
      alignmentId: `alignment-${digest({ intent, action, twinId: twin.twinId, conflictingGuidance }).slice(0, 24)}`,
      decision: STEPHANOS_OPERATOR_ALIGNED_HANDS_DECISION.CONFLICTING_OPERATOR_GUIDANCE,
      operatorIntent: intent,
      proposedAction: action,
      alignmentEvidence: evidence,
      conflictingGuidance,
      requiredNextGate: 'DO_NOT_DISPATCH_UNTIL_CONFLICT_IS_RESOLVED_BY_OPERATOR_OR_GOVERNED_CORRECTION',
      authority: AUTHORITY,
      valid: true,
      validationErrors: Object.freeze([]),
    });
  }

  const reservedApproval = actionNeedsReservedApproval(action.actionClass);
  const decision = reservedApproval
    ? STEPHANOS_OPERATOR_ALIGNED_HANDS_DECISION.OPERATOR_APPROVAL_REQUIRED
    : STEPHANOS_OPERATOR_ALIGNED_HANDS_DECISION.ALIGNED_FOR_DELEGATION_PLANNING;

  return Object.freeze({
    schemaVersion: STEPHANOS_OPERATOR_ALIGNED_HANDS_SCHEMA_VERSION,
    kind: 'stephanos.operator_aligned_digital_hands',
    alignmentId: `alignment-${digest({ intent, action, twinId: twin.twinId, evidence }).slice(0, 24)}`,
    decision,
    operatorIntent: Object.freeze({
      intentId: intent.intentId,
      statement: intent.statement,
      sourceRefs: denseRefs(intent.sourceRefs),
    }),
    proposedAction: Object.freeze({
      actionId: action.actionId,
      actionClass: action.actionClass,
      summary: action.summary,
      targetSystem: action.targetSystem,
      requestedBy: action.requestedBy,
      sourceRefs: denseRefs(action.sourceRefs),
    }),
    alignmentEvidence: evidence,
    conflictingGuidance: Object.freeze([]),
    requiredNextGate: reservedApproval
      ? 'EXISTING_OPERATOR_APPROVAL_GATE'
      : 'STEPHANOS_EXECUTIVE_COMMAND_PLANE_V1',
    authority: AUTHORITY,
    valid: true,
    validationErrors: Object.freeze([]),
  });
}
