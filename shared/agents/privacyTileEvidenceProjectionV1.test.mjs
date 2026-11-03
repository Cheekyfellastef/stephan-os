import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIVACY_TILE_EVIDENCE_INPUT_SCHEMA_VERSION as INPUT_SCHEMA,
  PRIVACY_TILE_EVIDENCE_RECORD_SCHEMA_VERSION as RECORD_SCHEMA,
  PRIVACY_TILE_CANONICAL_STALE_AFTER_MS as STALE_AFTER_MS,
  PRIVACY_TILE_MAX_RECORDS as MAX_RECORDS,
  PRIVACY_TILE_DOMAINS,
  buildPrivacyTileEvidenceProjectionV1 as buildProjection,
  validatePrivacyEvidenceRecordV1 as validateRecord,
} from './privacyTileEvidenceProjectionV1.mjs';

const NOW_MS = Date.parse('2026-08-14T20:00:00.000Z');
const iso = (milliseconds) => new Date(milliseconds).toISOString();

function sourceFor(classification) {
  if (classification === 'CONFIRMED_INTERVENTION') return 'PROVIDER_VISIBLE_NOTICE';
  if (classification === 'CONFIRMED_COLLECTION') return 'SUPPORTED_PROVIDER_METADATA';
  if (['CONFIRMED_HUMAN_ACCESS', 'CONFIRMED_DISCLOSURE', 'CONFIRMED_DELETION'].includes(classification)) {
    return 'PROVIDER_DISCLOSURE';
  }
  if (classification === 'CONFIRMED_RESTRICTION') return 'DEVICE_SETTING_EVIDENCE';
  if (classification === 'OPERATOR_SUPPLIED_EVIDENCE') return 'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE';
  if (classification === 'INFERRED_COLLECTION_RISK') return 'SUPPORTED_PROVIDER_METADATA';
  if (classification === 'INFERRED_LATENCY_OR_NETWORK_ANOMALY') return 'SUPPORTED_PROVIDER_METADATA';
  if (['CONSENT_PROVEN', 'CONSENT_WITHDRAWN'].includes(classification)) return 'DEVICE_SETTING_EVIDENCE';
  if (classification === 'CONSENT_UNPROVEN') return 'UNKNOWN';
  if (['REQUESTED_BUT_WITHHELD', 'PROVIDER_SAYS_NO_RECORD'].includes(classification)) {
    return 'PROVIDER_DISCLOSURE';
  }
  if (classification === 'NOT_PRESENT_IN_EXPORT') return 'SANITIZED_EXPORT_DIFF';
  if (classification === 'UNOBSERVABLE_INTERNAL_STATE') return 'UNKNOWN';
  return 'PROVIDER_VISIBLE_NOTICE';
}

function record(overrides = {}) {
  const classification = overrides.classification || 'CONFIRMED_INTERVENTION';
  return {
    schemaVersion: RECORD_SCHEMA,
    recordId: 'record-1',
    domain: 'AI_PROVIDER_TRANSPARENCY',
    classification,
    sourceClass: overrides.sourceClass || sourceFor(classification),
    subjectRef: 'provider-openai',
    summary: 'Visible bounded provider notice.',
    observedAtUtc: iso(NOW_MS - 1_000),
    freshnessBasisUtc: iso(NOW_MS - 1_000),
    evidenceRefs: ['evidence://fixture/record-1'],
    consentState: null,
    rightsRequestState: null,
    rightsOpenedAtUtc: null,
    rightsDeadlineUtc: null,
    networkContactKind: null,
    networkDestinationCategory: null,
    displayPrivacySetting: null,
    limitations: [],
    ...overrides,
  };
}

const input = (records) => ({
  schemaVersion: INPUT_SCHEMA,
  snapshotId: 'privacy-snapshot-1',
  records,
});
const run = (records, options = { evaluationNowMs: NOW_MS }) =>
  buildProjection(input(records), options);

