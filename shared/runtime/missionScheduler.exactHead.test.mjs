import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const FRESH = '2026-07-24T20:55:00.000Z';
const HEAD = '99c1f95c3b9dc2165284eb74444ade6e94740003';
const OTHER_HEAD = '1111111111111111111111111111111111111111';

function goal(issue, overrides = {}) {
  return {
    issue,
    title: `Goal ${issue}`,
    state: 'QUEUED',
    prerequisites: [],
    priority: 1,
    criticalPathWeight: 1,
    reversibility: 'HIGH',
    route: 'CHATGPT_GITHUB',
    evidenceAt: FRESH,
    ...overrides,
  };
}

test('merge readiness requires proof and approval bound to the current exact head', () => {
  const candidate = goal(1, { state:'IMPLEMENTED', activePr:1601, proofState:'PASS', headSha:HEAD });
  const missing = buildMissionScheduler({ now:NOW, goals:[candidate], proofHeadShas:[] });
  const stale = buildMissionScheduler({ now:NOW, goals:[candidate], proofHeadShas:[OTHER_HEAD] });
  const awaitingApproval = buildMissionScheduler({ now:NOW, goals:[candidate], proofHeadShas:[HEAD] });
  const exact = buildMissionScheduler({ now:NOW, goals:[{...candidate, operatorApprovalHeadSha:HEAD}], proofHeadShas:[HEAD] });

  assert.equal(missing.portfolio[0].lifecycle, 'IMPLEMENTED_NEEDS_PROOF');
  assert.equal(stale.portfolio[0].lifecycle, 'IMPLEMENTED_NEEDS_PROOF');
  assert.equal(awaitingApproval.portfolio[0].lifecycle, 'APPROVAL_REQUIRED');
  assert.equal(awaitingApproval.operatorAction, 'OPERATOR_APPROVAL_REQUIRED');
  assert.equal(exact.portfolio[0].lifecycle, 'MERGE_READY');
  assert.equal(exact.selectedGoal, '#1');
  assert.deepEqual(exact.decisionReceipt.proofHeadShas, [HEAD]);
});

test('completed goals remain approval gated before closure', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1, { state:'COMPLETE', approvalRequired:true })] });
  assert.equal(result.portfolio[0].lifecycle, 'APPROVAL_REQUIRED');
  assert.equal(result.selectedGoal, null);
  assert.equal(result.operatorAction, 'OPERATOR_APPROVAL_REQUIRED');
});

test('conflicting active claims are withheld from ACTIVE portfolio projection', () => {
  const result = buildMissionScheduler({
    now:NOW,
    goals:[
      goal(1, { state:'ACTIVE', activePr:1601 }),
      goal(2, { state:'IMPLEMENTING', branch:'feature/two' }),
    ],
  });
  assert.equal(result.failClosed, true);
  assert.equal(result.activeGoal, null);
  assert.equal(result.portfolio.some(({ lifecycle }) => lifecycle === 'ACTIVE'), false);
  assert.ok(result.contradictions.some(({ code }) => code === 'MULTIPLE_ACTIVE_LANES'));
});

test('malformed exact-head proof evidence fails closed', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1)], proofHeadShas:['not-a-sha'] });
  assert.equal(result.failClosed, true);
  assert.ok(result.contradictions.some(({ code }) => code === 'INVALID_PROOF_HEAD_EVIDENCE'));
});