import test from 'node:test';
import assert from 'node:assert/strict';
import { saveOpenClawReviewDecision, loadOpenClawReviewDecisions, clearOpenClawReviewDecision, listOpenClawReviewDecisionsByPacketId } from './openClawReviewDecisionStore.mjs';

function memoryStorage(seed = {}) {
  const db = { ...seed };
  return { getItem: (k) => db[k] ?? null, setItem: (k, v) => { db[k] = v; } };
}

test('save/load and lookup per packet', () => {
  const storage = memoryStorage();
  saveOpenClawReviewDecision({ decision: { packetId: 'p1', reviewDecision: 'ready_for_codex_review' }, storage });
  const all = loadOpenClawReviewDecisions({ storage });
  assert.equal(all.p1.reviewDecision, 'ready_for_codex_review');
  assert.equal(listOpenClawReviewDecisionsByPacketId({ packetId: 'p1', storage }).length, 1);
  clearOpenClawReviewDecision({ packetId: 'p1', storage });
  assert.equal(listOpenClawReviewDecisionsByPacketId({ packetId: 'p1', storage }).length, 0);
});

test('malformed storage recovers', () => {
  const storage = memoryStorage({ 'stephanos.openclaw.reviewDecisions.v1': 'bad-json' });
  const all = loadOpenClawReviewDecisions({ storage });
  assert.deepEqual(all, {});
});
