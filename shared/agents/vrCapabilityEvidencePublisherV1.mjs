import {
  createSharedWorkspaceProofRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import {
  createVrCapabilityProofRef,
  VR_CAPABILITY_PROOF_STAGES,
} from './vrCapabilityProofContractV1.mjs';

export const VR_CAPABILITY_EVIDENCE_PUBLISHER_SCHEMA = 'stephanos.vr-capability-evidence-publisher.v1';
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function cleanVisualEvidence(value) {
  if (!value || typeof value !== 'object') return null;
  const url = text(value.url || value.snapshotUrl || value.imageUrl || value.artifactUrl);
  if (!url) return null;
  const state = text(value.state || value.truth, value.verified === true ? 'VERIFIED' : '').toUpperCase();
  if (!['VERIFIED', 'OBSERVED', 'ACCEPTED'].includes(state)) return null;
  return {
    url,
    source: text(value.source, 'spatial-workspace'),
    state,
    observedAt: text(value.observedAt || value.timestampUtc),
    kind: text(value.kind, 'observed-workspace-capture'),
  };
}

export function createVrCapabilityEvidenceRecord(input = {}) {
  const capabilityId = text(input.capabilityId || input.vrCapabilityId);
  const stage = text(input.stage || input.proofStage || input.vrReadinessStage);
  if (!SAFE_ID.test(capabilityId)) throw new Error('VR_CAPABILITY_ID_INVALID');
  if (!VR_CAPABILITY_PROOF_STAGES.includes(stage)) throw new Error('VR_CAPABILITY_PROOF_STAGE_INVALID');
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const proofRef = createVrCapabilityProofRef(capabilityId, stage);
  const proofId = text(input.proofId, `vr-${capabilityId}-${stage}`);
  const visualEvidence = cleanVisualEvidence(input.visualEvidence || input.spatialWorkspaceVisual);
  const body = {
    schemaVersion: VR_CAPABILITY_EVIDENCE_PUBLISHER_SCHEMA,
    vrCapabilityId: capabilityId,
    proofStage: stage,
    passed: input.passed === true || input.accepted === true,
    note: text(input.note || input.summary),
    ...(visualEvidence ? { visualEvidence } : {}),
  };
  return {
    ...createSharedWorkspaceProofRecord({
      proofId,
      participantId: text(input.participantId, 'vr-capability-verifier'),
      timestampUtc,
      correlationId: text(input.correlationId, proofId),
      relatedIssue: text(input.relatedIssue, '#1597'),
      relatedPr: text(input.relatedPr),
      status: body.passed ? 'PASS' : 'BLOCKED',
      summary: text(input.summary, `${capabilityId} ${stage} ${body.passed ? 'PASS' : 'BLOCKED'}`),
      proofRefs: [proofRef, ...(Array.isArray(input.proofRefs) ? input.proofRefs : [])],
      refs: Array.isArray(input.refs) ? input.refs : [],
    }),
    body: JSON.stringify(body),
  };
}

export async function publishVrCapabilityEvidence(root, input = {}, options = {}) {
  const record = createVrCapabilityEvidenceRecord(input);
  const fileName = `${record.proofId}.json`;
  const write = await writeAtomicJson(root, ['proof', fileName], record, options);
  if (!write.ok) return { ok: false, reason: write.reason, write, record };
  return {
    ok: true,
    reason: 'VR_CAPABILITY_EVIDENCE_PUBLISHED',
    schemaVersion: VR_CAPABILITY_EVIDENCE_PUBLISHER_SCHEMA,
    record,
    write,
  };
}
