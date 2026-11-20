import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedWorkspaceEventRecord } from './sharedAgentWorkspaceStore.mjs';
import {
  extractSovereignNativeCapabilityGapsV1,
  SOVEREIGN_NATIVE_GAP_MAX_CANDIDATES,
  SOVEREIGN_NATIVE_GAP_MAX_RETAINED,
} from './sovereignCommanderNativeGapIntakeV1.mjs';

function nativeEvent(capabilityId, eventId, overrides = {}) {
  return createSharedWorkspaceEventRecord({
    eventId,
    participantId: overrides.participantId || 'sovereign-commander',
    timestampUtc: overrides.timestampUtc || '2026-10-12T11:00:00.000Z',
    eventKind: 'capability-gap',
    summary: 'Bounded capability gap discovered by Sovereign Commander.',
    capabilityFailure: {
      failureClass: overrides.failureClass || 'CAPABILITY_GAP',
      genuineCapabilityFailure: overrides.genuineCapabilityFailure ?? true,
      capabilityId,
      attemptedBy: overrides.attemptedBy || 'sovereign-commander',
      targetRefs: overrides.targetRefs || ['goal:#2573'],
    },
  });
}

test('valid self-discovered learning failures create bounded, deduplicated drafts without external Commander', () => {
  const e = nativeEvent('windows-service-ownership', 'sovereign-gap-one');
  const result = extractSovereignNativeCapabilityGapsV1([e, e], {
    nowUtc: '2026-10-12T11:10:00.000Z',
  });
  assert.equal(result.candidateTotalCount, 1);
  assert.equal(result.candidateCount, 1);
  assert.equal(result.gaps[0].capabilityId, 'windows-service-ownership');
  assert.equal(result.gaps[0].observationCount, 1);
  assert.deepEqual(result.gaps[0].evidenceEventIds, ['sovereign-gap-one']);
  assert.equal(result.gaps[0].sourceIsRuntimeParityProof, false);
  assert.equal(result.automaticAdmissionAllowed, false);
  assert.equal(result.arbitraryShellAllowed, false);
});

test('reject forged, unrelated, stale, future and non-gap events without source approval', () => {
  const reference = nativeEvent('windows-service-ownership', 'sovereign-gap-one');
  const bad = [
    { ...reference, participantId: 'openclaw-standalone' },
    { ...reference, kind: 'stephanos.shared_workspace.status' },
    { ...reference, closedLoopLearning: { ...reference.closedLoopLearning, attemptedBy: 'openclaw-standalone' } },
    { ...reference, closedLoopLearning: { ...reference.closedLoopLearning, genuineCapabilityFailure: false } },
    { ...reference, closedLoopLearning: { ...reference.closedLoopLearning, failureClass: 'TRANSIENT_FAILURE' } },
    { ...reference, closedLoopLearning: { ...reference.closedLoopLearning, targetRefs: ['goal:#2670'] } },
    { ...reference, timestampUtc: '2026-09-01T11:00:00.000Z' },
    { ...reference, timestampUtc: '2026-10-13T11:00:00.000Z' },
    { ...reference, eventId: 'C:/private/secret' },
    { ...reference, closedLoopLearning: null },
    { ...reference, closedLoopLearning: { ...reference.closedLoopLearning, capabilityId: '../../../secret' } },
  ];
  const result = extractSovereignNativeCapabilityGapsV1(bad, { nowUtc: '2026-10-12T11:10:00.000Z' });
  assert.equal(result.candidateCount, 0);
  assert.equal(result.finalVerdict, 'SOVEREIGN_NATIVE_GAP_NO_QUALIFIED_EVENTS');
});

test('retains the same uncompleted native gap after its original discovery event expires', () => {
  const old = nativeEvent('windows-service-ownership', 'sovereign-gap-one');
  const first = extractSovereignNativeCapabilityGapsV1([old], {
    nowUtc: '2026-10-12T11:10:00.000Z',
  });
  const later = extractSovereignNativeCapabilityGapsV1([old], {
    nowUtc: '2026-10-22T11:10:00.000Z', priorGaps: first.gaps,
  });
  assert.equal(later.candidateCount, 1);
  assert.equal(later.gaps[0].capabilityId, 'windows-service-ownership');
  assert.equal(later.gaps[0].constructionAdmissionAllowed, false);
  assert.equal(later.proofOfNewExecutableCapability, false);
  const denied = extractSovereignNativeCapabilityGapsV1([], {
    nowUtc: '2026-10-22T11:10:00.000Z',
    priorGaps: [{ ...first.gaps[0], sourceIsRuntimeParityProof: true }],
  });
  assert.equal(denied.candidateCount, 0);
});

test('large native learning history reports truncation but does not make a new scheduler', () => {
  const events = Array.from({ length: 20 }, (_, i) =>
    nativeEvent(`bounded-gap-${i}`, `sovereign-gap-${i}`));
  const result = extractSovereignNativeCapabilityGapsV1(events, {
    nowUtc: '2026-10-12T11:10:00.000Z',
  });
  assert.equal(result.candidateTotalCount, 20);
  assert.equal(result.candidateCount, SOVEREIGN_NATIVE_GAP_MAX_CANDIDATES);
  assert.equal(result.candidatesTruncated, true);
  assert.equal(result.retainedCount, 20);
  assert.equal(result.retentionTruncated, false);
  const aged = extractSovereignNativeCapabilityGapsV1([], {
    nowUtc: '2026-10-22T11:10:00.000Z', priorGaps: result.retainedGaps,
  });
  assert.equal(aged.candidateTotalCount, 20, 'older waiting gaps are not discarded');
  assert.equal(aged.retainedCount, 20);
  assert.equal(aged.candidateCount, SOVEREIGN_NATIVE_GAP_MAX_CANDIDATES);
  assert.equal(aged.constructionAdmissionAllowed, undefined);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.proofOfNewExecutableCapability, false);
});


test('native inventory overflow fails closed rather than silently completing proposals', () => {
  const events = Array.from({ length: SOVEREIGN_NATIVE_GAP_MAX_RETAINED + 1 }, (_, i) =>
    nativeEvent(`retained-gap-${String(i).padStart(3, '0')}`, `sovereign-overflow-${i}`));
  const first = extractSovereignNativeCapabilityGapsV1(events, {
    nowUtc: '2026-10-12T11:10:00.000Z',
  });
  assert.equal(first.candidateTotalCount, SOVEREIGN_NATIVE_GAP_MAX_RETAINED + 1);
  assert.equal(first.retainedCount, SOVEREIGN_NATIVE_GAP_MAX_RETAINED);
  assert.equal(first.retentionTruncated, true);
  assert.equal(first.automaticAdmissionAllowed, false);
  const later = extractSovereignNativeCapabilityGapsV1([], {
    nowUtc: '2026-10-22T11:10:00.000Z', priorGaps: first.retainedGaps,
  });
  assert.equal(later.retainedCount, SOVEREIGN_NATIVE_GAP_MAX_RETAINED);
  assert.equal(later.automaticAdmissionAllowed, false);
});
