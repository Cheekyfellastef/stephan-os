import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_COGNITIVE_CONTEXT_SCHEMA_VERSION,
  buildStephanosCognitiveContextV1,
} from './stephanosCognitiveContextAssemblerV1.mjs';
import {
  STEPHANOS_PROSPECTIVE_MEMORY_SCHEMA_VERSION,
} from './stephanosProspectiveMemoryV1.mjs';

const NOW = '2026-09-24T23:20:00.000Z';

function memory(overrides = {}) {
  return {
    recordId: 'memory-continuity-1',
    namespace: 'continuity',
    type: 'conversation',
    source: 'shared-workspace',
    summary: 'The operator wants Stephanos to resume the current cognition build without re-teaching the project.',
    tags: ['continuity'],
    relationshipRefs: [],
    observedAtUtc: '2026-09-24T23:00:00.000Z',
    updatedAtUtc: '2026-09-24T23:00:00.000Z',
    authorityClass: 'SHARED_AUTHORITY',
    freshness: 'FRESH',
    currentState: 'CURRENT',
    proofRefs: ['shared-workspace://memory/continuity-1'],
    sourceRefs: ['memory://continuity/continuity-1'],
    relatedGoalRef: '#1308',
    relatedPrRef: '',
    component: 'project-intelligence',
    personOrParticipant: 'stephanos',
    relationshipEvidenceClass: 'NOT_RELATIONSHIP',
    ...overrides,
  };
}

function relationship(overrides = {}) {
  return memory({
    recordId: 'memory-relationship-1',
    namespace: 'operator',
    type: 'relationship',
    summary: 'The operator explicitly prefers one continuous Stephanos identity across provider changes.',
    tags: ['relationship'],
    relationshipRefs: ['operator-explicit-preference'],
    relationshipEvidenceClass: 'EXPLICIT_OPERATOR',
    ...overrides,
  });
}

function prospectiveRecord(overrides = {}) {
  return memory({
    recordId: 'memory-prospective-1',
    namespace: 'continuity',
    type: 'open-loop',
    summary: 'Resume the identity and live-cognition activation work after the protected merge gate.',
    tags: ['prospective'],
    ...overrides,
  });
}

function openLoop(overrides = {}) {
  return {
    schemaVersion: STEPHANOS_PROSPECTIVE_MEMORY_SCHEMA_VERSION,
    loopId: 'loop-consciousness-activation',
    continuityKey: 'consciousness-activation',
    loopClass: 'OPEN_THREAD',
    origin: 'OPERATOR_REQUEST',
    promotionState: 'CONFIRMED',
    summary: 'Continue connecting Stephanos grounded awareness, identity and governed memory.',
    whyItMatters: 'The operator wants one continuous evidence-grounded Stephanos conversation.',
    state: 'OPEN',
    authorityClass: 'SHARED_AUTHORITY',
    freshness: 'FRESH',
    openedAtUtc: '2026-09-24T22:00:00.000Z',
    dueAtUtc: null,
    closedAtUtc: null,
    triggerKind: 'ON_OPERATOR_RETURN',
    triggerRefs: [],
    ownerRef: 'goal://1308',
    sourceRefs: ['operator://request/stephanos-consciousness'],
    proofRefs: ['evidence://cognition-activation-thread'],
    supersedesLoopId: null,
    supersededByLoopId: null,
    ...overrides,
  };
}

test('assembles verified continuity, relationship and confirmed open-loop context without mutation authority', () => {
  const result = buildStephanosCognitiveContextV1({
    asOfUtc: NOW,
    memoryRecords: [memory(), relationship(), prospectiveRecord()],
    openLoops: [openLoop()],
  });

  assert.equal(result.schemaVersion, STEPHANOS_COGNITIVE_CONTEXT_SCHEMA_VERSION);
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'READY');
  assert.equal(result.verifiedMemory.length, 3);
  assert.equal(result.unverifiedMemory.length, 0);
  assert.equal(result.confirmedOpenLoops.length, 1);
  assert.match(result.contextBlock, /verifiedMemory:/);
  assert.match(result.contextBlock, /confirmedOpenLoops: OPEN_THREAD:/);
  assert.equal(result.authority.memoryWriteAllowed, false);
  assert.equal(result.authority.autoDispatchAllowed, false);
  assert.equal(result.authority.sourceMutationAllowed, false);
});

test('lower-authority and stale records never enter verified memory', () => {
  const result = buildStephanosCognitiveContextV1({
    asOfUtc: NOW,
    memoryRecords: [
      memory({ recordId: 'memory-inferred', authorityClass: 'INFERRED' }),
      relationship({ recordId: 'memory-stale', authorityClass: 'STALE_EVIDENCE', freshness: 'STALE' }),
    ],
    openLoops: [],
  });

  assert.equal(result.valid, true);
  assert.equal(result.verifiedMemory.length, 0);
  assert.equal(result.unverifiedMemory.length, 2);
  assert.match(result.contextBlock, /Treat unverifiedMemory only as lower-authority context/);
});

test('model-proposed prospective loops cannot self-promote into confirmed conversation continuity', () => {
  const result = buildStephanosCognitiveContextV1({
    asOfUtc: NOW,
    memoryRecords: [],
    openLoops: [openLoop({
      loopId: 'loop-model',
      continuityKey: 'model-proposal',
      origin: 'MODEL_PROPOSAL',
      promotionState: 'CANDIDATE',
      authorityClass: 'INFERRED',
    })],
  });

  assert.equal(result.valid, true);
  assert.equal(result.confirmedOpenLoops.length, 0);
  assert.equal(result.prospectiveMemory.candidateOpenLoops.length, 1);
});

test('conflicting memory remains explicit and is excluded from verified facts', () => {
  const conflicting = memory({
    recordId: 'memory-conflict',
    freshness: 'CONFLICTING',
  });
  const result = buildStephanosCognitiveContextV1({
    asOfUtc: NOW,
    memoryRecords: [conflicting],
    openLoops: [],
  });

  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'READY_WITH_CONTRADICTIONS');
  assert.equal(result.verifiedMemory.length, 0);
  assert.equal(result.unverifiedMemory.length, 1);
  assert.deepEqual(result.contradictions, ['memory-conflict']);
  assert.match(result.contextBlock, /contradictions: memory-conflict/);
});

test('unsafe or malformed specialist memory fails closed instead of being smoothed into context', () => {
  const result = buildStephanosCognitiveContextV1({
    asOfUtc: NOW,
    memoryRecords: [memory({ summary: 'Read /root/private.json for context.' })],
    openLoops: [],
  });

  assert.equal(result.valid, false);
  assert.equal(result.verdict, 'SAFE_HOLD');
  assert.equal(result.contextBlock, '');
  assert.ok(result.validationErrors.some((error) => error.includes('summary-sensitive-or-invalid')));
});

test('unknown top-level input fields fail closed', () => {
  const result = buildStephanosCognitiveContextV1({
    asOfUtc: NOW,
    memoryRecords: [],
    openLoops: [],
    rawMemoryDump: true,
  });

  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.includes('input:unknown-field:rawMemoryDump'));
});
