import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_MEMORY_RETRIEVAL_PACK_KINDS,
  buildStephanosMemoryRetrievalPackV1,
} from './stephanosMemoryRetrievalPackV1.mjs';

function record(overrides = {}) {
  return {
    recordId: 'record-1',
    namespace: 'project',
    type: 'decision',
    source: 'github-programme-truth',
    summary: 'The product programme owns operator-facing outcomes.',
    tags: ['product', 'programme'],
    relationshipRefs: [],
    observedAtUtc: '2026-08-17T12:00:00.000Z',
    updatedAtUtc: '2026-08-17T12:00:00.000Z',
    authorityClass: 'SHARED_AUTHORITY',
    freshness: 'FRESH',
    currentState: 'CURRENT',
    proofRefs: ['github://issue/1776'],
    sourceRefs: ['project://stephanos/product-programme'],
    relatedGoalRef: '#1776',
    relatedPrRef: '',
    component: 'product-programme',
    personOrParticipant: 'stephanos',
    relationshipEvidenceClass: 'NOT_RELATIONSHIP',
    ...overrides,
  };
}

function build(records, overrides = {}) {
  return buildStephanosMemoryRetrievalPackV1({
    packKind: 'PROJECT_SELF_MODEL_PACK',
    records,
    selectors: {},
    budget: { maxRecords: 24, maxBytes: 32768 },
    ...overrides,
  });
}

test('exports all seven required provider-neutral pack kinds', () => {
  assert.deepEqual(STEPHANOS_MEMORY_RETRIEVAL_PACK_KINDS, [
    'CONVERSATIONAL_CONTINUITY_PACK',
    'OPERATOR_RELATIONSHIP_PACK',
    'PROJECT_SELF_MODEL_PACK',
    'ACTIVE_MISSION_PACK',
    'PROCEDURAL_METHOD_PACK',
    'PROSPECTIVE_OPEN_LOOPS_PACK',
    'REFLECTIVE_LESSONS_PACK',
  ]);
});

test('unsupported pack kind fails closed with zero authority', () => {
  const result = buildStephanosMemoryRetrievalPackV1({ packKind: 'RAW_MEMORY_DUMP', records: [], selectors: {}, budget: {} });
  assert.equal(result.valid, false);
  assert.equal(result.verdict, 'SAFE_HOLD');
  assert.ok(result.validationErrors.includes('packKind-unsupported'));
  assert.equal(result.authority.memoryWriteAllowed, false);
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.runtimeMutationAllowed, false);
});

test('non-array and oversized input are rejected', () => {
  assert.equal(buildStephanosMemoryRetrievalPackV1({ packKind: 'PROJECT_SELF_MODEL_PACK', records: {}, selectors: {}, budget: {} }).valid, false);
  const oversized = Array.from({ length: 2001 }, (_, index) => record({ recordId: `record-${index}` }));
  const result = buildStephanosMemoryRetrievalPackV1({ packKind: 'PROJECT_SELF_MODEL_PACK', records: oversized, selectors: {}, budget: {} });
  assert.ok(result.validationErrors.includes('records-exceed-input-bound'));
});

test('unsafe proof refs fail closed rather than leaking path data', () => {
  const result = build([record({ proofRefs: ['../../secret.txt'] })]);
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.includes('record-1:unsafe-proof-ref'));
});

test('relationship refs and dense list fields reject sensitive or local-path material', () => {
  const localPath = build([record({ relationshipRefs: ['C:\\Users\\operator\\private.txt'] })]);
  assert.equal(localPath.valid, false);
  assert.ok(localPath.validationErrors.includes('record-1:relationshipRefs-invalid'));

  const credential = build([record({ relationshipRefs: ['access token secret'] })]);
  assert.equal(credential.valid, false);
  assert.ok(credential.validationErrors.includes('record-1:relationshipRefs-invalid'));
});

