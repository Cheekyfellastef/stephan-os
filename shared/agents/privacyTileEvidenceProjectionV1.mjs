import { createHash } from 'node:crypto';

export const PRIVACY_TILE_EVIDENCE_INPUT_SCHEMA_VERSION =
  'stephanos.privacy-tile-evidence-input.v1';
export const PRIVACY_TILE_EVIDENCE_RECORD_SCHEMA_VERSION =
  'stephanos.privacy-evidence-record.v1';
export const PRIVACY_TILE_EVIDENCE_PROJECTION_SCHEMA_VERSION =
  'stephanos.privacy-tile-evidence-projection.v1';

export const PRIVACY_TILE_DOMAINS = Object.freeze([
  'AI_PROVIDER_TRANSPARENCY',
  'DEVICE_DISPLAY_PRIVACY',
  'CONSENT',
  'DATA_RIGHTS',
  'EXPORT_DISCLOSURE_DIFF',
  'NETWORK_CONTACT',
]);

export const PRIVACY_EVENT_CLASSIFICATIONS = Object.freeze([
  'CONFIRMED_COLLECTION',
  'CONFIRMED_INTERVENTION',
  'CONFIRMED_HUMAN_ACCESS',
  'CONFIRMED_DISCLOSURE',
  'CONFIRMED_DELETION',
  'CONFIRMED_RESTRICTION',
  'OPERATOR_SUPPLIED_EVIDENCE',
  'INFERRED_COLLECTION_RISK',
  'INFERRED_LATENCY_OR_NETWORK_ANOMALY',
  'CONSENT_PROVEN',
  'CONSENT_WITHDRAWN',
  'CONSENT_UNPROVEN',
  'REQUESTED_BUT_WITHHELD',
  'PROVIDER_SAYS_NO_RECORD',
  'NOT_PRESENT_IN_EXPORT',
  'UNOBSERVABLE_INTERNAL_STATE',
  'STALE_EVIDENCE',
]);

export const PRIVACY_SOURCE_CLASSES = Object.freeze([
  'SUPPORTED_PROVIDER_METADATA',
  'PROVIDER_VISIBLE_NOTICE',
  'PROVIDER_DISCLOSURE',
  'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
  'SANITIZED_EXPORT_DIFF',
  'SANITIZED_NETWORK_METADATA',
  'DEVICE_SETTING_EVIDENCE',
  'RIGHTS_REQUEST_RECEIPT',
  'SYNTHETIC_TEST_FIXTURE',
  'UNKNOWN',
]);

export const PRIVACY_RIGHTS_REQUEST_STATES = Object.freeze([
  'DRAFT',
  'READY_FOR_OPERATOR_SEND',
  'SENT',
  'ACKNOWLEDGED',
  'IDENTITY_CHECK_REQUIRED',
  'RESPONSE_DUE',
  'RESPONSE_RECEIVED',
  'PARTIAL_DISCLOSURE',
  'DATA_DISCLOSED',
  'ERASURE_CONFIRMED',
  'RESTRICTION_CONFIRMED',
  'REFUSED_WITH_REASON',
  'OVERDUE',
  'APPEAL_READY',
  'ICO_ESCALATION_READY',
  'CLOSED',
]);

export const PRIVACY_CONSENT_STATES = Object.freeze([
  'CONSENT_PROVEN',
  'CONSENT_WITHDRAWN',
  'CONSENT_UNPROVEN',
]);
export const PRIVACY_DISPLAY_SETTING_STATES = Object.freeze([
  'ENABLED',
  'DISABLED',
  'UNKNOWN',
]);
export const PRIVACY_NETWORK_CONTACT_KINDS = Object.freeze([
  'CONTACT_OBSERVED',
  'NO_CONTACT_OBSERVATION',
  'UNKNOWN',
]);

export const PRIVACY_TILE_CANONICAL_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
export const PRIVACY_TILE_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const PRIVACY_TILE_MAX_RECORDS = 128;
export const PRIVACY_TILE_MAX_INPUT_BYTES = 128 * 1024;
export const PRIVACY_TILE_MAX_PROJECTION_BYTES = 96 * 1024;

const MAX_DATE_MS = 8_640_000_000_000_000;
const TOP_LEVEL_KEYS = Object.freeze(['schemaVersion', 'snapshotId', 'records']);
const RECORD_KEYS = Object.freeze([
  'schemaVersion',
  'recordId',
  'domain',
  'classification',
  'sourceClass',
  'subjectRef',
  'summary',
  'observedAtUtc',
  'freshnessBasisUtc',
  'evidenceRefs',
  'consentState',
  'rightsRequestState',
  'rightsOpenedAtUtc',
  'rightsDeadlineUtc',
  'networkContactKind',
  'networkDestinationCategory',
  'displayPrivacySetting',
  'limitations',
]);
const OPTION_KEYS = Object.freeze(['evaluationNowMs']);

