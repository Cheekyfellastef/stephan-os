import { normalizeContextAssemblyResult } from '../../../shared/ai/contextAssemblyContract.mjs';
import { buildMissionSynthesis } from './missionSynthesis.js';
import { buildProposalPacket } from './proposalPacket.js';

const SOURCE_KEYS = Object.freeze([
  'memory',
  'retrieval',
  'knowledgeGraph',
  'simulation',
  'tileContext',
  'runtimeTruth',
  'operatorContext',
]);

const SELF_BUILD_PATTERNS = [
  /what\s+should\s+we\s+build\s+next/i,
  /how\s+should\s+stephanos\s+evolve/i,
  /self[-\s]?improv/i,
  /build\s+stephanos/i,
  /system\s+should\s+be\s+added\s+next/i,
  /design\s+.*(architecture|integration|orchestration)/i,
  /(roadmap|proposal|architecture|integration|orchestration)/i,
  /what\s+should\s+we\s+work\s+on\s+now/i,
];

const FRESHNESS_PATTERNS = [
  /today|latest|current|breaking|news|price|release/i,
  /who\s+is\s+the\s+(president|ceo|governor|prime minister)/i,
];

const SIMULATION_PATTERNS = [/simulation|scenario|simulate|outcome|model/i];
const ROUTING_PATTERNS = [/route|routing|provider|freshness|truth mode|stale|timeout|dispatch/i];
const KNOWLEDGE_PATTERNS = [/graph|entity|relationship|ontology|knowledge/i];

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function summarizeArray(values = [], limit = 5) {
  return Array.isArray(values) ? values.slice(0, limit) : [];
}

function detectSelfBuildIntent(prompt = '') {
  const text = safeString(prompt);
  const hit = SELF_BUILD_PATTERNS.find((pattern) => pattern.test(text));
  return {
    detected: Boolean(hit),
    reason: hit ? `matched:${String(hit)}` : '',
  };
}

function classifyPrompt(prompt = '', { freshnessNeed = 'low' } = {}) {
  const text = safeString(prompt);
  const lowered = text.toLowerCase();
  const selfBuild = detectSelfBuildIntent(text);
  const freshnessSensitive = freshnessNeed === 'high' || FRESHNESS_PATTERNS.some((pattern) => pattern.test(text));
  const simulationFocused = SIMULATION_PATTERNS.some((pattern) => pattern.test(text));
  const troubleshooting = ROUTING_PATTERNS.some((pattern) => pattern.test(text));
  const knowledgeFocused = KNOWLEDGE_PATTERNS.some((pattern) => pattern.test(text));
  const projectArchitecture = /stephanos|runtime|tile|subsystem|architecture|continuity/i.test(text);
  const timelessGeneral = !projectArchitecture && !freshnessSensitive && !simulationFocused && !troubleshooting && !knowledgeFocused;
  const tileScoped = /tile|workspace|panel|console/i.test(lowered);

  const categories = [
    timelessGeneral ? 'timeless-general' : null,
    freshnessSensitive ? 'freshness-sensitive' : null,
    projectArchitecture ? 'project-architecture' : null,
    selfBuild.detected ? 'self-build' : null,
    simulationFocused ? 'simulation-focused' : null,
    knowledgeFocused ? 'knowledge-focused' : null,
    troubleshooting ? 'troubleshooting-routing' : null,
    tileScoped ? 'tile-scoped' : null,
  ].filter(Boolean);

  return {
    categories,
    timelessGeneral,
    freshnessSensitive,
    projectArchitecture,
    simulationFocused,
    knowledgeFocused,
    troubleshooting,
    tileScoped,
    selfBuild,
  };
}

function selectMemoryContext({ continuityContext, memoryContext, promptClassification }) {
  const records = continuityContext?.records || memoryContext?.records || [];
  const recent = summarizeArray(records, 4);
  const available = recent.length > 0;
  const shouldUse = available && (promptClassification.projectArchitecture || promptClassification.selfBuild.detected || !promptClassification.timelessGeneral);
  return {
    used: shouldUse,
    available,
    reason: shouldUse ? 'Continuity memory provides recent architectural/session history.' : 'Memory not required for this prompt class.',
    data: shouldUse
      ? {
        recentRecords: recent,
        summary: safeString(continuityContext?.summary || memoryContext?.summary),
      }
      : null,
  };
}

