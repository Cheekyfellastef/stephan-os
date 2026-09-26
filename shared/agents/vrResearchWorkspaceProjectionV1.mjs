import { createHash } from 'node:crypto';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const VR_RESEARCH_WORKSPACE_SCHEMA_VERSION = 'stephanos.vr-research.workspace.v1';
export const VR_RESEARCH_DOMAIN_ID = 'vr-research';
export const VR_RESEARCH_WORKSPACE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

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

function sourceLicenceClass(source = {}) {
  const licence = text(source.licence, 'unknown');
  if (/commercial|proprietary|all rights reserved|analysis.only/i.test(`${licence} ${source.status || ''}`)) return 'RESTRICTED_OR_ANALYSIS_ONLY';
  if (/gpl|copyleft/i.test(licence)) return 'COPYLEFT';
  if (/mit|apache|bsd|permissive/i.test(licence)) return 'PERMISSIVE';
  return 'MIXED_OR_UNKNOWN';
}

function sourceHealth(source = {}) {
  const status = text(source.status, 'unknown');
  if (/withdrawn|blocked|missing|unknown/i.test(status)) return 'BLOCKED_OR_UNKNOWN';
  if (/candidate|analysis|metadata|operational/i.test(status)) return 'REGISTERED_WITH_BOUNDARY';
  if (/pinned|authoritative|benchmark|open.source/i.test(status)) return 'REGISTERED';
  return 'REGISTERED_WITH_BOUNDARY';
}

function projectSource(source = {}) {
  return Object.freeze({
    sourceId: text(source.source_id || source.sourceId, 'unknown-source'),
    title: text(source.title, 'Untitled source'),
    priority: text(source.priority, 'P?'),
    status: text(source.status, 'unknown'),
    health: sourceHealth(source),
    licenceClass: sourceLicenceClass(source),
    revision: text(source.snapshot_commit || source.snapshot_release || source.snapshot_version || source.snapshot_date, 'unresolved'),
    refreshOwner: source.refresh_owner || null,
    programmeLinks: Object.freeze(list(source.programme_links).map(Number).filter(Number.isFinite)),
    promotionRule: text(source.promotion_rule, 'Requires evidence-linked review before promotion.'),
  });
}

function projectExperiments(workspace = {}) {
  return Object.freeze(list(workspace.experiments).map((experiment = {}) => Object.freeze({
    id: text(experiment.id, 'unknown-experiment'),
    title: text(experiment.title, 'Untitled experiment'),
    status: text(experiment.status, 'idea'),
    hypothesis: text(experiment.hypothesis),
    relatedTechniques: Object.freeze(list(experiment.relatedTechniques).map(String)),
  })));
}

function currentResearchQueue(workspace = {}) {
  return Object.freeze(list(workspace.experiments)
    .filter((experiment = {}) => !['validated', 'complete', 'retired'].includes(text(experiment.status).toLowerCase()))
    .map((experiment = {}) => Object.freeze({
      id: text(experiment.id, 'unknown-experiment'),
      title: text(experiment.title, 'Untitled experiment'),
      status: text(experiment.status, 'idea'),
      owner: 'vr-research-agent',
    })));
}

