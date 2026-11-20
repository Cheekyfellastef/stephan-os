import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_SAFETY_LEDGER_INPUT_SCHEMA_VERSION as INPUT_SCHEMA,
  PROVIDER_SAFETY_EVENT_SCHEMA_VERSION as EVENT_SCHEMA,
  PROVIDER_SAFETY_CANONICAL_STALE_AFTER_MS as STALE_AFTER_MS,
  PROVIDER_SAFETY_MAX_EVENTS as MAX_EVENTS,
  buildProviderSafetyObservabilityLedgerV1 as buildLedger,
  validateProviderSafetyObservationEventV1 as validateEvent,
} from './providerSafetyObservabilityLedgerV1.mjs';

const NOW_MS = Date.parse('2026-08-14T20:00:00.000Z');
const iso = (milliseconds) => new Date(milliseconds).toISOString();
const hash = (character = 'a') => `sha256:${character.repeat(64)}`;

function evidenceTypeFor(classification) {
  if (classification === 'CONFIRMED_PROVIDER_REQUEST_METADATA') return 'SUPPORTED_CLIENT_METADATA';
  if (classification === 'CONFIRMED_PROVIDER_NOTICE') return 'PROVIDER_VISIBLE_NOTICE';
  if (classification === 'CONFIRMED_PROVIDER_BLOCK') return 'PROVIDER_VISIBLE_NOTICE';
  if (classification === 'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE') return 'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE';
  if (classification === 'INFERRED_LATENCY_ANOMALY') return 'SUPPORTED_CLIENT_METADATA';
  if (classification === 'UNOBSERVABLE_PROVIDER_INTERNAL_STATE') return 'UNKNOWN';
  if (classification === 'CONFIRMED_LOCAL_OBSERVATION') return 'PROVIDER_VISIBLE_NOTICE';
  if (['PROVIDER_DISCLOSED_EVENT', 'PROVIDER_DISCLOSED_HUMAN_ACCESS'].includes(classification)) {
    return 'PROVIDER_DISCLOSURE';
  }
  if (classification === 'NOT_PRESENT_IN_EXPORT') return 'SANITIZED_EXPORT_DIFF';
  if (['PROVIDER_SAYS_NO_RECORD', 'REQUESTED_BUT_WITHHELD', 'EXEMPTION_CLAIMED'].includes(classification)) {
    return 'PROVIDER_DISCLOSURE';
  }
  if (
    ['REQUEST_SUBMITTED', 'IDENTITY_VERIFICATION_PENDING', 'RESPONSE_DUE', 'RESPONSE_OVERDUE', 'APPEAL_OR_COMPLAINT_PENDING'].includes(classification)
  ) {
    return 'RIGHTS_REQUEST_RECEIPT';
  }
  if (classification === 'PARTIAL_DISCLOSURE') return 'PROVIDER_DISCLOSURE';
  if (classification === 'INFERRED_ANOMALY') return 'SUPPORTED_CLIENT_METADATA';
  return 'UNKNOWN';
}