function validation(recordValue) {
  return validateRecord(recordValue, { evaluationNowMs: NOW_MS });
}

test('separates confirmed, inferred, unknown and stale truth buckets', () => {
  const projection = run([
    record(),
    record({ recordId: 'record-2', classification: 'INFERRED_COLLECTION_RISK' }),
    record({ recordId: 'record-3', classification: 'PROVIDER_SAYS_NO_RECORD' }),
    record({
      recordId: 'record-4',
      classification: 'STALE_EVIDENCE',
      freshnessBasisUtc: iso(NOW_MS - STALE_AFTER_MS - 1),
    }),
  ]);
  assert.deepEqual(projection.truthCounts, {
    total: 4,
    confirmed: 1,
    inferred: 1,
    unknown: 1,
    stale: 1,
  });
});

test('missing device consent is projected as CONSENT_UNPROVEN', () => {
  const projection = run([
    record({
      domain: 'DEVICE_DISPLAY_PRIVACY',
      classification: 'UNOBSERVABLE_INTERNAL_STATE',
      sourceClass: 'UNKNOWN',
      displayPrivacySetting: 'UNKNOWN',
    }),
  ]);
  assert.equal(projection.consent.unprovenCount, 1);
  assert.ok(projection.unknowns.includes('CONSENT_UNPROVEN'));
  assert.ok(projection.unknowns.includes('DISPLAY_PRIVACY_SETTING_UNKNOWN'));
});

test('network contact remains contact-only and cannot prove content or processing', () => {
  const projection = run([
    record({
      domain: 'NETWORK_CONTACT',
      classification: 'INFERRED_LATENCY_OR_NETWORK_ANOMALY',
      sourceClass: 'SANITIZED_NETWORK_METADATA',
      networkContactKind: 'CONTACT_OBSERVED',
      networkDestinationCategory: 'VENDOR_TELEMETRY',
    }),
  ]);
  assert.equal(projection.records[0].contactOnly, true);
  assert.equal(
    validation(
      record({
        domain: 'NETWORK_CONTACT',
        classification: 'CONFIRMED_COLLECTION',
        sourceClass: 'SUPPORTED_PROVIDER_METADATA',
        networkContactKind: 'CONTACT_OBSERVED',
        networkDestinationCategory: 'VENDOR',
      }),
    ).valid,
    false,
  );
});

test('unknown display setting remains UNKNOWN', () => {
  const projection = run([
    record({
      domain: 'DEVICE_DISPLAY_PRIVACY',
      classification: 'UNOBSERVABLE_INTERNAL_STATE',
      sourceClass: 'UNKNOWN',
      displayPrivacySetting: null,
    }),
  ]);
  assert.equal(projection.records[0].effectiveDisplayPrivacySetting, 'UNKNOWN');
});

test('provider says no record is not proof that no processing occurred', () => {
  const projection = run([
    record({ classification: 'PROVIDER_SAYS_NO_RECORD' }),
  ]);
  assert.equal(projection.truthCounts.unknown, 1);
  assert.ok(
    projection.unknowns.includes(
      'ABSENCE_OF_DISCLOSURE_IS_NOT_PROOF_OF_NO_PROCESSING',
    ),
  );
});

test('stale evidence stays visible and materially future evidence is rejected', () => {
  assert.equal(
    run([
      record({ freshnessBasisUtc: iso(NOW_MS - STALE_AFTER_MS - 1) }),
    ]).truthCounts.stale,
    1,
  );
  assert.equal(
    validation(
      record({
        observedAtUtc: iso(NOW_MS + 300_001),
        freshnessBasisUtc: iso(NOW_MS),
      }),
    ).valid,
    false,
  );
});

test('caller cannot widen the canonical freshness policy', () => {
  assert.equal(
    buildProjection(input([record()]), {
      evaluationNowMs: NOW_MS,
      staleAfterMs: 9e15,
    }).valid,
    false,
  );
});

