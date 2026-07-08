import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCaptainsBridgeBuildOrchestrator } from './captainsBridgeBuildOrchestrator.mjs';

test('G13 orchestrator selects queued Captain Bridge goal without executing builds', () => {
  const p = projectCaptainsBridgeBuildOrchestrator({ queueRecords: [{ goalId: 'G14', status: 'queued' }] });
  assert.equal(p.selectedGoal, 'G14');
  assert.equal(p.phase, 'NEXT_ACTION');
  assert.equal(p.signals.OPENCLAW_NEEDED, true);
  assert.equal(p.automationExecutesBuilds, false);
  assert.equal(p.autoMergeAllowed, false);
});

test('G13 orchestrator reports active building lane and blocker deterministically', () => {
  const building = projectCaptainsBridgeBuildOrchestrator({ buildLaneManager: { activeLane: { goalId: 'G13', status: 'running', laneId: 'lane-a', latestProof: { status: 'pending' } } } });
  assert.equal(building.phase, 'BUILDING_NOW');
  assert.equal(building.signals.CODEX_NEEDED, true);
  const blocked = projectCaptainsBridgeBuildOrchestrator({ buildLaneManager: { activeLane: { goalId: 'G13', status: 'running', blocker: 'PROOF_MISSING' } } });
  assert.equal(blocked.phase, 'BLOCKER');
  assert.equal(blocked.actor, 'OPERATOR_NEEDED');
});
