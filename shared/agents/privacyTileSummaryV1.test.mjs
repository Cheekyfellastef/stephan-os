import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRIVACY_TILE_EVIDENCE_INPUT_SCHEMA_VERSION,
  PRIVACY_TILE_EVIDENCE_RECORD_SCHEMA_VERSION,
} from './privacyTileEvidenceProjectionV1.mjs';
import {
  PRIVACY_TILE_SUMMARY_SCHEMA_VERSION,
  buildPrivacyTileSummaryV1,
} from './privacyTileSummaryV1.mjs';

const evaluationNowMs = Date.parse('2026-08-17T12:00:00.000Z');
const observedAtUtc = '2026-08-17T11:00:00.000Z';

function record(overrides = {}) {
  return {
    schemaVersion: PRIVACY_TILE_EVIDENCE_RECORD_SCHEMA_VERSION,
    recordId: 'privacy-record-1',
    domain: 'AI_PROVIDER_TRANSPARENCY',
    classification: 'CONFIRMED_COLLECTION',
    sourceClass: 'PROVIDER_VISIBLE_NOTICE',
    subjectRef: 'provider-alpha',
    summary: 'Provider-visible evidence confirms one bounded collection event.',
    observedAtUtc,
    freshnessBasisUtc: observedAtUtc,
    evidenceRefs: ['provider://notice-1'],
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

function completeEvidence() {
  return {
    schemaVersion: PRIVACY_TILE_EVIDENCE_INPUT_SCHEMA_VERSION,
    snapshotId: 'privacy-summary-fixture',
    records: [
      record(),
      record({
        recordId: 'privacy-record-2',
        classification: 'CONFIRMED_INTERVENTION',
        summary: 'Provider-visible evidence confirms one intervention.',
        evidenceRefs: ['provider://notice-2'],
      }),
      record({
        recordId: 'privacy-record-3',
        domain: 'DEVICE_DISPLAY_PRIVACY',
        classification: 'CONSENT_UNPROVEN',
        sourceClass: 'DEVICE_SETTING_EVIDENCE',
        subjectRef: 'display-living-room',
        summary: 'Display privacy consent remains unproven.',
        evidenceRefs: ['device://display-setting-1'],
        consentState: 'CONSENT_UNPROVEN',
        displayPrivacySetting: 'UNKNOWN',
      }),
      record({
        recordId: 'privacy-record-4',
        domain: 'CONSENT',
        classification: 'CONSENT_PROVEN',
        sourceClass: 'DEVICE_SETTING_EVIDENCE',
        subjectRef: 'service-beta',
        summary: 'Explicit consent evidence is present for this service.',
        evidenceRefs: ['device://consent-1'],
        consentState: 'CONSENT_PROVEN',
      }),
      record({
        recordId: 'privacy-record-5',
        domain: 'DATA_RIGHTS',
        classification: 'REQUESTED_BUT_WITHHELD',
        sourceClass: 'RIGHTS_REQUEST_RECEIPT',
        subjectRef: 'controller-gamma',
        summary: 'A bounded rights request is awaiting complete disclosure.',
        evidenceRefs: ['receipt://rights-1'],
        rightsRequestState: 'RESPONSE_DUE',
        rightsOpenedAtUtc: '2026-08-01T10:00:00.000Z',
        rightsDeadlineUtc: '2026-08-31T10:00:00.000Z',
      }),
      record({
        recordId: 'privacy-record-6',
        domain: 'EXPORT_DISCLOSURE_DIFF',
        classification: 'NOT_PRESENT_IN_EXPORT',
        sourceClass: 'SANITIZED_EXPORT_DIFF',
        subjectRef: 'provider-export-delta',
        summary: 'A previously expected category is not present in the sanitized export diff.',
        evidenceRefs: ['export://diff-1'],
      }),
      record({
        recordId: 'privacy-record-7',
        domain: 'NETWORK_CONTACT',
        classification: 'INFERRED_COLLECTION_RISK',
        sourceClass: 'SANITIZED_NETWORK_METADATA',
        subjectRef: 'device-tv-1',
        summary: 'Sanitized metadata shows a vendor contact that merits review.',
        evidenceRefs: ['network://contact-1'],
        networkContactKind: 'CONTACT_OBSERVED',
        networkDestinationCategory: 'VENDOR_TELEMETRY',
      }),
    ],
  };
}

function build(evidenceInput = completeEvidence(), nowMs = evaluationNowMs) {
  return buildPrivacyTileSummaryV1({ evidenceInput, evaluationNowMs: nowMs });
}

test('M2 selects the compact collapsed-tile truth from the governed M1 projection', () => {
  const result = build();
  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.schemaVersion, PRIVACY_TILE_SUMMARY_SCHEMA_VERSION);
  assert.equal(result.projectionKind, 'READ_ONLY_PRIVACY_TILE_SUMMARY');
  assert.match(result.summaryId, /^privacy-summary-[0-9a-f]{24}$/);
  assert.equal(result.state, 'SUMMARY_READY');
  assert.equal(result.privacyPosture, 'ATTENTION');
  assert.equal(result.confirmedCollectionSubjectCount, 1);
  assert.equal(result.confirmedInterventionSubjectCount, 1);
  assert.equal(result.confirmedHumanAccessSubjectCount, 0);
  assert.equal(result.consentUnprovenCount, 1);
  assert.equal(result.openRightsRequestCount, 1);
  assert.equal(result.overdueRightsRequestCount, 0);
  assert.equal(result.nearestRightsDeadlineUtc, '2026-08-31T10:00:00.000Z');
  assert.equal(result.evidenceCoverage.requiredDomainCount, 6);
  assert.equal(result.evidenceCoverage.representedDomainCount, 6);
  assert.equal(result.nextReviewAction.actionClass, 'REVIEW_UNPROVEN_CONSENT');
});

test('repeated confirmed events for one subject do not inflate the collapsed collector count', () => {
  const evidence = completeEvidence();
  evidence.records.push(record({
    recordId: 'privacy-record-8',
    observedAtUtc: '2026-08-17T11:30:00.000Z',
    freshnessBasisUtc: '2026-08-17T11:30:00.000Z',
    summary: 'A second current collection observation concerns the same provider.',
    evidenceRefs: ['provider://notice-3'],
  }));
  const result = build(evidence);
  assert.equal(result.valid, true);
  assert.equal(result.confirmedCollectionSubjectCount, 1);
});

test('stale confirmed collection evidence cannot appear as a current confirmed collection subject', () => {
  const evidence = completeEvidence();
  evidence.records[0] = record({
    observedAtUtc: '2026-07-01T11:00:00.000Z',
    freshnessBasisUtc: '2026-07-01T11:00:00.000Z',
  });
  const result = build(evidence);
  assert.equal(result.valid, true);
  assert.equal(result.confirmedCollectionSubjectCount, 0);
  assert.equal(result.staleEvidenceCount >= 1, true);
});

test('an overdue rights request is projected read-only and wins the next-review priority', () => {
  const evidence = completeEvidence();
  evidence.records[4] = record({
    recordId: 'privacy-record-5',
    domain: 'DATA_RIGHTS',
    classification: 'REQUESTED_BUT_WITHHELD',
    sourceClass: 'RIGHTS_REQUEST_RECEIPT',
    subjectRef: 'controller-gamma',
    summary: 'A bounded rights request is overdue for evidence review.',
    evidenceRefs: ['receipt://rights-1'],
    rightsRequestState: 'RESPONSE_DUE',
    rightsOpenedAtUtc: '2026-07-01T10:00:00.000Z',
    rightsDeadlineUtc: '2026-08-01T10:00:00.000Z',
  });
  const result = build(evidence);
  assert.equal(result.valid, true);
  assert.equal(result.overdueRightsRequestCount, 1);
  assert.equal(result.nextReviewAction.actionClass, 'REVIEW_OVERDUE_RIGHTS_REQUEST');
  assert.equal(result.authority.legalSubmissionAllowed, false);
});

test('materially future M1 evidence fails closed instead of becoming a tile summary', () => {
  const evidence = completeEvidence();
  evidence.records[0] = record({
    observedAtUtc: '2026-08-17T12:10:01.000Z',
    freshnessBasisUtc: '2026-08-17T12:10:01.000Z',
  });
  const result = build(evidence);
  assert.equal(result.valid, false);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.equal(result.privacyPosture, 'UNKNOWN');
  assert.match(result.validationErrors.join('\n'), /m1:/);
});

test('outer accessors fail closed without invoking caller getters', () => {
  let calls = 0;
  const input = { evidenceInput: completeEvidence() };
  Object.defineProperty(input, 'evaluationNowMs', {
    enumerable: true,
    get() {
      calls += 1;
      return evaluationNowMs;
    },
  });
  const result = buildPrivacyTileSummaryV1(input);
  assert.equal(result.valid, false);
  assert.equal(calls, 0);
  assert.match(result.validationErrors.join('\n'), /exact-data-only-shape/);
});

test('the compact summary does not republish raw records or evidence references', () => {
  const result = build();
  assert.equal(result.valid, true);
  assert.equal(Object.hasOwn(result, 'records'), false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('provider://notice-1'), false);
  assert.equal(serialized.includes('network://contact-1'), false);
});

test('summary identity is deterministic and all action authority remains false', () => {
  const first = build();
  const second = build();
  assert.equal(first.summaryId, second.summaryId);
  assert.deepEqual(first.authority, {
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
});
