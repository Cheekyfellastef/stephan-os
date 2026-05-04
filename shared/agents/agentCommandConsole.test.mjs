import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentTaskProjection } from './agentTaskProjection.mjs';
import { buildAgentCommandConsoleProjection } from './agentCommandConsole.mjs';

test('agent command console projection stays non-executing and exposes codex manual mode', ()=>{
  const agentTaskProjection = buildAgentTaskProjection();
  const model = buildAgentCommandConsoleProjection({ agentTaskProjection });
  assert.equal(model.executionAllowed, false);
  assert.equal(model.openClawExecutionAllowed, false);
  assert.equal(model.approvalRequired, true);
  assert.equal(model.codexExecutionMode, 'manual_prompt');
});

test('agent command console projection selects proposal review when codex export is generated', ()=>{
  const agentTaskProjection = buildAgentTaskProjection({ context: { openClawReviewDecision: { reviewDecision: 'ready_for_codex_review' } } });
  const model = buildAgentCommandConsoleProjection({ agentTaskProjection });
  assert.match(model.commandConsoleMode, /(proposal_review|blocked)/);
  assert.equal(typeof model.nextBestAction, 'string');
});

test('agent command console is ready when operator review queue is ready', ()=>{
  const agentTaskProjection = buildAgentTaskProjection();
  agentTaskProjection.operatorSurface.blockers = ['legacy adapter stub blocker'];
  agentTaskProjection.operatorSurface.openClawOperatorReviewQueue = { queueStatus: 'ready_for_operator_review' };
  agentTaskProjection.operatorSurface.openClawProposalPacket = { packetStatus: 'ready_for_operator_review' };
  const model = buildAgentCommandConsoleProjection({ agentTaskProjection });
  assert.equal(model.commandConsoleStatus, 'ready');
  assert.equal(model.commandConsoleMode, 'proposal_review');
});
