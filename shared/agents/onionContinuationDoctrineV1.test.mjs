import test from 'node:test';
import assert from 'node:assert/strict';
import { ONION_TERMINAL_STATE, projectOnionContinuationV1 } from './onionContinuationDoctrineV1.mjs';

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

test('stops only when the original outcome is proven', () => {
  const state = projectOnionContinuationV1({ originalOutcomeProven: true, blockerDepth: 99 });
  assert.equal(state.shouldContinue, false);
  assert.equal(state.terminalState, ONION_TERMINAL_STATE.ORIGINAL_OUTCOME_PROVEN);
});

test('records a genuine boundary rather than pretending completion', () => {
  const state = projectOnionContinuationV1({ hardBoundary: true, blocker: 'QUEST_PLAYTEST_REQUIRED', blockerDepth: 8 });
  assert.equal(state.shouldContinue, false);
  assert.equal(state.terminalState, ONION_TERMINAL_STATE.OPERATOR_PHYSICAL_AUTHORITY_BOUNDARY);
  assert.equal(state.intermediateRepairIsCompletion, false);
});

test('no-safe-repair state remains explicit and re-evaluable', () => {
  const state = projectOnionContinuationV1({ safeRepairAvailable: false, blocker: 'NO_SAFE_PATH', blockerDepth: 14 });
  assert.equal(state.shouldContinue, false);
  assert.equal(state.terminalState, ONION_TERMINAL_STATE.NO_SAFE_REPAIR_CURRENTLY_AVAILABLE);
  assert.equal(state.persistAcrossDaemonCycles, true);
});
