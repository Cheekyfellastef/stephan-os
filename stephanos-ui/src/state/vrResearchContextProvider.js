export const VR_RESEARCH_CONTEXT_PROVIDER_ID = 'vrResearch';
export const VR_RESEARCH_CONTEXT_SCHEMA_VERSION = 'stephanos.vr-research.workspace.v1';
export const VR_RESEARCH_CONTEXT_DOMAIN_ID = 'vr-research';

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_SUMMARY_ITEMS = 5;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
}

function boundedStrings(value, limit = MAX_SUMMARY_ITEMS) {
  return asList(value)
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        return asText(item.summary || item.title || item.id || item.status);
      }
      return asText(item);
    })
    .filter(Boolean)
    .slice(0, limit);
}

function candidateProjection(input = {}) {
  return asObject(input.vrResearchProjection)
    || asObject(input.sharedWorkspace?.vrResearchProjection)
    || asObject(input.sharedWorkspace?.domains?.[VR_RESEARCH_CONTEXT_DOMAIN_ID])
    || asObject(input.missionState?.vrResearchProjection)
    || asObject(input.missionState?.operatorReliefProjection?.vrResearchProjection)
    || asObject(input.context?.vrResearchProjection)
    || null;
}

export function inspectVrResearchProjection(input = {}) {
  const projection = candidateProjection(input);
  if (!projection) {
    return Object.freeze({
      status: 'MISSING',
      proofState: 'missing',
      projection: null,
      warning: 'Canonical vr-research Shared Workspace projection is unavailable.',
    });
  }

  const schemaVersion = asText(projection.schemaVersion);
  const domainId = asText(projection.domainId);
  if (schemaVersion !== VR_RESEARCH_CONTEXT_SCHEMA_VERSION || domainId !== VR_RESEARCH_CONTEXT_DOMAIN_ID) {
    return Object.freeze({
      status: 'INVALID',
      proofState: 'invalid',
      projection,
      warning: `Canonical vr-research projection identity is invalid: ${schemaVersion || 'missing-schema'} / ${domainId || 'missing-domain'}.`,
    });
  }

  const updatedAtMs = Date.parse(asText(projection.updatedAt));
  const nowMs = input.now instanceof Date
    ? input.now.getTime()
    : Date.parse(asText(input.now, new Date().toISOString()));
  const staleAfterMs = Number.isFinite(Number(projection.staleAfterMs)) && Number(projection.staleAfterMs) > 0
    ? Number(projection.staleAfterMs)
    : DEFAULT_STALE_AFTER_MS;

  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs)) {
    return Object.freeze({
      status: 'INVALID',
      proofState: 'invalid',
      projection,
      warning: 'Canonical vr-research projection has invalid freshness timestamps.',
    });
  }

  const ageMs = Math.max(0, nowMs - updatedAtMs);
  const stale = ageMs > staleAfterMs || asText(projection.freshness).toUpperCase() === 'STALE';
  return Object.freeze({
    status: stale ? 'STALE' : 'READY',
    proofState: stale ? 'stale' : 'ready',
    projection,
    ageMs,
    staleAfterMs,
    warning: stale ? 'Canonical vr-research Shared Workspace projection is stale and must be refreshed before it is treated as current truth.' : '',
  });
}

