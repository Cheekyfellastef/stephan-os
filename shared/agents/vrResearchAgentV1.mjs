import { createHash } from 'node:crypto';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  createAgentCapabilityRecord,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const VR_RESEARCH_AGENT_SCHEMA_VERSION = 'stephanos.vr-research-agent.v1';
export const VR_RESEARCH_AGENT_ID = 'vr-research-agent';
export const VR_RESEARCH_AGENT_PROGRAMME = Object.freeze({
  programmeIssue: 1597,
  workspaceIssue: 1592,
  contextIssue: 1594,
  battleBridgeIssue: 1595,
  discoveryIssue: 1596,
});

export const VR_RESEARCH_AGENT_MODES = Object.freeze({
  READ_FIRST: 'read_first',
  PROPOSAL_ONLY: 'proposal_only',
});

export const VR_RESEARCH_AGENT_VERDICTS = Object.freeze({
  READY: 'VR_RESEARCH_AGENT_READY',
  NO_ACTION: 'VR_RESEARCH_AGENT_NO_ACTION',
  WORKSPACE_MISSING: 'BLOCKED_VR_RESEARCH_WORKSPACE_PROJECTION_MISSING',
  WORKSPACE_STALE: 'BLOCKED_VR_RESEARCH_WORKSPACE_PROJECTION_STALE',
  INVALID_INPUT: 'BLOCKED_VR_RESEARCH_AGENT_INPUT_INVALID',
});

export const VR_RESEARCH_AGENT_ACTIONS = Object.freeze({
  REFRESH_WORKSPACE: 'PROPOSE_WORKSPACE_REFRESH',
  TRIAGE_DISCOVERY: 'PROPOSE_DISCOVERY_TRIAGE',
  PREPARE_RESEARCH: 'PROPOSE_RESEARCH_PACKET',
  REQUEST_RUNTIME_EVIDENCE: 'PROPOSE_BATTLE_BRIDGE_EVIDENCE_REQUEST',
  UPDATE_CAPABILITY_GRAPH: 'PROPOSE_CAPABILITY_GRAPH_UPDATE',
  NO_ACTION: 'NO_ACTION',
});

