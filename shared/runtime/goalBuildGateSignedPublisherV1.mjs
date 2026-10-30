import { createHash, createPrivateKey, sign } from 'node:crypto';
import {
  createSharedWorkspaceProofRecord, createSharedWorkspaceStatusRecord,
  writeAtomicJson,
} from '../agents/sharedAgentWorkspaceStore.mjs';
import { GOAL_BUILD_GATE_SCHEMA_V1, GOAL_GATE_SIGNATURE_DOMAIN } from './goalBuildGateObservatoryV1.mjs';

const SHA = /^[a-f0-9]{40}$/;
export const GATE_STEWARD_SIGNED_PUBLISHER_SCHEMA_V1 = 'stephanos.goal-build-gate-signed-publisher.v1';

// No signer -> NO signed gate status. Keys must be commissioned outside both
// the repository and Shared Workspace; never generated or exported by Core.
export async function publishSignedCoreGateEvidenceV1({
  root, repoRoot, sourceHead, observedAtUtc, coreEvidence,
  signingPrivateKeyPem = '',
  write = writeAtomicJson,
} = {}) {
  if (!SHA.test(String(sourceHead || '')) || !Number.isFinite(Date.parse(observedAtUtc))
    || coreEvidence?.schemaVersion !== GOAL_BUILD_GATE_SCHEMA_V1
    || coreEvidence.sourceHead !== sourceHead
    || coreEvidence.observedAtUtc !== observedAtUtc
    || !Array.isArray(coreEvidence.gates) || coreEvidence.gates.length > 23
    || typeof signingPrivateKeyPem !== 'string' || !signingPrivateKeyPem) {
    return Object.freeze({ ok: false, reason: 'GATE_STEWARD_SIGNED_PUBLISHER_NOT_COMMISSIONED' });
  }
  let key;
  try {
    key = createPrivateKey(signingPrivateKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('WRONG_KEY_TYPE');
  } catch {
    return Object.freeze({ ok: false, reason: 'GATE_STEWARD_SIGNING_KEY_INVALID' });
  }
  const stamped = [];
  for (const gate of coreEvidence.gates) {
    const id = Number(gate.id);
    if (!Number.isSafeInteger(id) || id < 1 || id > 23
      || !['PASS', 'FAIL'].includes(gate.status)
      || gate.sourceHead !== sourceHead || gate.observedAtUtc !== observedAtUtc) {
      return Object.freeze({ ok: false, reason: 'GATE_STEWARD_UNQUALIFIED_GATE' });
    }
    const proofId = 'goal-gate-' + id;
    const proof = {
      ...createSharedWorkspaceProofRecord({
        proofId, participantId: 'stephanos-core', relatedIssue: '#2961',
        correlationId: proofId + '-' + sourceHead.slice(0, 12),
        timestampUtc: observedAtUtc, status: gate.status,
        summary: 'Core observed gate ' + id + ': ' + (gate.typedBlocker || 'verified runtime predicate'),
        refs: [gate.proofRef],
        // Store paths accepted by the real workspace writer, not view-only workspace: URIs.
        proofRefs: ['proof/' + proofId + '.json'],
      }),
      sourceHead,
    };
    const saved = await write(root, ['proof', proofId + '.json'], proof, { repoRoot });
    if (saved?.ok !== true) {
      return Object.freeze({ ok: false, reason: 'GATE_STEWARD_IMMUTABLE_PROOF_PUBLICATION_BLOCKED' });
    }
    stamped.push({
      id, status: gate.status, observedAtUtc, sourceHead,
      proofRef: 'workspace:proof/' + proofId,
      proofRecordSha256: createHash('sha256').update(JSON.stringify(proof)).digest('hex'),
      typedBlocker: gate.typedBlocker || '',
    });
  }
  const exact = Object.freeze({
    schemaVersion: GOAL_BUILD_GATE_SCHEMA_V1,
    publisherId: 'stephanos-core',
    signingKeyId: 'stephanos-goal-build-gates-v1',
    sourceHead, observedAtUtc, gates: stamped,
  });
  const signatureBase64 = sign(null,
    Buffer.from(GOAL_GATE_SIGNATURE_DOMAIN + JSON.stringify(exact)), key).toString('base64');
  const status = {
    ...createSharedWorkspaceStatusRecord({
      statusId: 'goal-build-gates-current',
      participantId: 'stephanos-core', timestampUtc: observedAtUtc,
      relatedIssue: '#2961', status: 'OBSERVED',
      summary: 'Signed per-gate evidence for read-only observatory; never security authority.',
      proofRefs: stamped.map(g => 'proof/goal-gate-' + g.id + '.json'),
    }),
    goalBuildGateEvidence: { ...exact, signatureBase64 },
  };
  const result = await write(root, ['status', 'goal-build-gates-current.json'], status, { repoRoot });
  return Object.freeze({
    ok: result?.ok === true,
    reason: result?.ok === true ? 'GATE_STEWARD_SIGNED_STATUS_PUBLISHED' : 'GATE_STEWARD_SIGNED_STATUS_BLOCKED',
    gateCount: stamped.length,
    sourceHead,
    authorityGranted: false, mergeAuthority: false, leaseAuthority: false,
  });
}
