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
  assert.equal(result.truthMetadata.planning_intent_detected, true);
  assert.ok(Array.isArray(result.truthMetadata.ranked_moves));
  assert.ok(result.truthMetadata.ranked_moves.length > 0);
  assert.equal(result.truthMetadata.proposal_packet_active, true);
  assert.equal(result.truthMetadata.memory_elevation_active, true);
  assert.ok(result.truthMetadata.elevated_memory_count >= 0);
  assert.equal(result.truthMetadata.graph_link_truth_preserved, true);
  assert.equal(result.truthMetadata.operator_approval_required, true);
  assert.equal(result.truthMetadata.execution_eligible, false);
  assert.equal(typeof result.truthMetadata.codex_handoff_payload, 'string');
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


test('buildContextAssembly keeps planning truth bounded when evidence is missing', () => {
  const result = buildContextAssembly({
    prompt: 'what should we build next',
    runtimeContext: {
      sessionKind: 'hosted-web',
      target: 'cloud',
    },
    routeDecision: {
      requestRouteTruth: { routeKind: 'cloud' },
      selectedProvider: 'groq',
      selectedAnswerMode: 'local-private',
    },
  });

  assert.equal(result.truthMetadata.planning_intent_detected, true);
  assert.equal(result.truthMetadata.current_system_maturity_estimate, 'early-structured');
  assert.ok(result.truthMetadata.planning_truth_warnings.includes('proposal system signal not observed; proposal bridge moves are inferred priorities'));
  assert.equal(result.truthMetadata.proposal_eligible, true);
  assert.equal(result.truthMetadata.proposal_packet_active, true);
  assert.equal(result.truthMetadata.memory_elevation_active, true);
  assert.ok(result.truthMetadata.elevated_memory_count >= 0);
  assert.equal(result.truthMetadata.graph_link_truth_preserved, true);
  assert.equal(result.truthMetadata.operator_approval_required, true);
});


test('buildContextAssembly projects memory elevation truth fields for self-build prompts', () => {
  const result = buildContextAssembly({
    prompt: 'what should we build next to improve graph and proposal quality?',
    continuityContext: {
      records: [
        { id: 'm-1', summary: 'timeout truth drift recurred', subsystem: 'routing', timestamp: '2026-04-01T00:00:00.000Z' },
        { id: 'm-2', summary: 'timeout truth drift recurred', subsystem: 'routing', timestamp: '2026-04-02T00:00:00.000Z' },
      ],
    },
    knowledgeGraphContext: {
      entities: [{ id: 'routing', label: 'Routing Truth' }],
    },
    runtimeContext: { sessionKind: 'hosted-web', target: 'cloud' },
    routeDecision: { requestRouteTruth: { routeKind: 'cloud' }, selectedProvider: 'groq' },
    operatorContext: { openTensions: ['no fake state'], subsystemInventory: ['proposal-system'] },
  });

  assert.equal(result.truthMetadata.memory_elevation_active, true);
  assert.ok(result.truthMetadata.memory_candidates_considered >= 2);
  assert.ok(result.truthMetadata.elevated_memory_count >= 0);
  assert.equal(typeof result.truthMetadata.memory_informed_recommendation, 'string');
  assert.equal(result.truthMetadata.graph_link_truth_preserved, true);
});
