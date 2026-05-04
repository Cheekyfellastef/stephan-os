import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentTaskProjection } from './agentTaskProjection.mjs';
import { buildAgentCommandQueue } from './agentCommandQueue.mjs';

test('agent command queue is non-executing with required item schema', ()=>{
  const queue = buildAgentCommandQueue({ agentTaskProjection: buildAgentTaskProjection() });
  assert.equal(queue.executionAllowed, false);
  assert.equal(queue.itemCount > 0, true);
  queue.items.forEach((item)=>{
    assert.equal(item.executionAllowed, false);
    assert.equal(item.operatorReviewRequired, true);
  });
});

test('agent command queue derives codex and dry-run statuses', ()=>{
  const queue = buildAgentCommandQueue({ agentTaskProjection: buildAgentTaskProjection() });
  const codexItem = queue.items.find((item)=>item.itemType==='codex_review_prompt');
  const dryRunItem = queue.items.find((item)=>item.itemType==='dry_run_preview');
  assert.equal(Boolean(codexItem), true);
  assert.equal(Boolean(dryRunItem), true);
  assert.match(String(codexItem.status), /(draft|ready_for_codex_review)/);
});

test('agent command queue reflects canonical proposal/review/export truth', ()=>{
  const projection = buildAgentTaskProjection();
  projection.operatorSurface.openClawProposalPacket = { packetId: 'p1', packetStatus: 'ready_for_operator_review' };
  projection.operatorSurface.openClawOperatorReviewQueue = { queueStatus: 'ready_for_operator_review' };
  projection.operatorSurface.openClawCodexProposalExport = { exportStatus: 'generated' };
  projection.operatorSurface.openClawCodexReviewResult = { resultStatus: 'not_received' };
  projection.operatorSurface.openClawEvidenceRequest = { requestStatus: 'archived', missingEvidence: ['attach test log'] };
  const queue = buildAgentCommandQueue({ agentTaskProjection: projection });
  assert.equal(queue.items.find((i)=>i.itemType==='openclaw_proposal_packet')?.status, 'ready_for_operator_review');
  assert.equal(queue.items.find((i)=>i.itemType==='codex_review_prompt')?.status, 'ready_for_codex_review');
  assert.equal(queue.items.find((i)=>i.itemType==='codex_review_result')?.status, 'waiting_for_codex_result');
  assert.equal(queue.items.find((i)=>i.itemType==='evidence_request')?.status, 'needs_more_evidence');
});