test('duplicate record identities fail closed', () => {
  assert.equal(run([record(), record()]).valid, false);
});

test('collections must be arrays and remain bounded', () => {
  assert.equal(
    buildProjection({ ...input([]), records: {} }, { evaluationNowMs: NOW_MS }).valid,
    false,
  );
  assert.equal(
    run(
      Array.from({ length: MAX_RECORDS + 1 }, (_, index) =>
        record({ recordId: `record-${index}` }),
      ),
    ).valid,
    false,
  );
});

test('unsupported classifications, domains and rights states fail closed', () => {
  assert.equal(validation(record({ classification: 'NO_SCAN' })).valid, false);
  assert.equal(validation(record({ domain: 'BROWSER_HISTORY' })).valid, false);
  assert.equal(
    validation(
      record({
        domain: 'DATA_RIGHTS',
        classification: 'REQUESTED_BUT_WITHHELD',
        rightsRequestState: 'MAGIC',
      }),
    ).valid,
    false,
  );
});

test('sensitive, raw, local-path and unsafe reference content is rejected', () => {
  for (const override of [
    { summary: 'raw export contains secret' },
    { subjectRef: 'account-id' },
    { evidenceRefs: ['evidence://../secret'] },
    { evidenceRefs: ['evidence://C:/Users/Stephan/a'] },
    { evidenceRefs: ['evidence://fixture/123456789'] },
  ]) {
    assert.equal(validation(record(override)).valid, false);
  }
});

test('rights deadline projection remains read-only', () => {
  const projection = run([
    record({
      domain: 'DATA_RIGHTS',
      classification: 'REQUESTED_BUT_WITHHELD',
      sourceClass: 'RIGHTS_REQUEST_RECEIPT',
      rightsRequestState: 'RESPONSE_DUE',
      rightsOpenedAtUtc: iso(NOW_MS - 100_000),
      rightsDeadlineUtc: iso(NOW_MS - 1),
    }),
  ]);
  assert.equal(projection.rights.overdueCount, 1);
  assert.equal(
    projection.recommendedNextReviewAction.actionClass,
    'REVIEW_OVERDUE_RIGHTS_REQUEST',
  );
  assert.equal(projection.authority.legalSubmissionAllowed, false);
  assert.equal(projection.authority.deletionAllowed, false);
});

test('empty evidence produces UNKNOWN posture', () => {
  assert.equal(run([]).posture, 'UNKNOWN');
});

test('every authority flag remains false', () => {
  assert.ok(Object.values(run([record()]).authority).every((value) => value === false));
});

test('output order and identity are deterministic', () => {
  const first = run([
    record({ recordId: 'record-b' }),
    record({ recordId: 'record-a', classification: 'INFERRED_COLLECTION_RISK' }),
  ]);
  const second = run([
    record({ recordId: 'record-a', classification: 'INFERRED_COLLECTION_RISK' }),
    record({ recordId: 'record-b' }),
  ]);
  assert.equal(first.projectionId, second.projectionId);
  assert.deepEqual(first.records.map((entry) => entry.recordId), [
    'record-a',
    'record-b',
  ]);
});

test('confirmed claims require a compatible non-unknown source', () => {
  const verdict = validation(
    record({
      classification: 'CONFIRMED_INTERVENTION',
      sourceClass: 'UNKNOWN',
    }),
  );
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('source-classification-mismatch'));
});

test('operator-supplied evidence-only records do not become confirmed claims', () => {
  const projection = run([
    record({
      classification: 'OPERATOR_SUPPLIED_EVIDENCE',
      sourceClass: 'OPERATOR_SUPPLIED_VISIBLE_EVIDENCE',
    }),
  ]);
  assert.equal(projection.truthCounts.confirmed, 0);
  assert.equal(projection.truthCounts.unknown, 1);
  assert.equal(projection.posture, 'UNKNOWN');
  assert.ok(
    projection.unknowns.includes(
      'OPERATOR_SUPPLIED_EVIDENCE_REQUIRES_SPECIFIC_CLAIM_CLASSIFICATION',
    ),
  );
});