test('unsupported raw fields are omitted and provider-specific input does not enter output', () => {
  const input = record();
  input.rawPayload = { provider: 'some-provider', token: 'should-not-be-read' };
  input.provider = 'some-provider';
  const result = build([input]);
  assert.equal(result.valid, true);
  assert.equal(result.sensitiveDataOmitted, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('should-not-be-read'), false);
  assert.equal(serialized.includes('some-provider'), false);
});

test('missing authority and freshness remain UNKNOWN and are never promoted', () => {
  const input = record();
  delete input.authorityClass;
  delete input.freshness;
  const result = build([input]);
  assert.equal(result.valid, true);
  assert.equal(result.selectedRecords[0].authorityClass, 'UNKNOWN');
  assert.equal(result.selectedRecords[0].freshness, 'UNKNOWN');
});

test('fresh higher-authority current evidence sorts before stale local evidence', () => {
  const stale = record({
    recordId: 'record-stale',
    authorityClass: 'LOCAL_MIRROR',
    freshness: 'STALE',
    updatedAtUtc: '2026-08-17T12:10:00.000Z',
  });
  const fresh = record({ recordId: 'record-fresh' });
  const result = build([stale, fresh]);
  assert.deepEqual(result.selectedRecordIds, ['record-fresh', 'record-stale']);
});

test('stale evidence outranks inference in the canonical memory authority order', () => {
  const stale = record({
    recordId: 'record-stale-authority',
    authorityClass: 'STALE_EVIDENCE',
    freshness: 'FRESH',
  });
  const inferred = record({
    recordId: 'record-inferred-authority',
    authorityClass: 'INFERRED',
    freshness: 'FRESH',
  });
  const result = build([inferred, stale]);
  assert.deepEqual(result.selectedRecordIds, ['record-stale-authority', 'record-inferred-authority']);
});

test('superseded evidence is excluded by default and can be included only as historical', () => {
  const historical = record({ recordId: 'record-old', currentState: 'SUPERSEDED' });
  assert.deepEqual(build([historical]).selectedRecordIds, []);
  const included = build([historical], { selectors: { includeHistorical: true } });
  assert.deepEqual(included.selectedRecordIds, ['record-old']);
  assert.equal(included.selectedRecords[0].currentState, 'SUPERSEDED');
});

test('contradictory current records remain explicit', () => {
  const first = record({ recordId: 'record-a', summary: 'Current state is A.' });
  const second = record({ recordId: 'record-b', summary: 'Current state is B.' });
  const result = build([first, second]);
  assert.equal(result.verdict, 'CONFLICTING_EVIDENCE');
  assert.deepEqual(result.unresolvedContradictions, ['record-a', 'record-b']);
});

test('pack identity binds the complete projected result rather than record ids alone', () => {
  const first = build([record({ recordId: 'record-stable', summary: 'Current state is A.' })]);
  const changedSummary = build([record({ recordId: 'record-stable', summary: 'Current state is B.' })]);
  const changedAuthority = build([record({ recordId: 'record-stable', authorityClass: 'LOCAL_MIRROR' })]);
  assert.notEqual(first.packId, changedSummary.packId);
  assert.notEqual(first.packId, changedAuthority.packId);
});

test('contradictions are detected before record-count truncation can hide them', () => {
  const first = record({ recordId: 'record-a', summary: 'Current state is A.' });
  const second = record({ recordId: 'record-b', summary: 'Current state is B.' });
  const result = build([first, second], { budget: { maxRecords: 1, maxBytes: 32768 } });
  assert.equal(result.budget.truncated, true);
  assert.deepEqual(result.selectedRecordIds, ['record-a']);
  assert.equal(result.verdict, 'CONFLICTING_EVIDENCE');
  assert.deepEqual(result.unresolvedContradictions, ['record-a', 'record-b']);
});

