import { normalizeMemoryElevationResult } from '../../../shared/ai/memoryElevationContract.mjs';

const MEMORY_CLASS_SCORES = Object.freeze({
  'plain-memory': 1,
  'graph-linked-memory': 2,
  'build-relevant-memory': 3,
  'mission-critical-continuity-memory': 4,
});

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function stableKey(source = {}) {
  return [source.sourceType, source.sourceRef, source.summary.toLowerCase()].join('|');
}

function classifyMemoryClass({ promptClassification = {}, tags = new Set(), recurrenceCount = 0 }) {
  const selfBuild = promptClassification?.selfBuild?.detected === true;
  const troubleshooting = promptClassification?.troubleshooting === true;

  if (selfBuild && (tags.has('architectural-intent') || tags.has('operator-control') || recurrenceCount >= 2)) {
    return 'mission-critical-continuity-memory';
  }
  if (tags.has('build') || tags.has('proposal') || tags.has('mission-packet') || troubleshooting) {
    return 'build-relevant-memory';
  }
  if (tags.has('graph')) {
    return 'graph-linked-memory';
  }
  return 'plain-memory';
}

function deriveTags(text = '') {
  const lower = safeString(text).toLowerCase();
  const tags = new Set();
  if (!lower) return tags;
  if (/graph|node|edge|entity|relationship/.test(lower)) tags.add('graph');
  if (/build|compile|verify|dist|merge|test|pipeline/.test(lower)) tags.add('build');
  if (/proposal|packet/.test(lower)) tags.add('proposal');
  if (/mission/.test(lower)) tags.add('mission-packet');
  if (/operator|approval|no fake|truth/.test(lower)) tags.add('operator-control');
  if (/architect|north star|long[-\s]?term|continuity|identity/.test(lower)) tags.add('architectural-intent');
  if (/timeout|route|provider|fallback|stale/.test(lower)) tags.add('troubleshooting');
  return tags;
}

function classifyImportance(memoryClass, recurrenceCount, promptClassification = {}) {
  const base = {
    'plain-memory': 0.34,
    'graph-linked-memory': 0.52,
    'build-relevant-memory': 0.72,
    'mission-critical-continuity-memory': 0.88,
  }[memoryClass] || 0.3;
  const recurrenceBoost = Math.min(0.12, recurrenceCount * 0.04);
  const selfBuildBoost = promptClassification?.selfBuild?.detected ? 0.05 : 0;
  return Number(Math.min(0.99, base + recurrenceBoost + selfBuildBoost).toFixed(3));
}

function classifyConfidence(sourceType, reasons = [], hasSummary) {
  const base = sourceType === 'durable-memory'
    ? 0.76
    : sourceType === 'proposal-history' || sourceType === 'mission-packet-history'
      ? 0.7
      : sourceType === 'operator-state'
        ? 0.74
        : sourceType === 'retrieval'
          ? 0.58
          : 0.5;
  const reasonBoost = Math.min(0.14, reasons.length * 0.035);
  const summaryPenalty = hasSummary ? 0 : 0.2;
  return Number(Math.max(0.15, Math.min(0.98, base + reasonBoost - summaryPenalty)).toFixed(3));
}

function memoryFromContinuity(records = []) {
  return safeArray(records).map((record, index) => ({
    memoryId: safeString(record?.id) || `continuity-${index}`,
    summary: safeString(record?.summary || record?.change),
    sourceType: 'durable-memory',
    sourceRef: safeString(record?.id) || `continuity:${index}`,
    subsystem: safeString(record?.subsystem || 'continuity'),
    observedAt: safeString(record?.timestamp),
  })).filter((memory) => memory.summary);
}

function memoryFromRetrieval(retrievalContext = {}) {
  return safeArray(retrievalContext?.sources).map((source, index) => ({
    memoryId: `retrieval-${index}`,
    summary: safeString(source?.summary || source?.path || source?.sourceId),
    sourceType: 'retrieval',
    sourceRef: safeString(source?.path || source?.sourceId || `retrieval:${index}`),
    subsystem: 'retrieval',
    observedAt: '',
  })).filter((memory) => memory.summary);
}