const CONFIRMED_CLASSIFICATIONS = new Set([
  'CONFIRMED_COLLECTION',
  'CONFIRMED_INTERVENTION',
  'CONFIRMED_HUMAN_ACCESS',
  'CONFIRMED_DISCLOSURE',
  'CONFIRMED_DELETION',
  'CONFIRMED_RESTRICTION',
  'CONSENT_PROVEN',
  'CONSENT_WITHDRAWN',
]);
const INFERRED_CLASSIFICATIONS = new Set([
  'INFERRED_COLLECTION_RISK',
  'INFERRED_LATENCY_OR_NETWORK_ANOMALY',
]);
const UNKNOWN_CLASSIFICATIONS = new Set([
  'OPERATOR_SUPPLIED_EVIDENCE',
  'CONSENT_UNPROVEN',
  'REQUESTED_BUT_WITHHELD',
  'PROVIDER_SAYS_NO_RECORD',
  'NOT_PRESENT_IN_EXPORT',
  'UNOBSERVABLE_INTERNAL_STATE',
]);
const RIGHTS_TERMINAL_STATES = new Set([
  'DATA_DISCLOSED',
  'ERASURE_CONFIRMED',
  'RESTRICTION_CONFIRMED',
  'REFUSED_WITH_REASON',
  'CLOSED',
]);
const HIGH_RISK_CLASSIFICATIONS = new Set([
  'CONFIRMED_HUMAN_ACCESS',
  'CONFIRMED_DISCLOSURE',
]);
const ATTENTION_CLASSIFICATIONS = new Set([
  'CONFIRMED_COLLECTION',
  'CONFIRMED_INTERVENTION',
  'INFERRED_COLLECTION_RISK',
  'INFERRED_LATENCY_OR_NETWORK_ANOMALY',
]);

const PROVIDER_OBSERVATION_SOURCES = Object.freeze([
  'SUPPORTED_PROVIDER_METADATA',
  'PROVIDER_VISIBLE_NOTICE',
  'PROVIDER_DISCLOSURE',
  'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
]);
const DISCLOSURE_SOURCES = Object.freeze([
  'PROVIDER_DISCLOSURE',
  'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
  'SANITIZED_EXPORT_DIFF',
  'RIGHTS_REQUEST_RECEIPT',
]);
const CONSENT_SOURCES = Object.freeze([
  'DEVICE_SETTING_EVIDENCE',
  'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
  'PROVIDER_DISCLOSURE',
  'RIGHTS_REQUEST_RECEIPT',
]);
const SOURCE_COMPATIBILITY = Object.freeze({
  CONFIRMED_COLLECTION: Object.freeze([...PROVIDER_OBSERVATION_SOURCES, 'SANITIZED_EXPORT_DIFF']),
  CONFIRMED_INTERVENTION: Object.freeze(PROVIDER_OBSERVATION_SOURCES),
  CONFIRMED_HUMAN_ACCESS: Object.freeze(DISCLOSURE_SOURCES),
  CONFIRMED_DISCLOSURE: Object.freeze(DISCLOSURE_SOURCES),
  CONFIRMED_DELETION: Object.freeze([...DISCLOSURE_SOURCES, 'DEVICE_SETTING_EVIDENCE']),
  CONFIRMED_RESTRICTION: Object.freeze([...DISCLOSURE_SOURCES, 'DEVICE_SETTING_EVIDENCE']),
  OPERATOR_SUPPLIED_EVIDENCE: Object.freeze(['OPERATOR_SUPPLIED_VISIBLE_EVIDENCE']),
  INFERRED_COLLECTION_RISK: Object.freeze([
    'SUPPORTED_PROVIDER_METADATA',
    'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
    'SANITIZED_NETWORK_METADATA',
    'DEVICE_SETTING_EVIDENCE',
  ]),
  INFERRED_LATENCY_OR_NETWORK_ANOMALY: Object.freeze([
    'SUPPORTED_PROVIDER_METADATA',
    'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
    'SANITIZED_NETWORK_METADATA',
  ]),
  CONSENT_PROVEN: Object.freeze(CONSENT_SOURCES),
  CONSENT_WITHDRAWN: Object.freeze(CONSENT_SOURCES),
  CONSENT_UNPROVEN: Object.freeze([
    'UNKNOWN',
    'DEVICE_SETTING_EVIDENCE',
    'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
    'PROVIDER_DISCLOSURE',
  ]),
  REQUESTED_BUT_WITHHELD: Object.freeze([
    'PROVIDER_DISCLOSURE',
    'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
    'RIGHTS_REQUEST_RECEIPT',
  ]),
  PROVIDER_SAYS_NO_RECORD: Object.freeze([
    'PROVIDER_DISCLOSURE',
    'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
    'RIGHTS_REQUEST_RECEIPT',
  ]),
  NOT_PRESENT_IN_EXPORT: Object.freeze(['SANITIZED_EXPORT_DIFF']),
  UNOBSERVABLE_INTERNAL_STATE: Object.freeze([
    'UNKNOWN',
    'SUPPORTED_PROVIDER_METADATA',
    'PROVIDER_DISCLOSURE',
    'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
  ]),
  STALE_EVIDENCE: Object.freeze(PRIVACY_SOURCE_CLASSES.filter((source) => source !== 'SYNTHETIC_TEST_FIXTURE')),
});

