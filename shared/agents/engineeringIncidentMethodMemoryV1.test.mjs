import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENGINEERING_CODING_MEMORY_PACK_SCHEMA_V1,
  ENGINEERING_INCIDENT_METHOD_AUTHORITY_V1,
  ENGINEERING_INCIDENT_METHOD_RECORD_SCHEMA_V1,
  buildEngineeringCodingMemoryPackV1,
  buildEngineeringIncidentMethodRecordV1,
  validateEngineeringIncidentMethodRecordInputV1,
} from './engineeringIncidentMethodMemoryV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

function recordInput(overrides = {}) {
  return {
    recordKey: 'review-receipt-delay-repair',
    recordClass: 'SUCCESSFUL_REPAIR',
    problemClass: 'review-receipt-continuity',
    componentAndOwnerRefs: ['#1574', 'component:independent-review'],
    observedAtUtc: '2026-08-22T13:10:00.000Z',
    sourceHead: HEAD,
    sourceBase: BASE,
    symptom: 'An exact review launch completed without an observable terminal receipt.',
    rootCause: 'Lossy workflow-run summaries and absent pre-artifact failure publication hid terminal truth.',
    repairOrMethod: 'Hydrate bounded run candidates and publish one exact pre-artifact blocked receipt.',
    prerequisites: ['one-content-addressed-launch', 'exact-head-and-base-binding'],
    forbiddenShortcuts: ['do-not-dispatch-a-second-review', 'do-not-treat-dispatch-as-acceptance'],
    failureModes: ['summary-only-run-matching', 'silent-no-artifact-return'],
    counterexamples: ['green-dispatch-workflow-without-terminal-review-receipt'],
    testAndProofRefs: ['test:independent-review-terminal-receipt', 'pr:#1953'],
    runtimeEvidenceRefs: ['receipt:review-launch'],
    confidenceBasis: 'Exact workflow, PR and regression evidence agree on the failure and repair.',
    freshness: 'CURRENT',
    supersedes: null,
    supersededBy: null,
    applicableDomains: ['software-engineering', 'review-continuity'],
    privacyAndSensitivity: 'PUBLIC_ENGINEERING',
    status: 'CURRENT',
    authority: { ...ENGINEERING_INCIDENT_METHOD_AUTHORITY_V1 },
    ...overrides,
  };
}

test('accepts a proven incident repair with attributable regression evidence', () => {
  const record = buildEngineeringIncidentMethodRecordV1(recordInput());
  assert.equal(record.schemaVersion, ENGINEERING_INCIDENT_METHOD_RECORD_SCHEMA_V1);
  assert.equal(record.recordClass, 'SUCCESSFUL_REPAIR');
  assert.equal(record.status, 'CURRENT');
  assert.ok(record.componentAndOwnerRefs.includes('#1574'));
  assert.equal(record.authority.sourceMutationAllowed, false);
  assert.equal(record.authority.automationExecutionAllowed, false);
  assert.equal(Object.isFrozen(record), true);
});

test('canonical issue owner refs are bounded while malformed issue refs remain rejected', () => {
  for (const value of ['#0', '#01', '#12345678901', '#abc', '#1574/extra']) {
    const validation = validateEngineeringIncidentMethodRecordInputV1(recordInput({
      componentAndOwnerRefs: [value, 'component:independent-review'],
    }));
    assert.equal(validation.valid, false, value);
    assert.ok(validation.blockers.includes('component-and-owner-refs-item-invalid'), value);
  }
});

test('rejects symptom-only root-cause and repair claims', () => {
  assert.throws(
    () => buildEngineeringIncidentMethodRecordV1(recordInput({
      recordClass: 'ROOT_CAUSE_FINDING',
      rootCause: '',
      repairOrMethod: null,
    })),
    /root-cause-required/,
  );
  assert.throws(
    () => buildEngineeringIncidentMethodRecordV1(recordInput({
      recordClass: 'SUCCESSFUL_REPAIR',
      repairOrMethod: '',
    })),
    /repair-or-method-required/,
  );
});

test('a failed repair remains visible but is never selected as a preferred method', () => {
  const failed = buildEngineeringIncidentMethodRecordV1(recordInput({
    recordKey: 'duplicate-review-dispatch-failed-repair',
    recordClass: 'FAILED_REPAIR',
    repairOrMethod: 'Dispatch a second review after the receipt window.',
    status: 'FAILED',
    observedAtUtc: '2026-08-22T12:00:00.000Z',
  }));
  const successful = buildEngineeringIncidentMethodRecordV1(recordInput());
  const pack = buildEngineeringCodingMemoryPackV1({
    problemClass: 'review-receipt-continuity',
    componentRefs: ['#1574'],
    createdAtUtc: '2026-08-22T13:20:00.000Z',
    records: [failed, successful],
    maxRecords: 8,
    maxBytes: 24 * 1024,
  });
  assert.equal(pack.schemaVersion, ENGINEERING_CODING_MEMORY_PACK_SCHEMA_V1);
  assert.ok(pack.componentRefs.includes('#1574'));
  assert.deepEqual(pack.preferredMethodRecordIds, [successful.recordId]);
  assert.ok(pack.incidentAndCounterexampleRecordIds.includes(failed.recordId));
  assert.ok(pack.records.some((record) => record.recordId === failed.recordId));
});

