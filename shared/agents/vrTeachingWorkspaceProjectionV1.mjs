import { createHash } from 'node:crypto';
import { buildVrResearchWorkspaceProjection } from './vrResearchWorkspaceProjectionV1.mjs';
import { buildVrResearchAgentReadModel } from './vrResearchAgentV1.mjs';

export const VR_TEACHING_WORKSPACE_SCHEMA_VERSION = 'stephanos.vr-teaching-workspace-projection.v1';
export const VR_RUNTIME_ACCEPTANCE_RECEIPT_SCHEMA_VERSION = 'stephanos.vr-runtime-acceptance-receipt.v1';
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
const RUNTIME_PROOF_LEVEL = 'OBSERVED_RUNTIME_OR_HEADSET_PROOF';

function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value.filter((entry) => entry !== null && entry !== undefined) : []; }
function norm(value) { return [...new Set(list(value).map(text).filter(Boolean))].sort(); }
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function portable(value) { let digest = 2166136261; for (let index = 0; index < value.length; index += 1) { digest ^= value.charCodeAt(index); digest = Math.imul(digest, 16777619) >>> 0; } return `fnv1a32:${digest.toString(16).padStart(8, '0')}`; }
function aliases(item) { if (typeof item === 'string') return new Set([`string:${text(item)}`]); return new Set([text(item?.teachingKey), text(item?.candidateKey)].filter(Boolean)); }
function legacyAlias(item) { return item && typeof item === 'object' && !text(item.teachingKey) && !text(item.candidateKey) ? text(item.reusableMethod) : ''; }
function overlap(left, right) { const leftAliases = aliases(left); const rightAliases = aliases(right); if (leftAliases.size && rightAliases.size) { for (const key of leftAliases) if (rightAliases.has(key)) return true; return false; } const legacy = legacyAlias(left); return Boolean(legacy && legacy === text(right?.reusableMethod)); }
function replaceGraph(existing, fresh) { return [...existing.filter((entry) => !fresh.some((candidate) => overlap(entry, candidate))), ...fresh]; }
function replaceMethods(existing, fresh) { return [...existing.filter((entry) => !fresh.some((candidate) => overlap(entry, candidate))), ...fresh]; }
function registryEntries(registry) { if (Array.isArray(registry)) return registry; if (registry && typeof registry === 'object' && Array.isArray(registry.sources)) return registry.sources; if (registry && typeof registry === 'object') return Object.entries(registry).map(([sourceId, value]) => typeof value === 'object' && value ? { sourceId, ...value } : { sourceId, observedIdentity: value }); return []; }
function registeredRevisions(entry) { return norm([entry?.observedIdentity, entry?.exactObservedIdentity, entry?.revision, entry?.freshnessIdentity, entry?.snapshot_commit, entry?.snapshot_version, entry?.snapshot_release, entry?.snapshot_date]); }
function registrySourceId(entry) { return text(entry?.sourceId || entry?.source_id || entry?.id || entry?.canonicalSourceId || entry?.canonical_source_id); }
function validateSource(sourceId, observedIdentity, registry) {
  if (registry === undefined || registry === null) return ['canonical-source-registry-required'];
  const matching = registryEntries(registry).filter((entry) => registrySourceId(entry) === sourceId);
  if (!matching.length) return ['source-not-in-canonical-registry'];
  const revisions = [...new Set(matching.flatMap(registeredRevisions))];
  if (!revisions.length) return ['registered-source-revision-required'];
  return revisions.includes(observedIdentity) ? [] : ['source-revision-mismatch'];
}
function runtimeAccepted(input, record, proofRefs) { return list(input.runtimeAcceptanceReceipts).some((receipt) => text(receipt?.schemaVersion) === VR_RUNTIME_ACCEPTANCE_RECEIPT_SCHEMA_VERSION && text(receipt?.verdict) === 'ACCEPTED' && text(receipt?.proofRef) && proofRefs.includes(text(receipt.proofRef)) && text(receipt?.sourceId) === text(record.sourceId || record.canonicalSourceId) && text(receipt?.observedIdentity) === text(record.observedIdentity || record.exactObservedIdentity)); }
function normalize(record = {}, input = {}) {
  const teachingKey = text(record.teachingKey), candidateKey = text(record.candidateKey), sourceId = text(record.sourceId || record.canonicalSourceId), observedIdentity = text(record.observedIdentity || record.exactObservedIdentity), evidencePlanes = norm(record.evidencePlanes || [record.evidencePlane]), proofRefs = norm(record.proofRefs), confidence = text(record.confidence), requiredProofLevel = text(record.requiredProofLevel), errors = [];
  if (!teachingKey) errors.push('missing-teachingKey'); if (!candidateKey) errors.push('missing-candidateKey'); if (!sourceId) errors.push('missing-sourceId'); if (!observedIdentity) errors.push('missing-observedIdentity'); if (!confidence) errors.push('missing-confidence'); if (!text(record.licenceBoundary || record.licenseBoundary)) errors.push('missing-licence-boundary'); if (!text(record.reusableMethod || record.capability)) errors.push('missing-reusable-method'); if (!proofRefs.length) errors.push('missing-proofRefs'); if (!evidencePlanes.length || evidencePlanes.some((plane) => !EVIDENCE_PLANES.has(plane))) errors.push('invalid-evidence-plane');
  errors.push(...validateSource(sourceId, observedIdentity, input.sourceRegistry));
  const claimsRuntimeEvidence = requiredProofLevel === RUNTIME_PROOF_LEVEL || evidencePlanes.includes(RUNTIME_PROOF_LEVEL);
  if (requiredProofLevel === RUNTIME_PROOF_LEVEL && !evidencePlanes.includes(RUNTIME_PROOF_LEVEL)) errors.push('required-runtime-proof-missing');
  if (claimsRuntimeEvidence && !runtimeAccepted(input, record, proofRefs)) errors.push('runtime-acceptance-proof-missing');
  if (text(record.sharedWorkspaceProjectionState).toUpperCase() === 'CONFIRMED') errors.push('self-confirmed-projection-forbidden');
  return { valid: !errors.length, errors, value: Object.freeze({ teachingKey, candidateKey, sourceId, observedIdentity, sourceCommentId: text(record.sourceCommentId), teachingCommentId: text(record.teachingCommentId), evidencePlanes: Object.freeze(evidencePlanes), confidence, licenceBoundary: text(record.licenceBoundary || record.licenseBoundary), reusableMethod: text(record.reusableMethod || record.capability), applicability: text(record.applicability), nonApplicability: text(record.nonApplicability), constraints: Object.freeze(norm(record.constraints)), failureModes: Object.freeze(norm(record.failureModes)), fallback: text(record.fallback), requiredProofLevel, freshnessIdentity: text(record.freshnessIdentity || observedIdentity), supersedesObservedIdentity: text(record.supersedesObservedIdentity), parityProjectionState: text(record.parityProjectionState || 'NOT_APPLICABLE'), proofRefs: Object.freeze(proofRefs) }) };
}
function select(items) {
  const accepted = [], duplicates = [], conflicts = [];
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.teachingKey)) groups.set(item.teachingKey, []);
    groups.get(item.teachingKey).push(item);
  }
  for (const [key, group] of groups) {
    const byIdentity = new Map();
    let equalIdentityConflict = false;
    for (const item of group) {
      const prior = byIdentity.get(item.observedIdentity);
      if (!prior) { byIdentity.set(item.observedIdentity, item); continue; }
      duplicates.push(key);
      if (hash(item) !== hash(prior)) equalIdentityConflict = true;
    }
    if (equalIdentityConflict) { conflicts.push({ teachingKey: key, errors: ['conflicting-equal-identity-revision'] }); continue; }
    const revisions = [...byIdentity.values()];
    if (revisions.length === 1) { accepted.push(revisions[0]); continue; }
    for (let index = 1; index < revisions.length; index += 1) duplicates.push(key);
    const superseded = new Set();
    let invalidChain = false;
    for (const item of revisions) {
      const parent = text(item.supersedesObservedIdentity);
      if (!parent) continue;
      if (parent === item.observedIdentity || !byIdentity.has(parent) || superseded.has(parent)) { invalidChain = true; break; }
      superseded.add(parent);
    }
    const terminals = revisions.filter((item) => !superseded.has(item.observedIdentity));
    const roots = revisions.filter((item) => !text(item.supersedesObservedIdentity));
    if (invalidChain || terminals.length !== 1 || roots.length !== 1) { conflicts.push({ teachingKey: key, errors: ['unproven-revision-supersession'] }); continue; }
    const seen = new Set();
    let cursor = terminals[0];
    while (cursor && !seen.has(cursor.observedIdentity)) {
      seen.add(cursor.observedIdentity);
      const parent = text(cursor.supersedesObservedIdentity);
      cursor = parent ? byIdentity.get(parent) : null;
    }
    if (seen.size !== revisions.length || cursor) { conflicts.push({ teachingKey: key, errors: ['unproven-revision-supersession'] }); continue; }
    accepted.push(terminals[0]);
  }
  return { accepted, duplicates, conflicts };
}
function content(graph, methods, proofRefs) { return { capabilityGraphCandidates: graph, methodLibrary: methods, proofRefs }; }
function digest(graph, methods, proofRefs) { return portable(JSON.stringify(content(graph, methods, proofRefs))); }
export function projectVrTeachingIntoSharedWorkspace(input = {}) {
  const normalized = [], blocked = [];
  for (const raw of list(input.teachingRecords)) { const result = normalize(raw, input); if (!result.valid) { blocked.push({ teachingKey: text(raw?.teachingKey), errors: result.errors }); continue; } normalized.push(result.value); }
  const { accepted, duplicates, conflicts } = select(normalized); blocked.push(...conflicts);
  const freshGraph = accepted.map((item) => Object.freeze({ teachingKey: item.teachingKey, candidateKey: item.candidateKey, sourceId: item.sourceId, observedIdentity: item.observedIdentity, evidencePlanes: item.evidencePlanes, confidence: item.confidence, reusableMethod: item.reusableMethod, requiredProofLevel: item.requiredProofLevel, proofRefs: item.proofRefs }));
  const graph = replaceGraph(list(input.capabilityGraphCandidates), freshGraph), methods = replaceMethods(list(input.methodLibrary), accepted.map((item) => Object.freeze({ ...item }))), proofRefs = [...new Set([...norm(input.proofRefs), ...accepted.flatMap((item) => item.proofRefs)])].sort();
  const projection = buildVrResearchWorkspaceProjection({ ...input, capabilityGraphCandidates: graph, methodLibrary: methods, proofRefs, updatedAt: text(input.updatedAt) || new Date().toISOString() });
  const agentReadModel = buildVrResearchAgentReadModel({ workspaceProjection: projection, sourceRegistry: input.sourceRegistry, nowMs: input.nowMs });
  const contentBinding = JSON.stringify(content(projection.capabilityGraphCandidates, projection.methodLibrary, projection.proofRefs)), contentDigest = digest(projection.capabilityGraphCandidates, projection.methodLibrary, projection.proofRefs);
  const projectionReceipt = Object.freeze({ schemaVersion: VR_TEACHING_WORKSPACE_SCHEMA_VERSION, receiptId: `vr-teaching-${hash({ projectionId: projection.projectionId, contentDigest }).slice(0, 20)}`, contentDigest, contentBinding, verdict: blocked.length ? VR_TEACHING_PROJECTION_VERDICT.BLOCKED : VR_TEACHING_PROJECTION_VERDICT.READY, projectionId: projection.projectionId, teachingKeys: Object.freeze(accepted.map((item) => item.teachingKey)), counters: Object.freeze({ seen: list(input.teachingRecords).length, projected: accepted.length, duplicatesSuppressed: duplicates.length, policyBlocked: blocked.length }), duplicatesSuppressed: Object.freeze(duplicates), policyBlocked: Object.freeze(blocked), agentReadModelVerdict: agentReadModel.verdict, proofRefs: Object.freeze(proofRefs) });
  return Object.freeze({ projection, agentReadModel, projectionReceipt });
}
