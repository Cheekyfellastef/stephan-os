import { normalizeMissionSynthesisResult } from '../../../shared/ai/missionSynthesisContract.mjs';

const SELF_PLANNING_PATTERNS = [
  /what\s+should\s+we\s+build\s+next/i,
  /what\s+system\s+should\s+be\s+added\s+next/i,
  /how\s+should\s+stephanos\s+evolve/i,
  /what\s+is\s+the\s+next\s+milestone/i,
  /what\s+should\s+we\s+improve\s+first/i,
  /move\s+stephanos\s+up\s+the\s+stack/i,
  /help\s+build\s+stephanos\s+itself/i,
  /self[-\s]?build|orchestration|roadmap|proposal/i,
];

const MOVE_CATALOG = Object.freeze([
  {
    moveId: 'mission-synthesis-layer',
    title: 'Mission synthesis / self-planning layer maturation',
    category: 'orchestration',
    dependencies: ['context-assembly'],
    requiredSignals: ['operatorContext'],
    heuristics: { impact: 5, centrality: 5, readiness: 4, frictionReduction: 4, truthStrength: 5, unlocks: 5 },
    codexHandoffEligible: true,
    proposalEligible: true,
  },
  {
    moveId: 'proposal-execution-bridge',
    title: 'Proposal-to-execution bridge',
    category: 'execution-contract',
    dependencies: ['proposal-system', 'mission-synthesis-layer'],
    requiredSignals: ['memory'],
    heuristics: { impact: 5, centrality: 4, readiness: 3, frictionReduction: 5, truthStrength: 4, unlocks: 5 },
    codexHandoffEligible: true,
    proposalEligible: true,
  },
  {
    moveId: 'codex-handoff-generator',
    title: 'Codex handoff generator',
    category: 'handoff',
    dependencies: ['proposal-system'],
    requiredSignals: ['operatorContext', 'runtimeTruth'],
    heuristics: { impact: 4, centrality: 4, readiness: 4, frictionReduction: 5, truthStrength: 4, unlocks: 4 },
    codexHandoffEligible: true,
    proposalEligible: true,
  },
  {
    moveId: 'tool-orchestration-registry',
    title: 'Tool orchestration registry expansion',
    category: 'orchestration',
    dependencies: ['runtime-truth'],
    requiredSignals: ['runtimeTruth'],
    heuristics: { impact: 4, centrality: 5, readiness: 4, frictionReduction: 4, truthStrength: 5, unlocks: 4 },
    codexHandoffEligible: true,
    proposalEligible: true,
  },
  {
    moveId: 'tile-capability-contracts',
    title: 'Tile capability registry and action contracts',
    category: 'contracts',
    dependencies: ['tile-context'],
    requiredSignals: ['tileContext'],
    heuristics: { impact: 4, centrality: 4, readiness: 3, frictionReduction: 4, truthStrength: 5, unlocks: 4 },
    codexHandoffEligible: true,
    proposalEligible: true,
  },
  {
    moveId: 'simulation-orchestration-planner',
    title: 'Simulation orchestration planner',
    category: 'simulation',
    dependencies: ['simulation'],
    requiredSignals: ['simulation'],
    heuristics: { impact: 4, centrality: 3, readiness: 3, frictionReduction: 3, truthStrength: 4, unlocks: 3 },
    codexHandoffEligible: true,
    proposalEligible: true,
  },
  {
    moveId: 'knowledge-graph-exploitation',
    title: 'Knowledge graph exploitation planner',
    category: 'knowledge',
    dependencies: ['knowledge-graph'],
    requiredSignals: ['knowledgeGraph'],
    heuristics: { impact: 4, centrality: 4, readiness: 3, frictionReduction: 3, truthStrength: 4, unlocks: 4 },
    codexHandoffEligible: true,
    proposalEligible: true,
  },
  {
    moveId: 'memory-promotion-adjudication',
    title: 'Memory promotion/adjudication maturation',
    category: 'memory',
    dependencies: ['memory'],
    requiredSignals: ['memory'],
    heuristics: { impact: 5, centrality: 4, readiness: 4, frictionReduction: 3, truthStrength: 5, unlocks: 4 },
    codexHandoffEligible: true,
    proposalEligible: true,
  },
  {
    moveId: 'build-test-run-mission-packets',
    title: 'Build/test/run mission packets',
    category: 'delivery',
    dependencies: ['runtime-truth', 'proposal-system'],
    requiredSignals: ['runtimeTruth'],
    heuristics: { impact: 5, centrality: 4, readiness: 3, frictionReduction: 5, truthStrength: 4, unlocks: 5 },
    codexHandoffEligible: true,
    proposalEligible: true,
  },
  {
    moveId: 'multi-agent-role-scaffolding',
    title: 'Multi-agent role scaffolding',
    category: 'orchestration',
    dependencies: ['tool-orchestration-registry', 'mission-synthesis-layer'],
    requiredSignals: ['operatorContext', 'runtimeTruth'],
    heuristics: { impact: 3, centrality: 3, readiness: 2, frictionReduction: 3, truthStrength: 4, unlocks: 3 },
    codexHandoffEligible: false,
    proposalEligible: true,
  },
  {
    moveId: 'operator-roadmap-compiler',
    title: 'Operator roadmap compiler',
    category: 'roadmap',
    dependencies: ['mission-synthesis-layer', 'proposal-system'],
    requiredSignals: ['operatorContext', 'memory'],
    heuristics: { impact: 4, centrality: 4, readiness: 4, frictionReduction: 5, truthStrength: 4, unlocks: 4 },
    codexHandoffEligible: true,
    proposalEligible: true,
  },
]);

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function detectPlanningIntent(prompt = '', promptClassification = {}) {
  const text = safeString(prompt);
  const hit = SELF_PLANNING_PATTERNS.find((pattern) => pattern.test(text));
  const selfBuildDetected = promptClassification?.selfBuild?.detected === true;
  return {
    detected: Boolean(hit || selfBuildDetected),
    reason: hit ? `matched:${String(hit)}` : (selfBuildDetected ? 'inherited:self-build-detection' : ''),
  };
}

