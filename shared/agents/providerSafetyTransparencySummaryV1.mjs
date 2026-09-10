import { createHash } from 'node:crypto';

import {
  PROVIDER_SAFETY_LEDGER_PROJECTION_SCHEMA_VERSION,
  buildProviderSafetyObservabilityLedgerV1,
} from './providerSafetyObservabilityLedgerV1.mjs';

export const PROVIDER_SAFETY_TRANSPARENCY_SUMMARY_SCHEMA_VERSION =
  'stephanos.provider-safety-transparency-summary.v1';

const INPUT_KEYS = Object.freeze(['ledgerInput', 'evaluationNowMs']);
const MAX_DATE_MS = 8_640_000_000_000_000;

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
  uiMutationAllowed: false,
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

function validEvaluationNowMs(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_MS;
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

function safeHold(errors, source = null) {
  return Object.freeze({
    schemaVersion: PROVIDER_SAFETY_TRANSPARENCY_SUMMARY_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_PROVIDER_SAFETY_TRANSPARENCY_SUMMARY',
    summaryId: '',
    sourceProjectionId: source?.projectionId || '',
    sourceSnapshotId: source?.snapshotId || '',
    evaluatedAtUtc: source?.evaluatedAtUtc || '',
    state: 'SAFE_HOLD',
    sourceVerdict: source?.verdict || 'NO_EVIDENCE',
    freshness: source?.freshness || 'UNKNOWN',
    confirmedInterventionEvidenceCount: 0,
    confirmedBlockCount: 0,
    confirmedRequestMetadataCount: 0,
    disclosedHumanAccessCount: 0,
    inferredAnomalyCount: 0,
    accountabilityEvidenceGapCount: 0,
    unobservableEventCount: 0,
    staleEventCount: 0,
    latestConfirmedEvent: null,
    observationCoverage: Object.freeze({
      liveCurrentEventCount: 0,
      unknownProviderCount: 0,
      unknownSurfaceCount: 0,
      unknownModelCount: 0,
    }),
    observedDuration: Object.freeze({
      measuredEventCount: 0,
      totalObservedDurationMs: 0,
      maximumObservedDurationMs: null,
      causalAttribution: 'NOT_ESTABLISHED',
    }),
    distributions: Object.freeze({
      providers: Object.freeze([]),
      models: Object.freeze([]),
    }),
    openEvidenceGaps: Object.freeze([]),
    nextReviewAction: Object.freeze({
      actionClass: 'FIX_INVALID_EVIDENCE',
      summary: 'Repair the invalid provider-safety evidence packet before presenting a transparency summary.',
    }),
    authority: AUTHORITY,
    valid: false,
    validationErrors: Object.freeze([...new Set(errors)]),
  });
}

function latestConfirmedEventSummary(event) {
  if (!event) return null;
  return Object.freeze({
    classification: event.classification,
    providerId: event.providerId,
    surfaceId: event.surfaceId,
    modelId: event.modelId,
    observedAtUtc: event.observedAtUtc,
    outcome: event.outcome,
  });
}

function copyDistribution(entries) {
  return Object.freeze(entries.map((entry) => Object.freeze({
    id: entry.id,
    count: entry.count,
  })));
}

function nextReviewAction(source) {
  if (source.counts.confirmedBlocks > 0) {
    return Object.freeze({
      actionClass: 'REVIEW_CONFIRMED_PROVIDER_BLOCK',
      summary: 'Review the latest confirmed provider block and its existing evidence before deciding any action.',
    });
  }
  if (source.counts.disclosedHumanAccess > 0) {
    return Object.freeze({
      actionClass: 'REVIEW_DISCLOSED_HUMAN_ACCESS',
      summary: 'Review the provider-disclosed human-access evidence and its stated limitations.',
    });
  }
  if (
    source.counts.confirmedNotices > 0 ||
    source.counts.confirmedLocalObservations > 0
  ) {
    return Object.freeze({
      actionClass: 'REVIEW_CONFIRMED_INTERVENTION_EVIDENCE',
      summary: 'Review the latest confirmed intervention evidence and keep causal claims bounded to what was observed.',
    });
  }
  if (
    source.counts.requestedButWithheld > 0 ||
    source.counts.exemptionClaimed > 0 ||
    source.counts.providerSaysNoRecord > 0 ||
    source.counts.notPresentInExport > 0
  ) {
    return Object.freeze({
      actionClass: 'REVIEW_ACCOUNTABILITY_EVIDENCE_GAP',
      summary: 'Review the current accountability evidence gap without treating missing disclosure as proof that no event occurred.',
    });
  }
  if (source.counts.inferredAnomalies > 0) {
    return Object.freeze({
      actionClass: 'REVIEW_INFERRED_ANOMALY',
      summary: 'Review the inferred anomaly separately from confirmed provider intervention evidence.',
    });
  }
  if (source.counts.unobservable > 0) {
    return Object.freeze({
      actionClass: 'REVIEW_UNOBSERVABLE_PROVIDER_STATE',
      summary: 'Review the explicit observability gap; hidden provider state remains unknown.',
    });
  }
  if (source.counts.stale > 0) {
    return Object.freeze({
      actionClass: 'REFRESH_STALE_PROVIDER_SAFETY_EVIDENCE',
      summary: 'Refresh stale provider-safety evidence only through its existing governed source.',
    });
  }
  if (source.verdict === 'NO_EVIDENCE' || source.verdict === 'TEST_FIXTURE_ONLY') {
    return Object.freeze({
      actionClass: 'NO_CURRENT_LIVE_EVIDENCE',
      summary: 'No live provider-safety conclusion is supported; wait for bounded governed evidence.',
    });
  }
  return Object.freeze({
    actionClass: 'NO_ACTION_REQUIRED',
    summary: 'No immediate provider-safety review action is supported by the current evidence.',
  });
}

export function buildProviderSafetyTransparencySummaryV1(input = {}) {
  const captured = captureInput(input);
  if (!captured) return safeHold(['input-must-be-exact-data-only-shape']);
  if (!validEvaluationNowMs(captured.evaluationNowMs)) {
    return safeHold(['evaluationNowMs-invalid']);
  }

  const source = buildProviderSafetyObservabilityLedgerV1(
    captured.ledgerInput,
    { evaluationNowMs: captured.evaluationNowMs },
  );

  if (!source.valid) {
    return safeHold(
      (source.validationErrors || []).map((error) => `m1:${error}`),
      source,
    );
  }
  if (source.schemaVersion !== PROVIDER_SAFETY_LEDGER_PROJECTION_SCHEMA_VERSION) {
    return safeHold(['m1:schema-version-mismatch'], source);
  }
  if (source.projectionKind !== 'READ_ONLY_PROVIDER_SAFETY_OBSERVABILITY') {
    return safeHold(['m1:projection-kind-mismatch'], source);
  }

  const accountabilityEvidenceGapCount =
    source.counts.providerSaysNoRecord +
    source.counts.notPresentInExport +
    source.counts.requestedButWithheld +
    source.counts.exemptionClaimed;

  const summaryCore = {
    schemaVersion: PROVIDER_SAFETY_TRANSPARENCY_SUMMARY_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_PROVIDER_SAFETY_TRANSPARENCY_SUMMARY',
    sourceProjectionId: source.projectionId,
    sourceSnapshotId: source.snapshotId,
    evaluatedAtUtc: source.evaluatedAtUtc,
    state: ['NO_EVIDENCE', 'TEST_FIXTURE_ONLY', 'STALE_EVIDENCE_ONLY'].includes(source.verdict)
      ? 'SUMMARY_EVIDENCE_INCOMPLETE'
      : 'SUMMARY_READY',
    sourceVerdict: source.verdict,
    freshness: source.freshness,
    confirmedInterventionEvidenceCount:
      source.counts.confirmedNotices + source.counts.confirmedLocalObservations,
    confirmedBlockCount: source.counts.confirmedBlocks,
    confirmedRequestMetadataCount: source.counts.confirmedRequestMetadata,
    disclosedHumanAccessCount: source.counts.disclosedHumanAccess,
    inferredAnomalyCount: source.counts.inferredAnomalies,
    accountabilityEvidenceGapCount,
    unobservableEventCount: source.counts.unobservable,
    staleEventCount: source.counts.stale,
    latestConfirmedEvent: latestConfirmedEventSummary(source.latestConfirmedMaterialEvent),
    observationCoverage: Object.freeze({
      liveCurrentEventCount: source.evidenceCoverage.liveCurrentEventCount,
      unknownProviderCount: source.evidenceCoverage.unknownProviderCount,
      unknownSurfaceCount: source.evidenceCoverage.unknownSurfaceCount,
      unknownModelCount: source.evidenceCoverage.unknownModelCount,
    }),
    observedDuration: Object.freeze({
      measuredEventCount: source.latency.measuredEventCount,
      totalObservedDurationMs: source.latency.totalMeasuredLatencyMs,
      maximumObservedDurationMs: source.latency.maximumMeasuredLatencyMs,
      causalAttribution: 'NOT_ESTABLISHED',
    }),
    distributions: Object.freeze({
      providers: copyDistribution(source.distributions.providers),
      models: copyDistribution(source.distributions.models),
    }),
    openEvidenceGaps: Object.freeze([...source.unknowns]),
    nextReviewAction: nextReviewAction(source),
    authority: AUTHORITY,
    valid: true,
    validationErrors: Object.freeze([]),
  };

  return Object.freeze({
    ...summaryCore,
    summaryId: `provider-safety-summary-${stableHash(summaryCore).slice(0, 24)}`,
  });
}