test('record-count budget truncates deterministically', () => {
  const result = build([
    record({ recordId: 'record-a' }),
    record({ recordId: 'record-b' }),
    record({ recordId: 'record-c' }),
  ], { budget: { maxRecords: 2, maxBytes: 32768 } });
  assert.equal(result.valid, true);
  assert.equal(result.budget.truncated, true);
  assert.equal(result.budget.actualRecords, 2);
  assert.deepEqual(result.selectedRecordIds, ['record-a', 'record-b']);
});

test('byte budget reports the exact serialized selected-record array size', () => {
  const result = build([record({ recordId: 'record-a' }), record({ recordId: 'record-b' })]);
  assert.equal(result.budget.actualBytes, Buffer.byteLength(JSON.stringify(result.selectedRecords), 'utf8'));
  assert.ok(result.budget.actualBytes <= result.budget.maxBytes);

  const empty = build([], { budget: { maxRecords: 24, maxBytes: 32768 } });
  assert.equal(empty.budget.actualBytes, Buffer.byteLength('[]', 'utf8'));
});

test('operator relationship pack rejects psychological inference while retaining explicit teaching', () => {
  const explicit = record({
    recordId: 'operator-explicit',
    namespace: 'operator',
    type: 'preference',
    summary: 'Operator explicitly prefers concise evidence-first answers.',
    relationshipEvidenceClass: 'EXPLICIT_OPERATOR',
    personOrParticipant: 'operator',
  });
  const speculative = record({
    recordId: 'operator-speculative',
    namespace: 'operator',
    type: 'inference',
    summary: 'The operator mood is anxious and reveals a hidden motivation.',
    authorityClass: 'INFERRED',
    relationshipEvidenceClass: 'LOW_AUTHORITY_INTERACTION_INFERENCE',
    personOrParticipant: 'operator',
  });
  const result = buildStephanosMemoryRetrievalPackV1({
    packKind: 'OPERATOR_RELATIONSHIP_PACK',
    records: [speculative, explicit],
    selectors: {},
    budget: { maxRecords: 24, maxBytes: 32768 },
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.selectedRecordIds, ['operator-explicit']);
  assert.equal(result.sensitiveDataOmitted, true);
});

test('operator relationship pack screens every projected textual field for psychological inference', () => {
  const neutralSummaryUnsafeTag = record({
    recordId: 'operator-tag-inference',
    namespace: 'operator',
    type: 'inference',
    summary: 'A low-authority interaction observation.',
    tags: ['mood'],
    authorityClass: 'INFERRED',
    relationshipEvidenceClass: 'LOW_AUTHORITY_INTERACTION_INFERENCE',
    personOrParticipant: 'operator',
  });
  const neutralSummaryUnsafeMetadata = record({
    recordId: 'operator-metadata-inference',
    namespace: 'operator',
    type: 'inference',
    summary: 'Another low-authority interaction observation.',
    relationshipRefs: ['hidden motivation'],
    authorityClass: 'INFERRED',
    relationshipEvidenceClass: 'LOW_AUTHORITY_INTERACTION_INFERENCE',
    personOrParticipant: 'operator',
  });
  const result = buildStephanosMemoryRetrievalPackV1({
    packKind: 'OPERATOR_RELATIONSHIP_PACK',
    records: [neutralSummaryUnsafeTag, neutralSummaryUnsafeMetadata],
    selectors: {},
    budget: { maxRecords: 24, maxBytes: 32768 },
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.selectedRecordIds, []);
  assert.equal(result.sensitiveDataOmitted, true);
  assert.ok(result.omissionReasons.includes('operator-relationship-unsupported-inference-omitted'));
});

test('selectors preserve exact reasons and read-only authority', () => {
  const result = build([record()], {
    selectors: { namespace: 'project', tag: 'product', goalRef: '#1776' },
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.selectedRecordIds, ['record-1']);
  assert.ok(result.selectedRecords[0].selectionReasons.includes('namespace-match'));
  assert.ok(result.selectedRecords[0].selectionReasons.includes('tag-match'));
  assert.ok(result.selectedRecords[0].selectionReasons.includes('goal-match'));
  assert.equal(Object.values(result.authority).every((value) => value === false), true);
});