test('synthetic fixtures can test determinism but never establish live posture', () => {
  const fixtures = PRIVACY_TILE_DOMAINS.map((domain, index) =>
    record({
      recordId: `fixture-${index}`,
      domain,
      classification:
        domain === 'NETWORK_CONTACT'
          ? 'INFERRED_LATENCY_OR_NETWORK_ANOMALY'
          : domain === 'CONSENT'
            ? 'CONSENT_PROVEN'
            : domain === 'DATA_RIGHTS'
              ? 'CONFIRMED_DELETION'
              : 'CONFIRMED_RESTRICTION',
      sourceClass: 'SYNTHETIC_TEST_FIXTURE',
      consentState:
        domain === 'CONSENT' || domain === 'DEVICE_DISPLAY_PRIVACY'
          ? 'CONSENT_PROVEN'
          : null,
      displayPrivacySetting:
        domain === 'DEVICE_DISPLAY_PRIVACY' ? 'DISABLED' : null,
      rightsRequestState: domain === 'DATA_RIGHTS' ? 'CLOSED' : null,
      rightsOpenedAtUtc: domain === 'DATA_RIGHTS' ? iso(NOW_MS - 2_000) : null,
      rightsDeadlineUtc: domain === 'DATA_RIGHTS' ? iso(NOW_MS - 1_500) : null,
      networkContactKind:
        domain === 'NETWORK_CONTACT' ? 'NO_CONTACT_OBSERVATION' : null,
      networkDestinationCategory:
        domain === 'NETWORK_CONTACT' ? 'VENDOR_TELEMETRY' : null,
    }),
  );
  const projection = run(fixtures);
  assert.equal(projection.posture, 'UNKNOWN');
  assert.equal(projection.evidenceCoverage.syntheticFixtureCount, fixtures.length);
  assert.equal(projection.evidenceCoverage.currentDomainCount, 0);
  assert.ok(
    projection.unknowns.includes('SYNTHETIC_FIXTURES_ARE_NOT_LIVE_EVIDENCE'),
  );
  assert.equal(projection.latestMaterialEvent, null);
});

test('sparse and accessor-bearing evidence arrays fail closed without throwing', () => {
  const sparse = [];
  sparse.length = 1;
  assert.doesNotThrow(() => validation(record({ evidenceRefs: sparse })));
  assert.equal(validation(record({ evidenceRefs: sparse })).valid, false);

  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', {
    enumerable: true,
    get() {
      throw new Error('must not execute');
    },
  });
  accessorArray.length = 1;
  assert.doesNotThrow(() => validation(record({ evidenceRefs: accessorArray })));
  assert.equal(validation(record({ evidenceRefs: accessorArray })).valid, false);
});

test('sparse and accessor-bearing record collections fail closed without throwing', () => {
  const sparse = [];
  sparse.length = 1;
  assert.doesNotThrow(() => run(sparse));
  assert.equal(run(sparse).valid, false);

  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', {
    enumerable: true,
    get() {
      throw new Error('must not execute');
    },
  });
  accessorArray.length = 1;
  assert.doesNotThrow(() => run(accessorArray));
  assert.equal(run(accessorArray).valid, false);
});

test('custom array prototypes are rejected', () => {
  const references = ['evidence://fixture/record-1'];
  Object.setPrototypeOf(references, null);
  assert.equal(validation(record({ evidenceRefs: references })).valid, false);
});

test('projection detaches and freezes nested evidence arrays', () => {
  const evidenceRefs = ['evidence://fixture/record-1'];
  const limitations = [];
  const projection = run([record({ evidenceRefs, limitations })]);
  evidenceRefs[0] = 'evidence://fixture/tampered';
  limitations.push('tampered');

  assert.deepEqual(projection.records[0].evidenceRefs, [
    'evidence://fixture/record-1',
  ]);
  assert.deepEqual(projection.records[0].limitations, []);
  assert.equal(Object.isFrozen(projection.records[0].evidenceRefs), true);
  assert.equal(Object.isFrozen(projection.records[0].limitations), true);
  assert.throws(() => projection.records[0].evidenceRefs.push('evidence://fixture/new'));
});

