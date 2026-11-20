export const VR_CAPABILITY_PROOF_CONTRACT_SCHEMA = 'stephanos.vr-capability-proof-contract.v1';

export const VR_CAPABILITY_PROOF_STAGES = Object.freeze([
  'design',
  'implementation',
  'automatedProof',
  'runtimeProof',
  'operatorAcceptance',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

export function createVrCapabilityProofRef(capabilityId, stage) {
  const id = String(capabilityId || '').trim();
  const resolvedStage = String(stage || '').trim();
  if (!SAFE_ID.test(id)) throw new Error('VR_CAPABILITY_ID_INVALID');
  if (!VR_CAPABILITY_PROOF_STAGES.includes(resolvedStage)) throw new Error('VR_CAPABILITY_PROOF_STAGE_INVALID');
  return `proofs/vr-capability/${id}/${resolvedStage}`;
}

export function attachVrCapabilityProofRef(proofRefs = [], capabilityId, stage) {
  return Object.freeze([
    ...new Set([
      ...(Array.isArray(proofRefs) ? proofRefs.map(String) : []),
      createVrCapabilityProofRef(capabilityId, stage),
    ]),
  ]);
}

export function buildVrCapabilityVerificationMetadata({ capabilityId, stage, proofRefs = [] } = {}) {
  return Object.freeze({
    schemaVersion: VR_CAPABILITY_PROOF_CONTRACT_SCHEMA,
    capabilityId: String(capabilityId || ''),
    stage: String(stage || ''),
    proofRefs: attachVrCapabilityProofRef(proofRefs, capabilityId, stage),
    rule: 'Only a PASS/ACCEPTED canonical proof record carrying this proof reference may promote the matching VR capability stage.',
  });
}