function selectRetrievalContext({ retrievalContext, promptClassification }) {
  const available = retrievalContext && typeof retrievalContext === 'object' && (retrievalContext.used === true || Array.isArray(retrievalContext.sources));
  const shouldUse = Boolean(available && (promptClassification.knowledgeFocused || promptClassification.projectArchitecture || promptClassification.selfBuild.detected));
  return {
    used: shouldUse,
    available,
    reason: shouldUse ? 'Local retrieval truth contributes internal project grounding.' : 'Retrieval omitted because no targeted retrieval need detected.',
    data: shouldUse
      ? {
        mode: safeString(retrievalContext.mode || retrievalContext.retrieval_mode || 'local-rag'),
        reason: safeString(retrievalContext.reason || retrievalContext.retrieval_reason),
        sources: summarizeArray(retrievalContext.sources || retrievalContext.retrieved_sources, 4),
        chunkCount: Number(retrievalContext.chunkCount || retrievalContext.retrieved_chunk_count || 0),
      }
      : null,
  };
}

function selectKnowledgeGraphContext({ knowledgeGraphContext, promptClassification }) {
  const entities = summarizeArray(knowledgeGraphContext?.entities, 8);
  const available = entities.length > 0 || safeString(knowledgeGraphContext?.summary).length > 0;
  const shouldUse = Boolean(available && (promptClassification.knowledgeFocused || promptClassification.selfBuild.detected || promptClassification.projectArchitecture));
  return {
    used: shouldUse,
    available,
    reason: shouldUse ? 'Knowledge graph entities map active system concepts.' : 'Knowledge graph context not relevant for prompt class.',
    data: shouldUse
      ? {
        summary: safeString(knowledgeGraphContext.summary),
        entities,
      }
      : null,
  };
}

function selectSimulationContext({ simulationContext, promptClassification }) {
  const available = simulationContext && typeof simulationContext === 'object' && (Array.isArray(simulationContext.recentRuns) || simulationContext.latestResult);
  const shouldUse = Boolean(available && (promptClassification.simulationFocused || promptClassification.selfBuild.detected));
  return {
    used: shouldUse,
    available,
    reason: shouldUse ? 'Simulation context prioritized for simulation-oriented prompt.' : 'Simulation context omitted by relevance gate.',
    data: shouldUse
      ? {
        latestResult: simulationContext.latestResult || null,
        recentRuns: summarizeArray(simulationContext.recentRuns, 3),
      }
      : null,
  };
}

function selectTileContext({ tileContext, promptClassification }) {
  const available = tileContext && typeof tileContext === 'object' && Array.isArray(tileContext.tileContexts);
  const shouldUse = Boolean(available && (promptClassification.tileScoped || promptClassification.projectArchitecture || promptClassification.selfBuild.detected));
  return {
    used: shouldUse,
    available,
    reason: shouldUse ? 'Active/relevant tile context contributes workspace truth.' : 'Tile context not required for this prompt class.',
    data: shouldUse
      ? {
        activeTile: tileContext.activeTileContext || null,
        relevantTiles: summarizeArray(tileContext.relevantTileContexts, 3),
        diagnostics: tileContext.diagnostics || null,
      }
      : null,
  };
}

function selectRuntimeTruthContext({ runtimeTruth, promptClassification }) {
  const available = runtimeTruth && typeof runtimeTruth === 'object';
  const shouldUse = Boolean(available && !promptClassification.timelessGeneral);
  return {
    used: shouldUse,
    available,
    reason: shouldUse ? 'Runtime route/provider/freshness truth required for non-timeless prompts.' : 'Runtime truth omitted for timeless general prompt.',
    data: shouldUse
      ? {
        routeKind: safeString(runtimeTruth.routeKind),
        sessionKind: safeString(runtimeTruth.sessionKind),
        target: safeString(runtimeTruth.target),
        selectedProvider: safeString(runtimeTruth.selectedProvider),
        freshnessNeed: safeString(runtimeTruth.freshnessNeed),
        answerTruthMode: safeString(runtimeTruth.answerTruthMode),
      }
      : null,
  };
}

function selectOperatorContext({ operatorContext, promptClassification }) {
  const available = operatorContext && typeof operatorContext === 'object';
  const shouldUse = Boolean(available && (promptClassification.selfBuild.detected || promptClassification.projectArchitecture));
  return {
    used: shouldUse,
    available,
    reason: shouldUse ? 'Operator/project context elevated for system evolution guidance.' : 'Operator context omitted by relevance gate.',
    data: shouldUse
      ? {
        northStar: safeString(operatorContext.northStar),
        subsystemInventory: summarizeArray(operatorContext.subsystemInventory, 10),
        openTensions: summarizeArray(operatorContext.openTensions, 6),
        recentActivity: summarizeArray(operatorContext.recentActivity, 6),
        roadmapSignals: summarizeArray(operatorContext.roadmapSignals, 6),
      }
      : null,
  };
}

