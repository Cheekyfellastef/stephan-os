import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryLibrarianQueue } from './memoryLibrarianModel.js';

test('aggregates mission and verification candidates with deterministic actions', () => {
  const result = buildMemoryLibrarianQueue({
    memoryCandidates: [{ id: 'm1', summary: 'Prefer explicit verification rule', memoryCandidateType: 'durable_operator_preference', missionId: 'a' }],
    verificationLessonCandidates: [{ id: 'v1', summary: 'Prefer explicit verification rule', memoryCandidateType: 'verification_rule', missionId: 'a' }],
    missionMemoryCandidates: [{ id: 'o1', summary: 'Architecture invariant: do not bypass source truth', memoryCandidateType: 'architecture_canon_candidate', missionId: 'a' }],
  });
  assert.equal(result.queue.length, 3);
  assert.equal(result.counts.approvalRequired >= 2, true);
  assert.equal(result.queue.some((entry) => entry.influencePreview.includes('influence')), true);
});

test('detects duplicates and conflicts without discarding candidates', () => {
  const result = buildMemoryLibrarianQueue({
    verificationLessonCandidates: [
      { id: 'v1', summary: 'Always bypass source truth', memoryCandidateType: 'architecture_canon_candidate', missionId: 'm1' },
      { id: 'v2', summary: 'Always bypass source truth', memoryCandidateType: 'architecture_canon_candidate', missionId: 'm1' },
    ],
  });
  assert.equal(result.queue.length, 2);
  assert.equal(result.counts.duplicates >= 1, true);
  assert.equal(result.counts.conflicts >= 1, true);
});