function memoryFromOperator(operatorContext = {}) {
  const lines = [
    ...safeArray(operatorContext?.openTensions),
    ...safeArray(operatorContext?.roadmapSignals),
    ...safeArray(operatorContext?.subsystemInventory),
  ].map((value) => safeString(value)).filter(Boolean);
  return lines.slice(0, 8).map((line, index) => ({
    memoryId: `operator-${index}`,
    summary: line,
    sourceType: 'operator-state',
    sourceRef: `operator:${index}`,
    subsystem: 'operator',
    observedAt: '',
  }));
}

function memoryFromProposalHistory(proposalPacket = {}) {
  const items = [];
  if (safeString(proposalPacket?.recommended_move_summary?.title)) {
    items.push({
      memoryId: `proposal-${safeString(proposalPacket?.recommended_move_summary?.move_id) || 'move'}`,
      summary: safeString(proposalPacket.recommended_move_summary.title),
      sourceType: 'proposal-history',
      sourceRef: safeString(proposalPacket?.recommended_move_summary?.move_id) || 'proposal:move',
      subsystem: 'proposal',
      observedAt: '',
    });
  }
  return items;
}

function buildGraphLinks(memory, knowledgeGraphContext = {}) {
  const entities = safeArray(knowledgeGraphContext?.entities);
  const summary = memory.summary.toLowerCase();
  const matchingEntity = entities.find((entity) => {
    const id = safeString(entity?.id).toLowerCase();
    const label = safeString(entity?.label || entity?.name).toLowerCase();
    return (id && summary.includes(id)) || (label && summary.includes(label));
  });

  if (matchingEntity) {
    return [{
      relation: 'memory-supports-node',
      state: 'linked',
      entityId: safeString(matchingEntity.id),
      entityLabel: safeString(matchingEntity.label || matchingEntity.name || matchingEntity.id),
      edgeId: '',
      reason: 'Memory summary matched an existing graph entity.',
    }];
  }

  return [{
    relation: 'memory-relevant-to-subsystem',
    state: 'deferred',
    entityId: '',
    entityLabel: memory.subsystem || 'unknown-subsystem',
    edgeId: '',
    reason: 'No existing graph entity matched; deferred graph intent emitted without claiming graph node existence.',
  }];
}