function buildAugmentedPrompt({ prompt, contextBundle, diagnostics, promptClassification }) {
  const sections = [];
  const usedSources = diagnostics.sourcesUsed;

  usedSources.forEach((sourceKey) => {
    const value = contextBundle[sourceKey];
    if (!value) return;
    sections.push(`## ${sourceKey}\n${JSON.stringify(value)}`);
  });

  const shouldAugment = sections.length > 0 && !promptClassification.timelessGeneral;
  if (!shouldAugment) {
    return {
      prompt,
      used: false,
    };
  }

  return {
    prompt: [
      prompt,
      '',
      '[System awareness context: include only relevant truth below; do not claim unavailable sources.]',
      ...sections,
    ].join('\n'),
    used: true,
  };
}

export function buildContextAssembly({
  prompt = '',
  freshnessContext = null,
  runtimeContext = null,
  routeDecision = null,
  tileContext = null,
  continuityContext = null,
  retrievalContext = null,
  knowledgeGraphContext = null,
  simulationContext = null,
  operatorContext = null,
} = {}) {
  const promptClassification = classifyPrompt(prompt, {
    freshnessNeed: freshnessContext?.freshnessNeed || 'low',
  });

  const runtimeTruth = {
    routeKind: routeDecision?.requestRouteTruth?.routeKind || runtimeContext?.routeKind || '',
    sessionKind: runtimeContext?.sessionKind || '',
    target: runtimeContext?.target || '',
    selectedProvider: routeDecision?.selectedProvider || routeDecision?.requestedProviderForRequest || '',
    freshnessNeed: freshnessContext?.freshnessNeed || 'low',
    answerTruthMode: routeDecision?.selectedAnswerMode || '',
  };

  const sourceSelections = {
    memory: selectMemoryContext({ continuityContext, promptClassification }),
    retrieval: selectRetrievalContext({ retrievalContext, promptClassification }),
    knowledgeGraph: selectKnowledgeGraphContext({ knowledgeGraphContext, promptClassification }),
    simulation: selectSimulationContext({ simulationContext, promptClassification }),
    tileContext: selectTileContext({ tileContext, promptClassification }),
    runtimeTruth: selectRuntimeTruthContext({ runtimeTruth, promptClassification }),
    operatorContext: selectOperatorContext({ operatorContext, promptClassification }),
  };

  const contextBundle = {};
  const sourceReasons = {};
  const sourcesUsed = [];
  const unavailableSources = [];
  const omittedSources = [];

  SOURCE_KEYS.forEach((sourceKey) => {
    const selection = sourceSelections[sourceKey];
    sourceReasons[sourceKey] = selection.reason;
    if (!selection.available) {
      unavailableSources.push(sourceKey);
      return;
    }

    if (selection.used) {
      sourcesUsed.push(sourceKey);
      contextBundle[sourceKey] = selection.data;
    } else {
      omittedSources.push(sourceKey);
    }
  });

  const diagnostics = {
    sourcesConsidered: [...SOURCE_KEYS],
    sourcesUsed,
    sourceReasons,
    omittedSources,
    unavailableSources,
    assemblyMode: promptClassification.selfBuild.detected
      ? 'self-build-elevated'
      : promptClassification.timelessGeneral
        ? 'minimal'
        : 'task-aware',
    assemblyConfidence: sourcesUsed.length >= 3 ? 'high' : (sourcesUsed.length >= 1 ? 'medium' : 'low'),
    warnings: [
      promptClassification.freshnessSensitive && sourcesUsed.includes('retrieval')
        ? 'retrieval context is historical/internal and not fresh-world validation'
        : '',
      promptClassification.freshnessSensitive && !sourcesUsed.includes('runtimeTruth')
        ? 'freshness-sensitive prompt without runtime truth context'
        : '',
    ].filter(Boolean),
  };

  const missionSynthesis = buildMissionSynthesis({
    prompt,
    promptClassification,
    contextBundle,
    operatorContext,
    runtimeContext,
    contextDiagnostics: diagnostics,
  });

  if (missionSynthesis.planningIntentDetected) {
    contextBundle.missionSynthesis = {
      planningMode: missionSynthesis.planningMode,
      planningConfidence: missionSynthesis.planningConfidence,
      currentSystemMaturityEstimate: missionSynthesis.currentSystemMaturityEstimate,
      recommendedNextMove: missionSynthesis.recommendedNextMove,
      recommendationReason: missionSynthesis.recommendationReason,
      candidateMoveCount: missionSynthesis.candidateMoves.length,
      evidenceSources: missionSynthesis.evidenceSources,
      truthWarnings: missionSynthesis.truthWarnings,
      codexHandoffEligible: missionSynthesis.codexHandoffEligible,
      proposalEligible: missionSynthesis.proposalEligible,
    };
  }

  const proposalPacket = buildProposalPacket({
    missionSynthesis,
    contextDiagnostics: diagnostics,
    runtimeTruth,
  });
  if (proposalPacket.packet_metadata.proposal_active) {
    contextBundle.proposalPacket = {
      mode: proposalPacket.packet_metadata.proposal_mode,
      confidence: proposalPacket.packet_metadata.proposal_confidence,
      moveId: proposalPacket.recommended_move_summary.move_id,
      moveTitle: proposalPacket.recommended_move_summary.title,
      codexEligible: proposalPacket.codex_handoff_payload.codex_eligible,
      approvalRequired: proposalPacket.operator_workflow.approval_required,
      warnings: proposalPacket.packet_metadata.warnings,
    };
  }

  const augmented = buildAugmentedPrompt({
    prompt: safeString(prompt),
    contextBundle,
    diagnostics,
    promptClassification,
  });

  return normalizeContextAssemblyResult({
    contextBundle,
    contextDiagnostics: diagnostics,
    augmentedPrompt: augmented.prompt,
    truthMetadata: {
      context_assembly_used: sourcesUsed.length > 0,
      context_assembly_mode: diagnostics.assemblyMode,
      context_sources_considered: diagnostics.sourcesConsidered,
      context_sources_used: sourcesUsed,
      context_source_reason_map: sourceReasons,
      context_bundle_summary: {
        ...Object.fromEntries(sourcesUsed.map((source) => [source, 'included'])),
        planningActive: missionSynthesis.planningIntentDetected,
      },
      self_build_prompt_detected: promptClassification.selfBuild.detected,
      self_build_reason: promptClassification.selfBuild.reason,
      system_awareness_level: promptClassification.selfBuild.detected
        ? 'elevated-self-build'
        : (sourcesUsed.length >= 3 ? 'multi-source' : (sourcesUsed.length > 0 ? 'single-source' : 'baseline')),
      augmented_prompt_used: augmented.used,
      augmented_prompt_length: augmented.prompt.length,
      context_assembly_warnings: diagnostics.warnings,
      context_integrity_preserved: !(promptClassification.freshnessSensitive && sourcesUsed.includes('retrieval') && !sourcesUsed.includes('runtimeTruth')),
      planning_mode: missionSynthesis.planningMode,
      planning_intent_detected: missionSynthesis.planningIntentDetected,
      planning_confidence: missionSynthesis.planningConfidence,
      current_system_maturity_estimate: missionSynthesis.currentSystemMaturityEstimate,
      candidate_moves: missionSynthesis.candidateMoves,
      ranked_moves: missionSynthesis.rankedMoves,
      planning_blockers: missionSynthesis.blockers,
      planning_dependencies: missionSynthesis.dependencies,
      recommended_next_move: missionSynthesis.recommendedNextMove,
      recommendation_reason: missionSynthesis.recommendationReason,
      planning_evidence_sources: missionSynthesis.evidenceSources,
      planning_truth_warnings: missionSynthesis.truthWarnings,
      planning_operator_actions: missionSynthesis.operatorActions,
      proposal_eligible: missionSynthesis.proposalEligible,
      proposal_packet_active: proposalPacket.truth_fields.proposal_packet_active,
      proposal_packet_mode: proposalPacket.truth_fields.proposal_packet_mode,
      proposal_packet_confidence: proposalPacket.truth_fields.proposal_packet_confidence,
      proposal_packet_truth_preserved: proposalPacket.truth_fields.proposal_packet_truth_preserved,
      codex_handoff_available: proposalPacket.truth_fields.codex_handoff_available,
      codex_handoff_eligible: proposalPacket.truth_fields.codex_handoff_eligible || missionSynthesis.codexHandoffEligible,
      operator_approval_required: proposalPacket.truth_fields.operator_approval_required,
      proposed_move_id: proposalPacket.truth_fields.proposed_move_id,
      proposed_move_title: proposalPacket.truth_fields.proposed_move_title,
      proposed_move_rationale: proposalPacket.truth_fields.proposed_move_rationale,
      proposal_packet_warnings: proposalPacket.truth_fields.proposal_packet_warnings,
      proposal_packet: proposalPacket,
      codex_prompt: proposalPacket.codex_handoff_payload.codex_prompt,
      codex_prompt_summary: proposalPacket.codex_handoff_payload.codex_prompt_summary,
      codex_constraints: proposalPacket.codex_handoff_payload.codex_constraints,
      codex_success_criteria: proposalPacket.codex_handoff_payload.codex_success_criteria,
      codex_handoff_payload: proposalPacket.codex_handoff_payload.copyable_payload,
      proposal_operator_actions: proposalPacket.operator_workflow.operator_actions,
      execution_eligible: proposalPacket.operator_workflow.execution_eligible,
    },
  });
}

export { classifyPrompt, detectSelfBuildIntent };
