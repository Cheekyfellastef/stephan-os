import { createHash } from 'node:crypto';

import {
  PRIVACY_TILE_EVIDENCE_PROJECTION_SCHEMA_VERSION,
  buildPrivacyTileEvidenceProjectionV1,
} from './privacyTileEvidenceProjectionV1.mjs';

export const PRIVACY_TILE_SUMMARY_SCHEMA_VERSION = 'stephanos.privacy-tile-summary.v1';

const INPUT_KEYS = Object.freeze(['evidenceInput', 'evaluationNowMs']);
const MAX_DATE_MS = 8_640_000_000_000_000;

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  commandExecutionAllowed: false,
  accountAccessAllowed: false,
  deviceMutationAllowed: false,
  networkInterceptionAllowed: false,
  credentialAccessAllowed: false,
  legalSubmissionAllowed: false,
  deletionAllowed: false,
  uiMutationAllowed: false,
  notificationAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  spendAllowed: false,
  runtimeMutationAllowed: false,
});

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function captureInput(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(input).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Object.keys(descriptors).sort(compareCodePoints);
    const expected = [...INPUT_KEYS].sort(compareCodePoints);
    if (JSON.stringify(keys) !== JSON.stringify(expected)) return null;

    const output = Object.create(null);
    for (const key of INPUT_KEYS) {
      const descriptor = descriptors[key];
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.get ||
        descriptor.set
      ) return null;
      Object.defineProperty(output, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function validEvaluationNowMs(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_MS;
}

function safeHold(errors, source = null) {
  return Object.freeze({
    schemaVersion: PRIVACY_TILE_SUMMARY_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_PRIVACY_TILE_SUMMARY',
    summaryId: '',
    sourceProjectionId: source?.projectionId || '',
    sourceSnapshotId: source?.snapshotId || '',
    evaluatedAtUtc: source?.evaluatedAtUtc || '',
    state: 'SAFE_HOLD',
    privacyPosture: 'UNKNOWN',
    freshness: source?.freshness || 'UNKNOWN',
    confirmedCollectionSubjectCount: 0,
    confirmedInterventionSubjectCount: 0,
    confirmedHumanAccessSubjectCount: 0,
    consentUnprovenCount: 0,
    openRightsRequestCount: 0,
    overdueRightsRequestCount: 0,
    nearestRightsDeadlineUtc: null,
    latestMaterialEvent: null,
    unknownOrUnobservableCount: 0,
    staleEvidenceCount: 0,
    evidenceCoverage: Object.freeze({
      requiredDomainCount: 0,
      representedDomainCount: 0,
      currentDomainCount: 0,
      currentRecordCount: 0,
    }),
    nextReviewAction: Object.freeze({
      actionClass: 'FIX_INVALID_EVIDENCE',
      summary: 'Repair the invalid privacy evidence packet before presenting a tile summary.',
    }),
    limitations: Object.freeze([]),
    unknowns: Object.freeze([]),
    authority: AUTHORITY,
    valid: false,
    validationErrors: Object.freeze([...new Set(errors)]),
  });
}

function currentConfirmedSubjects(records, classification) {
  return new Set(records
    .filter((record) =>
      record.classification === classification &&
      record.truthBucket === 'CONFIRMED' &&
      record.derivedFreshness === 'CURRENT' &&
      record.syntheticFixture !== true)
    .map((record) => record.subjectRef)).size;
}

function latestEventSummary(event) {
  if (!event) return null;
  return Object.freeze({
    domain: event.domain,
    classification: event.classification,
    truthBucket: event.truthBucket,
    summary: event.summary,
    observedAtUtc: event.observedAtUtc,
  });
}

export function buildPrivacyTileSummaryV1(input = {}) {
  const captured = captureInput(input);
  if (!captured) return safeHold(['input-must-be-exact-data-only-shape']);
  if (!validEvaluationNowMs(captured.evaluationNowMs)) {
    return safeHold(['evaluationNowMs-invalid']);
  }

  const source = buildPrivacyTileEvidenceProjectionV1(
    captured.evidenceInput,
    { evaluationNowMs: captured.evaluationNowMs },
  );

  if (!source.valid) {
    return safeHold(
      (source.validationErrors || []).map((error) => `m1:${error}`),
      source,
    );
  }
  if (source.schemaVersion !== PRIVACY_TILE_EVIDENCE_PROJECTION_SCHEMA_VERSION) {
    return safeHold(['m1:schema-version-mismatch'], source);
  }
  if (source.projectionKind !== 'READ_ONLY_PRIVACY_EVIDENCE') {
    return safeHold(['m1:projection-kind-mismatch'], source);
  }

  const confirmedCollectionSubjectCount = currentConfirmedSubjects(
    source.records,
    'CONFIRMED_COLLECTION',
  );
  const confirmedInterventionSubjectCount = currentConfirmedSubjects(
    source.records,
    'CONFIRMED_INTERVENTION',
  );
  const confirmedHumanAccessSubjectCount = currentConfirmedSubjects(
    source.records,
    'CONFIRMED_HUMAN_ACCESS',
  );

  const evidenceCoverage = Object.freeze({
    requiredDomainCount: source.evidenceCoverage.requiredDomainCount,
    representedDomainCount: source.evidenceCoverage.representedDomainCount,
    currentDomainCount: source.evidenceCoverage.currentDomainCount,
    currentRecordCount: source.evidenceCoverage.currentRecordCount,
  });

  const nextReviewAction = Object.freeze({
    actionClass: source.recommendedNextReviewAction.actionClass,
    summary: source.recommendedNextReviewAction.summary,
  });

  const summaryCore = {
    schemaVersion: PRIVACY_TILE_SUMMARY_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_PRIVACY_TILE_SUMMARY',
    sourceProjectionId: source.projectionId,
    sourceSnapshotId: source.snapshotId,
    evaluatedAtUtc: source.evaluatedAtUtc,
    state: source.readiness === 'READ_ONLY_PROJECTION_READY'
      ? 'SUMMARY_READY'
      : 'SUMMARY_EVIDENCE_INCOMPLETE',
    privacyPosture: source.posture,
    freshness: source.freshness,
    confirmedCollectionSubjectCount,
    confirmedInterventionSubjectCount,
    confirmedHumanAccessSubjectCount,
    consentUnprovenCount: source.consent.unprovenCount,
    openRightsRequestCount: source.rights.openCount,
    overdueRightsRequestCount: source.rights.overdueCount,
    nearestRightsDeadlineUtc: source.rights.nearestDeadlineUtc,
    latestMaterialEvent: latestEventSummary(source.latestMaterialEvent),
    unknownOrUnobservableCount: source.truthCounts.unknown,
    staleEvidenceCount: source.truthCounts.stale,
    evidenceCoverage,
    nextReviewAction,
    limitations: Object.freeze([...source.limitations]),
    unknowns: Object.freeze([...source.unknowns]),
    authority: AUTHORITY,
    valid: true,
    validationErrors: Object.freeze([]),
  };

  return Object.freeze({
    ...summaryCore,
    summaryId: `privacy-summary-${stableHash(summaryCore).slice(0, 24)}`,
  });
}
