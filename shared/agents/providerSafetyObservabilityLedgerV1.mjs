import { createHash } from 'node:crypto';

export const PROVIDER_SAFETY_LEDGER_INPUT_SCHEMA_VERSION =
  'stephanos.provider-safety-ledger-input.v1';
export const PROVIDER_SAFETY_EVENT_SCHEMA_VERSION =
  'stephanos.provider-safety-observation-event.v1';
export const PROVIDER_SAFETY_LEDGER_PROJECTION_SCHEMA_VERSION =
  'stephanos.provider-safety-ledger-projection.v1';

export const PROVIDER_SAFETY_CLASSIFICATIONS = Object.freeze([
  'CONFIRMED_PROVIDER_NOTICE',
  'CONFIRMED_PROVIDER_BLOCK',
  'CONFIRMED_PROVIDER_REQUEST_METADATA',
  'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
  'INFERRED_LATENCY_ANOMALY',
  'UNOBSERVABLE_PROVIDER_INTERNAL_STATE',
  'CONFIRMED_LOCAL_OBSERVATION',
  'PROVIDER_DISCLOSED_EVENT',
  'PROVIDER_DISCLOSED_HUMAN_ACCESS',
  'PROVIDER_SAYS_NO_RECORD',
  'NOT_PRESENT_IN_EXPORT',
  'REQUEST_SUBMITTED',
  'IDENTITY_VERIFICATION_PENDING',
  'RESPONSE_DUE',
  'RESPONSE_OVERDUE',
  'PARTIAL_DISCLOSURE',
  'REQUESTED_BUT_WITHHELD',
  'EXEMPTION_CLAIMED',
  'APPEAL_OR_COMPLAINT_PENDING',
  'INFERRED_ANOMALY',
]);

export const PROVIDER_SAFETY_OUTCOMES = Object.freeze([
  'CONTINUED',
  'BLOCKED',
  'FAILED',
  'RETRIED',
  'DISCLOSED',
  'WITHHELD',
  'PENDING',
  'COMPLETE',
  'UNKNOWN',
]);

export const PROVIDER_SAFETY_EVIDENCE_TYPES = Object.freeze([
  'PROVIDER_VISIBLE_NOTICE',
  'SUPPORTED_CLIENT_METADATA',
  'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
  'PROVIDER_DISCLOSURE',
  'SANITIZED_EXPORT_DIFF',
  'RIGHTS_REQUEST_RECEIPT',
  'SYNTHETIC_TEST_FIXTURE',
  'UNKNOWN',
]);

export const PROVIDER_SAFETY_EVIDENCE_STRENGTHS = Object.freeze([
  'STRONG',
  'MEDIUM',
  'WEAK',
  'UNKNOWN',
]);

export const PROVIDER_SAFETY_OBSERVER_CLASSES = Object.freeze([
  'AUTHORIZED_SUPPORTED_CLIENT',
  'OPERATOR_SUPPLIED',
  'PROVIDER_DISCLOSURE',
  'LOCAL_LEDGER_NORMALIZER',
  'SYNTHETIC_TEST',
  'UNKNOWN',
]);

export const PROVIDER_SAFETY_CANONICAL_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
export const PROVIDER_SAFETY_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const PROVIDER_SAFETY_MAX_EVENTS = 256;
export const PROVIDER_SAFETY_MAX_INPUT_BYTES = 256 * 1024;
export const PROVIDER_SAFETY_MAX_PROJECTION_BYTES = 160 * 1024;

const MAX_DATE_MS = 8_640_000_000_000_000;
const TOP_LEVEL_KEYS = Object.freeze(['schemaVersion', 'snapshotId', 'events']);
const OPTION_KEYS = Object.freeze(['evaluationNowMs']);
const EVENT_KEYS = Object.freeze([
  'schemaVersion',
  'eventId',
  'classification',
  'providerId',
  'surfaceId',
  'modelId',
  'observedAtUtc',
  'startedAtUtc',
  'completedAtUtc',
  'latencyMs',
  'outcome',
  'evidenceStrength',
  'noticeFingerprint',
  'noticeSummaryRedacted',
  'requestIdHash',
  'relatedGoalRef',
  'relatedPrRef',
  'relatedTaskRef',
  'evidenceType',
  'evidenceRefs',
  'observerClass',
  'accessRoleCategory',
  'accessPurposeCategory',
  'contentCategory',
  'limitations',
  'freshnessBasisUtc',
]);

