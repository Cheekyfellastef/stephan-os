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
