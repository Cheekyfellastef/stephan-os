import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROVIDER_SAFETY_EVENT_SCHEMA_VERSION,
  PROVIDER_SAFETY_LEDGER_INPUT_SCHEMA_VERSION,
} from './providerSafetyObservabilityLedgerV1.mjs';
import {
  PROVIDER_SAFETY_TRANSPARENCY_SUMMARY_SCHEMA_VERSION,
  buildProviderSafetyTransparencySummaryV1,
} from './providerSafetyTransparencySummaryV1.mjs';

const NOW_MS = Date.parse('2026-08-17T14:00:00.000Z');
const iso = (milliseconds) => new Date(milliseconds).toISOString();
const hash = (character = 'a') => `sha256:${character.repeat(64)}`;

function evidenceTypeFor(classification) {
  if (classification === 'CONFIRMED_PROVIDER_REQUEST_METADATA') return 'SUPPORTED_CLIENT_METADATA';
  if (classification === 'CONFIRMED_PROVIDER_NOTICE') return 'PROVIDER_VISIBLE_NOTICE';
  if (classification === 'CONFIRMED_PROVIDER_BLOCK') return 'PROVIDER_VISIBLE_NOTICE';
  if (classification === 'CONFIRMED_LOCAL_OBSERVATION') return 'PROVIDER_VISIBLE_NOTICE';
  if (classification === 'INFERRED_LATENCY_ANOMALY') return 'SUPPORTED_CLIENT_METADATA';
  if (classification === 'UNOBSERVABLE_PROVIDER_INTERNAL_STATE') return 'UNKNOWN';
  if (classification === 'PROVIDER_SAYS_NO_RECORD') return 'PROVIDER_DISCLOSURE';
  if (classification === 'NOT_PRESENT_IN_EXPORT') return 'SANITIZED_EXPORT_DIFF';
  if (classification === 'REQUESTED_BUT_WITHHELD') return 'PROVIDER_DISCLOSURE';
  return 'UNKNOWN';
}

function event(overrides = {}) {
  const classification = overrides.classification || 'CONFIRMED_PROVIDER_NOTICE';
  const inferred = classification === 'INFERRED_LATENCY_ANOMALY';
  return {
    schemaVersion: PROVIDER_SAFETY_EVENT_SCHEMA_VERSION,
    eventId: 'event-1',
    classification,
    providerId: 'provider-a',
    surfaceId: 'surface-chat',
    modelId: 'model-a',
    observedAtUtc: iso(NOW_MS - 500),
    startedAtUtc: iso(NOW_MS - 2_000),
    completedAtUtc: iso(NOW_MS - 1_000),
    latencyMs: inferred ? 1_000 : null,
    outcome: classification === 'CONFIRMED_PROVIDER_BLOCK' ? 'BLOCKED' : 'CONTINUED',
    evidenceStrength: ['UNOBSERVABLE_PROVIDER_INTERNAL_STATE'].includes(classification) ? 'UNKNOWN' : 'STRONG',
    noticeFingerprint: hash('a'),
    noticeSummaryRedacted: ['UNOBSERVABLE_PROVIDER_INTERNAL_STATE', 'PROVIDER_SAYS_NO_RECORD', 'NOT_PRESENT_IN_EXPORT', 'REQUESTED_BUT_WITHHELD'].includes(classification)
      ? null
      : 'Visible bounded provider notice.',
    requestIdHash: null,
    relatedGoalRef: '#1563',
    relatedPrRef: null,
    relatedTaskRef: null,
    evidenceType: overrides.evidenceType || evidenceTypeFor(classification),
    evidenceRefs: ['evidence://fixture/event-1'],
    observerClass: 'AUTHORIZED_SUPPORTED_CLIENT',
    accessRoleCategory: null,
    accessPurposeCategory: null,
    contentCategory: null,
    limitations: [],
    freshnessBasisUtc: iso(NOW_MS - 500),
    ...overrides,
  };
}

function ledgerInput(events) {
  return {
    schemaVersion: PROVIDER_SAFETY_LEDGER_INPUT_SCHEMA_VERSION,
    snapshotId: 'provider-safety-summary-fixture',
    events,
  };
}

function build(events) {
  return buildProviderSafetyTransparencySummaryV1({
    ledgerInput: ledgerInput(events),
    evaluationNowMs: NOW_MS,
  });
}

test('confirmed provider intervention evidence and inferred anomalies stay separate', () => {
  const result = build([
    event(),
    event({
      eventId: 'event-2',
      classification: 'INFERRED_LATENCY_ANOMALY',
      noticeFingerprint: hash('b'),
      noticeSummaryRedacted: null,
      latencyMs: 1_000,
    }),
  ]);

  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.schemaVersion, PROVIDER_SAFETY_TRANSPARENCY_SUMMARY_SCHEMA_VERSION);
  assert.equal(result.state, 'SUMMARY_READY');
  assert.equal(result.confirmedInterventionEvidenceCount, 1);
  assert.equal(result.confirmedBlockCount, 0);
  assert.equal(result.inferredAnomalyCount, 1);
  assert.equal(result.sourceVerdict, 'CONFIRMED_PROVIDER_INTERVENTION_EVIDENCE_PRESENT');
});

