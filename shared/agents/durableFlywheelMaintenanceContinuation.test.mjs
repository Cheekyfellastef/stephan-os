import test from 'node:test';
import assert from 'node:assert/strict';
import { runDurableFlywheelStartupCycle } from './durableFlywheelControllerVNext.mjs';

for (const learningThrows of [false, true]) {
  test('unsettled Core repair retains heartbeat and incident learning without affected authority steps' + (learningThrows ? ' when learning fails' : ''), async () => {
    const calls = [], receipts = [], heartbeats = [];
    const forbidden = async () => { calls.push('forbidden'); throw new Error('Authority phase entered during repair uncertainty'); };
    const result = await runDurableFlywheelStartupCycle({
      publishControllerHeartbeat: async value => { heartbeats.push(value); return { ok: true }; },
      promoteIncidentLessons: async options => {
        calls.push('learning'); assert.equal(options.maxPromotions, 2);
        if (learningThrows) throw new Error('Optional lesson storage failure');
        return { ok: true, promotedLessonIds: ['original-incident'] };
      },
      publishReceipt: async value => { receipts.push(value); return { ok: true }; },
      publishOutcomeOwnershipSeed: forbidden, runRecurringCalibrationReadiness: forbidden,
      publishWorkspaceIntegritySeedPressure: forbidden, reconcileLearningGoals: forbidden,
      loadAuthoritativeProjection: forbidden, closeReadyGoal: forbidden,
      finalizeTerminalLane: forbidden, ensureBacklogMission: forbidden,
      recoverOrphanedBacklogMission: forbidden, loadCapacityRoutingInput: forbidden,
      resolveCapacityCandidates: forbidden, readMissionRecord: forbidden,
    }, {
      sourceRevision: 'a'.repeat(40), nowUtc: '2026-11-17T09:00:00.000Z', env: {},
      maintenanceContinuationHold: { blocker: 'CORE_REPAIR_ORIGINAL_RESULT_UNPROVEN' },
    });
    assert.deepEqual(calls, ['learning']);
    assert.deepEqual(heartbeats.map(value => value.cycleState), ['RECONCILING', 'HOLD']);
    assert.equal(result.maintenanceContinuationHeld, true);
    assert.equal(result.allowWorkerTick, false); assert.equal(result.boundedMutationSteps, 0);
    assert.equal(result.learningPromotion.ok, !learningThrows);
    assert.equal(receipts.length, 1); assert.equal(receipts[0].workerActionGrantId, null);
    assert.equal(receipts[0].goalClosureState, null); assert.equal(receipts[0].boundedMutationSteps, 0);
    assert.deepEqual(result.blockers, ['CORE_REPAIR_ORIGINAL_RESULT_UNPROVEN']);
  });
}

test('malformed hold context cannot reopen an authority phase or publish arbitrary blocker text', async () => {
  let authorityCalls = 0;
  const result = await runDurableFlywheelStartupCycle({
    publishControllerHeartbeat: async () => ({ ok: true }),
    promoteIncidentLessons: async () => ({ ok: true }), publishReceipt: async () => ({ ok: true }),
    loadAuthoritativeProjection: async () => { authorityCalls++; return {}; },
  }, { sourceRevision: 'a'.repeat(40), maintenanceContinuationHold: { blocker: '../../arbitrary' } });
  assert.equal(authorityCalls, 0); assert.equal(result.allowWorkerTick, false);
  assert.deepEqual(result.blockers, ['CORE_REPAIR_CONTINUATION_UNPROVEN']);
});
