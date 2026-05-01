import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOpenClawOversightProposal, FORBIDDEN_SELF_ACTIONS } from './openClawOversightProposal.mjs';

test('oversight proposal hard-gates execution and self-modification', () => {
  const proposal = buildOpenClawOversightProposal();
  assert.equal(proposal.executionAllowed, false);
  assert.equal(proposal.selfModificationAllowed, false);
  assert.equal(proposal.operatorApprovalRequired, true);
});

test('oversight proposal always includes canonical forbidden self-actions', () => {
  const proposal = buildOpenClawOversightProposal({ capabilityTrial: { blockers: ['x'] } });
  FORBIDDEN_SELF_ACTIONS.forEach((item) => assert.equal(proposal.forbiddenSelfActions.includes(item), true));
});

test('successful readonly validation advances only to proposal-only trust stage', () => {
  const proposal = buildOpenClawOversightProposal({
    operatorSurface: {
      openClawHealthValidationStatus: 'succeeded',
      openClawHealthState: 'passing',
      openClawHandshakeState: 'compatible',
      openClawProtocolCompatible: true,
      openClawReadonlyAssurance: { readonlyOnly: true },
    },
    capabilityTrial: { trialStatus: 'ready', blockers: [] },
  });
  assert.equal(proposal.trustStage, 'stage_2_proposal_only');
  assert.equal(proposal.nextAction, 'Review OpenClaw oversight proposal before any capability increase.');
  assert.equal(proposal.trustStageLadder.find((x) => x.stage === 'stage_3_operator_reviewed_execution_candidate').futureGated, true);
});

test('blocked state requires blocker resolution before review', () => {
  const proposal = buildOpenClawOversightProposal({ capabilityTrial: { blockers: ['blocked'] } });
  assert.equal(proposal.proposalStatus, 'blocked');
  assert.equal(proposal.nextAction, 'Resolve blockers before proposal review.');
});
