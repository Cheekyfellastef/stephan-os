import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

// Use the EXISTING independently commissioned Core Ed25519 key; this
// observation is diagnostic only and never grants source/lease/merge powers.
export const LOGICAL_GOAL_PICKUP_ATTESTATION_SCHEMA = 'stephanos.logical-goal-pickup-attestation.v1';
export const LOGICAL_GOAL_PICKUP_ATTESTATION_DOMAIN = 'stephanos.logical-goal-pickup-attestation.v1\\0';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const REF = /^proof\/([a-z0-9][a-z0-9._-]{0,100})(?:\.json)?$/i;
const MAX_SKEW_MS = 60_000;
const MAX_AGE_MS = 15 * 60_000;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = v => String(v ?? '').trim();
const millis = v => Date.parse(text(v));

function proofRefId(ref) { return (REF.exec(text(ref))?.[1] || '').replace(/\.json$/i, ''); }
function refsOf(record) {
  const id = text(record?.proofId);
  return new Set([
    ...(Array.isArray(record?.refs) ? record.refs : []),
    ...(Array.isArray(record?.proofRefs) ? record.proofRefs : []),
    id ? `proof/${id}` : '', id ? `proof/${id}.json` : '',
  ]);
}
function qualifiedProof(record, ref, goal, timeMs, currentMs) {
  if (!record || record.kind !== 'stephanos.shared_workspace.proof'
    || text(record.status).toUpperCase() !== 'PASS'
    || record.controllerActivityProof?.schemaVersion !== 'stephanos.controller-activity-proof.v1'
    || record.controllerActivityProof.controllerId !== goal.controllerId
    || !text(record.controllerActivityProof.runId)
    || Number(record.controllerActivityProof.materialActionsSucceeded) < 1
    || text(record.correlationId) !== text(record.controllerActivityProof.runId)
    || !refsOf(record).has(ref)
    || !proofRefId(ref)) return false;
  const at = millis(record.timestampUtc);
  return Number.isFinite(at) && at <= currentMs + MAX_SKEW_MS
    && currentMs - at <= MAX_AGE_MS
    && Math.abs(at - timeMs) <= MAX_AGE_MS;
}
function canonicalClaims(buildTruth, proofRecords, nowMs) {
  if (!Array.isArray(buildTruth?.goals)) return null;
  const claims = [];
  for (const goal of buildTruth.goals) {
    if (goal?.state !== 'BUILDING') continue;
    const refs = Array.isArray(goal.proofRefs) ? goal.proofRefs : [];
    const at = millis(goal.lastMaterialProgressAtUtc);
    if (refs.length < 1 || refs.length > 8 || !Number.isFinite(at)
      || at > nowMs + MAX_SKEW_MS || nowMs - at > MAX_AGE_MS
      || !/^#[1-9]\d*$/.test(text(goal.issue))
      || !/^logical-goal-[1-9]\d*$/.test(text(goal.logicalLaneId))
      || goal.logicalLaneId !== `logical-goal-${text(goal.issue).slice(1)}`
      || !text(goal.controllerId) || goal.selectedForAdmission !== true) return null;
    const perRef = [];
    for (const ref of refs) {
      const id = proofRefId(ref);
      if (!id) return null;
      const matches = proofRecords.filter(record =>
        record?.proofId === id && qualifiedProof(record, ref, goal, at, nowMs));
      if (matches.length !== 1) return null;
      perRef.push(Object.freeze({ proofRef: ref, proofId: id, recordSha256: digest(matches[0]) }));
    }
    claims.push(Object.freeze({
      issue: goal.issue,
      logicalLaneId: goal.logicalLaneId,
      controllerId: goal.controllerId,
      selectedForAdmission: true,
      lastMaterialProgressAtUtc: goal.lastMaterialProgressAtUtc,
      proofRecords: Object.freeze(perRef),
    }));
  }
  return claims;
}
function signedBody({ buildTruth, sourceHead, proofRecords, nowMs }) {
  if (!SHA40.test(text(sourceHead)) || buildTruth?.schemaVersion !== 'stephanos.sovereign-build-truth.v1'
    || !Number.isFinite(millis(buildTruth.observedAtUtc))
    || millis(buildTruth.observedAtUtc) > nowMs + MAX_SKEW_MS
    || nowMs - millis(buildTruth.observedAtUtc) > MAX_AGE_MS
    || !Array.isArray(proofRecords)) return null;
  const claims = canonicalClaims(buildTruth, proofRecords, nowMs);
  if (!claims) return null;
  return Object.freeze({
    schemaVersion: LOGICAL_GOAL_PICKUP_ATTESTATION_SCHEMA,
    publisherId: 'stephanos-core',
    signingKeyId: 'stephanos-goal-build-gates-v1',
    sourceHead,
    observedAtUtc: buildTruth.observedAtUtc,
    buildTruthSha256: digest(buildTruth),
    claims,
  });
}
export function signLogicalGoalBuildTruthV1({ buildTruth, sourceHead, proofRecords = [], signingPrivateKeyPem = '', nowMs = Date.now() } = {}) {
  const body = signedBody({ buildTruth, sourceHead, proofRecords, nowMs });
  if (!body) return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_SIGNING_SOURCE_OR_PROOF_UNVERIFIED' });
  try {
    const key = createPrivateKey(signingPrivateKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong-key');
    return Object.freeze({ ok: true, attestation: Object.freeze({
      ...body, signatureBase64: sign(null, Buffer.from(LOGICAL_GOAL_PICKUP_ATTESTATION_DOMAIN + JSON.stringify(body)), key).toString('base64'),
    }) });
  } catch { return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_SIGNER_UNAVAILABLE' }); }
}
export function verifyLogicalGoalBuildTruthV1({
  buildTruth, attestation, proofRecords = [], expectedSourceHead = '',
  trustedPublicKeyPem = '', trustedPublicKeySha256 = '', nowMs = Date.now(),
} = {}) {
  const blocked = reason => Object.freeze({ ok: false, blocker: reason, verifiedGoalIds: Object.freeze([]) });
  if (!SHA64.test(text(trustedPublicKeySha256))
    || createHash('sha256').update(String(trustedPublicKeyPem)).digest('hex') !== trustedPublicKeySha256) {
    return blocked('LOGICAL_GOAL_PINNED_VERIFIER_UNAVAILABLE');
  }
  const body = signedBody({ buildTruth, sourceHead: expectedSourceHead, proofRecords, nowMs });
  if (!body || !attestation || attestation.sourceHead !== expectedSourceHead
    || !Array.isArray(attestation.claims)
    || JSON.stringify(attestation.claims) !== JSON.stringify(body.claims)
    || attestation.schemaVersion !== body.schemaVersion
    || attestation.publisherId !== body.publisherId
    || attestation.signingKeyId !== body.signingKeyId
    || attestation.observedAtUtc !== body.observedAtUtc
    || attestation.buildTruthSha256 !== body.buildTruthSha256) {
    return blocked('LOGICAL_GOAL_PICKUP_ATTESTATION_BINDING_INVALID');
  }
  try {
    const key = createPublicKey(trustedPublicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong-key');
    const sig = Buffer.from(String(attestation.signatureBase64 || ''), 'base64');
    if (sig.length !== 64 || sig.toString('base64') !== attestation.signatureBase64
      || !verify(null, Buffer.from(LOGICAL_GOAL_PICKUP_ATTESTATION_DOMAIN + JSON.stringify(body)), key, sig)) {
      return blocked('LOGICAL_GOAL_PICKUP_ATTESTATION_SIGNATURE_INVALID');
    }
    return Object.freeze({ ok: true, blocker: '', verifiedGoalIds: Object.freeze(body.claims.map(c=>c.issue)) });
  } catch { return blocked('LOGICAL_GOAL_PICKUP_ATTESTATION_SIGNATURE_INVALID'); }
}
