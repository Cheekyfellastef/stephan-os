import test from 'node:test';
import assert from 'node:assert/strict';
import { projectOperatorTimeline } from './operatorTimeline.mjs';

test('G16 projects chronological read-only ship log with proof and exact next action', () => {
  const p = projectOperatorTimeline({ timestampUtc:'2026-07-08T00:00:00.000Z', events:[{ kind:'fetch', timestampUtc:'2026-07-08T00:00:02.000Z', title:'Fetched main', proofRefs:['git://fetch'], exactNextAction:'Build next.' }], buildLaneManager:{ activeLane:{ goalId:'G16', branch:'feature/bridge', prNumber:12, headSha:'abcdef1', latestProof:{ status:'passed', timestampUtc:'2026-07-08T00:00:03.000Z', proofRefs:['node://test'] } } } });
  assert.equal(p.readOnly, true);
  assert.equal(p.arbitraryShellAllowed, false);
  assert.deepEqual(p.events.map(e => e.kind), ['source_update','fetch','proof_passed']);
  assert.equal(p.events[2].proofRefs[0], 'node://test');
});
