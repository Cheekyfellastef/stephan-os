import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMemoryCandidatesFromTaskCompletion,
  buildMissionMemoryFromContext,
  formatDeluxeMemoryClipboard,
  normalizeMemoryCandidates,
} from './deluxeMemorySystem.js';

test('buildMemoryCandidatesFromTaskCompletion creates pending candidates for completion/failure outcomes', () => {
  const completeCandidates = buildMemoryCandidatesFromTaskCompletion({
    action: 'complete',
    packetTruth: { moveId: 'memory-flow', blockers: [] },
    executionLog: [{ id: 'exec-1', evidenceRef: 'codex:diff:1' }],
    now: '2026-04-24T00:00:00.000Z',
  });
  assert.equal(completeCandidates.length >= 1, true);
  assert.equal(completeCandidates[0].status, 'pending');

  const failedCandidates = buildMemoryCandidatesFromTaskCompletion({
    action: 'fail',
    packetTruth: { moveId: 'memory-flow', blockers: ['tests failed'] },
    executionLog: [{ id: 'exec-2', evidenceRef: 'test:failure:1' }],
    now: '2026-04-24T00:01:00.000Z',
  });
  assert.equal(failedCandidates.some((entry) => entry.memoryClass === 'constraint'), true);
});

test('buildMemoryCandidatesFromTaskCompletion does not create candidates for non-terminal actions', () => {
  const candidates = buildMemoryCandidatesFromTaskCompletion({ action: 'start', packetTruth: { moveId: 'noop' } });
  assert.deepEqual(candidates, []);
});

test('normalizeMemoryCandidates keeps candidate payload bounded and structured', () => {
  const normalized = normalizeMemoryCandidates([{ summary: 'Keep adjudication explicit.', memoryClass: 'decision', confidence: 2 }]);
  assert.equal(normalized[0].memoryClass, 'decision');
  assert.equal(normalized[0].confidence, 1);
  assert.equal(normalized[0].status, 'pending');
});

test('mission memory + clipboard formatter separates mission, proposals, and durable summary', () => {
  const missionMemory = buildMissionMemoryFromContext({
    packetTruth: {
      moveTitle: 'Deluxe memory rollout',
      rationale: 'Separate memory from runtime truth.',
      blockers: ['approval pending'],
      active: true,
      approvalRequired: true,
    },
    workingMemory: { currentTask: 'Implement memory governance' },
    now: '2026-04-24T00:10:00.000Z',
  });
  const snapshot = formatDeluxeMemoryClipboard({
    missionMemory,
    memoryCandidates: [{ summary: 'Promote validated memory only.', memoryClass: 'constraint', status: 'pending', confidence: 0.75, impactLevel: 'high', source: 'system', evidenceRef: 'evt-1' }],
    durableSummary: ['Existing durable continuity note'],
  });

  assert.match(snapshot, /Active Mission Memory/);
  assert.match(snapshot, /Memory Candidates/);
  assert.match(snapshot, /Durable Memory Summary/);
});