function event(overrides = {}) {
  const classification = overrides.classification || 'CONFIRMED_PROVIDER_NOTICE';
  const startedAtUtc = overrides.startedAtUtc === undefined ? iso(NOW_MS - 2_000) : overrides.startedAtUtc;
  const completedAtUtc = overrides.completedAtUtc === undefined ? iso(NOW_MS - 1_000) : overrides.completedAtUtc;
  const inferred = ['INFERRED_LATENCY_ANOMALY', 'INFERRED_ANOMALY'].includes(classification);
  return {
    schemaVersion: EVENT_SCHEMA,
    eventId: 'event-1',
    classification,
    providerId: 'provider-a',
    surfaceId: 'surface-chat',
    modelId: null,
    observedAtUtc: iso(NOW_MS - 500),
    startedAtUtc,
    completedAtUtc,
    latencyMs: inferred ? 1_000 : null,
    outcome: classification === 'CONFIRMED_PROVIDER_BLOCK' ? 'BLOCKED' : 'CONTINUED',
    evidenceStrength: 'STRONG',
    noticeFingerprint: hash('a'),
    noticeSummaryRedacted: 'Visible bounded provider notice.',
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

const input = (events) => ({
  schemaVersion: INPUT_SCHEMA,
  snapshotId: 'provider-safety-snapshot-1',
  events,
});
const run = (events, options = { evaluationNowMs: NOW_MS }) =>
  buildLedger(input(events), options);
const validation = (value) => validateEvent(value, { evaluationNowMs: NOW_MS });

test('explicit provider notice is confirmed while a slow request stays inferred', () => {
  const projection = run([
    event(),
    event({
      eventId: 'event-2',
      classification: 'INFERRED_LATENCY_ANOMALY',
      noticeFingerprint: hash('b'),
      noticeSummaryRedacted: null,
      evidenceType: 'SUPPORTED_CLIENT_METADATA',
      latencyMs: 1_000,
    }),
  ]);
  assert.equal(projection.counts.confirmedNotices, 1);
  assert.equal(projection.counts.inferredAnomalies, 1);
  assert.equal(projection.verdict, 'CONFIRMED_PROVIDER_INTERVENTION_EVIDENCE_PRESENT');
});

test('provider block remains a distinct explicit confirmed event', () => {
  const projection = run([
    event({ classification: 'CONFIRMED_PROVIDER_BLOCK', outcome: 'BLOCKED' }),
  ]);
  assert.equal(projection.counts.confirmedBlocks, 1);
  assert.equal(projection.verdict, 'CONFIRMED_PROVIDER_BLOCK_OBSERVED');
  assert.equal(
    validation(event({ classification: 'CONFIRMED_PROVIDER_BLOCK', outcome: 'CONTINUED' })).valid,
    false,
  );
});

test('exact replay is deduplicated without increasing counts', () => {
  const original = event();
  const projection = run([original, { ...original }]);
  assert.equal(projection.valid, true);
  assert.equal(projection.events.length, 1);
  assert.equal(projection.counts.confirmedNotices, 1);
  assert.equal(projection.counts.replayedDuplicates, 1);
});

test('same evidence fingerprint with a different event id is replay-deduplicated', () => {
  const projection = run([
    event(),
    event({ eventId: 'event-replay' }),
  ]);
  assert.equal(projection.valid, true);
  assert.equal(projection.events.length, 1);
  assert.equal(projection.counts.replayedDuplicates, 1);
});

test('conflicting duplicate identity and fingerprint fail closed', () => {
  assert.equal(
    run([event(), event({ noticeSummaryRedacted: 'Different notice.' })]).valid,
    false,
  );
  assert.equal(
    run([
      event(),
      event({ eventId: 'event-2', providerId: 'provider-b' }),
    ]).valid,
    false,
  );
});

test('no-record, export absence, withheld and unobservable states never prove no event', () => {
  const projection = run([
    event({
      eventId: 'event-1',
      classification: 'PROVIDER_SAYS_NO_RECORD',
      evidenceType: 'PROVIDER_DISCLOSURE',
      noticeFingerprint: null,
      noticeSummaryRedacted: null,
      outcome: 'UNKNOWN',
    }),
    event({
      eventId: 'event-2',
      classification: 'NOT_PRESENT_IN_EXPORT',
      evidenceType: 'SANITIZED_EXPORT_DIFF',
      noticeFingerprint: hash('b'),
      noticeSummaryRedacted: null,
      outcome: 'UNKNOWN',
    }),
    event({
      eventId: 'event-3',
      classification: 'REQUESTED_BUT_WITHHELD',
      evidenceType: 'PROVIDER_DISCLOSURE',
      noticeFingerprint: hash('c'),
      noticeSummaryRedacted: null,
      outcome: 'WITHHELD',
    }),
    event({
      eventId: 'event-4',
      classification: 'UNOBSERVABLE_PROVIDER_INTERNAL_STATE',
      evidenceType: 'UNKNOWN',
      noticeFingerprint: hash('d'),
      noticeSummaryRedacted: null,
      outcome: 'UNKNOWN',
      evidenceStrength: 'UNKNOWN',
    }),
  ]);
  assert.equal(projection.counts.confirmedNotices, 0);
  assert.equal(projection.counts.providerSaysNoRecord, 1);
  assert.equal(projection.counts.notPresentInExport, 1);
  assert.equal(projection.counts.requestedButWithheld, 1);
  assert.equal(projection.counts.unobservable, 1);
  assert.ok(projection.unknowns.includes('PROVIDER_SAYS_NO_RECORD_IS_NOT_PROOF_OF_NO_EVENT'));
});

test('future, stale and impossible chronology are handled fail closed', () => {
  assert.equal(
    validation(event({ observedAtUtc: iso(NOW_MS + 300_001), freshnessBasisUtc: iso(NOW_MS) })).valid,
    false,
  );
  assert.equal(
    validation(event({ startedAtUtc: iso(NOW_MS - 1_000), completedAtUtc: iso(NOW_MS - 2_000) })).valid,
    false,
  );
  const stale = run([
    event({ freshnessBasisUtc: iso(NOW_MS - STALE_AFTER_MS - 1) }),
  ]);
  assert.equal(stale.counts.stale, 1);
  assert.equal(stale.counts.confirmedNotices, 0);
});

test('caller cannot widen the freshness boundary', () => {
  assert.equal(
    buildLedger(input([event()]), {
      evaluationNowMs: NOW_MS,
      staleAfterMs: Number.MAX_SAFE_INTEGER,
    }).valid,
    false,
  );
});

test('non-array and oversized input fail closed', () => {
  assert.equal(
    buildLedger({ ...input([]), events: {} }, { evaluationNowMs: NOW_MS }).valid,
    false,
  );
  assert.equal(
    run(Array.from({ length: MAX_EVENTS + 1 }, (_, index) => event({
      eventId: `event-${index}`,
      noticeFingerprint: `sha256:${index.toString(16).padStart(64, '0')}`,
    }))).valid,
    false,
  );
});

test('unsafe refs, paths, secrets and raw content are rejected', () => {
  for (const overrides of [
    { evidenceRefs: ['evidence://../secret'] },
    { evidenceRefs: ['evidence://C:/Users/Stephan/a'] },
    { noticeSummaryRedacted: 'raw screenshot includes secret' },
    { providerId: 'account-id' },
    { requestIdHash: 'request-raw-123456789' },
  ]) {
    assert.equal(validation(event(overrides)).valid, false);
  }
});

test('unknown provider and model stay explicit rather than fabricated', () => {
  const projection = run([
    event({
      classification: 'UNOBSERVABLE_PROVIDER_INTERNAL_STATE',
      evidenceType: 'UNKNOWN',
      evidenceStrength: 'UNKNOWN',
      providerId: null,
      surfaceId: null,
      modelId: null,
      noticeFingerprint: null,
      noticeSummaryRedacted: null,
      outcome: 'UNKNOWN',
    }),
  ]);
  assert.deepEqual(projection.distributions.providers, [{ id: 'UNKNOWN', count: 1 }]);
  assert.deepEqual(projection.distributions.models, [{ id: 'UNKNOWN', count: 1 }]);
  assert.ok(projection.unknowns.includes('PROVIDER_ID_UNKNOWN_FOR_SOME_EVENTS'));
});

test('sanitized disclosed human access keeps bounded categories only', () => {
  const projection = run([
    event({
      classification: 'PROVIDER_DISCLOSED_HUMAN_ACCESS',
      evidenceType: 'PROVIDER_DISCLOSURE',
      observerClass: 'PROVIDER_DISCLOSURE',
      outcome: 'DISCLOSED',
      noticeFingerprint: null,
      noticeSummaryRedacted: null,
      accessRoleCategory: 'CONTRACTOR_REVIEWER',
      accessPurposeCategory: 'SAFETY_REVIEW',
      contentCategory: 'CODE_REQUEST',
    }),
  ]);
  assert.equal(projection.counts.disclosedHumanAccess, 1);
  assert.equal(projection.events[0].accessRoleCategory, 'CONTRACTOR_REVIEWER');
  assert.equal(projection.latestConfirmedMaterialEvent.classification, 'PROVIDER_DISCLOSED_HUMAN_ACCESS');
});

test('all authority flags are false', () => {
  assert.ok(Object.values(run([event()]).authority).every((value) => value === false));
});

test('output is deterministic and provider neutral', () => {
  const a = event({ eventId: 'event-a', noticeFingerprint: hash('a') });
  const b = event({
    eventId: 'event-b',
    noticeFingerprint: hash('b'),
    providerId: 'provider-b',
    classification: 'INFERRED_ANOMALY',
    evidenceType: 'SUPPORTED_CLIENT_METADATA',
    noticeSummaryRedacted: null,
    latencyMs: 1_000,
  });
  const first = run([b, a]);
  const second = run([a, b]);
  assert.equal(first.projectionId, second.projectionId);
  assert.deepEqual(first.events.map((entry) => entry.eventId), ['event-a', 'event-b']);
});

test('confirmed or disclosed claims require compatible evidence', () => {
  assert.equal(
    validation(event({ evidenceType: 'UNKNOWN' })).valid,
    false,
  );
  assert.equal(
    validation(event({
      classification: 'PROVIDER_DISCLOSED_EVENT',
      evidenceType: 'SUPPORTED_CLIENT_METADATA',
      noticeFingerprint: null,
      noticeSummaryRedacted: null,
      outcome: 'DISCLOSED',
    })).valid,
    false,
  );
});

test('weak evidence cannot establish confirmed or disclosed claims', () => {
  assert.equal(validation(event({ evidenceStrength: 'WEAK' })).valid, false);
  assert.equal(
    validation(event({
      classification: 'PROVIDER_DISCLOSED_EVENT',
      evidenceType: 'PROVIDER_DISCLOSURE',
      evidenceStrength: 'WEAK',
      noticeFingerprint: null,
      noticeSummaryRedacted: null,
      outcome: 'DISCLOSED',
    })).valid,
    false,
  );
});

test('inferred anomalies require exact measured timing', () => {
  assert.equal(
    validation(event({
      classification: 'INFERRED_LATENCY_ANOMALY',
      latencyMs: null,
      noticeSummaryRedacted: null,
    })).valid,
    false,
  );
  assert.equal(
    validation(event({
      classification: 'INFERRED_LATENCY_ANOMALY',
      latencyMs: 999,
      noticeSummaryRedacted: null,
    })).valid,
    false,
  );
});

test('synthetic fixtures never establish live counts or material verdicts', () => {
  const projection = run([
    event({
      evidenceType: 'SYNTHETIC_TEST_FIXTURE',
      observerClass: 'SYNTHETIC_TEST',
      providerId: 'synthetic-provider',
    }),
  ]);
  assert.equal(projection.counts.confirmedNotices, 0);
  assert.equal(projection.counts.syntheticFixtures, 1);
  assert.equal(projection.verdict, 'TEST_FIXTURE_ONLY');
  assert.equal(projection.freshness, 'TEST_ONLY');
  assert.equal(projection.latestConfirmedMaterialEvent, null);
  assert.ok(projection.unknowns.includes('SYNTHETIC_FIXTURES_ARE_NOT_LIVE_EVIDENCE'));
});

test('operator supplied evidence-only record does not become a confirmed notice', () => {
  const projection = run([
    event({
      classification: 'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
      evidenceType: 'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
      observerClass: 'OPERATOR_SUPPLIED',
    }),
  ]);
  assert.equal(projection.counts.confirmedNotices, 0);
  assert.equal(projection.counts.unclassifiedVisibleEvidence, 1);
  assert.equal(projection.verdict, 'UNCLASSIFIED_OPERATOR_VISIBLE_EVIDENCE');
  assert.ok(projection.unknowns.includes('OPERATOR_EVIDENCE_REQUIRES_SPECIFIC_CLAIM_CLASSIFICATION'));
});

test('sparse and accessor-bearing arrays fail closed without throwing', () => {
  const sparseRefs = [];
  sparseRefs.length = 1;
  assert.doesNotThrow(() => validation(event({ evidenceRefs: sparseRefs })));
  assert.equal(validation(event({ evidenceRefs: sparseRefs })).valid, false);

  const accessorEvents = [];
  Object.defineProperty(accessorEvents, '0', {
    enumerable: true,
    get() {
      throw new Error('must not execute');
    },
  });
  accessorEvents.length = 1;
  assert.doesNotThrow(() => run(accessorEvents));
  assert.equal(run(accessorEvents).valid, false);
});

test('accepted nested arrays are detached and frozen', () => {
  const evidenceRefs = ['evidence://fixture/event-1'];
  const limitations = [];
  const projection = run([event({ evidenceRefs, limitations })]);
  evidenceRefs[0] = 'evidence://fixture/tampered';
  limitations.push('tampered');
  assert.deepEqual(projection.events[0].evidenceRefs, ['evidence://fixture/event-1']);
  assert.deepEqual(projection.events[0].limitations, []);
  assert.equal(Object.isFrozen(projection.events[0].evidenceRefs), true);
  assert.throws(() => projection.events[0].evidenceRefs.push('evidence://fixture/new'));
});

test('out-of-range evaluation clocks fail closed without throwing', () => {
  assert.doesNotThrow(() => buildLedger(input([event()]), { evaluationNowMs: Number.MAX_SAFE_INTEGER }));
  assert.equal(
    buildLedger(input([event()]), { evaluationNowMs: Number.MAX_SAFE_INTEGER }).valid,
    false,
  );
});

test('raw request identifiers are never accepted in place of hashes', () => {
  assert.equal(validation(event({ requestIdHash: 'req-1234' })).valid, false);
  assert.equal(validation(event({ requestIdHash: hash('f') })).valid, true);
});
