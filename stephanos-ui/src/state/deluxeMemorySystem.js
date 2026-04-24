const MAX_CANDIDATES = 30;
const MAX_EXECUTION_LOG = 120;

function asText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asList(value, limit = 8) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => asText(entry)).filter(Boolean))].slice(0, limit);
}

function normalizeImpactLevel(value = 'low') {
  const normalized = asText(value, 'low').toLowerCase();
  return ['low', 'medium', 'high'].includes(normalized) ? normalized : 'low';
}

function normalizeMemoryClass(value = 'pattern') {
  const normalized = asText(value, 'pattern').toLowerCase();
  return ['decision', 'issue', 'pattern', 'improvement', 'constraint'].includes(normalized)
    ? normalized
    : 'pattern';
}

function normalizeConfidence(value, fallback = 0.62) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

export function createDefaultMissionMemory() {
  return {
    schemaVersion: 1,
    objective: '',
    structuredBrief: '',
    agentPlan: [],
    approvalState: 'analysis-only',
    executionStatus: 'inactive',
    blockers: [],
    updatedAt: '',
  };
}

export function createDefaultDeluxeMemoryState() {
  return {
    missionMemory: createDefaultMissionMemory(),
    memoryCandidates: [],
    executionLog: [],
  };
}

export function normalizeMissionMemory(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    schemaVersion: 1,
    objective: asText(source.objective),
    structuredBrief: asText(source.structuredBrief),
    agentPlan: asList(source.agentPlan, 12),
    approvalState: asText(source.approvalState, 'analysis-only'),
    executionStatus: asText(source.executionStatus, 'inactive'),
    blockers: asList(source.blockers, 12),
    updatedAt: asText(source.updatedAt),
  };
}

export function normalizeExecutionLog(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => ({
      id: asText(entry.id, `exec_${index + 1}`),
      type: asText(entry.type, 'execution-event'),
      summary: asText(entry.summary),
      evidenceRef: asText(entry.evidenceRef),
      source: asText(entry.source, 'system'),
      timestamp: asText(entry.timestamp),
      raw: entry.raw && typeof entry.raw === 'object' ? entry.raw : null,
    }))
    .filter((entry) => entry.summary)
    .slice(-MAX_EXECUTION_LOG);
}

export function normalizeMemoryCandidates(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => ({
      id: asText(entry.id, `memory_candidate_${index + 1}`),
      status: asText(entry.status, 'pending'),
      memoryClass: normalizeMemoryClass(entry.memoryClass),
      summary: asText(entry.summary),
      source: asText(entry.source, 'system'),
      confidence: normalizeConfidence(entry.confidence),
      evidenceRef: asText(entry.evidenceRef),
      impactLevel: normalizeImpactLevel(entry.impactLevel),
      createdAt: asText(entry.createdAt),
      reviewedAt: asText(entry.reviewedAt),
      reviewNote: asText(entry.reviewNote),
    }))
    .filter((entry) => entry.summary)
    .slice(-MAX_CANDIDATES);
}

export function buildMissionMemoryFromContext({ packetTruth = {}, workingMemory = {}, now = new Date().toISOString() } = {}) {
  const objective = asText(packetTruth.moveTitle || workingMemory.currentTask);
  const structuredBrief = asText(packetTruth.rationale || workingMemory.lastMissionPacketSummary || workingMemory.missionNote);
  const agentPlan = asList(packetTruth.dependencies?.length ? packetTruth.dependencies : packetTruth.evidence, 8);
  return normalizeMissionMemory({
    objective,
    structuredBrief,
    agentPlan,
    approvalState: packetTruth.approvalRequired === false ? 'not-required' : 'required',
    executionStatus: packetTruth.active ? 'in-progress' : (workingMemory.lastExecutionLifecycleState || 'inactive'),
    blockers: asList(packetTruth.blockers, 8),
    updatedAt: now,
  });
}

export function buildMemoryCandidatesFromTaskCompletion({ action = '', packetTruth = {}, executionLog = [], now = new Date().toISOString() } = {}) {
  const normalizedAction = asText(action).toLowerCase();
  if (!['complete', 'fail', 'confirm-validation-passed', 'confirm-validation-failed', 'rollback'].includes(normalizedAction)) {
    return [];
  }

  const moveRef = asText(packetTruth.moveId || packetTruth.mode, 'mission');
  const blockers = asList(packetTruth.blockers, 4);
  const evidenceRef = asText(executionLog.at(-1)?.evidenceRef || executionLog.at(-1)?.id, `mission-packet:${moveRef}`);

  const base = [
    {
      id: `candidate-${Date.parse(now)}-${moveRef}-pattern`,
      status: 'pending',
      memoryClass: normalizedAction.includes('fail') || normalizedAction === 'rollback' ? 'issue' : 'pattern',
      summary: normalizedAction.includes('fail') || normalizedAction === 'rollback'
        ? `Avoid repeating failure mode for ${moveRef}; enforce preflight checks before execution.`
        : `Reuse validated execution pattern for ${moveRef} when similar dependencies recur.`,
      source: 'agent',
      confidence: normalizedAction.includes('fail') || normalizedAction === 'rollback' ? 0.67 : 0.78,
      evidenceRef,
      impactLevel: normalizedAction.includes('fail') || normalizedAction === 'rollback' ? 'high' : 'medium',
      createdAt: now,
    },
  ];

  if (blockers.length > 0) {
    base.push({
      id: `candidate-${Date.parse(now)}-${moveRef}-constraint`,
      status: 'pending',
      memoryClass: 'constraint',
      summary: `Track recurring blockers for ${moveRef}: ${blockers.join(' | ')}`,
      source: 'system',
      confidence: 0.72,
      evidenceRef,
      impactLevel: 'high',
      createdAt: now,
    });
  }

  return normalizeMemoryCandidates(base);
}

export function formatDeluxeMemoryClipboard({ missionMemory = {}, memoryCandidates = [], durableSummary = [] } = {}) {
  const mission = normalizeMissionMemory(missionMemory);
  const candidates = normalizeMemoryCandidates(memoryCandidates);
  const durable = (Array.isArray(durableSummary) ? durableSummary : []).slice(0, 12);
  return [
    '# Stephanos Deluxe Memory Snapshot',
    '',
    '## Active Mission Memory',
    `- Objective: ${mission.objective || 'none'}`,
    `- Brief: ${mission.structuredBrief || 'none'}`,
    `- Approval: ${mission.approvalState}`,
    `- Execution: ${mission.executionStatus}`,
    `- Blockers: ${mission.blockers.join(', ') || 'none'}`,
    '',
    '## Memory Candidates (Pending/Reviewed)',
    ...candidates.map((candidate) => `- [${candidate.status}] ${candidate.memoryClass} · ${candidate.summary} (impact=${candidate.impactLevel}, confidence=${candidate.confidence.toFixed(2)}, evidence=${candidate.evidenceRef || 'n/a'})`),
    ...(candidates.length ? [] : ['- none']),
    '',
    '## Durable Memory Summary (Read-only)',
    ...durable.map((entry) => `- ${entry}`),
    ...(durable.length ? [] : ['- none']),
  ].join('\n');
}