export function buildMemoryElevation({
  promptClassification = {},
  continuityContext = null,
  retrievalContext = null,
  operatorContext = null,
  knowledgeGraphContext = null,
  proposalPacket = null,
} = {}) {
  const candidates = [
    ...memoryFromContinuity(continuityContext?.records),
    ...memoryFromRetrieval(retrievalContext),
    ...memoryFromOperator(operatorContext),
    ...memoryFromProposalHistory(proposalPacket),
  ];

  const deduped = [];
  const seen = new Set();
  const recurrence = new Map();

  candidates.forEach((candidate) => {
    const key = stableKey(candidate);
    recurrence.set(candidate.summary.toLowerCase(), (recurrence.get(candidate.summary.toLowerCase()) || 0) + 1);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(candidate);
  });

  const elevated = deduped.map((candidate) => {
    const recurrenceCount = recurrence.get(candidate.summary.toLowerCase()) || 0;
    const tags = deriveTags(candidate.summary);
    const memoryClass = classifyMemoryClass({ promptClassification, tags, recurrenceCount });
    const reasons = [
      recurrenceCount > 1 ? `Recurring signal observed ${recurrenceCount} time(s).` : 'Single observed signal.',
      promptClassification?.selfBuild?.detected ? 'Self-build prompt detected; continuity signals prioritized.' : 'Prompt class did not require self-build escalation.',
      tags.has('operator-control') ? 'Operator control/no-fake-state preference signal detected.' : '',
      tags.has('build') ? 'Build/test/dist relevance detected.' : '',
    ].filter(Boolean);
    const links = buildGraphLinks(candidate, knowledgeGraphContext);
    return {
      memoryId: candidate.memoryId,
      summary: candidate.summary,
      sourceType: candidate.sourceType,
      sourceRef: candidate.sourceRef,
      subsystem: candidate.subsystem,
      memoryClass,
      importance: classifyImportance(memoryClass, recurrenceCount, promptClassification),
      confidence: classifyConfidence(candidate.sourceType, reasons, Boolean(candidate.summary)),
      recurrenceCount,
      reasons,
      provenance: {
        sourceType: candidate.sourceType,
        sourceRef: candidate.sourceRef,
        observedAt: candidate.observedAt,
      },
      graphLinks: links,
    };
  }).sort((left, right) => {
    const classDiff = MEMORY_CLASS_SCORES[right.memoryClass] - MEMORY_CLASS_SCORES[left.memoryClass];
    if (classDiff !== 0) return classDiff;
    if (right.importance !== left.importance) return right.importance - left.importance;
    return left.memoryId.localeCompare(right.memoryId);
  });

  const topInfluencers = elevated.slice(0, 6);
  const graphLinkedCount = elevated.filter((memory) => memory.graphLinks.some((link) => link.state === 'linked')).length;
  const deferredGraphCount = elevated.reduce((count, memory) => count + memory.graphLinks.filter((link) => link.state === 'deferred').length, 0);
  const buildRelevantCount = elevated.filter((memory) => ['build-relevant-memory', 'mission-critical-continuity-memory'].includes(memory.memoryClass)).length;
  const missionCriticalCount = elevated.filter((memory) => memory.memoryClass === 'mission-critical-continuity-memory').length;
  const recurrenceSignals = elevated
    .filter((memory) => memory.recurrenceCount > 1)
    .map((memory) => `${memory.summary} (x${memory.recurrenceCount})`)
    .slice(0, 6);
  const warnings = [];
  if (!elevated.length) {
    warnings.push('No memory candidates available for elevation; continuity remained sparse and bounded.');
  }
  if (!graphLinkedCount && deferredGraphCount > 0) {
    warnings.push('Graph links are currently deferred; no matching graph entities were found.');
  }

  return normalizeMemoryElevationResult({
    active: true,
    mode: promptClassification?.selfBuild?.detected ? 'self-build-elevated' : 'bounded-minimal',
    memory_truth_preserved: true,
    graph_link_truth_preserved: true,
    memory_candidates_considered: candidates.length,
    elevated_memory_count: elevated.length,
    graph_linked_memory_count: graphLinkedCount,
    deferred_graph_link_count: deferredGraphCount,
    build_relevant_memory_count: buildRelevantCount,
    mission_critical_memory_count: missionCriticalCount,
    continuity_confidence: missionCriticalCount > 0 ? 'high' : (buildRelevantCount > 0 ? 'medium' : 'low'),
    continuity_reason: missionCriticalCount > 0
      ? 'Mission-critical continuity memories were elevated with bounded confidence.'
      : 'Continuity remained bounded to available memory and provenance.',
    graph_link_reason: graphLinkedCount > 0
      ? 'Elevated memories linked to existing graph entities where matches were observed.'
      : 'Elevated memories emitted deferred graph intents where graph entities were not observed.',
    recurrence_signals: recurrenceSignals,
    memory_elevation_warnings: warnings,
    source_provenance_summary: [...new Set(elevated.map((memory) => `${memory.sourceType}:${memory.sourceRef || 'n/a'}`))].slice(0, 8),
    top_memory_influencers: topInfluencers,
    memory_informed_recommendation: topInfluencers[0]
      ? `Prioritize ${topInfluencers[0].memoryClass} grounded by ${topInfluencers[0].sourceType}.`
      : 'No memory-informed recommendation available.',
  });
}