test('confirmed provider block remains distinct and wins the read-only review priority', () => {
  const result = build([
    event({ classification: 'CONFIRMED_PROVIDER_BLOCK', outcome: 'BLOCKED' }),
  ]);

  assert.equal(result.valid, true);
  assert.equal(result.confirmedBlockCount, 1);
  assert.equal(result.confirmedInterventionEvidenceCount, 0);
  assert.equal(result.nextReviewAction.actionClass, 'REVIEW_CONFIRMED_PROVIDER_BLOCK');
  assert.equal(result.authority.providerAccessAllowed, false);
});

test('provider no-record and unobservable state remain evidence gaps, never proof of no intervention', () => {
  const result = build([
    event({
      classification: 'PROVIDER_SAYS_NO_RECORD',
      evidenceType: 'PROVIDER_DISCLOSURE',
      noticeFingerprint: null,
      outcome: 'UNKNOWN',
    }),
    event({
      eventId: 'event-2',
      classification: 'UNOBSERVABLE_PROVIDER_INTERNAL_STATE',
      evidenceType: 'UNKNOWN',
      evidenceStrength: 'UNKNOWN',
      noticeFingerprint: null,
      outcome: 'UNKNOWN',
    }),
  ]);

  assert.equal(result.valid, true);
  assert.equal(result.confirmedInterventionEvidenceCount, 0);
  assert.equal(result.confirmedBlockCount, 0);
  assert.equal(result.accountabilityEvidenceGapCount, 1);
  assert.equal(result.unobservableEventCount, 1);
  assert.ok(result.openEvidenceGaps.includes('PROVIDER_SAYS_NO_RECORD_IS_NOT_PROOF_OF_NO_EVENT'));
  assert.equal(result.nextReviewAction.actionClass, 'REVIEW_ACCOUNTABILITY_EVIDENCE_GAP');
});

test('observed request duration is surfaced without causal attribution to a safety check', () => {
  const result = build([event()]);
  assert.equal(result.valid, true);
  assert.equal(result.observedDuration.measuredEventCount, 1);
  assert.equal(result.observedDuration.totalObservedDurationMs, 1_000);
  assert.equal(result.observedDuration.maximumObservedDurationMs, 1_000);
  assert.equal(result.observedDuration.causalAttribution, 'NOT_ESTABLISHED');
  assert.equal(Object.hasOwn(result, 'safetyCheckDelayMs'), false);
});

test('latest confirmed event is compact and does not republish evidence references or event identity', () => {
  const result = build([event()]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.latestConfirmedEvent, {
    classification: 'CONFIRMED_PROVIDER_NOTICE',
    providerId: 'provider-a',
    surfaceId: 'surface-chat',
    modelId: 'model-a',
    observedAtUtc: iso(NOW_MS - 500),
    outcome: 'CONTINUED',
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('evidence://fixture/event-1'), false);
  assert.equal(Object.hasOwn(result.latestConfirmedEvent, 'eventId'), false);
});

test('stale confirmed evidence cannot remain a current confirmed intervention summary', () => {
  const result = build([
    event({
      observedAtUtc: '2026-07-01T12:00:00.000Z',
      startedAtUtc: '2026-07-01T11:59:58.000Z',
      completedAtUtc: '2026-07-01T11:59:59.000Z',
      freshnessBasisUtc: '2026-07-01T12:00:00.000Z',
    }),
  ]);
  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.confirmedInterventionEvidenceCount, 0);
  assert.equal(result.staleEventCount, 1);
  assert.equal(result.state, 'SUMMARY_EVIDENCE_INCOMPLETE');
});

test('provider and model distributions reuse bounded M1 identities without raw event republication', () => {
  const result = build([
    event(),
    event({
      eventId: 'event-2',
      providerId: 'provider-b',
      modelId: 'model-b',
      noticeFingerprint: hash('b'),
    }),
  ]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.distributions.providers, [
    { id: 'provider-a', count: 1 },
    { id: 'provider-b', count: 1 },
  ]);
  assert.deepEqual(result.distributions.models, [
    { id: 'model-a', count: 1 },
    { id: 'model-b', count: 1 },
  ]);
  assert.equal(Object.hasOwn(result, 'events'), false);
});

test('materially future M1 evidence fails closed before a transparency summary is presented', () => {
  const result = build([
    event({
      observedAtUtc: iso(NOW_MS + 300_001),
      freshnessBasisUtc: iso(NOW_MS),
    }),
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.match(result.validationErrors.join('\n'), /m1:/);
});

test('outer accessors fail closed without invoking caller getters', () => {
  let calls = 0;
  const input = { ledgerInput: ledgerInput([event()]) };
  Object.defineProperty(input, 'evaluationNowMs', {
    enumerable: true,
    get() {
      calls += 1;
      return NOW_MS;
    },
  });
  const result = buildProviderSafetyTransparencySummaryV1(input);
  assert.equal(result.valid, false);
  assert.equal(calls, 0);
  assert.match(result.validationErrors.join('\n'), /exact-data-only-shape/);
});

test('summary identity is deterministic and every action authority remains false', () => {
  const first = build([event()]);
  const second = build([event()]);
  assert.equal(first.summaryId, second.summaryId);
  assert.deepEqual(first.authority, {
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
});
