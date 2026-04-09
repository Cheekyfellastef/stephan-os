import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContextAssembly } from './contextAssembly.js';

test('buildContextAssembly returns structured bundle with relevance gating', () => {
  const result = buildContextAssembly({
    prompt: 'How should Stephanos connect memory, graph, and simulation for architecture planning?',
    continuityContext: {
      summary: 'Recent work focused on route truth and memory continuity.',
      records: [{ id: 'r1' }, { id: 'r2' }],
    },
    retrievalContext: {
      used: true,
      reason: 'Retrieved internal docs',
      chunkCount: 2,
      sources: [{ sourceId: 'doc-a' }],
    },
    knowledgeGraphContext: {
      summary: 'Core runtime entities linked.',
      entities: [{ id: 'truth-engine' }],
    },
    simulationContext: {
      recentRuns: [{ id: 'sim-1' }],
    },
    tileContext: {
      tileContexts: [{ tileId: 'runtime' }],
      activeTileContext: { tileId: 'runtime' },
      relevantTileContexts: [],
    },
    runtimeContext: {
      sessionKind: 'hosted-web',
      target: 'cloud',
    },
    routeDecision: {
      requestRouteTruth: { routeKind: 'cloud' },
      selectedProvider: 'groq',
      selectedAnswerMode: 'local-private',
    },
    operatorContext: {
      northStar: 'Persistent cross-device identity and continuity layer that persists across reality.',
      subsystemInventory: ['memory', 'graph', 'simulation'],
      openTensions: ['route truth drift'],
      recentActivity: ['context assembly design'],
      roadmapSignals: ['system awareness'],
    },
  });

  assert.equal(result.truthMetadata.context_assembly_used, true);
  assert.equal(result.truthMetadata.self_build_prompt_detected, true);
  assert.ok(result.contextBundle.memory);
  assert.ok(result.contextBundle.knowledgeGraph);
  assert.ok(result.contextDiagnostics.sourcesUsed.includes('operatorContext'));
  assert.ok(result.augmentedPrompt.includes('System awareness context'));
});

test('buildContextAssembly keeps timeless prompts minimally overloaded', () => {
  const result = buildContextAssembly({
    prompt: 'How does a transformer work?',
    continuityContext: { records: [{ id: 'r1' }] },
    retrievalContext: { used: true, sources: [{ sourceId: 'doc-a' }] },
    runtimeContext: { sessionKind: 'local-desktop', target: 'local' },
    routeDecision: { requestRouteTruth: { routeKind: 'local' } },
  });

  assert.equal(result.contextDiagnostics.assemblyMode, 'minimal');
  assert.deepEqual(result.contextDiagnostics.sourcesUsed, []);
  assert.equal(result.truthMetadata.augmented_prompt_used, false);
});

test('buildContextAssembly preserves freshness integrity truth signals', () => {
  const result = buildContextAssembly({
    prompt: 'What is the latest status of Stephanos architecture today?',
    freshnessContext: { freshnessNeed: 'high' },
    retrievalContext: {
      used: true,
      reason: 'internal archive',
      sources: [{ sourceId: 'archive' }],
    },
    runtimeContext: {
      sessionKind: 'hosted-web',
      target: 'cloud',
    },
    routeDecision: {
      requestRouteTruth: { routeKind: 'cloud' },
      selectedProvider: 'groq',
      selectedAnswerMode: 'fresh-web',
    },
  });

  assert.equal(result.truthMetadata.context_integrity_preserved, true);
  assert.ok(result.contextDiagnostics.warnings.includes('retrieval context is historical/internal and not fresh-world validation'));
  assert.ok(result.contextDiagnostics.sourcesUsed.includes('runtimeTruth'));
});

test('buildContextAssembly reports unavailable sources honestly', () => {
  const result = buildContextAssembly({
    prompt: 'Help debug routing truth mismatch in Stephanos.',
    runtimeContext: {
      sessionKind: 'hosted-web',
      target: 'cloud',
    },
    routeDecision: {
      requestRouteTruth: { routeKind: 'unavailable' },
      selectedAnswerMode: 'fallback-stale-risk',
    },
  });

  assert.ok(result.contextDiagnostics.unavailableSources.includes('knowledgeGraph'));
  assert.ok(result.contextDiagnostics.unavailableSources.includes('simulation'));
  assert.ok(result.contextDiagnostics.sourcesUsed.includes('runtimeTruth'));
});
