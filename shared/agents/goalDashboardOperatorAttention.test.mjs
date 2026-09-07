import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoalDashboardApprovalDecisions,
  buildGoalDashboardMaintenanceActions,
  buildGoalDashboardOperatorAttention,
} from './goalDashboardOperatorAttention.mjs';
import {
  createOperatorReviewParkingPacketV1,
} from './operatorReviewParkingRefillV1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const BASE = 'c'.repeat(40);

test('stale evidence is routed to Codex and Housekeeper, not mislabeled as operator approval', () => {
  const attention = buildGoalDashboardOperatorAttention({
    goals: [{ issue: '#1287', title: 'Shared Workspace truth', statusTruth: 'UNKNOWN', proofTruth: 'UNKNOWN', blockers: ['UNKNOWN_PROOF_RECORD'], exactNextAction: 'Publish the missing proof record.' }],
    blockers: ['UNKNOWN_PROOF_RECORD'],
  });

  assert.equal(attention.approvals.length, 0);
  assert.equal(attention.maintenanceActions.length, 1);
  assert.equal(attention.maintenanceActions[0].owner, 'codex-housekeeper');
  assert.equal(attention.maintenanceActions[0].operatorDecisionRequired, false);
  assert.equal(attention.parkedReviewBatch.readyCount, 0);
});

test('only an exact-head approval-ready live pull request becomes an operator decision', () => {
  const decisions = buildGoalDashboardApprovalDecisions([
    { source: 'github-live-open-pr', state: 'APPROVAL_REQUIRED', issue: 'PR #2032', prNumber: 2032, exactHead: HEAD },
    { source: 'github-live-open-pr', state: 'VERIFYING', issue: 'PR #2033', prNumber: 2033, exactHead: HEAD },
    { source: 'github-live-open-pr', state: 'APPROVAL_REQUIRED', issue: 'PR #2034', prNumber: 2034, exactHead: 'unknown' },
  ]);

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decisionId, 'merge-pr-2032-aaaaaaaaaaaa');
  assert.equal(decisions[0].relatedPr, '#2032');
  assert.equal(decisions[0].expectedHeadSha, HEAD);
  assert.equal(decisions[0].requiresOperator, true);
});

test('approval-ready work is excluded from routine maintenance cards', () => {
  const actions = buildGoalDashboardMaintenanceActions([
    { source: 'github-live-open-pr', state: 'APPROVAL_REQUIRED', issue: 'PR #2032', prNumber: 2032, exactHead: HEAD, statusTruth: 'CURRENT', proofTruth: 'CURRENT' },
  ]);
  assert.deepEqual(actions, []);
});

test('current parked protected-merge packets appear in the existing operator attention while builder capacity stays released', () => {
  const packet = createOperatorReviewParkingPacketV1({
    parkingId: 'parking-goal-1947-pr-2110',
    missionId: 'mission-goal-1947-pr-2110',
    goalId: 'goal-1947',
    correlationId: 'corr-goal-1947-pr-2110',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1947,
    goalTitle: 'Goal: Provider-Neutral Execution Compatibility Shims and Continuous Capacity Refill V1',
    prNumber: 2110,
    prTitle: 'Park operator-ready goals and refill construction capacity',
    branch: 'agent/operator-review-parking-refill-v1',
    exactHead: HEAD,
    exactTree: TREE,
    exactBase: BASE,
    changedPaths: ['shared/agents/operatorReviewParkingRefillV1.mjs'],
    requiredAuthorityClass: 'PROTECTED_MERGE',
    checksProofRefs: ['proof/checks-pr-2110.json'],
    reviewProofRefs: ['proof/review-pr-2110.json'],
    proofRefs: ['proof/parking-pr-2110.json'],
    parkedAtUtc: '2026-09-03T13:30:00Z',
    leaseIds: ['lease-goal-1947-pr-2110'],
    nextOperatorAction: 'Review the exact protected merge packet for PR #2110.',
  });
  const attention = buildGoalDashboardOperatorAttention({
    parkedReviewEntries: [{
      packet,
      current: {
        repository: packet.repository,
        prNumber: packet.prNumber,
        branch: packet.branch,
        exactHead: packet.exactHead,
        exactTree: packet.exactTree,
        exactBase: packet.exactBase,
        changedPaths: packet.changedPaths,
        state: 'OPEN',
        checksCurrent: true,
        reviewCurrent: true,
        unresolvedThreads: 0,
        observedAtUtc: '2026-09-03T13:35:00Z',
      },
    }],
  });

  assert.equal(attention.parkedReviewBatch.readyCount, 1);
  assert.equal(attention.parkedReviewBatch.parkedBuilderCapacityConsumed, 0);
  assert.equal(attention.approvals.length, 1);
  assert.equal(attention.approvals[0].relatedPr, '#2110');
  assert.equal(attention.approvals[0].expectedHeadSha, HEAD);
  assert.match(attention.exactNextAction, /construction capacity remains released/i);
});

test('drifted parked packets move to reproving and are not shown as an approval decision', () => {
  const packet = createOperatorReviewParkingPacketV1({
    parkingId: 'parking-goal-2002-pr-2111',
    missionId: 'mission-goal-2002-pr-2111',
    goalId: 'goal-2002',
    correlationId: 'corr-goal-2002-pr-2111',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2002,
    goalTitle: 'Goal: Stephanos Goal Building Agent and 100% Programme Operations V1',
    prNumber: 2111,
    prTitle: 'Wire work-conserving Goal Building Agent parking projection',
    branch: 'agent/goal-building-agent-parking-v1',
    exactHead: HEAD,
    exactTree: TREE,
    exactBase: BASE,
    changedPaths: ['shared/agents/goalBuildingAgentParkingProjectionV1.mjs'],
    requiredAuthorityClass: 'PROTECTED_MERGE',
    checksProofRefs: ['proof/checks-pr-2111.json'],
    reviewProofRefs: ['proof/review-pr-2111.json'],
    proofRefs: ['proof/parking-pr-2111.json'],
    parkedAtUtc: '2026-09-03T13:31:00Z',
    leaseIds: ['lease-goal-2002-pr-2111'],
    nextOperatorAction: 'Review the exact protected merge packet for PR #2111.',
  });
  const attention = buildGoalDashboardOperatorAttention({
    parkedReviewEntries: [{
      packet,
      current: {
        repository: packet.repository,
        prNumber: packet.prNumber,
        branch: packet.branch,
        exactHead: 'd'.repeat(40),
        exactTree: packet.exactTree,
        exactBase: packet.exactBase,
        changedPaths: packet.changedPaths,
        state: 'OPEN',
        checksCurrent: false,
        reviewCurrent: true,
        unresolvedThreads: 0,
        observedAtUtc: '2026-09-03T13:35:00Z',
      },
    }],
  });

  assert.equal(attention.parkedReviewBatch.readyCount, 0);
  assert.equal(attention.parkedReviewBatch.reproveCount, 1);
  assert.equal(attention.approvals.length, 0);
});
