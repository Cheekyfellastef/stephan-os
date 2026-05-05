const CANDIDATE_GROUPS = Object.freeze([
  'architecture_canon_candidate',
  'durable_operator_preference',
  'project_lesson',
  'verification_rule',
  'capability_gap',
  'do_not_repeat_warning',
  'mission_history',
  'temporary_note',
  'rejected',
  'saved',
  'duplicate',
  'conflict',
]);

const ACTIONS = Object.freeze([
  'approve_for_durable_memory',
  'reject_candidate',
  'keep_as_draft',
  'promote_to_canon_candidate',
  'mark_duplicate',
  'mark_stale',
  'no_action',
]);

const APPROVAL_TYPES = new Set(['architecture_canon_candidate', 'durable_operator_preference', 'project_lesson', 'verification_rule', 'capability_gap', 'do_not_repeat_warning']);

const DURABLE_TYPES = new Set(['architecture_canon_candidate', 'durable_operator_preference', 'project_lesson', 'verification_rule', 'capability_gap', 'do_not_repeat_warning', 'mission_history']);

function asText(value, fallback = '') { if (value == null) return fallback; const text = String(value).trim(); return text || fallback; }
function asArray(value) { return Array.isArray(value) ? value : []; }

function normalizeType(value) {
  const raw = asText(value, 'temporary_note').toLowerCase();
  if (raw === 'architecture_canon') return 'architecture_canon_candidate';
  if (raw === 'workflow_preference') return 'durable_operator_preference';
  if (raw === 'bug_lesson') return 'project_lesson';
  return CANDIDATE_GROUPS.includes(raw) ? raw : 'temporary_note';
}

function summarizeInfluence(type, summary = '') {
  const effects = [];
  if (['project_lesson', 'do_not_repeat_warning', 'mission_history'].includes(type)) effects.push('future mission proposals', 'Codex handoffs');
  if (type === 'verification_rule') effects.push('verification rules');
  if (type === 'architecture_canon_candidate') effects.push('architecture warnings', 'finish authority warnings');
  if (type === 'durable_operator_preference') effects.push('future mission proposals');
  if (type === 'capability_gap') effects.push('Skill Forge / Capability Radar signals');
  if (/openclaw|delegation/i.test(summary)) effects.push('OpenClaw delegation boundaries');
  if (effects.length === 0) effects.push('future mission proposals');
  return { affectedSubsystems: [...new Set(effects)], influencePreview: `This ${type} would influence ${[...new Set(effects)].join(', ')} if approved.` };
}

function fingerprint(candidate) {
  return `${candidate.memoryCandidateType}|${asText(candidate.sourceMissionId, 'unknown')}|${asText(candidate.summary).toLowerCase()}`;
}

function buildCandidate(input = {}, index = 0, source = 'unknown') {
  const type = normalizeType(input.memoryCandidateType || input.type);
  const status = asText(input.status, 'pending_review').toLowerCase();
  const promotionState = asText(input.promotionState, status === 'approved' ? 'saved' : 'pending');
  const requiresOperatorApproval = input.requiresOperatorApproval === true || APPROVAL_TYPES.has(type);
  const { affectedSubsystems, influencePreview } = summarizeInfluence(type, asText(input.summary || input.text));
  return {
    candidateId: asText(input.candidateId || input.id, `${source}-${index + 1}`),
    summary: asText(input.summary || input.text || input.intentSummary, 'No summary provided.'),
    memoryCandidateType: type,
    source,
    sourceMissionId: asText(input.sourceMissionId || input.missionId, 'unknown-mission'),
    sourceSubsystem: asText(input.sourceSubsystem || input.generatedFrom, source),
    createdAt: asText(input.createdAt, new Date(0).toISOString()),
    status,
    promotionState,
    promotionTarget: asText(input.promotionTarget, type === 'architecture_canon_candidate' ? 'project_canon' : 'durable_memory'),
    requiresOperatorApproval,
    durability: DURABLE_TYPES.has(type) ? 'durable_candidate' : 'session_note',
    confidence: Number(input.confidence ?? 0.5),
    reason: asText(input.reason, 'Candidate queued for operator review.'),
    influencePreview,
    affectedSubsystems,
    relatedCanon: asArray(input.relatedCanon),
    duplicateOf: '',
    conflictWith: [],
    suggestedAction: 'keep_as_draft',
    warningLevel: 'none',
    operatorActionAvailable: ACTIONS,
    _fingerprint: fingerprint({ memoryCandidateType: type, sourceMissionId: asText(input.sourceMissionId || input.missionId), summary: asText(input.summary || input.text || input.intentSummary) }),
  };
}