export function buildVrResearchContextSummary(input = {}) {
  const inspection = inspectVrResearchProjection(input);
  const projection = inspection.projection || {};
  const sourceRegistry = asObject(projection.sourceRegistry) || {};
  const writePolicy = asObject(projection.writePolicy) || {};

  return Object.freeze({
    status: inspection.status,
    proofState: inspection.proofState,
    schemaVersion: asText(projection.schemaVersion, 'unavailable'),
    domainId: asText(projection.domainId, VR_RESEARCH_CONTEXT_DOMAIN_ID),
    projectionId: asText(projection.projectionId, 'unavailable'),
    updatedAt: asText(projection.updatedAt, 'unknown'),
    ageMs: Number.isFinite(inspection.ageMs) ? inspection.ageMs : null,
    currentTarget: asText(projection.currentTarget, 'unknown'),
    desiredExperience: asText(projection.desiredExperience, 'unknown'),
    programmeStage: asText(projection.programmeStage, 'unknown'),
    nextAuthorisedAction: asText(projection.nextAuthorisedAction, 'Refresh canonical vr-research Shared Workspace projection.'),
    sourceCount: Number(sourceRegistry.sourceCount || 0),
    sourceHealth: asObject(sourceRegistry.sourceHealth) || {},
    licenceHealth: asObject(sourceRegistry.licenceHealth) || {},
    known: Object.freeze({
      factCount: asList(projection.facts).length,
      facts: Object.freeze(boundedStrings(projection.facts)),
      decisionCount: asList(projection.decisions).length,
      decisions: Object.freeze(boundedStrings(projection.decisions)),
    }),
    observed: Object.freeze({
      battleBridgeEvidenceCount: asList(projection.battleBridgeEvidence).length,
      battleBridgeEvidence: Object.freeze(boundedStrings(projection.battleBridgeEvidence)),
      proofRefs: Object.freeze(boundedStrings(projection.proofRefs, 10)),
    }),
    inferred: Object.freeze({
      hypothesisCount: asList(projection.hypotheses).length,
      hypotheses: Object.freeze(boundedStrings(projection.hypotheses)),
      capabilityCandidateCount: asList(projection.capabilityGraphCandidates).length,
    }),
    proposed: Object.freeze({
      nextAuthorisedAction: asText(projection.nextAuthorisedAction, 'unknown'),
      researchQueueCount: asList(projection.researchQueue).length,
      researchQueue: Object.freeze(boundedStrings(projection.researchQueue)),
      runtimeEvidenceRequestCount: asList(projection.runtimeEvidenceRequests).length,
    }),
    blocked: Object.freeze({
      blockerCount: asList(projection.blockers).length,
      blockers: Object.freeze(boundedStrings(projection.blockers)),
      stale: inspection.status === 'STALE',
      missing: inspection.status === 'MISSING',
      invalid: inspection.status === 'INVALID',
    }),
    evidencePlanes: Object.freeze(boundedStrings(projection.evidencePlanes, 10)),
    writePolicy: Object.freeze({
      validatedEventsOnly: writePolicy.validatedEventsOnly === true,
      agentMaySelfPromoteClaims: writePolicy.agentMaySelfPromoteClaims === true,
      privateAgentStateForbidden: writePolicy.privateAgentStateForbidden !== false,
      arbitraryShellAllowed: writePolicy.arbitraryShellAllowed === true,
      mergeAuthority: writePolicy.mergeAuthority === true,
    }),
  });
}

export const vrResearchContextProvider = Object.freeze({
  id: VR_RESEARCH_CONTEXT_PROVIDER_ID,
  label: 'VR Research',
  priority: 65,
  defaultEnabled: false,
  getSummary: buildVrResearchContextSummary,
  getWarnings: (input) => {
    const inspection = inspectVrResearchProjection(input);
    return inspection.warning ? [inspection.warning] : [];
  },
  getNextAction: (input) => {
    const inspection = inspectVrResearchProjection(input);
    if (inspection.status === 'READY') {
      return [asText(inspection.projection?.nextAuthorisedAction, 'Continue the next bounded VR research action.')];
    }
    return ['Refresh and validate the canonical vr-research Shared Workspace projection before answering from it.'];
  },
  getProofState: (input) => inspectVrResearchProjection(input).proofState,
  getCanonLinks: () => ['goal.1592.shared-vr-research-workspace', 'goal.1594.vr-context-provider'],
  getSourceRefs: () => [
    'vrResearchProjection',
    'sharedWorkspace.vrResearchProjection',
    'sharedWorkspace.domains.vr-research',
    'missionState.vrResearchProjection',
  ],
});
