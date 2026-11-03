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
  const building = projectCaptainsBridgeBuildOrchestrator({ buildLaneManager: { activeLane: { goalId: 'G13', status: 'running', prState: 'open', laneId: 'lane-a', latestProof: { status: 'pending' } } } });
  assert.equal(building.phase, 'BUILDING_NOW');
  assert.equal(building.signals.CODEX_NEEDED, true);
  const blocked = projectCaptainsBridgeBuildOrchestrator({ buildLaneManager: { activeLane: { goalId: 'G13', status: 'running', prState: 'open', blocker: 'PROOF_MISSING' } } });
  assert.equal(blocked.phase, 'BLOCKER');
  assert.equal(blocked.actor, 'OPERATOR_NEEDED');
});

test('G13 orchestrator fails closed without explicit open PR state proof', () => {
  for (const activeLane of [
    { goalId: 'G13', status: 'running' },
    { goalId: 'G13', status: 'running', prState: 'unknown' },
    { goalId: 'G13', status: 'running', prState: 'closed' },
    { goalId: 'G13', status: 'running', prState: 'merged' },
  ]) {
    const p = projectCaptainsBridgeBuildOrchestrator({ buildLaneManager: { activeLane } });
    assert.equal(p.phase, 'BLOCKER');
    assert.equal(p.signals.BUILDING_NOW, false);
    assert.match(p.exactNextAction, /explicit open-state proof|only explicit open-state proof/i);
  }
});

test('G13 orchestrator treats only explicit open state as active implementation evidence', () => {
  const p = projectCaptainsBridgeBuildOrchestrator({ buildLaneManager: { activeLane: { goalId: 'G13', status: 'waiting-proof', prState: 'open', latestProof: { status: 'passed' } } } });
  assert.equal(p.phase, 'BUILDING_NOW');
  assert.equal(p.actor, 'OPERATOR_NEEDED');
});

test('G13 orchestrator preserves runtime and claimed-head blocker strings', () => {
  const p = projectCaptainsBridgeBuildOrchestrator({
    runtimeBlockers: ['Battle Bridge proof required.'],
    buildLaneManager: { activeLane: { goalId: 'G13', status: 'running', prState: 'open', blockers: ['claimed-head drift: PR head changed.'] } },
  });
  assert.equal(p.phase, 'BLOCKER');
  assert.match(p.exactNextAction, /Battle Bridge proof required/);
  assert.match(p.exactNextAction, /claimed-head drift: PR head changed/);
});


test('G13 orchestrator vetoes terminal PR states despite stale open hints', () => {
  const base = { goalId: 'G13', status: 'running', prOpen: true };
  const negatives = [
    { prState: 'closed' }, { prState: 'merged' },
    { pullRequest: { state: 'MERGED', isOpen: true } },
    { pullRequestState: 'CLOSED' }, { pr: { state: 'closed', isOpen: true } },
    { githubPrEvidence: { state: 'MERGED' } },
    { stateEvidence: { prState: 'closed' } },
    { state: 'CLOSED' }, { state: 'MERGED' },
    { prState: 'open', pullRequest: { state: 'MERGED' } },
    { prState: 'open', prOpen: false },
  ];
  for (const stateEvidence of negatives) {
    const lane = { ...base, ...stateEvidence };
    const p = projectCaptainsBridgeBuildOrchestrator({ buildLaneManager: { activeLane: lane } });
    assert.equal(p.phase, 'BLOCKER', JSON.stringify(lane));
    assert.equal(p.signals.BUILDING_NOW, false, JSON.stringify(lane));
  }
});

test('G13 orchestrator accepts top-level PR OPEN without confusing running lane status', () => {
  const wrap = activeLane => projectCaptainsBridgeBuildOrchestrator({ buildLaneManager: { activeLane } });
  for (const status of ['running', 'dispatched', 'waiting-proof']) {
    assert.equal(wrap({ goalId: 'G13', status, state: 'OPEN' }).phase, 'BUILDING_NOW');
    assert.equal(wrap({ goalId: 'G13', status, prState: 'OPEN' }).phase, 'BUILDING_NOW');
    assert.equal(wrap({ goalId: 'G13', status, prOpen: true }).phase, 'BUILDING_NOW');
    assert.equal(wrap({ goalId: 'G13', status, state: 'running' }).phase, 'BLOCKER');
  }
});