const SNAPSHOT_INVALID = Symbol('SNAPSHOT_INVALID');
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_OPTIONAL_ID = /^[a-z0-9][a-z0-9._:-]{0,95}$/;
const SAFE_CATEGORY = /^[A-Z0-9][A-Z0-9_:-]{0,95}$/;
const SAFE_GOAL_REF = /^#[1-9][0-9]{0,9}$/;
const SAFE_PR_REF = /^#[1-9][0-9]{0,9}$/;
const SAFE_TASK_REF = /^task:[a-z0-9][a-z0-9._:-]{0,120}$/;
const SAFE_HASH = /^sha256:[a-f0-9]{64}$/;
const SAFE_EVIDENCE_REF =
  /^(?:issue|pr|receipt|evidence|export|operator|provider|workspace|dataset):\/\/[a-z0-9][a-z0-9._:/#-]{0,220}$/;
const SENSITIVE_TEXT =
  /\b(?:api[-_ ]?key|password|passwd|secret|bearer|authorization|private[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|cookie|session|account[-_ ]?(?:number|no|id)|sort[-_ ]?code|iban|swift|prompt content|response content|conversation title|raw screenshot|raw export|identity document)\b/i;
const EMAIL_LIKE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const LONG_DIGIT_SEQUENCE = /(?:^|\D)\d{6,}(?:\D|$)/;
const LOCAL_PATH = /(?:^|\s)(?:[A-Za-z]:\\|\\\\|\/home\/|\/Users\/|\/etc\/|\.\.\/|\.\.\\)/;

const CONFIRMED_CLASSIFICATIONS = new Set([
  'CONFIRMED_PROVIDER_NOTICE',
  'CONFIRMED_PROVIDER_BLOCK',
  'CONFIRMED_PROVIDER_REQUEST_METADATA',
  'CONFIRMED_LOCAL_OBSERVATION',
]);
const DISCLOSED_CLASSIFICATIONS = new Set([
  'PROVIDER_DISCLOSED_EVENT',
  'PROVIDER_DISCLOSED_HUMAN_ACCESS',
]);
const INFERRED_CLASSIFICATIONS = new Set([
  'INFERRED_LATENCY_ANOMALY',
  'INFERRED_ANOMALY',
]);
const WITHHELD_OR_ABSENT_CLASSIFICATIONS = new Set([
  'PROVIDER_SAYS_NO_RECORD',
  'NOT_PRESENT_IN_EXPORT',
  'REQUESTED_BUT_WITHHELD',
  'EXEMPTION_CLAIMED',
]);
const ACCOUNTABILITY_PROCESS_CLASSIFICATIONS = new Set([
  'REQUEST_SUBMITTED',
  'IDENTITY_VERIFICATION_PENDING',
  'RESPONSE_DUE',
  'RESPONSE_OVERDUE',
  'PARTIAL_DISCLOSURE',
  'APPEAL_OR_COMPLAINT_PENDING',
]);
const UNOBSERVABLE_CLASSIFICATIONS = new Set([
  'UNOBSERVABLE_PROVIDER_INTERNAL_STATE',
  'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
]);
const MATERIAL_CONFIRMED_CLASSIFICATIONS = new Set([
  'CONFIRMED_PROVIDER_NOTICE',
  'CONFIRMED_PROVIDER_BLOCK',
  'CONFIRMED_LOCAL_OBSERVATION',
  'PROVIDER_DISCLOSED_EVENT',
  'PROVIDER_DISCLOSED_HUMAN_ACCESS',
]);

const COMPATIBLE_EVIDENCE_TYPES = Object.freeze({
  CONFIRMED_PROVIDER_NOTICE: Object.freeze([
    'PROVIDER_VISIBLE_NOTICE',
    'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
  ]),
  CONFIRMED_PROVIDER_BLOCK: Object.freeze([
    'PROVIDER_VISIBLE_NOTICE',
    'SUPPORTED_CLIENT_METADATA',
    'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
  ]),
  CONFIRMED_PROVIDER_REQUEST_METADATA: Object.freeze(['SUPPORTED_CLIENT_METADATA']),
  OPERATOR_SUPPLIED_VISIBLE_EVIDENCE: Object.freeze(['OPERATOR_SUPPLIED_VISIBLE_EVIDENCE']),
  INFERRED_LATENCY_ANOMALY: Object.freeze([
    'SUPPORTED_CLIENT_METADATA',
    'PROVIDER_VISIBLE_NOTICE',
    'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
  ]),
  UNOBSERVABLE_PROVIDER_INTERNAL_STATE: Object.freeze([
    'UNKNOWN',
    'PROVIDER_DISCLOSURE',
    'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
  ]),
  CONFIRMED_LOCAL_OBSERVATION: Object.freeze([
    'PROVIDER_VISIBLE_NOTICE',
    'SUPPORTED_CLIENT_METADATA',
    'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
  ]),
  PROVIDER_DISCLOSED_EVENT: Object.freeze([
    'PROVIDER_DISCLOSURE',
    'RIGHTS_REQUEST_RECEIPT',
    'SANITIZED_EXPORT_DIFF',
  ]),
  PROVIDER_DISCLOSED_HUMAN_ACCESS: Object.freeze([
    'PROVIDER_DISCLOSURE',
    'RIGHTS_REQUEST_RECEIPT',
    'SANITIZED_EXPORT_DIFF',
  ]),
  PROVIDER_SAYS_NO_RECORD: Object.freeze([
    'PROVIDER_DISCLOSURE',
    'RIGHTS_REQUEST_RECEIPT',
  ]),
  NOT_PRESENT_IN_EXPORT: Object.freeze(['SANITIZED_EXPORT_DIFF']),
  REQUEST_SUBMITTED: Object.freeze(['RIGHTS_REQUEST_RECEIPT']),
  IDENTITY_VERIFICATION_PENDING: Object.freeze(['RIGHTS_REQUEST_RECEIPT']),
  RESPONSE_DUE: Object.freeze(['RIGHTS_REQUEST_RECEIPT']),
  RESPONSE_OVERDUE: Object.freeze(['RIGHTS_REQUEST_RECEIPT']),
  PARTIAL_DISCLOSURE: Object.freeze([
    'PROVIDER_DISCLOSURE',
    'RIGHTS_REQUEST_RECEIPT',
    'SANITIZED_EXPORT_DIFF',
  ]),
  REQUESTED_BUT_WITHHELD: Object.freeze([
    'PROVIDER_DISCLOSURE',
    'RIGHTS_REQUEST_RECEIPT',
  ]),
  EXEMPTION_CLAIMED: Object.freeze([
    'PROVIDER_DISCLOSURE',
    'RIGHTS_REQUEST_RECEIPT',
  ]),
  APPEAL_OR_COMPLAINT_PENDING: Object.freeze(['RIGHTS_REQUEST_RECEIPT']),
  INFERRED_ANOMALY: Object.freeze([
    'SUPPORTED_CLIENT_METADATA',
    'PROVIDER_VISIBLE_NOTICE',
    'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
    'SANITIZED_EXPORT_DIFF',
  ]),
});

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  commandExecutionAllowed: false,
  providerAccessAllowed: false,
  accountAccessAllowed: false,
  browserObservationAllowed: false,
  networkInterceptionAllowed: false,
  credentialAccessAllowed: false,
  legalSubmissionAllowed: false,
  exportImportAllowed: false,
  notificationPublishAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  spendAllowed: false,
  runtimeMutationAllowed: false,
});

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function snapshotExactObject(value, expectedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return SNAPSHOT_INVALID;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return SNAPSHOT_INVALID;
    if (Object.getOwnPropertySymbols(value).length > 0) return SNAPSHOT_INVALID;

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Object.keys(descriptors).sort(compareText);
    const expected = [...expectedKeys].sort(compareText);
    if (JSON.stringify(actualKeys) !== JSON.stringify(expected)) return SNAPSHOT_INVALID;

    const output = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.get ||
        descriptor.set
      ) {
        return SNAPSHOT_INVALID;
      }
      Object.defineProperty(output, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output);
  } catch {
    return SNAPSHOT_INVALID;
  }
}