export function buildMemoryLibrarianQueue({ memoryCandidates = [], verificationLessonCandidates = [], missionMemoryCandidates = [], existingPendingCandidates = [], verificationJudge = {}, capabilitySignals = [], existingApprovedMemory = [] } = {}) {
  const merged = [
    ...asArray(memoryCandidates).map((entry, i) => buildCandidate(entry, i, 'operator-intent')),
    ...asArray(verificationLessonCandidates).map((entry, i) => buildCandidate(entry, i, 'verification-return')),
    ...asArray(missionMemoryCandidates).map((entry, i) => buildCandidate(entry, i, 'mission-memory-orchestrator')),
    ...asArray(existingPendingCandidates).map((entry, i) => buildCandidate(entry, i, 'pending-candidates')),
    ...asArray(capabilitySignals).map((entry, i) => buildCandidate({ ...entry, memoryCandidateType: 'capability_gap' }, i, 'skill-forge')),
  ];

  const approved = new Set(asArray(existingApprovedMemory).map((entry) => asText(entry.summary).toLowerCase()));
  const byFingerprint = new Map();
  const queue = merged.map((candidate) => {
    const normalizedSummary = candidate.summary.toLowerCase();
    const duplicate = byFingerprint.get(candidate._fingerprint) || (approved.has(normalizedSummary) ? 'approved-memory' : '');
    if (!byFingerprint.has(candidate._fingerprint)) byFingerprint.set(candidate._fingerprint, candidate.candidateId);
    const conflictWith = [];
    if (candidate.memoryCandidateType === 'durable_operator_preference' && /always|never/.test(normalizedSummary)) conflictWith.push('preference_conflict_hint');
    if (candidate.memoryCandidateType === 'architecture_canon_candidate' && /override|bypass|ignore/.test(normalizedSummary)) conflictWith.push('canon_conflict_hint');
    if (asArray(verificationJudge.blockers).length && candidate.source === 'verification-return') conflictWith.push('verification_blocker_context');
    const stale = candidate.status === 'rejected' || candidate.status === 'stale';
    let suggestedAction = stale ? 'mark_stale' : 'keep_as_draft';
    let warningLevel = 'none';
    if (duplicate) { suggestedAction = 'mark_duplicate'; warningLevel = 'low'; }
    if (conflictWith.length) { suggestedAction = 'keep_as_draft'; warningLevel = 'high'; }
    if (!duplicate && !conflictWith.length && candidate.requiresOperatorApproval && candidate.status !== 'rejected') {
      suggestedAction = candidate.memoryCandidateType === 'architecture_canon_candidate' ? 'promote_to_canon_candidate' : 'approve_for_durable_memory';
      warningLevel = 'medium';
    }
    return { ...candidate, duplicateOf: duplicate, conflictWith, suggestedAction, warningLevel };
  });

  const counts = {
    pending: queue.filter((c) => c.status !== 'rejected' && c.promotionState !== 'saved').length,
    approvalRequired: queue.filter((c) => c.requiresOperatorApproval && c.status !== 'rejected' && c.promotionState !== 'saved').length,
    canonCandidates: queue.filter((c) => c.memoryCandidateType === 'architecture_canon_candidate').length,
    projectLessons: queue.filter((c) => c.memoryCandidateType === 'project_lesson').length,
    capabilityGaps: queue.filter((c) => c.memoryCandidateType === 'capability_gap').length,
    duplicates: queue.filter((c) => Boolean(c.duplicateOf)).length,
    conflicts: queue.filter((c) => c.conflictWith.length > 0).length,
    saved: queue.filter((c) => c.promotionState === 'saved').length,
    rejected: queue.filter((c) => c.status === 'rejected').length,
  };

  const groups = Object.fromEntries(CANDIDATE_GROUPS.map((group) => [group, queue.filter((entry) => entry.memoryCandidateType === group || entry.status === group || entry.promotionState === group)]));
  return { queue, groups, counts };
}

export { CANDIDATE_GROUPS, ACTIONS };
