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
    },
  };
}
