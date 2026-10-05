import test from 'node:test';
import assert from 'node:assert/strict';
import { ONION_TERMINAL_STATE, projectOnionContinuationV1 } from './onionContinuationDoctrineV1.mjs';

function terminalPacket(identity, overrides = {}) {
  return {
    originalOutcomeId: 'automatic-building',
    terminalIdentity: identity,
    evidenceRefs: ['proof:end-to-end'],
    terminalOwner: '#1903',
    terminalAction: 'reconcile-parent-outcome',
    reEvaluationTrigger: 'next-core-daemon-cycle',
    ...overrides,
  };
}

test('continues through arbitrary blocker depth while original outcome is false', () => {
  const state = projectOnionContinuationV1({
    originalOutcomeId: 'automatic-building',
    blocker: 'LAYER_763',
    blockerDepth: 763,
    originalOutcomeProven: false,
    safeRepairAvailable: true,
  });
  assert.equal(state.shouldContinue, true);
  assert.equal(state.nextBlockerDepth, 764);
  assert.equal(state.arbitraryDepthLimitAllowed, false);
  assert.equal(state.intermediateRepairIsCompletion, false);
  assert.equal(state.replayOriginalOutcomeAfterRepair, true);
  assert.equal(state.teachFlywheelAfterVerifiedRepair, true);
});

test('stops only when the original outcome is proven by a bound evidence packet', () => {
  const state = projectOnionContinuationV1({
    ...terminalPacket('automatic-building'),
    originalOutcomeProven: true,
    blockerDepth: 99,
  });
  assert.equal(state.shouldContinue, false);
  assert.equal(state.terminalPacketValid, true);
  assert.equal(state.terminalState, ONION_TERMINAL_STATE.ORIGINAL_OUTCOME_PROVEN);
});

test('bare completion booleans fail closed and continuation remains active', () => {
  const state = projectOnionContinuationV1({ originalOutcomeProven: true, blockerDepth: 99 });
  assert.equal(state.shouldContinue, true);
  assert.equal(state.terminalRequestRejected, true);
  assert.equal(state.terminalState, '');
});

test('records a genuine boundary only with bound identity, evidence, owner, action and re-evaluation', () => {
  const state = projectOnionContinuationV1({
    ...terminalPacket('QUEST_PLAYTEST_REQUIRED', {
      terminalAction: 'operator-performs-physical-playtest',
      reEvaluationTrigger: 'playtest-evidence-arrives',
    }),
    hardBoundary: true,
    boundaryId: 'QUEST_PLAYTEST_REQUIRED',
    blocker: 'QUEST_PLAYTEST_REQUIRED',
    blockerDepth: 8,
  });
  assert.equal(state.shouldContinue, false);
  assert.equal(state.terminalState, ONION_TERMINAL_STATE.OPERATOR_PHYSICAL_AUTHORITY_BOUNDARY);
  assert.equal(state.intermediateRepairIsCompletion, false);
});

test('no-safe-repair state requires a precise re-evaluable evidence packet', () => {
  const state = projectOnionContinuationV1({
    ...terminalPacket('NO_SAFE_PATH', {
      terminalAction: 'retain-owner-and-research-safe-path',
      reEvaluationTrigger: 'new-capability-or-evidence',
    }),
    safeRepairAvailable: false,
    noSafeRepairId: 'NO_SAFE_PATH',
    blocker: 'NO_SAFE_PATH',
    blockerDepth: 14,
  });
  assert.equal(state.shouldContinue, false);
  assert.equal(state.terminalState, ONION_TERMINAL_STATE.NO_SAFE_REPAIR_CURRENTLY_AVAILABLE);
  assert.equal(state.persistAcrossDaemonCycles, true);
});

test('mismatched terminal identity cannot stop the parent outcome', () => {
  const state = projectOnionContinuationV1({
    ...terminalPacket('different-outcome'),
    originalOutcomeProven: true,
  });
  assert.equal(state.shouldContinue, true);
  assert.equal(state.terminalPacketValid, false);
  assert.equal(state.terminalRequestRejected, true);
});