function snapshotDenseArray(value, maximumLength, snapshotEntry = (entry) => entry) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return SNAPSHOT_INVALID;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) return SNAPSHOT_INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength
    ) {
      return SNAPSHOT_INVALID;
    }
    const length = lengthDescriptor.value;
    const expectedKeys = ['length', ...Array.from({ length }, (_, index) => String(index))]
      .sort(compareText);
    const actualKeys = Object.keys(descriptors).sort(compareText);
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) return SNAPSHOT_INVALID;

    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.get ||
        descriptor.set
      ) {
        return SNAPSHOT_INVALID;
      }
      const entry = snapshotEntry(descriptor.value, index);
      if (entry === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;
      output.push(entry);
    }
    return Object.freeze(output);
  } catch {
    return SNAPSHOT_INVALID;
  }
}

function snapshotStringArray(value, maximumLength) {
  return snapshotDenseArray(value, maximumLength, (entry) =>
    typeof entry === 'string' ? entry : SNAPSHOT_INVALID,
  );
}

function snapshotEvent(value) {
  const event = snapshotExactObject(value, EVENT_KEYS);
  if (event === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;
  const evidenceRefs = snapshotStringArray(event.evidenceRefs, 8);
  const limitations = snapshotStringArray(event.limitations, 8);
  if (evidenceRefs === SNAPSHOT_INVALID || limitations === SNAPSHOT_INVALID) {
    return SNAPSHOT_INVALID;
  }

  const output = Object.create(null);
  for (const key of EVENT_KEYS) {
    const fieldValue = key === 'evidenceRefs'
      ? evidenceRefs
      : key === 'limitations'
        ? limitations
        : event[key];
    if (
      key !== 'evidenceRefs' &&
      key !== 'limitations' &&
      fieldValue !== null &&
      typeof fieldValue === 'object'
    ) {
      return SNAPSHOT_INVALID;
    }
    Object.defineProperty(output, key, {
      value: fieldValue,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(output);
}

function snapshotInput(value) {
  const input = snapshotExactObject(value, TOP_LEVEL_KEYS);
  if (input === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;
  const events = snapshotDenseArray(input.events, PROVIDER_SAFETY_MAX_EVENTS, snapshotEvent);
  if (events === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;
  return Object.freeze({
    schemaVersion: input.schemaVersion,
    snapshotId: input.snapshotId,
    events,
  });
}

function snapshotOptions(value) {
  const options = snapshotExactObject(value, OPTION_KEYS);
  if (options === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;
  return Object.freeze({ evaluationNowMs: options.evaluationNowMs });
}

function validEvaluationNowMs(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_MS;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  try {
    return new Date(milliseconds).toISOString() === value ? milliseconds : null;
  } catch {
    return null;
  }
}

function isoFromMs(value) {
  if (!validEvaluationNowMs(value)) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function boundedText(value, maximumLength, allowEmpty = false) {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length <= maximumLength &&
    (allowEmpty || value.length > 0)
  );
}

function containsSensitiveText(value) {
  return (
    typeof value === 'string' &&
    (SENSITIVE_TEXT.test(value) ||
      EMAIL_LIKE.test(value) ||
      LONG_DIGIT_SEQUENCE.test(value) ||
      LOCAL_PATH.test(value))
  );
}

function safeEvidenceRef(value) {
  if (
    typeof value !== 'string' ||
    !SAFE_EVIDENCE_REF.test(value) ||
    value.includes('..') ||
    containsSensitiveText(value)
  ) {
    return false;
  }
  const payload = value.slice(value.indexOf('://') + 3);
  return (
    !payload.startsWith('/') &&
    !/^[a-z]:\//i.test(payload) &&
    !payload.includes('\\') &&
    !/(?:^|\/)(?:home|users|etc)(?:\/|$)/i.test(payload)
  );
}

function sourceCompatible(classification, evidenceType) {
  if (evidenceType === 'SYNTHETIC_TEST_FIXTURE') return true;
  const allowed = COMPATIBLE_EVIDENCE_TYPES[classification];
  return Array.isArray(allowed) && allowed.includes(evidenceType);
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function truthClassFor(event, stale) {
  if (stale) return 'STALE';
  if (event.evidenceType === 'SYNTHETIC_TEST_FIXTURE') return 'TEST_FIXTURE';
  if (CONFIRMED_CLASSIFICATIONS.has(event.classification)) return 'CONFIRMED';
  if (DISCLOSED_CLASSIFICATIONS.has(event.classification)) return 'DISCLOSED';
  if (INFERRED_CLASSIFICATIONS.has(event.classification)) return 'INFERRED';
  if (WITHHELD_OR_ABSENT_CLASSIFICATIONS.has(event.classification)) {
    return 'WITHHELD_OR_ABSENT';
  }
  if (ACCOUNTABILITY_PROCESS_CLASSIFICATIONS.has(event.classification)) {
    return 'ACCOUNTABILITY_PROCESS';
  }
  if (event.classification === 'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE') return 'UNCLASSIFIED_EVIDENCE';
  if (UNOBSERVABLE_CLASSIFICATIONS.has(event.classification)) return 'UNOBSERVABLE';
  return 'UNOBSERVABLE';
}

function emptyDistribution() {
  return Object.freeze([]);
}

function distribution(events, key) {
  const counts = new Map();
  for (const event of events) {
    const value = typeof event[key] === 'string' && event[key].length > 0
      ? event[key]
      : 'UNKNOWN';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Object.freeze(
    [...counts.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([id, count]) => Object.freeze({ id, count })),
  );
}

function invalidProjection(errors, partial = {}) {
  return Object.freeze({
    schemaVersion: PROVIDER_SAFETY_LEDGER_PROJECTION_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_PROVIDER_SAFETY_OBSERVABILITY',
    projectionId: '',
    snapshotId: partial.snapshotId || '',
    evaluatedAtUtc: partial.evaluatedAtUtc || '',
    freshness: 'UNKNOWN',
    verdict: 'SAFE_HOLD',
    events: Object.freeze([]),
    counts: Object.freeze({
      total: 0,
      confirmedNotices: 0,
      confirmedBlocks: 0,
      confirmedRequestMetadata: 0,
      confirmedLocalObservations: 0,
      disclosedEvents: 0,
      disclosedHumanAccess: 0,
      inferredAnomalies: 0,
      providerSaysNoRecord: 0,
      notPresentInExport: 0,
      requestedButWithheld: 0,
      exemptionClaimed: 0,
      accountabilityProcess: 0,
      unclassifiedVisibleEvidence: 0,
      unobservable: 0,
      stale: 0,
      syntheticFixtures: 0,
      replayedDuplicates: 0,
    }),
    latestConfirmedMaterialEvent: null,
    latency: Object.freeze({ measuredEventCount: 0, totalMeasuredLatencyMs: 0, maximumMeasuredLatencyMs: null }),
    distributions: Object.freeze({
      providers: emptyDistribution(),
      surfaces: emptyDistribution(),
      models: emptyDistribution(),
    }),
    evidenceCoverage: Object.freeze({
      liveCurrentEventCount: 0,
      currentEvidenceRefCount: 0,
      staleEventCount: 0,
      unknownProviderCount: 0,
      unknownSurfaceCount: 0,
      unknownModelCount: 0,
      syntheticFixtureCount: 0,
    }),
    evidenceRefs: Object.freeze([]),
    limitations: Object.freeze([]),
    unknowns: Object.freeze([]),
    authority: AUTHORITY,
    valid: false,
    validationErrors: Object.freeze([...errors]),
  });
}

function validateProviderSafetyEventInternal(input, options) {
  const event = snapshotEvent(input);
  const validatedOptions = snapshotOptions(options);
  const errors = [];

  if (event === SNAPSHOT_INVALID) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(['event-must-be-exact-dense-data-only-shape']),
      event: null,
    });
  }
  if (validatedOptions === SNAPSHOT_INVALID) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(['validation-options-mismatch']),
      event: null,
    });
  }

  const evaluationNowMs = validatedOptions.evaluationNowMs;
  if (!validEvaluationNowMs(evaluationNowMs)) errors.push('evaluationNowMs-invalid');
  if (event.schemaVersion !== PROVIDER_SAFETY_EVENT_SCHEMA_VERSION) {
    errors.push('event-schema-version-mismatch');
  }
  if (!SAFE_ID.test(event.eventId || '')) errors.push('eventId-invalid');
  if (!PROVIDER_SAFETY_CLASSIFICATIONS.includes(event.classification)) {
    errors.push('classification-invalid');
  }
  if (!PROVIDER_SAFETY_OUTCOMES.includes(event.outcome)) errors.push('outcome-invalid');
  if (!PROVIDER_SAFETY_EVIDENCE_TYPES.includes(event.evidenceType)) {
    errors.push('evidenceType-invalid');
  }
  if (!PROVIDER_SAFETY_EVIDENCE_STRENGTHS.includes(event.evidenceStrength)) {
    errors.push('evidenceStrength-invalid');
  }
  if (!PROVIDER_SAFETY_OBSERVER_CLASSES.includes(event.observerClass)) {
    errors.push('observerClass-invalid');
  }
  if (
    PROVIDER_SAFETY_CLASSIFICATIONS.includes(event.classification) &&
    PROVIDER_SAFETY_EVIDENCE_TYPES.includes(event.evidenceType) &&
    !sourceCompatible(event.classification, event.evidenceType)
  ) {
    errors.push('classification-evidence-type-mismatch');
  }

  for (const [field, value] of [
    ['providerId', event.providerId],
    ['surfaceId', event.surfaceId],
    ['modelId', event.modelId],
  ]) {
    if (value !== null && (!SAFE_OPTIONAL_ID.test(value) || containsSensitiveText(value))) {
      errors.push(`${field}-invalid`);
    }
  }

  if (
    ['CONFIRMED_PROVIDER_NOTICE', 'CONFIRMED_PROVIDER_BLOCK', 'CONFIRMED_PROVIDER_REQUEST_METADATA', 'PROVIDER_DISCLOSED_EVENT', 'PROVIDER_DISCLOSED_HUMAN_ACCESS'].includes(event.classification) &&
    event.providerId === null
  ) {
    errors.push('providerId-required-for-provider-specific-claim');
  }
  if (
    ['CONFIRMED_PROVIDER_NOTICE', 'CONFIRMED_PROVIDER_BLOCK'].includes(event.classification) &&
    event.surfaceId === null
  ) {
    errors.push('surfaceId-required-for-visible-provider-claim');
  }

  const observedAtMs = canonicalTimestamp(event.observedAtUtc);
  const startedAtMs = event.startedAtUtc === null ? null : canonicalTimestamp(event.startedAtUtc);
  const completedAtMs = event.completedAtUtc === null ? null : canonicalTimestamp(event.completedAtUtc);
  const freshnessBasisMs = canonicalTimestamp(event.freshnessBasisUtc);
  if (observedAtMs === null) errors.push('observedAtUtc-invalid');
  if (event.startedAtUtc !== null && startedAtMs === null) errors.push('startedAtUtc-invalid');
  if (event.completedAtUtc !== null && completedAtMs === null) errors.push('completedAtUtc-invalid');
  if (freshnessBasisMs === null) errors.push('freshnessBasisUtc-invalid');
  if (
    observedAtMs !== null &&
    validEvaluationNowMs(evaluationNowMs) &&
    observedAtMs > evaluationNowMs + PROVIDER_SAFETY_MAX_FUTURE_SKEW_MS
  ) {
    errors.push('observedAtUtc-materially-future');
  }
  if (startedAtMs !== null && completedAtMs !== null && completedAtMs < startedAtMs) {
    errors.push('completed-before-started');
  }
  if (startedAtMs !== null && observedAtMs !== null && startedAtMs > observedAtMs) {
    errors.push('started-after-observed');
  }
  if (completedAtMs !== null && observedAtMs !== null && completedAtMs > observedAtMs) {
    errors.push('completed-after-observed');
  }
  if (
    freshnessBasisMs !== null &&
    observedAtMs !== null &&
    freshnessBasisMs > observedAtMs
  ) {
    errors.push('freshness-basis-after-observation');
  }

  if (event.latencyMs !== null) {
    if (!Number.isSafeInteger(event.latencyMs) || event.latencyMs < 0 || event.latencyMs > 86_400_000) {
      errors.push('latencyMs-invalid');
    }
    if (startedAtMs === null || completedAtMs === null) {
      errors.push('latency-requires-start-and-complete');
    } else if (event.latencyMs !== completedAtMs - startedAtMs) {
      errors.push('latency-does-not-match-observed-chronology');
    }
  } else if (INFERRED_CLASSIFICATIONS.has(event.classification)) {
    errors.push('inferred-anomaly-requires-measured-latency');
  }

  if (event.noticeFingerprint !== null && !SAFE_HASH.test(event.noticeFingerprint)) {
    errors.push('noticeFingerprint-invalid');
  }
  if (event.requestIdHash !== null && !SAFE_HASH.test(event.requestIdHash)) {
    errors.push('requestIdHash-invalid');
  }
  if (
    event.noticeSummaryRedacted !== null &&
    (!boundedText(event.noticeSummaryRedacted, 500) || containsSensitiveText(event.noticeSummaryRedacted))
  ) {
    errors.push('noticeSummaryRedacted-invalid');
  }
  if (
    ['CONFIRMED_PROVIDER_NOTICE', 'CONFIRMED_PROVIDER_BLOCK', 'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE'].includes(event.classification) &&
    event.noticeSummaryRedacted === null &&
    event.noticeFingerprint === null
  ) {
    errors.push('visible-evidence-requires-summary-or-fingerprint');
  }

  if (event.relatedGoalRef !== null && !SAFE_GOAL_REF.test(event.relatedGoalRef)) {
    errors.push('relatedGoalRef-invalid');
  }
  if (event.relatedPrRef !== null && !SAFE_PR_REF.test(event.relatedPrRef)) {
    errors.push('relatedPrRef-invalid');
  }
  if (event.relatedTaskRef !== null && !SAFE_TASK_REF.test(event.relatedTaskRef)) {
    errors.push('relatedTaskRef-invalid');
  }

  if (event.evidenceRefs.length === 0) {
    errors.push('evidenceRefs-invalid');
  } else if (event.evidenceRefs.some((reference) => !safeEvidenceRef(reference))) {
    errors.push('evidenceRef-unsafe');
  } else if (new Set(event.evidenceRefs).size !== event.evidenceRefs.length) {
    errors.push('evidenceRefs-duplicate');
  }

  for (const field of ['accessRoleCategory', 'accessPurposeCategory', 'contentCategory']) {
    const value = event[field];
    if (value !== null && !SAFE_CATEGORY.test(value)) errors.push(`${field}-invalid`);
  }
  if (event.classification === 'PROVIDER_DISCLOSED_HUMAN_ACCESS') {
    if (
      event.accessRoleCategory === null ||
      event.accessPurposeCategory === null ||
      event.contentCategory === null
    ) {
      errors.push('human-access-categories-required');
    }
  } else if (
    event.accessRoleCategory !== null ||
    event.accessPurposeCategory !== null ||
    event.contentCategory !== null
  ) {
    errors.push('human-access-fields-outside-disclosed-human-access');
  }

  if (
    event.limitations.some(
      (limitation) => !boundedText(limitation, 240) || containsSensitiveText(limitation),
    )
  ) {
    errors.push('limitations-invalid');
  }

  if (
    event.evidenceType === 'SYNTHETIC_TEST_FIXTURE' &&
    event.observerClass !== 'SYNTHETIC_TEST'
  ) {
    errors.push('synthetic-fixture-observer-mismatch');
  }
  if (
    event.evidenceType !== 'SYNTHETIC_TEST_FIXTURE' &&
    event.observerClass === 'SYNTHETIC_TEST'
  ) {
    errors.push('synthetic-observer-outside-fixture');
  }
  if (
    event.evidenceType === 'UNKNOWN' &&
    (CONFIRMED_CLASSIFICATIONS.has(event.classification) || DISCLOSED_CLASSIFICATIONS.has(event.classification))
  ) {
    errors.push('unknown-evidence-cannot-confirm-or-disclose');
  }
  if (
    CONFIRMED_CLASSIFICATIONS.has(event.classification) &&
    ['WEAK', 'UNKNOWN'].includes(event.evidenceStrength)
  ) {
    errors.push('confirmed-event-requires-sufficient-evidence-strength');
  }
  if (
    DISCLOSED_CLASSIFICATIONS.has(event.classification) &&
    ['WEAK', 'UNKNOWN'].includes(event.evidenceStrength)
  ) {
    errors.push('disclosed-event-requires-sufficient-evidence-strength');
  }
  if (
    event.classification === 'CONFIRMED_PROVIDER_BLOCK' &&
    event.outcome !== 'BLOCKED'
  ) {
    errors.push('confirmed-block-requires-blocked-outcome');
  }

  if (
    containsSensitiveText(event.providerId) ||
    containsSensitiveText(event.surfaceId) ||
    containsSensitiveText(event.modelId) ||
    containsSensitiveText(event.noticeSummaryRedacted) ||
    containsSensitiveText(event.requestIdHash) ||
    event.evidenceRefs.some(containsSensitiveText) ||
    event.limitations.some(containsSensitiveText)
  ) {
    errors.push('sensitive-content-rejected');
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    event: errors.length === 0 ? event : null,
  });
}

export function validateProviderSafetyObservationEventV1(input, options = {}) {
  try {
    return validateProviderSafetyEventInternal(input, options);
  } catch {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(['event-validation-failed-closed']),
      event: null,
    });
  }
}

