const MAX_ITEMS = 12;
const MAX_INFLUENCERS = 6;

function safeString(value = '') {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function safeArray(value, limit = MAX_ITEMS) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, Math.max(0, Number(limit) || MAX_ITEMS));
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeBoolean(value, fallback = false) {
  return value === undefined ? fallback : value === true;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeLink(link = {}) {
  const source = safeObject(link);
  return {
    relation: safeString(source.relation),
    state: safeString(source.state) || 'deferred',
    entityId: safeString(source.entityId),
    entityLabel: safeString(source.entityLabel),
    edgeId: safeString(source.edgeId),
    reason: safeString(source.reason),
  };
}

function normalizeMemory(memory = {}) {
  const source = safeObject(memory);
  return {
    memoryId: safeString(source.memoryId),
    summary: safeString(source.summary),
    sourceType: safeString(source.sourceType) || 'unknown',
    sourceRef: safeString(source.sourceRef),
    subsystem: safeString(source.subsystem),
    memoryClass: safeString(source.memoryClass) || 'plain-memory',
    importance: Math.max(0, Math.min(1, safeNumber(source.importance, 0))),
    confidence: Math.max(0, Math.min(1, safeNumber(source.confidence, 0))),
    recurrenceCount: Math.max(0, Math.floor(safeNumber(source.recurrenceCount, 0))),
    reasons: safeArray(source.reasons, 8).map((reason) => safeString(reason)).filter(Boolean),
    provenance: {
      sourceType: safeString(source?.provenance?.sourceType || source.sourceType),
      sourceRef: safeString(source?.provenance?.sourceRef || source.sourceRef),
      observedAt: safeString(source?.provenance?.observedAt),
    },
    graphLinks: safeArray(source.graphLinks, 8).map((link) => normalizeLink(link)),
  };
}

export function normalizeMemoryElevationResult(input = {}) {
  const source = safeObject(input);
  return {
    active: safeBoolean(source.active, true),
    mode: safeString(source.mode) || 'bounded',
    memory_truth_preserved: safeBoolean(source.memory_truth_preserved, true),
    graph_link_truth_preserved: safeBoolean(source.graph_link_truth_preserved, true),
    memory_candidates_considered: Math.max(0, Math.floor(safeNumber(source.memory_candidates_considered, 0))),
    elevated_memory_count: Math.max(0, Math.floor(safeNumber(source.elevated_memory_count, 0))),
    graph_linked_memory_count: Math.max(0, Math.floor(safeNumber(source.graph_linked_memory_count, 0))),
    deferred_graph_link_count: Math.max(0, Math.floor(safeNumber(source.deferred_graph_link_count, 0))),
    build_relevant_memory_count: Math.max(0, Math.floor(safeNumber(source.build_relevant_memory_count, 0))),
    mission_critical_memory_count: Math.max(0, Math.floor(safeNumber(source.mission_critical_memory_count, 0))),
    continuity_confidence: safeString(source.continuity_confidence) || 'low',
    continuity_reason: safeString(source.continuity_reason),
    graph_link_reason: safeString(source.graph_link_reason),
    recurrence_signals: safeArray(source.recurrence_signals, 8).map((signal) => safeString(signal)).filter(Boolean),
    memory_elevation_warnings: safeArray(source.memory_elevation_warnings, 8).map((warning) => safeString(warning)).filter(Boolean),
    source_provenance_summary: safeArray(source.source_provenance_summary, 8).map((item) => safeString(item)).filter(Boolean),
    top_memory_influencers: safeArray(source.top_memory_influencers, MAX_INFLUENCERS).map((memory) => normalizeMemory(memory)),
    memory_informed_recommendation: safeString(source.memory_informed_recommendation),
  };
}