export const VR_RESEARCH_AGENT_ROUTES = Object.freeze({
  GITHUB_FIRST: 'CHATGPT_GITHUB',
  OPENCLAW_LOCAL: 'OPENCLAW_LOCAL',
  BATTLE_BRIDGE: 'BATTLE_BRIDGE_FIXED_TEST',
  WAITING: 'WAITING_FOR_EXTERNAL_CONDITION',
  BLOCKED: 'BLOCKED_UNSAFE_OR_UNKNOWN',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const output = String(value).trim();
  return output || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function safeId(value, fallback = '') {
  const output = text(value);
  return SAFE_ID.test(output) ? output : fallback;
}

function canonicalHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function freshnessClassification(projection = {}, nowMs = Date.now()) {
  const explicit = text(projection.freshness || projection.freshnessClassification).toUpperCase();
  if (['FRESH', 'CURRENT'].includes(explicit)) return 'FRESH';
  if (['STALE', 'EXPIRED'].includes(explicit)) return 'STALE';
  const observedMs = timestampMs(projection.updatedAt || projection.timestampUtc || projection.freshnessUtc);
  if (!Number.isFinite(observedMs)) return 'UNKNOWN';
  const staleAfterMs = Number.isFinite(projection.staleAfterMs)
    ? projection.staleAfterMs
    : 24 * 60 * 60 * 1000;
  return nowMs - observedMs > staleAfterMs ? 'STALE' : 'FRESH';
}

function boundedSourceSummary(sourceRegistry = {}) {
  const sources = list(sourceRegistry.sources);
  const licenceClasses = {};
  for (const source of sources) {
    const licence = text(source?.licence, 'unknown');
    const key = /commercial|proprietary|all rights reserved/i.test(licence)
      ? 'restricted'
      : /gpl|copyleft/i.test(licence)
        ? 'copyleft'
        : /mit|apache|bsd|permissive/i.test(licence)
          ? 'permissive'
          : 'mixed_or_unknown';
    licenceClasses[key] = (licenceClasses[key] || 0) + 1;
  }
  return Object.freeze({
    schemaVersion: text(sourceRegistry.schema_version || sourceRegistry.schemaVersion, 'unknown'),
    sourceCount: sources.length,
    licenceClasses: Object.freeze(licenceClasses),
  });
}

export function createVrResearchAgentCapabilityRecord(input = {}) {
  return createAgentCapabilityRecord({
    agentId: VR_RESEARCH_AGENT_ID,
    timestampUtc: text(input.timestampUtc, new Date().toISOString()),
    mode: VR_RESEARCH_AGENT_MODES.READ_FIRST,
    boundedWritePath: 'shared-workspace/vr-research/proposals',
    trustedBuilder: false,
    proofRefs: list(input.proofRefs),
  });
}

export function buildVrResearchAgentReadModel(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const workspaceProjection = input.workspaceProjection;
  if (!workspaceProjection || typeof workspaceProjection !== 'object') {
    return Object.freeze({
      schemaVersion: VR_RESEARCH_AGENT_SCHEMA_VERSION,
      agentId: VR_RESEARCH_AGENT_ID,
      ready: false,
      verdict: VR_RESEARCH_AGENT_VERDICTS.WORKSPACE_MISSING,
      freshness: 'UNKNOWN',
      sourceSummary: boundedSourceSummary(input.sourceRegistry),
      blockers: ['canonical-vr-research-projection-missing'],
    });
  }

  const freshness = freshnessClassification(workspaceProjection, nowMs);
  const blockers = [];
  if (freshness !== 'FRESH') blockers.push(`canonical-vr-research-projection-${freshness.toLowerCase()}`);

  return Object.freeze({
    schemaVersion: VR_RESEARCH_AGENT_SCHEMA_VERSION,
    agentId: VR_RESEARCH_AGENT_ID,
    ready: blockers.length === 0,
    verdict: blockers.length === 0
      ? VR_RESEARCH_AGENT_VERDICTS.READY
      : VR_RESEARCH_AGENT_VERDICTS.WORKSPACE_STALE,
    freshness,
    target: text(workspaceProjection.currentTarget || workspaceProjection.target, 'Starfield VR'),
    programmeStage: text(workspaceProjection.programmeStage || workspaceProjection.stage, 'unknown'),
    sourceSummary: boundedSourceSummary(input.sourceRegistry),
    researchQueue: list(workspaceProjection.researchQueue),
    discoveryCandidates: list(workspaceProjection.discoveryCandidates),
    graphCandidates: list(workspaceProjection.capabilityGraphCandidates),
    runtimeEvidenceRequests: list(workspaceProjection.runtimeEvidenceRequests),
    blockers: Object.freeze(blockers),
  });
}

function routeForAction(action, input = {}) {
  const available = input.availableSurfaces && typeof input.availableSurfaces === 'object'
    ? input.availableSurfaces
    : {};
  if (action === VR_RESEARCH_AGENT_ACTIONS.REQUEST_RUNTIME_EVIDENCE) {
    return available.battleBridge === true
      ? VR_RESEARCH_AGENT_ROUTES.BATTLE_BRIDGE
      : VR_RESEARCH_AGENT_ROUTES.WAITING;
  }
  if (action === VR_RESEARCH_AGENT_ACTIONS.TRIAGE_DISCOVERY && available.openClaw === true) {
    return VR_RESEARCH_AGENT_ROUTES.OPENCLAW_LOCAL;
  }
  if (action === VR_RESEARCH_AGENT_ACTIONS.NO_ACTION) return VR_RESEARCH_AGENT_ROUTES.WAITING;
  return VR_RESEARCH_AGENT_ROUTES.GITHUB_FIRST;
}

function proposal(action, reason, readModel, input = {}) {
  const route = routeForAction(action, input);
  const actionId = `vr-research-${canonicalHash({
    action,
    reason,
    target: readModel.target,
    programmeStage: readModel.programmeStage,
    sourceCount: readModel.sourceSummary.sourceCount,
  }).slice(0, 20)}`;
  return Object.freeze({
    schemaVersion: VR_RESEARCH_AGENT_SCHEMA_VERSION,
    agentId: VR_RESEARCH_AGENT_ID,
    actionId,
    action,
    route,
    reason,
    relatedIssue: `#${VR_RESEARCH_AGENT_PROGRAMME.programmeIssue}`,
    requiresOperator: action === VR_RESEARCH_AGENT_ACTIONS.REQUEST_RUNTIME_EVIDENCE,
    mutatesSource: false,
    executesRuntime: false,
    mergeAuthority: false,
    arbitraryShellAllowed: false,
  });
}

export function planVrResearchAgentCycle(input = {}) {
  const readModel = buildVrResearchAgentReadModel(input);
  if (!readModel.ready) {
    const action = readModel.verdict === VR_RESEARCH_AGENT_VERDICTS.WORKSPACE_MISSING
      ? VR_RESEARCH_AGENT_ACTIONS.REFRESH_WORKSPACE
      : VR_RESEARCH_AGENT_ACTIONS.REFRESH_WORKSPACE;
    return Object.freeze({
      schemaVersion: VR_RESEARCH_AGENT_SCHEMA_VERSION,
      agentId: VR_RESEARCH_AGENT_ID,
      mode: VR_RESEARCH_AGENT_MODES.PROPOSAL_ONLY,
      verdict: readModel.verdict,
      readModel,
      proposal: proposal(action, readModel.blockers[0] || 'workspace-refresh-required', readModel, input),
    });
  }

  let action = VR_RESEARCH_AGENT_ACTIONS.NO_ACTION;
  let reason = 'no-material-vr-research-change';
  if (readModel.runtimeEvidenceRequests.length > 0) {
    action = VR_RESEARCH_AGENT_ACTIONS.REQUEST_RUNTIME_EVIDENCE;
    reason = 'runtime-or-headset-evidence-required';
  } else if (readModel.discoveryCandidates.length > 0) {
    action = VR_RESEARCH_AGENT_ACTIONS.TRIAGE_DISCOVERY;
    reason = 'untriaged-discovery-candidates-present';
  } else if (readModel.graphCandidates.length > 0) {
    action = VR_RESEARCH_AGENT_ACTIONS.UPDATE_CAPABILITY_GRAPH;
    reason = 'verified-capability-graph-candidates-present';
  } else if (readModel.researchQueue.length > 0) {
    action = VR_RESEARCH_AGENT_ACTIONS.PREPARE_RESEARCH;
    reason = 'bounded-research-queue-not-empty';
  }

  return Object.freeze({
    schemaVersion: VR_RESEARCH_AGENT_SCHEMA_VERSION,
    agentId: VR_RESEARCH_AGENT_ID,
    mode: VR_RESEARCH_AGENT_MODES.PROPOSAL_ONLY,
    verdict: action === VR_RESEARCH_AGENT_ACTIONS.NO_ACTION
      ? VR_RESEARCH_AGENT_VERDICTS.NO_ACTION
      : VR_RESEARCH_AGENT_VERDICTS.READY,
    readModel,
    proposal: proposal(action, reason, readModel, input),
  });
}

export function createVrResearchAgentWorkspaceRecords(input = {}) {
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const cycle = input.cycle || planVrResearchAgentCycle(input);
  const capability = createVrResearchAgentCapabilityRecord({
    timestampUtc,
    proofRefs: list(input.proofRefs),
  });
  const correlationId = safeId(input.correlationId, 'vr-research-agent-cycle');
  const proofRefs = list(input.proofRefs).length > 0 ? list(input.proofRefs) : ['evidence/receipts/vr-research-agent-v1'];
  const status = {
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.PARTICIPANT_STATUS,
    participantStatusId: safeId(input.participantStatusId, `vr-research-${canonicalHash({ timestampUtc, correlationId }).slice(0, 16)}`),
    participantId: VR_RESEARCH_AGENT_ID,
    timestampUtc,
    correlationId,
    relatedIssue: `#${VR_RESEARCH_AGENT_PROGRAMME.programmeIssue}`,
    status: cycle.verdict,
    summary: `${cycle.proposal.action} via ${cycle.proposal.route}`,
    body: JSON.stringify({
      mode: cycle.mode,
      actionId: cycle.proposal.actionId,
      action: cycle.proposal.action,
      route: cycle.proposal.route,
      requiresOperator: cycle.proposal.requiresOperator,
      freshness: cycle.readModel.freshness,
      sourceCount: cycle.readModel.sourceSummary.sourceCount,
    }),
    proofRefs,
  };
  return Object.freeze({
    capability,
    status,
    validations: Object.freeze({
      capability: validateSharedWorkspaceRecord(capability, input.validationOptions),
      status: validateSharedWorkspaceRecord(status, input.validationOptions),
    }),
  });
}
