import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryElevation } from './memoryElevation.js';

test('buildMemoryElevation deterministically classifies and links memory without fake graph claims', () => {
  const input = {
    promptClassification: { selfBuild: { detected: true }, troubleshooting: true },
    continuityContext: {
      records: [
        { id: 'evt-1', summary: 'dist parity broke after merge', subsystem: 'build', timestamp: '2026-04-01T00:00:00.000Z' },
        { id: 'evt-2', summary: 'dist parity broke after merge', subsystem: 'build', timestamp: '2026-04-02T00:00:00.000Z' },
      ],
    },
    retrievalContext: {
      sources: [{ sourceId: 'doc-1', path: 'docs/route-truth.md', summary: 'route truth timeout drift' }],
    },
    operatorContext: {
      openTensions: ['preserve operator approval and no fake state'],
      roadmapSignals: ['knowledge graph maturity'],
    },
    knowledgeGraphContext: {
      entities: [{ id: 'build', label: 'Build Subsystem' }],
    },
  };

  const first = buildMemoryElevation(input);
  const second = buildMemoryElevation(input);

  assert.deepEqual(first, second);
  assert.equal(first.memory_truth_preserved, true);
  assert.equal(first.graph_link_truth_preserved, true);
  assert.ok(first.elevated_memory_count >= 2);
  assert.ok(first.top_memory_influencers.some((memory) => memory.memoryClass === 'mission-critical-continuity-memory'));
  assert.ok(first.recurrence_signals.length >= 1);
  assert.ok(first.graph_linked_memory_count >= 1 || first.deferred_graph_link_count >= 1);
});


test('buildMemoryElevation remains bounded when memory is sparse', () => {
  const result = buildMemoryElevation({
    promptClassification: { selfBuild: { detected: false } },
    continuityContext: { records: [] },
    retrievalContext: { sources: [] },
    operatorContext: {},
    knowledgeGraphContext: { entities: [] },
  });

  assert.equal(result.elevated_memory_count, 0);
  assert.ok(result.memory_elevation_warnings.includes('No memory candidates available for elevation; continuity remained sparse and bounded.'));
});