function resolveObservedCapabilities({ contextBundle = {}, operatorContext = {}, runtimeContext = {} } = {}) {
  const subsystemInventory = Array.isArray(operatorContext?.subsystemInventory)
    ? operatorContext.subsystemInventory.map((value) => safeString(value).toLowerCase())
    : [];
  const observed = new Set(['context-assembly']);

  if (contextBundle.memory) observed.add('memory');
  if (contextBundle.runtimeTruth || runtimeContext?.target) observed.add('runtime-truth');
  if (contextBundle.knowledgeGraph) observed.add('knowledge-graph');
  if (contextBundle.simulation) observed.add('simulation');
  if (contextBundle.tileContext) observed.add('tile-context');
  if (subsystemInventory.some((entry) => entry.includes('proposal'))) observed.add('proposal-system');

  return observed;
}

function scoreMove(move, observedCapabilities = new Set()) {
  const heuristics = move.heuristics || {};
  const missingDependencies = move.dependencies.filter((dependency) => !observedCapabilities.has(dependency));
  const dependencyReadyRatio = move.dependencies.length
    ? (move.dependencies.length - missingDependencies.length) / move.dependencies.length
    : 1;

  const weightedScore = (
    (heuristics.impact || 0) * 0.30
    + (heuristics.centrality || 0) * 0.18
    + (heuristics.readiness || 0) * 0.14
    + (heuristics.frictionReduction || 0) * 0.14
    + (heuristics.truthStrength || 0) * 0.14
    + (heuristics.unlocks || 0) * 0.10
  ) * (0.8 + (dependencyReadyRatio * 0.2));

  const blockers = missingDependencies.map((dependency) => `missing dependency signal: ${dependency}`);

  return {
    moveId: move.moveId,
    title: move.title,
    category: move.category,
    score: Number(weightedScore.toFixed(3)),
    dependencies: move.dependencies,
    blockers,
    rationale: blockers.length
      ? `High-value move with unresolved prerequisites (${blockers[0]}).`
      : 'High-value move with prerequisites currently observed.',
    codexHandoffEligible: move.codexHandoffEligible === true,
    proposalEligible: move.proposalEligible === true,
  };
}

