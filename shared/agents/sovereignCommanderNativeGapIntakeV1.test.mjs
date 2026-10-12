import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedWorkspaceEventRecord } from './sharedAgentWorkspaceStore.mjs';
import {
  extractSovereignNativeCapabilityGapsV1,
  SOVEREIGN_NATIVE_GAP_MAX_CANDIDATES,
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

test('large native learning history reports truncation but does not make a new scheduler', () => {
  const events = Array.from({ length: 20 }, (_, i) =>
    nativeEvent(`bounded-gap-${i}`, `sovereign-gap-${i}`));
  const result = extractSovereignNativeCapabilityGapsV1(events, {
    nowUtc: '2026-10-12T11:10:00.000Z',
  });
  assert.equal(result.candidateTotalCount, 20);
  assert.equal(result.candidateCount, SOVEREIGN_NATIVE_GAP_MAX_CANDIDATES);
  assert.equal(result.candidatesTruncated, true);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.proofOfNewExecutableCapability, false);
});