test('out-of-range evaluation clocks fail closed without throwing', () => {
  assert.doesNotThrow(() =>
    buildProjection(input([record()]), { evaluationNowMs: Number.MAX_SAFE_INTEGER }),
  );
  assert.equal(
    buildProjection(input([record()]), { evaluationNowMs: Number.MAX_SAFE_INTEGER }).valid,
    false,
  );
});

test('NOT_PRESENT_IN_EXPORT is bound to sanitized export evidence', () => {
  assert.equal(
    validation(
      record({
        domain: 'EXPORT_DISCLOSURE_DIFF',
        classification: 'NOT_PRESENT_IN_EXPORT',
        sourceClass: 'SANITIZED_EXPORT_DIFF',
      }),
    ).valid,
    true,
  );
  assert.equal(
    validation(
      record({
        classification: 'NOT_PRESENT_IN_EXPORT',
        sourceClass: 'SANITIZED_EXPORT_DIFF',
      }),
    ).valid,
    false,
  );
});

test('rights deadlines cannot exist without an opened time', () => {
  const verdict = validation(
    record({
      domain: 'DATA_RIGHTS',
      classification: 'REQUESTED_BUT_WITHHELD',
      sourceClass: 'RIGHTS_REQUEST_RECEIPT',
      rightsRequestState: 'RESPONSE_DUE',
      rightsDeadlineUtc: iso(NOW_MS + 10_000),
    }),
  );
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('rights-deadline-without-opened-time'));
});

test('record accessors are rejected before serialization without executing caller code', () => {
  let getterCalls = 0;
  const hostile = record();
  Object.defineProperty(hostile, 'summary', {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });

  let projection;
  assert.doesNotThrow(() => {
    projection = run([hostile]);
  });
  assert.equal(projection.valid, false);
  assert.equal(getterCalls, 0);
  assert.ok(
    projection.validationErrors.includes(
      'input-must-be-exact-dense-data-only-shape',
    ),
  );
});

test('own toJSON hooks are rejected before the input-size check without execution', () => {
  let toJsonCalls = 0;
  const hostile = record();
  Object.defineProperty(hostile, 'toJSON', {
    enumerable: true,
    configurable: true,
    value() {
      toJsonCalls += 1;
      return { summary: 'forged serialization' };
    },
  });

  const projection = run([hostile]);
  assert.equal(projection.valid, false);
  assert.equal(toJsonCalls, 0);
  assert.ok(
    projection.validationErrors.includes(
      'input-must-be-exact-dense-data-only-shape',
    ),
  );
});

test('revoked and throwing record proxies fail closed without escaping', () => {
  const revoked = Proxy.revocable(record(), {});
  revoked.revoke();
  assert.doesNotThrow(() => run([revoked.proxy]));
  assert.equal(run([revoked.proxy]).valid, false);

  let trapCalls = 0;
  const throwing = new Proxy(record(), {
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error('uninspectable');
    },
  });
  let projection;
  assert.doesNotThrow(() => {
    projection = run([throwing]);
  });
  assert.equal(projection.valid, false);
  assert.equal(trapCalls, 1);
});

test('record objects are detached before projection size measurement and later mutation', () => {
  const sourceRecord = record();
  const projection = run([sourceRecord]);
  sourceRecord.summary = 'Caller mutation after projection.';
  sourceRecord.subjectRef = 'provider-tampered';

  assert.equal(projection.valid, true);
  assert.equal(projection.records[0].summary, 'Visible bounded provider notice.');
  assert.equal(projection.records[0].subjectRef, 'provider-openai');
  assert.equal(Object.isFrozen(projection.records[0]), true);
});
