import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOpenClawProposalRisk } from './openClawProposalRisk.mjs';

test('risk classifier blocks dangerous actions', () => {
  const blocked = classifyOpenClawProposalRisk({ proposedActions: ['execute_command:rm'] });
  assert.equal(blocked.riskLevel, 'blocked');
  const guarded = classifyOpenClawProposalRisk({ proposedActions: ['propose_ui_change'] });
  assert.equal(guarded.riskLevel, 'guarded');
});
