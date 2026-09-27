export const OPENCLAW_LOCAL_ID = 'openclaw-local';
export const OPENCLAW_STANDALONE_ID = 'openclaw-standalone';
export const OPENCLAW_TWO_AGENT_IDS = Object.freeze([OPENCLAW_LOCAL_ID, OPENCLAW_STANDALONE_ID]);

export const OPENCLAW_AGENT_PROFILES = Object.freeze({
  [OPENCLAW_LOCAL_ID]: Object.freeze({
    participantId: OPENCLAW_LOCAL_ID,
    label: 'OpenClaw Local',
    scope: 'STEPHANOS_ONLY',
    owns: Object.freeze(['stephan-os', 'stephanos-runtime', 'shared-workspace', 'approved-stephanos-paths']),
    mustHandoff: Object.freeze(['whole-pc', 'non-stephanos-desktop', 'non-stephanos-files', 'general-windows']),
    handoffTarget: OPENCLAW_STANDALONE_ID,
  }),
  [OPENCLAW_STANDALONE_ID]: Object.freeze({
    participantId: OPENCLAW_STANDALONE_ID,
    label: 'OpenClaw Standalone',
    scope: 'GOVERNED_WHOLE_PC',
    owns: Object.freeze(['whole-pc', 'desktop', 'apps', 'files', 'general-windows']),
    mustHandoff: Object.freeze(['stephan-os-source-ownership', 'stephanos-internal-runtime-ownership']),
    handoffTarget: OPENCLAW_LOCAL_ID,
  }),
});

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function freeze(value) { return Object.freeze(value); }

export function projectOpenClawQualificationScoreV1(result = {}) {
  const participantId = text(result.participantId);
  if (!OPENCLAW_AGENT_PROFILES[participantId]) {
    return freeze({ valid: false, verdict: 'UNKNOWN_OPENCLAW_IDENTITY', participantId, score: null });
  }
  const evaluation = result.evaluation || {};
  const counts = evaluation.counts || {};
  const grounded = Number(counts.grounded || 0);
  const partial = Number(counts.partial || 0);
  const buildableGaps = Number(counts.buildableGaps || 0);
  const score = Math.max(0, Math.min(10, grounded + (partial * 0.5) - buildableGaps));
  return freeze({
    valid: evaluation.valid === true,
    verdict: evaluation.state || 'SAFE_HOLD',
    participantId,
    label: OPENCLAW_AGENT_PROFILES[participantId].label,
    scope: OPENCLAW_AGENT_PROFILES[participantId].scope,
    score,
    scoreMaximum: 10,
    independentlyQualified: evaluation.valid === true && evaluation.state === 'SETTLED',
    proofRefs: Object.freeze(Array.isArray(result.proofRefs) ? [...result.proofRefs] : []),
  });
}

export function evaluateOpenClawScopeHandoffV1(input = {}) {
  const fromParticipantId = text(input.fromParticipantId);
  const workScope = text(input.workScope).toLowerCase();
  const profile = OPENCLAW_AGENT_PROFILES[fromParticipantId];
  if (!profile) return freeze({ valid: false, verdict: 'UNKNOWN_OPENCLAW_IDENTITY' });
  if (!workScope) return freeze({ valid: false, verdict: 'WORK_SCOPE_REQUIRED' });

  const localOwn = new Set(['stephan-os', 'stephanos-runtime', 'shared-workspace', 'approved-stephanos-paths']);
  const standaloneOwn = new Set(['whole-pc', 'desktop', 'apps', 'files', 'general-windows']);
  const localInternal = new Set(['stephan-os-source-ownership', 'stephanos-internal-runtime-ownership']);

  if (fromParticipantId === OPENCLAW_LOCAL_ID && standaloneOwn.has(workScope)) {
    return freeze({ valid: true, verdict: 'HANDOFF_REQUIRED', fromParticipantId, toParticipantId: OPENCLAW_STANDALONE_ID, workScope });
  }
  if (fromParticipantId === OPENCLAW_STANDALONE_ID && (localOwn.has(workScope) || localInternal.has(workScope))) {
    return freeze({ valid: true, verdict: 'HANDOFF_REQUIRED', fromParticipantId, toParticipantId: OPENCLAW_LOCAL_ID, workScope });
  }
  const owned = fromParticipantId === OPENCLAW_LOCAL_ID ? localOwn.has(workScope) : standaloneOwn.has(workScope);
  return freeze({
    valid: owned,
    verdict: owned ? 'SCOPE_OWNED' : 'SAFE_HOLD_UNCLASSIFIED_SCOPE',
    fromParticipantId,
    toParticipantId: null,
    workScope,
  });
}