const NETWORK_ALLOWED_CLASSIFICATIONS = new Set([
  'OPERATOR_SUPPLIED_EVIDENCE',
  'INFERRED_COLLECTION_RISK',
  'INFERRED_LATENCY_OR_NETWORK_ANOMALY',
  'UNOBSERVABLE_INTERNAL_STATE',
  'STALE_EVIDENCE',
]);
const CONSENT_CLASSIFICATIONS = new Set([
  'CONSENT_PROVEN',
  'CONSENT_WITHDRAWN',
  'CONSENT_UNPROVEN',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_SUBJECT_REF = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const SAFE_CATEGORY = /^[A-Z0-9][A-Z0-9_:-]{0,95}$/;
const SAFE_EVIDENCE_REF =
  /^(?:issue|pr|receipt|evidence|export|operator|provider|workspace|dataset|device|network):\/\/[a-z0-9][a-z0-9._:/#-]{0,220}$/;
const SENSITIVE_TEXT =
  /\b(?:api[-_ ]?key|password|passwd|secret|bearer|authorization|private[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|cookie|session|account[-_ ]?(?:number|no|id)|sort[-_ ]?code|iban|swift|prompt content|response content|raw export|identity document)\b/i;
const EMAIL_LIKE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const LONG_DIGIT_SEQUENCE = /(?:^|\D)\d{6,}(?:\D|$)/;
const LOCAL_PATH = /(?:^|\s)(?:[A-Za-z]:\\|\\\\|\/home\/|\/Users\/|\/etc\/|\.\.\/|\.\.\\)/;

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  commandExecutionAllowed: false,
  accountAccessAllowed: false,
  deviceMutationAllowed: false,
  networkInterceptionAllowed: false,
  credentialAccessAllowed: false,
  legalSubmissionAllowed: false,
  deletionAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  spendAllowed: false,
  runtimeMutationAllowed: false,
});

const SNAPSHOT_INVALID = Symbol('SNAPSHOT_INVALID');

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
    const keys = Object.keys(descriptors).sort(compareText);
    const expected = [...expectedKeys].sort(compareText);
    if (JSON.stringify(keys) !== JSON.stringify(expected)) return SNAPSHOT_INVALID;

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

function snapshotDenseArray(value, maxLength, snapshotEntry = (entry) => entry) {
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
      lengthDescriptor.value > maxLength
    ) {
      return SNAPSHOT_INVALID;
    }

    const length = lengthDescriptor.value;
    const expectedKeys = ['length', ...Array.from({ length }, (_, index) => String(index))].sort(compareText);
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

function snapshotStringArray(value, maxLength) {
  return snapshotDenseArray(value, maxLength, (entry) =>
    typeof entry === 'string' ? entry : SNAPSHOT_INVALID,
  );
}

function snapshotRecord(value) {
  const record = snapshotExactObject(value, RECORD_KEYS);
  if (record === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;

  const evidenceRefs = snapshotStringArray(record.evidenceRefs, 8);
  const limitations = snapshotStringArray(record.limitations, 8);
  if (evidenceRefs === SNAPSHOT_INVALID || limitations === SNAPSHOT_INVALID) {
    return SNAPSHOT_INVALID;
  }

  const output = Object.create(null);
  for (const key of RECORD_KEYS) {
    const fieldValue = key === 'evidenceRefs'
      ? evidenceRefs
      : key === 'limitations'
        ? limitations
        : record[key];
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
  const records = snapshotDenseArray(input.records, PRIVACY_TILE_MAX_RECORDS, snapshotRecord);
  if (records === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;
  return Object.freeze({
    schemaVersion: input.schemaVersion,
    snapshotId: input.snapshotId,
    records,
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

function isoFromMs(value) {
  if (!validEvaluationNowMs(value)) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
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

function sourceCompatible(classification, sourceClass) {
  if (sourceClass === 'SYNTHETIC_TEST_FIXTURE') return true;
  const allowedSources = SOURCE_COMPATIBILITY[classification];
  return Array.isArray(allowedSources) && allowedSources.includes(sourceClass);
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function deriveTruthBucket(record, stale) {
  if (stale || record.classification === 'STALE_EVIDENCE') return 'STALE';
  if (record.sourceClass === 'SYNTHETIC_TEST_FIXTURE') return 'UNKNOWN';
  if (record.sourceClass === 'UNKNOWN') return 'UNKNOWN';
  if (CONFIRMED_CLASSIFICATIONS.has(record.classification)) return 'CONFIRMED';
  if (INFERRED_CLASSIFICATIONS.has(record.classification)) return 'INFERRED';
  if (UNKNOWN_CLASSIFICATIONS.has(record.classification)) return 'UNKNOWN';
  return 'UNKNOWN';
}

function deriveConsentState(record) {
  if (PRIVACY_CONSENT_STATES.includes(record.consentState)) return record.consentState;
  if (PRIVACY_CONSENT_STATES.includes(record.classification)) return record.classification;
  if (record.domain === 'CONSENT' || record.domain === 'DEVICE_DISPLAY_PRIVACY') {
    return 'CONSENT_UNPROVEN';
  }
  return null;
}

function deriveDisplaySetting(record) {
  if (PRIVACY_DISPLAY_SETTING_STATES.includes(record.displayPrivacySetting)) {
    return record.displayPrivacySetting;
  }
  return record.domain === 'DEVICE_DISPLAY_PRIVACY' ? 'UNKNOWN' : null;
}

function deriveRightsState(record, evaluationNowMs) {
  if (!record.rightsRequestState) return null;
  if (RIGHTS_TERMINAL_STATES.has(record.rightsRequestState)) return record.rightsRequestState;
  const deadlineMs = canonicalTimestamp(record.rightsDeadlineUtc);
  if (deadlineMs !== null && deadlineMs < evaluationNowMs) return 'OVERDUE';
  return record.rightsRequestState;
}

function emptyDomainSummary(domain) {
  return Object.freeze({
    domain,
    recordCount: 0,
    confirmedCount: 0,
    inferredCount: 0,
    unknownCount: 0,
    staleCount: 0,
    currentEvidenceAvailable: false,
  });
}

function invalidProjection(errors, partial = {}) {
  return Object.freeze({
    schemaVersion: PRIVACY_TILE_EVIDENCE_PROJECTION_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_PRIVACY_EVIDENCE',
    projectionId: '',
    snapshotId: partial.snapshotId || '',
    evaluatedAtUtc: partial.evaluatedAtUtc || '',
    posture: 'UNKNOWN',
    readiness: 'SAFE_HOLD',
    freshness: 'UNKNOWN',
    records: Object.freeze([]),
    truthCounts: Object.freeze({ total: 0, confirmed: 0, inferred: 0, unknown: 0, stale: 0 }),
    domains: Object.freeze(PRIVACY_TILE_DOMAINS.map(emptyDomainSummary)),
    consent: Object.freeze({
      provenCount: 0,
      withdrawnCount: 0,
      unprovenCount: 0,
      gaps: Object.freeze([]),
    }),
    rights: Object.freeze({
      openCount: 0,
      overdueCount: 0,
      nearestDeadlineUtc: null,
      requests: Object.freeze([]),
    }),
    latestMaterialEvent: null,
    evidenceCoverage: Object.freeze({
      requiredDomainCount: PRIVACY_TILE_DOMAINS.length,
      representedDomainCount: 0,
      currentDomainCount: 0,
      currentRecordCount: 0,
      safeEvidenceRefCount: 0,
      syntheticFixtureCount: 0,
    }),
    limitations: Object.freeze([]),
    unknowns: Object.freeze([]),
    recommendedNextReviewAction: Object.freeze({
      actionClass: 'FIX_INVALID_EVIDENCE',
      summary: 'Repair the invalid privacy evidence packet before drawing a posture conclusion.',
    }),
    authority: AUTHORITY,
    valid: false,
    validationErrors: Object.freeze([...errors]),
  });
}

function validatePrivacyEvidenceRecordInternal(input, options) {
  const record = snapshotRecord(input);
  const validatedOptions = snapshotOptions(options);
  const errors = [];

  if (record === SNAPSHOT_INVALID) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(['record-must-be-exact-dense-data-only-shape']),
      record: null,
    });
  }
  if (validatedOptions === SNAPSHOT_INVALID) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(['validation-options-mismatch']),
      record: null,
    });
  }

  const evaluationNowMs = validatedOptions.evaluationNowMs;
  if (!validEvaluationNowMs(evaluationNowMs)) errors.push('evaluationNowMs-invalid');
  if (record.schemaVersion !== PRIVACY_TILE_EVIDENCE_RECORD_SCHEMA_VERSION) {
    errors.push('record-schema-version-mismatch');
  }
  if (!SAFE_ID.test(record.recordId || '')) errors.push('recordId-invalid');
  if (!PRIVACY_TILE_DOMAINS.includes(record.domain)) errors.push('domain-invalid');
  if (!PRIVACY_EVENT_CLASSIFICATIONS.includes(record.classification)) {
    errors.push('classification-invalid');
  }
  if (!PRIVACY_SOURCE_CLASSES.includes(record.sourceClass)) errors.push('sourceClass-invalid');
  if (
    PRIVACY_EVENT_CLASSIFICATIONS.includes(record.classification) &&
    PRIVACY_SOURCE_CLASSES.includes(record.sourceClass) &&
    !sourceCompatible(record.classification, record.sourceClass)
  ) {
    errors.push('source-classification-mismatch');
  }
  if (!SAFE_SUBJECT_REF.test(record.subjectRef || '') || containsSensitiveText(record.subjectRef)) {
    errors.push('subjectRef-invalid');
  }
  if (!boundedText(record.summary, 500) || containsSensitiveText(record.summary)) {
    errors.push('summary-invalid');
  }

  const observedAtMs = canonicalTimestamp(record.observedAtUtc);
  const freshnessBasisMs = canonicalTimestamp(record.freshnessBasisUtc);
  if (observedAtMs === null) errors.push('observedAtUtc-invalid');
  if (freshnessBasisMs === null) errors.push('freshnessBasisUtc-invalid');
  if (
    observedAtMs !== null &&
    validEvaluationNowMs(evaluationNowMs) &&
    observedAtMs > evaluationNowMs + PRIVACY_TILE_MAX_FUTURE_SKEW_MS
  ) {
    errors.push('observedAtUtc-materially-future');
  }
  if (
    freshnessBasisMs !== null &&
    observedAtMs !== null &&
    freshnessBasisMs > observedAtMs
  ) {
    errors.push('freshness-basis-after-observation');
  }

  if (record.evidenceRefs.length === 0) {
    errors.push('evidenceRefs-invalid');
  } else if (record.evidenceRefs.some((reference) => !safeEvidenceRef(reference))) {
    errors.push('evidenceRef-unsafe');
  } else if (new Set(record.evidenceRefs).size !== record.evidenceRefs.length) {
    errors.push('evidenceRefs-duplicate');
  }

  if (record.consentState !== null && !PRIVACY_CONSENT_STATES.includes(record.consentState)) {
    errors.push('consentState-invalid');
  }
  if (
    record.rightsRequestState !== null &&
    !PRIVACY_RIGHTS_REQUEST_STATES.includes(record.rightsRequestState)
  ) {
    errors.push('rightsRequestState-invalid');
  }
  if (
    record.networkContactKind !== null &&
    !PRIVACY_NETWORK_CONTACT_KINDS.includes(record.networkContactKind)
  ) {
    errors.push('networkContactKind-invalid');
  }
  if (
    record.networkDestinationCategory !== null &&
    !SAFE_CATEGORY.test(record.networkDestinationCategory)
  ) {
    errors.push('networkDestinationCategory-invalid');
  }
  if (
    record.displayPrivacySetting !== null &&
    !PRIVACY_DISPLAY_SETTING_STATES.includes(record.displayPrivacySetting)
  ) {
    errors.push('displayPrivacySetting-invalid');
  }
  if (
    record.limitations.some(
      (limitation) => !boundedText(limitation, 240) || containsSensitiveText(limitation),
    )
  ) {
    errors.push('limitations-invalid');
  }

  const rightsOpenedAtMs = record.rightsOpenedAtUtc === null
    ? null
    : canonicalTimestamp(record.rightsOpenedAtUtc);
  const rightsDeadlineMs = record.rightsDeadlineUtc === null
    ? null
    : canonicalTimestamp(record.rightsDeadlineUtc);
  if (record.rightsOpenedAtUtc !== null && rightsOpenedAtMs === null) {
    errors.push('rightsOpenedAtUtc-invalid');
  }
  if (record.rightsDeadlineUtc !== null && rightsDeadlineMs === null) {
    errors.push('rightsDeadlineUtc-invalid');
  }
  if (
    rightsOpenedAtMs !== null &&
    observedAtMs !== null &&
    rightsOpenedAtMs > observedAtMs
  ) {
    errors.push('rights-opened-after-observation');
  }
  if (
    rightsOpenedAtMs !== null &&
    rightsDeadlineMs !== null &&
    rightsDeadlineMs < rightsOpenedAtMs
  ) {
    errors.push('rights-deadline-before-opened');
  }
  if (rightsDeadlineMs !== null && rightsOpenedAtMs === null) {
    errors.push('rights-deadline-without-opened-time');
  }

  if (record.domain === 'DATA_RIGHTS') {
    if (!record.rightsRequestState) errors.push('data-rights-state-required');
  } else if (
    record.rightsRequestState !== null ||
    record.rightsOpenedAtUtc !== null ||
    record.rightsDeadlineUtc !== null
  ) {
    errors.push('rights-fields-outside-data-rights-domain');
  }

  if (record.domain === 'NETWORK_CONTACT') {
    if (!record.networkContactKind || !record.networkDestinationCategory) {
      errors.push('network-contact-fields-required');
    }
    if (!NETWORK_ALLOWED_CLASSIFICATIONS.has(record.classification)) {
      errors.push('network-contact-cannot-prove-content-or-processing');
    }
  } else if (
    record.networkContactKind !== null ||
    record.networkDestinationCategory !== null
  ) {
    errors.push('network-fields-outside-network-domain');
  }

  if (
    record.domain !== 'DEVICE_DISPLAY_PRIVACY' &&
    record.displayPrivacySetting !== null
  ) {
    errors.push('display-setting-outside-device-domain');
  }

  if (
    CONSENT_CLASSIFICATIONS.has(record.classification) &&
    record.domain !== 'CONSENT' &&
    record.domain !== 'DEVICE_DISPLAY_PRIVACY'
  ) {
    errors.push('consent-classification-outside-consent-or-device-domain');
  }
  if (
    record.domain === 'CONSENT' &&
    record.consentState === null &&
    !['CONSENT_UNPROVEN', 'UNOBSERVABLE_INTERNAL_STATE'].includes(record.classification)
  ) {
    errors.push('consent-domain-missing-consent-classification');
  }

  if (
    record.classification === 'NOT_PRESENT_IN_EXPORT' &&
    record.domain !== 'EXPORT_DISCLOSURE_DIFF'
  ) {
    errors.push('not-present-in-export-outside-export-domain');
  }
  if (
    record.sourceClass === 'SANITIZED_EXPORT_DIFF' &&
    record.domain !== 'EXPORT_DISCLOSURE_DIFF' &&
    record.domain !== 'AI_PROVIDER_TRANSPARENCY'
  ) {
    errors.push('export-source-outside-export-or-provider-domain');
  }
  if (
    record.sourceClass === 'DEVICE_SETTING_EVIDENCE' &&
    record.domain !== 'DEVICE_DISPLAY_PRIVACY' &&
    record.domain !== 'CONSENT'
  ) {
    errors.push('device-setting-source-outside-device-or-consent-domain');
  }

  if (
    containsSensitiveText(record.subjectRef) ||
    containsSensitiveText(record.summary) ||
    record.evidenceRefs.some(containsSensitiveText) ||
    record.limitations.some(containsSensitiveText)
  ) {
    errors.push('sensitive-content-rejected');
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    record: errors.length === 0 ? record : null,
  });
}

export function validatePrivacyEvidenceRecordV1(input, options = {}) {
  try {
    return validatePrivacyEvidenceRecordInternal(input, options);
  } catch {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(['record-validation-failed-closed']),
      record: null,
    });
  }
}

function buildPrivacyTileEvidenceProjectionInternal(input, options) {
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
  if (snapshot.schemaVersion !== PRIVACY_TILE_EVIDENCE_INPUT_SCHEMA_VERSION) {
    errors.push('input-schema-version-mismatch');
  }
  if (!SAFE_ID.test(snapshot.snapshotId || '')) errors.push('snapshotId-invalid');

  try {
    if (
      Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > PRIVACY_TILE_MAX_INPUT_BYTES
    ) {
      errors.push('input-too-large');
    }
  } catch {
    errors.push('input-not-serializable');
  }

  const accepted = [];
  const recordIds = new Set();
  if (validEvaluationNowMs(evaluationNowMs)) {
    snapshot.records.forEach((entry, index) => {
      const verdict = validatePrivacyEvidenceRecordInternal(entry, { evaluationNowMs });
      if (!verdict.valid) {
        errors.push(...verdict.errors.map((error) => `records[${index}]:${error}`));
        return;
      }
      if (recordIds.has(verdict.record.recordId)) {
        errors.push(`duplicate-recordId:${verdict.record.recordId}`);
        return;
      }
      recordIds.add(verdict.record.recordId);
      accepted.push(verdict.record);
    });
  }

  if (errors.length > 0) {
    return invalidProjection(errors, {
      snapshotId: snapshot.snapshotId || '',
      evaluatedAtUtc,
    });
  }

  const records = accepted
    .map((record) => {
      const freshnessBasisMs = canonicalTimestamp(record.freshnessBasisUtc);
      const stale =
        record.classification === 'STALE_EVIDENCE' ||
        evaluationNowMs - freshnessBasisMs > PRIVACY_TILE_CANONICAL_STALE_AFTER_MS;
      const syntheticFixture = record.sourceClass === 'SYNTHETIC_TEST_FIXTURE';
      return Object.freeze({
        ...record,
        truthBucket: deriveTruthBucket(record, stale),
        derivedFreshness: stale ? 'STALE' : 'CURRENT',
        syntheticFixture,
        effectiveConsentState: deriveConsentState(record),
        effectiveRightsState: deriveRightsState(record, evaluationNowMs),
        effectiveDisplayPrivacySetting: deriveDisplaySetting(record),
        contactOnly:
          record.domain === 'NETWORK_CONTACT' &&
          record.networkContactKind === 'CONTACT_OBSERVED',
        observedAtMs: canonicalTimestamp(record.observedAtUtc),
      });
    })
    .sort((left, right) => compareText(left.recordId, right.recordId));

  const countBucket = (bucketName) =>
    records.filter((record) => record.truthBucket === bucketName).length;
  const truthCounts = Object.freeze({
    total: records.length,
    confirmed: countBucket('CONFIRMED'),
    inferred: countBucket('INFERRED'),
    unknown: countBucket('UNKNOWN'),
    stale: countBucket('STALE'),
  });

  const domains = PRIVACY_TILE_DOMAINS.map((domain) => {
    const domainRecords = records.filter((record) => record.domain === domain);
    const count = (bucketName) =>
      domainRecords.filter((record) => record.truthBucket === bucketName).length;
    return Object.freeze({
      domain,
      recordCount: domainRecords.length,
      confirmedCount: count('CONFIRMED'),
      inferredCount: count('INFERRED'),
      unknownCount: count('UNKNOWN'),
      staleCount: count('STALE'),
      currentEvidenceAvailable: domainRecords.some(
        (record) => record.derivedFreshness === 'CURRENT' && !record.syntheticFixture,
      ),
    });
  });

  const consentRecords = records.filter(
    (record) => record.effectiveConsentState !== null,
  );
  const consentGaps = consentRecords
    .filter((record) => record.effectiveConsentState === 'CONSENT_UNPROVEN')
    .map((record) =>
      Object.freeze({
        recordId: record.recordId,
        subjectRef: record.subjectRef,
        classification: 'CONSENT_UNPROVEN',
      }),
    );
  const consent = Object.freeze({
    provenCount: consentRecords.filter(
      (record) => record.effectiveConsentState === 'CONSENT_PROVEN',
    ).length,
    withdrawnCount: consentRecords.filter(
      (record) => record.effectiveConsentState === 'CONSENT_WITHDRAWN',
    ).length,
    unprovenCount: consentGaps.length,
    gaps: Object.freeze(consentGaps),
  });

  const rightsRequests = records
    .filter((record) => record.domain === 'DATA_RIGHTS')
    .map((record) =>
      Object.freeze({
        recordId: record.recordId,
        subjectRef: record.subjectRef,
        state: record.effectiveRightsState,
        deadlineUtc: record.rightsDeadlineUtc,
        overdue: record.effectiveRightsState === 'OVERDUE',
      }),
    );
  const openRightsRequests = rightsRequests.filter(
    (request) => !RIGHTS_TERMINAL_STATES.has(request.state),
  );
  const rightsDeadlines = openRightsRequests
    .map((request) => request.deadlineUtc)
    .filter(Boolean)
    .sort(compareText);
  const rights = Object.freeze({
    openCount: openRightsRequests.length,
    overdueCount: openRightsRequests.filter((request) => request.overdue).length,
    nearestDeadlineUtc: rightsDeadlines[0] || null,
    requests: Object.freeze(rightsRequests),
  });

  const latest = [...records]
    .filter(
      (record) =>
        record.truthBucket !== 'STALE' &&
        !record.syntheticFixture &&
        record.classification !== 'OPERATOR_SUPPLIED_EVIDENCE',
    )
    .sort(
      (left, right) =>
        right.observedAtMs - left.observedAtMs ||
        compareText(left.recordId, right.recordId),
    )[0];
  const latestMaterialEvent = latest
    ? Object.freeze({
        recordId: latest.recordId,
        domain: latest.domain,
        classification: latest.classification,
        truthBucket: latest.truthBucket,
        summary: latest.summary,
        observedAtUtc: latest.observedAtUtc,
        evidenceRefs: latest.evidenceRefs,
      })
    : null;

  const representedDomainCount = domains.filter((domain) => domain.recordCount > 0).length;
  const currentDomainCount = domains.filter(
    (domain) => domain.currentEvidenceAvailable,
  ).length;
  const syntheticFixtureCount = records.filter(
    (record) => record.syntheticFixture,
  ).length;
  const evidenceCoverage = Object.freeze({
    requiredDomainCount: PRIVACY_TILE_DOMAINS.length,
    representedDomainCount,
    currentDomainCount,
    currentRecordCount: records.filter(
      (record) => record.derivedFreshness === 'CURRENT' && !record.syntheticFixture,
    ).length,
    safeEvidenceRefCount: records.reduce(
      (total, record) => total + record.evidenceRefs.length,
      0,
    ),
    syntheticFixtureCount,
  });

  const limitations = [
    ...new Set(records.flatMap((record) => record.limitations)),
  ].sort(compareText);
  const unknowns = [];
  if (representedDomainCount < PRIVACY_TILE_DOMAINS.length) {
    unknowns.push('PRIVACY_DOMAINS_NOT_FULLY_REPRESENTED');
  }
  if (truthCounts.unknown > 0) {
    unknowns.push('UNRESOLVED_UNKNOWN_OR_UNOBSERVABLE_EVIDENCE');
  }
  if (truthCounts.stale > 0) unknowns.push('STALE_PRIVACY_EVIDENCE_PRESENT');
  if (consent.unprovenCount > 0) unknowns.push('CONSENT_UNPROVEN');
  if (
    records.some(
      (record) =>
        record.domain === 'DEVICE_DISPLAY_PRIVACY' &&
        record.effectiveDisplayPrivacySetting === 'UNKNOWN',
    )
  ) {
    unknowns.push('DISPLAY_PRIVACY_SETTING_UNKNOWN');
  }
  if (
    records.some((record) =>
      ['PROVIDER_SAYS_NO_RECORD', 'NOT_PRESENT_IN_EXPORT'].includes(
        record.classification,
      ),
    )
  ) {
    unknowns.push('ABSENCE_OF_DISCLOSURE_IS_NOT_PROOF_OF_NO_PROCESSING');
  }
  if (syntheticFixtureCount > 0) {
    unknowns.push('SYNTHETIC_FIXTURES_ARE_NOT_LIVE_EVIDENCE');
  }
  if (
    records.some(
      (record) => record.classification === 'OPERATOR_SUPPLIED_EVIDENCE',
    )
  ) {
    unknowns.push('OPERATOR_SUPPLIED_EVIDENCE_REQUIRES_SPECIFIC_CLAIM_CLASSIFICATION');
  }

  const currentConfirmed = records.filter(
    (record) => record.truthBucket === 'CONFIRMED',
  );
  const currentInferred = records.filter(
    (record) => record.truthBucket === 'INFERRED',
  );
  let posture = 'UNKNOWN';
  if (
    currentConfirmed.some((record) =>
      HIGH_RISK_CLASSIFICATIONS.has(record.classification),
    )
  ) {
    posture = 'HIGH_RISK';
  } else if (
    currentConfirmed.some((record) =>
      ATTENTION_CLASSIFICATIONS.has(record.classification),
    ) ||
    currentInferred.length > 0 ||
    consent.unprovenCount > 0 ||
    rights.openCount > 0
  ) {
    posture = 'ATTENTION';
  } else if (
    records.length > 0 &&
    currentDomainCount === PRIVACY_TILE_DOMAINS.length &&
    truthCounts.confirmed > 0 &&
    truthCounts.inferred === 0 &&
    truthCounts.unknown === 0 &&
    truthCounts.stale === 0 &&
    consent.unprovenCount === 0 &&
    rights.openCount === 0 &&
    syntheticFixtureCount === 0
  ) {
    posture = 'PROTECTED';
  }

  let recommendedNextReviewAction;
  if (rights.overdueCount > 0) {
    recommendedNextReviewAction = {
      actionClass: 'REVIEW_OVERDUE_RIGHTS_REQUEST',
      summary:
        'Review the overdue privacy-rights request and decide whether an operator-approved follow-up is appropriate.',
    };
  } else if (posture === 'HIGH_RISK') {
    recommendedNextReviewAction = {
      actionClass: 'REVIEW_LATEST_CONFIRMED_HIGH_RISK_EVENT',
      summary:
        'Review the latest confirmed high-risk privacy event and its evidence before deciding any action.',
    };
  } else if (consent.unprovenCount > 0) {
    recommendedNextReviewAction = {
      actionClass: 'REVIEW_UNPROVEN_CONSENT',
      summary:
        'Review one unproven consent record and obtain explicit evidence without assuming approval.',
    };
  } else if (truthCounts.stale > 0) {
    recommendedNextReviewAction = {
      actionClass: 'REFRESH_STALE_PRIVACY_EVIDENCE',
      summary:
        'Refresh the oldest stale privacy evidence through its existing governed source.',
    };
  } else if (posture === 'UNKNOWN') {
    recommendedNextReviewAction = {
      actionClass: 'COLLECT_MISSING_PRIVACY_EVIDENCE',
      summary:
        'Collect one missing bounded evidence item from an existing governed source before drawing a posture conclusion.',
    };
  } else {
    recommendedNextReviewAction = {
      actionClass: 'NO_ACTION_REQUIRED',
      summary:
        'No immediate privacy action is supported by the current evidence; continue bounded review only.',
    };
  }

  const freshness = records.length === 0
    ? 'UNKNOWN'
    : truthCounts.stale === records.length
      ? 'STALE'
      : truthCounts.stale > 0
        ? 'MIXED'
        : 'FRESH';

  const projectionCore = {
    schemaVersion: PRIVACY_TILE_EVIDENCE_PROJECTION_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_PRIVACY_EVIDENCE',
    snapshotId: snapshot.snapshotId,
    evaluatedAtUtc,
    posture,
    readiness: posture === 'UNKNOWN'
      ? 'EVIDENCE_INCOMPLETE'
      : 'READ_ONLY_PROJECTION_READY',
    freshness,
    records: Object.freeze(records),
    truthCounts,
    domains: Object.freeze(domains),
    consent,
    rights,
    latestMaterialEvent,
    evidenceCoverage,
    limitations: Object.freeze(limitations),
    unknowns: Object.freeze([...new Set(unknowns)].sort(compareText)),
    recommendedNextReviewAction: Object.freeze(recommendedNextReviewAction),
    authority: AUTHORITY,
    valid: true,
    validationErrors: Object.freeze([]),
  };

  if (
    Buffer.byteLength(JSON.stringify(projectionCore), 'utf8') >
    PRIVACY_TILE_MAX_PROJECTION_BYTES
  ) {
    return invalidProjection(['projection-too-large'], {
      snapshotId: snapshot.snapshotId,
      evaluatedAtUtc,
    });
  }

  return Object.freeze({
    ...projectionCore,
    projectionId: `privacy-${stableHash(projectionCore).slice(0, 24)}`,
  });
}

export function buildPrivacyTileEvidenceProjectionV1(input = {}, options = {}) {
  try {
    return buildPrivacyTileEvidenceProjectionInternal(input, options);
  } catch {
    return invalidProjection(['projection-build-failed-closed']);
  }
}
