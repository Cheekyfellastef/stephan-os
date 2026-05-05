import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawDelegatedMission } from './openClawDelegationModel.js';

test('default OpenClaw delegation is research/planning-only and blocks execution authorities', () => {
  const model = buildOpenClawDelegatedMission({ missionId: 'm1', operatorIntent: 'Delegate OpenClaw research and planning.' });
  assert.equal(model.delegatedTo, 'openclaw');
  assert.equal(model.researchAllowed, true);
  assert.equal(model.repoInspectionAllowed, true);
  assert.equal(model.codexHandoffDraftAllowed, true);
  assert.equal(model.mutationAllowed, false);
  assert.equal(model.shellAllowed, false);
  assert.equal(model.gitPushAllowed, false);
  assert.equal(model.mergeAllowed, false);
  assert.equal(model.secretsAllowed, false);
  assert.equal(model.externalAccountAllowed, false);
  assert.equal(model.selfAuthorityEscalationAllowed, false);
  assert.equal(model.requiredOperatorApproval, true);
});

test('self-control intent is allowed only as research/proposal and no self-authority grant', () => {
  const model = buildOpenClawDelegatedMission({ missionId: 'm2', operatorIntent: 'OpenClaw should design its own control-system.' });
  assert.equal(model.openClawRelated, true);
  assert.match(model.reason, /cannot approve\/grant\/persist\/execute authority/i);
  assert.match(model.selfControlConstructionCanon, /cannot approve, grant, persist, or execute new authority/i);
});