function buildProjectionInternal(input, options) {
  const snapshot = snapshotInput(input);
  const validatedOptions = snapshotOptions(options);
  const errors = [];

  if (snapshot === SNAPSHOT_INVALID) {
    return invalidProjection(['input-must-be-exact-dense-data-only-shape']);
  }
  if (validatedOptions === SNAPSHOT_INVALID) {
    return invalidProjection(['validation-options-mismatch']);
  }

  const evaluationNowMs = validatedOptions.evaluationNowMs;
  const evaluatedAtUtc = isoFromMs(evaluationNowMs) || '';
  if (!validEvaluationNowMs(evaluationNowMs)) errors.push('evaluationNowMs-invalid');
  if (snapshot.schemaVersion !== PROVIDER_SAFETY_LEDGER_INPUT_SCHEMA_VERSION) {
    errors.push('input-schema-version-mismatch');
  }
  if (!SAFE_ID.test(snapshot.snapshotId || '')) errors.push('snapshotId-invalid');

  try {
    if (
      Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > PROVIDER_SAFETY_MAX_INPUT_BYTES
    ) {
      errors.push('input-too-large');
    }
  } catch {
    errors.push('input-not-serializable');
  }

  const accepted = [];
  if (validEvaluationNowMs(evaluationNowMs)) {
    snapshot.events.forEach((entry, index) => {
      const verdict = validateProviderSafetyEventInternal(entry, { evaluationNowMs });
      if (!verdict.valid) {
        errors.push(...verdict.errors.map((error) => `events[${index}]:${error}`));
      } else {
        accepted.push(verdict.event);
      }
    });
  }

  const byEventId = new Map();
  const byFingerprint = new Map();
  const deduplicated = [];
  let replayedDuplicates = 0;
  for (const event of accepted) {
    const canonical = JSON.stringify(event);
    const fingerprintCanonical = JSON.stringify({ ...event, eventId: null });
    if (byEventId.has(event.eventId)) {
      if (byEventId.get(event.eventId) === canonical) {
        replayedDuplicates += 1;
        continue;
      }
      errors.push(`conflicting-duplicate-eventId:${event.eventId}`);
      continue;
    }
    if (event.noticeFingerprint !== null && byFingerprint.has(event.noticeFingerprint)) {
      if (byFingerprint.get(event.noticeFingerprint) === fingerprintCanonical) {
        replayedDuplicates += 1;
        continue;
      }
      errors.push(`conflicting-duplicate-fingerprint:${event.noticeFingerprint}`);
      continue;
    }
    byEventId.set(event.eventId, canonical);
    if (event.noticeFingerprint !== null) {
      byFingerprint.set(event.noticeFingerprint, fingerprintCanonical);
    }
    deduplicated.push(event);
  }

  if (errors.length > 0) {
    return invalidProjection(errors, {
      snapshotId: snapshot.snapshotId || '',
      evaluatedAtUtc,
    });
  }

  const events = deduplicated
    .map((event) => {
      const freshnessBasisMs = canonicalTimestamp(event.freshnessBasisUtc);
      const stale =
        evaluationNowMs - freshnessBasisMs > PROVIDER_SAFETY_CANONICAL_STALE_AFTER_MS;
      const startedAtMs = event.startedAtUtc === null ? null : canonicalTimestamp(event.startedAtUtc);
      const completedAtMs = event.completedAtUtc === null ? null : canonicalTimestamp(event.completedAtUtc);
      return Object.freeze({
        ...event,
        truthClass: truthClassFor(event, stale),
        derivedFreshness: stale ? 'STALE' : 'CURRENT',
        measuredLatencyMs:
          startedAtMs !== null && completedAtMs !== null
            ? completedAtMs - startedAtMs
            : null,
        syntheticFixture: event.evidenceType === 'SYNTHETIC_TEST_FIXTURE',
        observedAtMs: canonicalTimestamp(event.observedAtUtc),
      });
    })
    .sort((left, right) => compareText(left.eventId, right.eventId));

  const currentLiveEvents = events.filter(
    (event) => event.derivedFreshness === 'CURRENT' && !event.syntheticFixture,
  );
  const countClassification = (classification) =>
    currentLiveEvents.filter((event) => event.classification === classification).length;
  const counts = Object.freeze({
    total: events.length,
    confirmedNotices: countClassification('CONFIRMED_PROVIDER_NOTICE'),
    confirmedBlocks: countClassification('CONFIRMED_PROVIDER_BLOCK'),
    confirmedRequestMetadata: countClassification('CONFIRMED_PROVIDER_REQUEST_METADATA'),
    confirmedLocalObservations: countClassification('CONFIRMED_LOCAL_OBSERVATION'),
    disclosedEvents: countClassification('PROVIDER_DISCLOSED_EVENT'),
    disclosedHumanAccess: countClassification('PROVIDER_DISCLOSED_HUMAN_ACCESS'),
    inferredAnomalies:
      countClassification('INFERRED_LATENCY_ANOMALY') +
      countClassification('INFERRED_ANOMALY'),
    providerSaysNoRecord: countClassification('PROVIDER_SAYS_NO_RECORD'),
    notPresentInExport: countClassification('NOT_PRESENT_IN_EXPORT'),
    requestedButWithheld: countClassification('REQUESTED_BUT_WITHHELD'),
    exemptionClaimed: countClassification('EXEMPTION_CLAIMED'),
    accountabilityProcess: currentLiveEvents.filter((event) =>
      ACCOUNTABILITY_PROCESS_CLASSIFICATIONS.has(event.classification),
    ).length,
    unclassifiedVisibleEvidence: countClassification('OPERATOR_SUPPLIED_VISIBLE_EVIDENCE'),
    unobservable: countClassification('UNOBSERVABLE_PROVIDER_INTERNAL_STATE'),
    stale: events.filter((event) => event.derivedFreshness === 'STALE').length,
    syntheticFixtures: events.filter((event) => event.syntheticFixture).length,
    replayedDuplicates,
  });

  const latestConfirmed = [...currentLiveEvents]
    .filter((event) => MATERIAL_CONFIRMED_CLASSIFICATIONS.has(event.classification))
    .sort(
      (left, right) =>
        right.observedAtMs - left.observedAtMs || compareText(left.eventId, right.eventId),
    )[0];
  const latestConfirmedMaterialEvent = latestConfirmed
    ? Object.freeze({
        eventId: latestConfirmed.eventId,
        classification: latestConfirmed.classification,
        providerId: latestConfirmed.providerId,
        surfaceId: latestConfirmed.surfaceId,
        modelId: latestConfirmed.modelId,
        observedAtUtc: latestConfirmed.observedAtUtc,
        outcome: latestConfirmed.outcome,
        evidenceRefs: latestConfirmed.evidenceRefs,
      })
    : null;

  const measuredEvents = currentLiveEvents.filter(
    (event) => event.measuredLatencyMs !== null,
  );
  const latency = Object.freeze({
    measuredEventCount: measuredEvents.length,
    totalMeasuredLatencyMs: measuredEvents.reduce(
      (total, event) => total + event.measuredLatencyMs,
      0,
    ),
    maximumMeasuredLatencyMs:
      measuredEvents.length > 0
        ? Math.max(...measuredEvents.map((event) => event.measuredLatencyMs))
        : null,
  });

  const distributions = Object.freeze({
    providers: distribution(currentLiveEvents, 'providerId'),
    surfaces: distribution(currentLiveEvents, 'surfaceId'),
    models: distribution(currentLiveEvents, 'modelId'),
  });

  const evidenceRefs = Object.freeze(
    [...new Set(events.flatMap((event) => event.evidenceRefs))].sort(compareText),
  );
  const limitations = Object.freeze(
    [...new Set(events.flatMap((event) => event.limitations))].sort(compareText),
  );
  const evidenceCoverage = Object.freeze({
    liveCurrentEventCount: currentLiveEvents.length,
    currentEvidenceRefCount: currentLiveEvents.reduce(
      (total, event) => total + event.evidenceRefs.length,
      0,
    ),
    staleEventCount: counts.stale,
    unknownProviderCount: currentLiveEvents.filter((event) => event.providerId === null).length,
    unknownSurfaceCount: currentLiveEvents.filter((event) => event.surfaceId === null).length,
    unknownModelCount: currentLiveEvents.filter((event) => event.modelId === null).length,
    syntheticFixtureCount: counts.syntheticFixtures,
  });

  const unknowns = [];
  if (events.length === 0) unknowns.push('NO_PROVIDER_SAFETY_EVIDENCE');
  if (evidenceCoverage.unknownProviderCount > 0) unknowns.push('PROVIDER_ID_UNKNOWN_FOR_SOME_EVENTS');
  if (evidenceCoverage.unknownSurfaceCount > 0) unknowns.push('SURFACE_ID_UNKNOWN_FOR_SOME_EVENTS');
  if (evidenceCoverage.unknownModelCount > 0) unknowns.push('MODEL_ID_UNKNOWN_FOR_SOME_EVENTS');
  if (counts.stale > 0) unknowns.push('STALE_PROVIDER_SAFETY_EVIDENCE_PRESENT');
  if (counts.syntheticFixtures > 0) unknowns.push('SYNTHETIC_FIXTURES_ARE_NOT_LIVE_EVIDENCE');
  if (counts.providerSaysNoRecord > 0) {
    unknowns.push('PROVIDER_SAYS_NO_RECORD_IS_NOT_PROOF_OF_NO_EVENT');
  }
  if (counts.notPresentInExport > 0) {
    unknowns.push('NOT_PRESENT_IN_EXPORT_IS_NOT_PROOF_OF_NO_EVENT');
  }
  if (counts.requestedButWithheld > 0 || counts.exemptionClaimed > 0) {
    unknowns.push('REQUESTED_EVIDENCE_REMAINS_WITHHELD_OR_EXEMPTED');
  }
  if (counts.unobservable > 0) unknowns.push('PROVIDER_INTERNAL_STATE_REMAINS_UNOBSERVABLE');
  if (
    currentLiveEvents.some(
      (event) => event.classification === 'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
    )
  ) {
    unknowns.push('OPERATOR_EVIDENCE_REQUIRES_SPECIFIC_CLAIM_CLASSIFICATION');
  }

  let verdict = 'NO_EVIDENCE';
  if (events.length > 0 && counts.syntheticFixtures === events.length) {
    verdict = 'TEST_FIXTURE_ONLY';
  } else if (counts.confirmedBlocks > 0) verdict = 'CONFIRMED_PROVIDER_BLOCK_OBSERVED';
  else if (
    counts.confirmedNotices > 0 ||
    counts.confirmedLocalObservations > 0 ||
    counts.confirmedRequestMetadata > 0
  ) {
    verdict = 'CONFIRMED_PROVIDER_INTERVENTION_EVIDENCE_PRESENT';
  } else if (counts.disclosedHumanAccess > 0 || counts.disclosedEvents > 0) {
    verdict = 'PROVIDER_DISCLOSURE_EVIDENCE_PRESENT';
  } else if (
    counts.requestedButWithheld > 0 ||
    counts.exemptionClaimed > 0 ||
    counts.providerSaysNoRecord > 0 ||
    counts.notPresentInExport > 0
  ) {
    verdict = 'ACCOUNTABILITY_EVIDENCE_GAP_VISIBLE';
  } else if (counts.accountabilityProcess > 0) {
    verdict = 'ACCOUNTABILITY_PROCESS_IN_PROGRESS';
  } else if (counts.inferredAnomalies > 0) {
    verdict = 'INFERRED_ANOMALY_ONLY';
  } else if (counts.unclassifiedVisibleEvidence > 0) {
    verdict = 'UNCLASSIFIED_OPERATOR_VISIBLE_EVIDENCE';
  } else if (counts.unobservable > 0) {
    verdict = 'UNOBSERVABLE_PROVIDER_INTERNAL_STATE';
  } else if (events.length > 0 && counts.stale === events.length) {
    verdict = 'STALE_EVIDENCE_ONLY';
  } else if (events.length > 0) {
    verdict = 'EVIDENCE_PRESENT_NO_CONFIRMED_INTERVENTION';
  }

  const freshness = events.length === 0
    ? 'UNKNOWN'
    : counts.syntheticFixtures === events.length
      ? 'TEST_ONLY'
      : counts.stale === events.length
        ? 'STALE'
        : counts.stale > 0
          ? 'MIXED'
          : 'FRESH';

  const projectionCore = {
    schemaVersion: PROVIDER_SAFETY_LEDGER_PROJECTION_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_PROVIDER_SAFETY_OBSERVABILITY',
    snapshotId: snapshot.snapshotId,
    evaluatedAtUtc,
    freshness,
    verdict,
    events: Object.freeze(events),
    counts,
    latestConfirmedMaterialEvent,
    latency,
    distributions,
    evidenceCoverage,
    evidenceRefs,
    limitations,
    unknowns: Object.freeze([...new Set(unknowns)].sort(compareText)),
    authority: AUTHORITY,
    valid: true,
    validationErrors: Object.freeze([]),
  };

  if (
    Buffer.byteLength(JSON.stringify(projectionCore), 'utf8') >
    PROVIDER_SAFETY_MAX_PROJECTION_BYTES
  ) {
    return invalidProjection(['projection-too-large'], {
      snapshotId: snapshot.snapshotId,
      evaluatedAtUtc,
    });
  }

  return Object.freeze({
    ...projectionCore,
    projectionId: `provider-safety-${stableHash(projectionCore).slice(0, 24)}`,
  });
}

export function buildProviderSafetyObservabilityLedgerV1(input = {}, options = {}) {
  try {
    return buildProjectionInternal(input, options);
  } catch {
    return invalidProjection(['projection-build-failed-closed']);
  }
}
