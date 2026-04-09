const MAX_LIST_ITEMS = 8;

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function safeArray(value, limit = MAX_LIST_ITEMS) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, Math.max(0, Number(limit) || MAX_LIST_ITEMS));
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}


function normalizePlanningMove(move = {}) {
  const source = safeObject(move);
  return {
    moveId: safeString(source.moveId),
    title: safeString(source.title),
    category: safeString(source.category),
    score: Number.isFinite(Number(source.score)) ? Number(source.score) : 0,
    rationale: safeString(source.rationale),
    dependencies: safeArray(source.dependencies),
    blockers: safeArray(source.blockers),
    codexHandoffEligible: source.codexHandoffEligible === true,
    proposalEligible: source.proposalEligible === true,
  };
}

export function createContextSourceStatus({ key = '', used = false, available = false, reason = '', warning = '' } = {}) {
  return {
    key: safeString(key),
    used: used === true,
    available: available === true,
    reason: safeString(reason),
    warning: safeString(warning),
  };
}

export function normalizeContextAssemblyResult(input = {}) {
  const source = safeObject(input);
  const diagnostics = safeObject(source.contextDiagnostics);
  const sourceReasons = safeObject(diagnostics.sourceReasons);

  return {
    contextBundle: safeObject(source.contextBundle),
    contextDiagnostics: {
      sourcesConsidered: safeArray(diagnostics.sourcesConsidered),
      sourcesUsed: safeArray(diagnostics.sourcesUsed),
      sourceReasons: Object.fromEntries(
        Object.entries(sourceReasons).map(([key, value]) => [safeString(key), safeString(value)]),
      ),
      omittedSources: safeArray(diagnostics.omittedSources),
      unavailableSources: safeArray(diagnostics.unavailableSources),
      assemblyMode: safeString(diagnostics.assemblyMode) || 'minimal',
      assemblyConfidence: safeString(diagnostics.assemblyConfidence) || 'low',
      warnings: safeArray(diagnostics.warnings),
    },
    augmentedPrompt: safeString(source.augmentedPrompt),
    truthMetadata: {
      context_assembly_used: source.truthMetadata?.context_assembly_used === true,
      context_assembly_mode: safeString(source.truthMetadata?.context_assembly_mode) || 'minimal',
      context_sources_considered: safeArray(source.truthMetadata?.context_sources_considered),
      context_sources_used: safeArray(source.truthMetadata?.context_sources_used),
      context_source_reason_map: safeObject(source.truthMetadata?.context_source_reason_map),
      context_bundle_summary: safeObject(source.truthMetadata?.context_bundle_summary),
      self_build_prompt_detected: source.truthMetadata?.self_build_prompt_detected === true,
      self_build_reason: safeString(source.truthMetadata?.self_build_reason),
      system_awareness_level: safeString(source.truthMetadata?.system_awareness_level) || 'baseline',
      augmented_prompt_used: source.truthMetadata?.augmented_prompt_used === true,
      augmented_prompt_length: Number.isFinite(Number(source.truthMetadata?.augmented_prompt_length))
        ? Number(source.truthMetadata.augmented_prompt_length)
        : 0,
      context_assembly_warnings: safeArray(source.truthMetadata?.context_assembly_warnings),
      context_integrity_preserved: source.truthMetadata?.context_integrity_preserved !== false,
      planning_mode: safeString(source.truthMetadata?.planning_mode) || 'inactive',
      planning_intent_detected: source.truthMetadata?.planning_intent_detected === true,
      planning_confidence: safeString(source.truthMetadata?.planning_confidence) || 'low',
      current_system_maturity_estimate: safeString(source.truthMetadata?.current_system_maturity_estimate) || 'unknown',
      candidate_moves: safeArray(source.truthMetadata?.candidate_moves).map((move) => normalizePlanningMove(move)),
      ranked_moves: safeArray(source.truthMetadata?.ranked_moves).map((move) => normalizePlanningMove(move)),
      planning_blockers: safeArray(source.truthMetadata?.planning_blockers),
      planning_dependencies: safeArray(source.truthMetadata?.planning_dependencies),
      recommended_next_move: safeObject(source.truthMetadata?.recommended_next_move),
      recommendation_reason: safeString(source.truthMetadata?.recommendation_reason),
      planning_evidence_sources: safeArray(source.truthMetadata?.planning_evidence_sources),
      planning_truth_warnings: safeArray(source.truthMetadata?.planning_truth_warnings),
      planning_operator_actions: safeArray(source.truthMetadata?.planning_operator_actions),
      codex_handoff_eligible: source.truthMetadata?.codex_handoff_eligible === true,
      proposal_eligible: source.truthMetadata?.proposal_eligible === true,
    },
  };
}
