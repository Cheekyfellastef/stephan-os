import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const FRESH = '2026-07-24T20:55:00.000Z';
const HEAD = '99c1f95c3b9dc2165284eb74444ade6e94740003';
const OTHER_HEAD = '1111111111111111111111111111111111111111';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'feat/exact-head-proof-binding';

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
function receipt(issue = 1, activePr = 1601, headSha = HEAD) {
  return { issue, activePr, headSha, repository:REPOSITORY, branch:BRANCH };
}

test('merge readiness requires proof and approval bound to goal, PR and exact head', () => {
  const candidate = goal(1, { state:'IMPLEMENTED', activePr:1601, repository:REPOSITORY, branch:BRANCH, proofState:'PASS', headSha:HEAD });
  const missing = buildMissionScheduler({ now:NOW, goals:[candidate] });
  const stale = buildMissionScheduler({ now:NOW, goals:[candidate], proofReceipts:[receipt(1,1601,OTHER_HEAD)] });
  const wrongGoal = buildMissionScheduler({ now:NOW, goals:[candidate], proofReceipts:[receipt(2,1601,HEAD)] });
  const wrongPr = buildMissionScheduler({ now:NOW, goals:[candidate], proofReceipts:[receipt(1,1602,HEAD)] });
  const awaitingApproval = buildMissionScheduler({ now:NOW, goals:[candidate], proofReceipts:[receipt()] });
  const exact = buildMissionScheduler({ now:NOW, goals:[{...candidate, operatorApprovalReceipt:receipt()}], proofReceipts:[receipt()] });

  assert.equal(missing.portfolio[0].lifecycle, 'IMPLEMENTED_NEEDS_PROOF');
  assert.equal(stale.portfolio[0].lifecycle, 'IMPLEMENTED_NEEDS_PROOF');
  assert.equal(wrongGoal.portfolio[0].lifecycle, 'IMPLEMENTED_NEEDS_PROOF');
  assert.equal(wrongPr.portfolio[0].lifecycle, 'IMPLEMENTED_NEEDS_PROOF');
  assert.equal(awaitingApproval.portfolio[0].lifecycle, 'APPROVAL_REQUIRED');
  assert.equal(awaitingApproval.operatorAction, 'OPERATOR_APPROVAL_REQUIRED');
  assert.equal(exact.portfolio[0].lifecycle, 'MERGE_READY');
  assert.equal(exact.selectedGoal, '#1');
  assert.deepEqual(exact.decisionReceipt.proofReceipts, [receipt()]);
});

test('SHA-only proof and approval evidence cannot create merge readiness', () => {
  const result = buildMissionScheduler({
    now:NOW,
    proofHeadShas:[HEAD],
    goals:[goal(1, { state:'IMPLEMENTED', activePr:1601, proofState:'PASS', headSha:HEAD, operatorApprovalHeadSha:HEAD })],
  });
  assert.equal(result.portfolio[0].lifecycle, 'IMPLEMENTED_NEEDS_PROOF');
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
