import { createHash } from 'node:crypto';

import { buildVrResearchWorkspaceProjection } from './vrResearchWorkspaceProjectionV1.mjs';
import { buildVrResearchAgentReadModel } from './vrResearchAgentV1.mjs';

export const VR_TEACHING_WORKSPACE_SCHEMA_VERSION = 'stephanos.vr-teaching-workspace-projection.v1';
export const VR_TEACHING_PROJECTION_VERDICT = Object.freeze({
  READY: 'VR_TEACHING_WORKSPACE_PROJECTION_READY',
  BLOCKED: 'VR_TEACHING_WORKSPACE_PROJECTION_BLOCKED',
});

const EVIDENCE_PLANES = new Set([
  'NORMATIVE_OR_OFFICIAL_SPECIFICATION',
  'OFFICIAL_AUTHORING_EVIDENCE',
  'DIRECT_PUBLIC_SOURCE_EVIDENCE',
  'PUBLIC_PRODUCT_OR_CREATOR_CLAIM',
  'APPROVED_LOCAL_PACKAGE_EVIDENCE',
  'OBSERVED_RUNTIME_OR_HEADSET_PROOF',
  'STEPHANOS_INFERENCE_OR_PROPOSAL',
]);

function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function normalizeTeaching(record = {}) {
  const teachingKey = text(record.teachingKey);
  const candidateKey = text(record.candidateKey);
  const sourceId = text(record.sourceId || record.canonicalSourceId);
  const observedIdentity = text(record.observedIdentity || record.exactObservedIdentity);
  const evidencePlanes = list(record.evidencePlanes || [record.evidencePlane]).map(text);
  const proofRefs = list(record.proofRefs).map(text);
  const errors = [];
  if (!teachingKey) errors.push('missing-teachingKey');
  if (!candidateKey) errors.push('missing-candidateKey');
  if (!sourceId) errors.push('missing-sourceId');
  if (!observedIdentity) errors.push('missing-observedIdentity');
  if (!text(record.licenceBoundary || record.licenseBoundary)) errors.push('missing-licence-boundary');
  if (!text(record.reusableMethod || record.capability)) errors.push('missing-reusable-method');
  if (!proofRefs.length) errors.push('missing-proofRefs');
  if (!evidencePlanes.length || evidencePlanes.some((plane) => !EVIDENCE_PLANES.has(plane))) errors.push('invalid-evidence-plane');
  if (text(record.sharedWorkspaceProjectionState).toUpperCase() === 'CONFIRMED') errors.push('self-confirmed-projection-forbidden');
  return {
    valid: errors.length === 0,
    errors,
    value: Object.freeze({
      teachingKey,
      candidateKey,
      sourceId,
      observedIdentity,
      sourceCommentId: text(record.sourceCommentId),
      teachingCommentId: text(record.teachingCommentId),
      evidencePlanes: Object.freeze(evidencePlanes),
      confidence: text(record.confidence),
      licenceBoundary: text(record.licenceBoundary || record.licenseBoundary),
      reusableMethod: text(record.reusableMethod || record.capability),
      applicability: text(record.applicability),
      nonApplicability: text(record.nonApplicability),
      constraints: Object.freeze(list(record.constraints).map(text)),
      failureModes: Object.freeze(list(record.failureModes).map(text)),
      fallback: text(record.fallback),
      requiredProofLevel: text(record.requiredProofLevel),
      freshnessIdentity: text(record.freshnessIdentity || observedIdentity),
      parityProjectionState: text(record.parityProjectionState || 'NOT_APPLICABLE'),
      proofRefs: Object.freeze(proofRefs),
    }),
  };
}

export function projectVrTeachingIntoSharedWorkspace(input = {}) {
  const seen = new Set();
  const accepted = [];
  const blocked = [];
  const duplicates = [];
  for (const raw of list(input.teachingRecords)) {
    const normalized = normalizeTeaching(raw);
    if (!normalized.valid) {
      blocked.push({ teachingKey: text(raw?.teachingKey), errors: normalized.errors });
      continue;
    }
    const item = normalized.value;
    const identity = `${item.teachingKey}|${item.candidateKey}|${item.sourceId}|${item.observedIdentity}`;
    if (seen.has(identity)) { duplicates.push(item.teachingKey); continue; }
    seen.add(identity);
    accepted.push(item);
  }

  const capabilityGraphCandidates = accepted.map((item) => Object.freeze({
    teachingKey: item.teachingKey,
    candidateKey: item.candidateKey,
    sourceId: item.sourceId,
    observedIdentity: item.observedIdentity,
    evidencePlanes: item.evidencePlanes,
    confidence: item.confidence,
    reusableMethod: item.reusableMethod,
    requiredProofLevel: item.requiredProofLevel,
    proofRefs: item.proofRefs,
  }));
  const methodLibrary = accepted.map((item) => Object.freeze({ ...item }));
  const proofRefs = [...new Set(accepted.flatMap((item) => item.proofRefs))];
  const projection = buildVrResearchWorkspaceProjection({
    ...input,
    capabilityGraphCandidates,
    methodLibrary,
    proofRefs,
    updatedAt: text(input.updatedAt) || new Date().toISOString(),
  });
  const agentReadModel = buildVrResearchAgentReadModel({
    workspaceProjection: projection,
    sourceRegistry: input.sourceRegistry,
    nowMs: input.nowMs,
  });
  const projectionReceipt = Object.freeze({
    schemaVersion: VR_TEACHING_WORKSPACE_SCHEMA_VERSION,
    receiptId: `vr-teaching-${hash({ projectionId: projection.projectionId, teachingKeys: accepted.map((item) => item.teachingKey) }).slice(0, 20)}`,
    verdict: blocked.length ? VR_TEACHING_PROJECTION_VERDICT.BLOCKED : VR_TEACHING_PROJECTION_VERDICT.READY,
    projectionId: projection.projectionId,
    teachingKeys: Object.freeze(accepted.map((item) => item.teachingKey)),
    counters: Object.freeze({ seen: list(input.teachingRecords).length, projected: accepted.length, duplicatesSuppressed: duplicates.length, policyBlocked: blocked.length }),
    duplicatesSuppressed: Object.freeze(duplicates),
    policyBlocked: Object.freeze(blocked),
    agentReadModelVerdict: agentReadModel.verdict,
    proofRefs: Object.freeze(proofRefs),
  });
  return Object.freeze({ projection, agentReadModel, projectionReceipt });
}