test('a current method supersedes an older method without deleting history', () => {
  const oldMethod = buildEngineeringIncidentMethodRecordV1(recordInput({
    recordKey: 'summary-only-review-run-match',
    recordClass: 'REUSABLE_METHOD',
    symptom: null,
    rootCause: null,
    repairOrMethod: 'Match independent review workflow runs from list summaries only.',
    status: 'SUPERSEDED',
    freshness: 'STALE',
    supersededBy: 'record:hydrated-review-run-match',
    observedAtUtc: '2026-08-20T10:00:00.000Z',
  }));
  const newMethod = buildEngineeringIncidentMethodRecordV1(recordInput({
    recordKey: 'hydrated-review-run-match',
    recordClass: 'REUSABLE_METHOD',
    symptom: null,
    rootCause: null,
    repairOrMethod: 'Use bounded summaries only as candidates, then hydrate exact run detail before matching.',
    status: 'CURRENT',
    supersedes: 'record:summary-only-review-run-match',
    observedAtUtc: '2026-08-22T13:00:00.000Z',
  }));
  const pack = buildEngineeringCodingMemoryPackV1({
    problemClass: 'review-receipt-continuity',
    componentRefs: ['#1574'],
    createdAtUtc: '2026-08-22T13:20:00.000Z',
    records: [oldMethod, newMethod],
  });
  assert.deepEqual(pack.preferredMethodRecordIds, [newMethod.recordId]);
  assert.ok(pack.records.some((record) => record.recordId === oldMethod.recordId));
});

test('rejects unrestricted transcript or log content', () => {
  const validation = validateEngineeringIncidentMethodRecordInputV1(recordInput({
    rawTranscript: 'unrestricted conversation dump',
  }));
  assert.equal(validation.valid, false);
  assert.ok(validation.blockers.includes('unrestricted-content-not-admissible'));
});

test('automation candidates remain inert and can be surfaced for later #1607 adjudication', () => {
  const automation = buildEngineeringIncidentMethodRecordV1(recordInput({
    recordKey: 'review-receipt-observer-automation',
    recordClass: 'AUTOMATION_CANDIDATE',
    symptom: null,
    rootCause: null,
    repairOrMethod: 'Observe the existing exact content-addressed review launch and return terminal truth.',
    status: 'CANDIDATE',
    sourceHead: null,
    sourceBase: null,
  }));
  const pack = buildEngineeringCodingMemoryPackV1({
    problemClass: 'review-receipt-continuity',
    componentRefs: ['#1574'],
    createdAtUtc: '2026-08-22T13:20:00.000Z',
    records: [automation],
  });
  assert.deepEqual(pack.automationCandidateRecordIds, [automation.recordId]);
  assert.equal(pack.authority.automationExecutionAllowed, false);
  assert.equal(pack.authority.runtimeMutationAllowed, false);
});

test('later coding work retrieves the prior incident, method and regression intent', () => {
  const successful = buildEngineeringIncidentMethodRecordV1(recordInput());
  const regression = buildEngineeringIncidentMethodRecordV1(recordInput({
    recordKey: 'review-receipt-regression-case',
    recordClass: 'REGRESSION_CASE',
    rootCause: null,
    repairOrMethod: null,
    symptom: 'A terminal review failure without its normal artifact disappears from canonical observation.',
    status: 'HISTORICAL',
    testAndProofRefs: ['test:pre-artifact-failure-publication'],
  }));
  const pack = buildEngineeringCodingMemoryPackV1({
    problemClass: 'review-receipt-continuity',
    componentRefs: ['component:independent-review'],
    createdAtUtc: '2026-08-22T13:20:00.000Z',
    records: [successful, regression],
  });
  assert.ok(pack.records.some((record) => record.recordId === successful.recordId));
  assert.ok(pack.records.some((record) => record.recordId === regression.recordId));
  assert.equal(pack.omittedSensitiveState, false);
});

test('authority widening is rejected', () => {
  const validation = validateEngineeringIncidentMethodRecordInputV1(recordInput({
    authority: { automationExecutionAllowed: true },
  }));
  assert.equal(validation.valid, false);
  assert.ok(validation.blockers.includes('authority-widening-rejected'));
});