function estimateMaturity(observedCapabilities = new Set()) {
  const knownSignals = ['context-assembly', 'runtime-truth', 'memory', 'tile-context', 'knowledge-graph', 'simulation', 'proposal-system'];
  const hits = knownSignals.filter((signal) => observedCapabilities.has(signal)).length;
  if (hits >= 6) return 'advanced-foundation';
  if (hits >= 4) return 'emerging-orchestration';
  if (hits >= 2) return 'early-structured';
  return 'bootstrap';
}

export function buildMissionSynthesis({
  prompt = '',
  promptClassification = {},
  contextBundle = {},
  operatorContext = {},
  runtimeContext = {},
  contextDiagnostics = {},
} = {}) {
  const planningIntent = detectPlanningIntent(prompt, promptClassification);
  if (!planningIntent.detected) {
    return normalizeMissionSynthesisResult({
      planningMode: 'inactive',
      planningIntentDetected: false,
      planningConfidence: 'low',
      currentSystemMaturityEstimate: 'unknown',
      candidateMoves: [],
      rankedMoves: [],
      blockers: [],
      dependencies: [],
      recommendedNextMove: null,
      recommendationReason: '',
      evidenceSources: [],
      truthWarnings: [],
      operatorActions: [],
      codexHandoffEligible: false,
      proposalEligible: false,
    });
  }

  const observedCapabilities = resolveObservedCapabilities({ contextBundle, operatorContext, runtimeContext });
  const rankedMoves = MOVE_CATALOG
    .map((move) => scoreMove(move, observedCapabilities))
    .sort((left, right) => right.score - left.score || left.moveId.localeCompare(right.moveId));

  const recommendedNextMove = rankedMoves[0] || null;
  const evidenceSources = Array.isArray(contextDiagnostics?.sourcesUsed)
    ? contextDiagnostics.sourcesUsed
    : [];
  const truthWarnings = [];
  if (!evidenceSources.length) {
    truthWarnings.push('planning intent detected but no bounded context sources were available');
  }
  if (!observedCapabilities.has('proposal-system')) {
    truthWarnings.push('proposal system signal not observed; proposal bridge moves are inferred priorities');
  }

  return normalizeMissionSynthesisResult({
    planningMode: 'self-build-mission-synthesis',
    planningIntentDetected: true,
    planningConfidence: evidenceSources.length >= 3 ? 'high' : (evidenceSources.length >= 1 ? 'medium' : 'low'),
    currentSystemMaturityEstimate: estimateMaturity(observedCapabilities),
    candidateMoves: rankedMoves,
    rankedMoves,
    blockers: recommendedNextMove?.blockers || [],
    dependencies: recommendedNextMove?.dependencies || [],
    recommendedNextMove,
    recommendationReason: recommendedNextMove?.rationale || 'No ranked move available.',
    evidenceSources,
    truthWarnings,
    operatorActions: recommendedNextMove
      ? [
        `Create proposal packet for ${recommendedNextMove.moveId}.`,
        'Validate dependency readiness against current route/provider/runtime truth.',
        'Generate Codex-safe implementation handoff with explicit acceptance tests.',
      ]
      : [],
    codexHandoffEligible: recommendedNextMove?.codexHandoffEligible === true,
    proposalEligible: recommendedNextMove?.proposalEligible === true,
  });
}

export { MOVE_CATALOG, detectPlanningIntent };