export function buildVrResearchWorkspaceProjection(input = {}) {
  const registry = input.sourceRegistry && typeof input.sourceRegistry === 'object'
    ? input.sourceRegistry
    : {};
  const workspace = input.workspaceModel && typeof input.workspaceModel === 'object'
    ? input.workspaceModel
    : {};
  const sources = Object.freeze(list(registry.sources).map(projectSource));
  const sourceHealth = Object.freeze(sources.reduce((counts, source) => {
    counts[source.health] = (counts[source.health] || 0) + 1;
    return counts;
  }, {}));
  const licenceHealth = Object.freeze(sources.reduce((counts, source) => {
    counts[source.licenceClass] = (counts[source.licenceClass] || 0) + 1;
    return counts;
  }, {}));
  const updatedAt = text(input.updatedAt, new Date().toISOString());
  const experiments = projectExperiments(workspace);
  const blockers = Object.freeze(list(input.blockers).map((blocker) => Object.freeze({
    id: text(blocker?.id || blocker, 'unknown-blocker'),
    summary: text(blocker?.summary || blocker, 'Unspecified blocker'),
    owner: text(blocker?.owner, 'unassigned'),
    evidencePlane: text(blocker?.evidencePlane, 'STEPHANOS_PROPOSAL'),
  })));

  return Object.freeze({
    schemaVersion: VR_RESEARCH_WORKSPACE_SCHEMA_VERSION,
    domainId: VR_RESEARCH_DOMAIN_ID,
    projectionId: `vr-research-${canonicalHash({
      registrySchema: registry.schema_version || registry.schemaVersion,
      sourceIds: sources.map((source) => source.sourceId),
      workspaceSchema: workspace.schemaVersion,
      updatedAt,
    }).slice(0, 24)}`,
    updatedAt,
    staleAfterMs: VR_RESEARCH_WORKSPACE_STALE_AFTER_MS,
    freshness: 'FRESH',
    currentTarget: text(input.currentTarget || workspace.targets?.[0]?.name, 'Starfield VR'),
    desiredExperience: text(input.desiredExperience, 'Skyrim VR-quality Starfield with compounding reusable capability'),
    programmeStage: text(input.programmeStage, 'research-intelligence-buildout'),
    nextAuthorisedAction: text(input.nextAuthorisedAction, 'Complete canonical workspace, agent and live evidence connections.'),
    sourceRegistry: Object.freeze({
      schemaVersion: text(registry.schema_version || registry.schemaVersion, 'unknown'),
      sourceCount: sources.length,
      sourceHealth,
      licenceHealth,
      sources,
    }),
    facts: Object.freeze(list(input.facts)),
    hypotheses: Object.freeze(list(input.hypotheses)),
    decisions: Object.freeze(list(input.decisions)),
    experiments,
    researchQueue: currentResearchQueue(workspace),
    discoveryCandidates: Object.freeze(list(input.discoveryCandidates)),
    capabilityGraphCandidates: Object.freeze(list(input.capabilityGraphCandidates)),
    runtimeEvidenceRequests: Object.freeze(list(input.runtimeEvidenceRequests)),
    battleBridgeEvidence: Object.freeze(list(input.battleBridgeEvidence)),
    methodLibrary: Object.freeze(list(input.methodLibrary)),
    blockers,
    proofRefs: Object.freeze(list(input.proofRefs).map(String)),
    evidencePlanes: Object.freeze([
      'NORMATIVE_OR_OFFICIAL_SPECIFICATION',
      'OFFICIAL_AUTHORING_EVIDENCE',
      'DIRECT_PUBLIC_SOURCE_EVIDENCE',
      'PUBLIC_PRODUCT_OR_CREATOR_CLAIM',
      'APPROVED_LOCAL_PACKAGE_EVIDENCE',
      'OBSERVED_RUNTIME_OR_HEADSET_PROOF',
      'STEPHANOS_INFERENCE_OR_PROPOSAL',
    ]),
    writePolicy: Object.freeze({
      validatedEventsOnly: true,
      agentMaySelfPromoteClaims: false,
      privateAgentStateForbidden: true,
      arbitraryFileAccessAllowed: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
    }),
  });
}

export function createVrResearchProjectionStatusRecord(input = {}) {
  const projection = input.projection || buildVrResearchWorkspaceProjection(input);
  const timestampUtc = text(input.timestampUtc, projection.updatedAt);
  const correlationId = safeId(input.correlationId, 'vr-research-workspace-v1');
  const proofRefs = list(input.proofRefs).length > 0
    ? list(input.proofRefs).map(String)
    : ['evidence/receipts/vr-research-workspace-v1'];
  const record = {
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.STATUS,
    statusId: safeId(input.statusId, `vr-research-${canonicalHash({ timestampUtc, correlationId }).slice(0, 16)}`),
    participantId: 'stephanos-vr-research',
    timestampUtc,
    status: 'VR_RESEARCH_WORKSPACE_PROJECTION_READY',
    summary: `${projection.sourceRegistry.sourceCount} VR sources projected for ${projection.currentTarget}`,
    proofRefs,
    domainId: VR_RESEARCH_DOMAIN_ID,
    projectionId: projection.projectionId,
    correlationId,
    relatedIssue: '#1592',
  };
  return Object.freeze({
    record,
    validation: validateSharedWorkspaceRecord(record, input.validationOptions),
  });
}
