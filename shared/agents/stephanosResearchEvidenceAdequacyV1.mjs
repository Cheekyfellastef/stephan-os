export const STEPHANOS_RESEARCH_EVIDENCE_ADEQUACY_SCHEMA_VERSION = 'stephanos.research-evidence-adequacy.v1';

const PRIMARY_SOURCE_CLASSES = new Set([
  'PRIMARY_OFFICIAL',
  'PRIMARY_REPOSITORY',
  'AUTHORITATIVE_SPEC',
  'LOCAL_PROOF',
]);

function text(value, maximum = 1200) {
  if (typeof value !== 'string') return '';
  const output = value.trim();
  return output && output.length <= maximum ? output : '';
}

function dataObject(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return null;
      if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) return null;
    }
    return value;
  } catch {
    return null;
  }
}

function dataArray(value, maximum = 256) {
  try {
    if (!Array.isArray(value) || value.length > maximum || Object.getPrototypeOf(value) !== Array.prototype) return null;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return null;
    }
    return value;
  } catch {
    return null;
  }
}

function authorityBoundary() {
  return Object.freeze({
    researchGrantsSourceMutation: false,
    researchGrantsMerge: false,
    researchGrantsDeployment: false,
    researchGrantsRuntimeMutation: false,
    researchGrantsArbitraryShell: false,
    researchGrantsCredentialOrAccountChange: false,
    researchGrantsSpending: false,
    automaticKnowledgePromotionAllowed: false,
    researchAgentsOwnCanonicalTruth: false,
    stephanosOwnsFinalSynthesis: true,
  });
}

function invalid(reason) {
  return Object.freeze({
    schemaVersion: STEPHANOS_RESEARCH_EVIDENCE_ADEQUACY_SCHEMA_VERSION,
    valid: false,
    state: 'SAFE_HOLD',
    reason,
    currentOrFreshEvidenceRequired: true,
    canPresentAsCurrentTechnicalTruth: false,
    freshPrimaryClaimCount: 0,
    freshPrimaryClaimTopics: Object.freeze([]),
    secondaryOnlyClaimTopics: Object.freeze([]),
    conflictCount: 0,
    recommendedNextAction: 'REPAIR_EVIDENCE_ENVELOPE',
    authority: authorityBoundary(),
  });
}

function normalizedEvidenceRefs(value) {
  const refs = dataArray(value, 64);
  if (!refs) return Object.freeze([]);
  return Object.freeze([...new Set(refs.map((entry) => text(entry, 512)).filter(Boolean))]);
}

function normalizeClaim(value) {
  const claim = dataObject(value);
  if (!claim) return null;
  const topic = text(claim.topic, 256);
  const sourceClass = text(claim.sourceClass, 128).toUpperCase();
  const freshness = text(claim.freshness, 128).toUpperCase();
  const evidenceRefs = normalizedEvidenceRefs(claim.evidenceRefs);
  if (!topic || !sourceClass) return null;
  return Object.freeze({
    topic,
    sourceClass,
    freshness,
    evidenceRefs,
    freshPrimary: PRIMARY_SOURCE_CLASSES.has(sourceClass)
      && freshness === 'FRESH'
      && evidenceRefs.length > 0,
  });
}

export function assessStephanosResearchEvidenceAdequacyV1(input = {}) {
  try {
    const request = dataObject(input);
    const mission = dataObject(request?.mission);
    const packet = dataObject(request?.packet);
    if (!request || !mission || !packet) return invalid('mission-and-research-packet-required');
    if (text(mission.schemaVersion, 128) !== 'stephanos.research-mission.v1') return invalid('research-mission-schema-invalid');
    if (text(packet.schemaVersion, 128) !== 'stephanos.research-packet.v1') return invalid('research-packet-schema-invalid');

    const missionId = text(mission.researchMissionId, 256);
    if (!missionId || missionId !== text(packet.researchMissionId, 256)) return invalid('research-mission-lineage-mismatch');

    const claimsInput = dataArray(packet.claims, 256);
    const conflictsInput = dataArray(packet.conflicts, 128);
    if (!claimsInput || !conflictsInput) return invalid('research-evidence-arrays-invalid');
    const claims = claimsInput.map(normalizeClaim);
    if (claims.some((claim) => claim === null)) return invalid('research-claim-envelope-invalid');

    const freshnessRequirement = text(mission.freshnessRequirement, 128).toUpperCase() || 'CURRENT_WHERE_MATERIAL';
    const currentOrFreshEvidenceRequired = /CURRENT|FRESH/.test(freshnessRequirement);
    const freshPrimaryClaims = claims.filter((claim) => claim.freshPrimary);
    const freshPrimaryTopics = [...new Set(freshPrimaryClaims.map((claim) => claim.topic))];
    const secondaryOnlyTopics = [...new Set(claims
      .filter((claim) => !claim.freshPrimary)
      .map((claim) => claim.topic)
      .filter((topic) => !freshPrimaryTopics.includes(topic)))];
    const conflictCount = conflictsInput.length;

    let state = 'EVIDENCE_READY_FOR_STEPHANOS_SYNTHESIS';
    let reason = 'evidence-meets-current-synthesis-boundary';
    let recommendedNextAction = 'STEPHANOS_SYNTHESIZE_WITH_EVIDENCE_DISCLOSURE';
    let canPresentAsCurrentTechnicalTruth = true;

    if (conflictCount > 0) {
      state = 'CONFLICT_RECONCILIATION_REQUIRED';
      reason = 'research-conflicts-remain-explicit';
      recommendedNextAction = 'RECONCILE_CONFLICT_BEFORE_CURRENT_TRUTH_CLAIM';
      canPresentAsCurrentTechnicalTruth = false;
    } else if (currentOrFreshEvidenceRequired && freshPrimaryClaims.length === 0) {
      state = 'PRIMARY_EVIDENCE_REQUIRED';
      reason = 'current-or-fresh-claim-has-no-fresh-primary-evidence';
      recommendedNextAction = 'COLLECT_PRIMARY_OR_OFFICIAL_EVIDENCE';
      canPresentAsCurrentTechnicalTruth = false;
    }

    return Object.freeze({
      schemaVersion: STEPHANOS_RESEARCH_EVIDENCE_ADEQUACY_SCHEMA_VERSION,
      valid: true,
      state,
      reason,
      researchMissionId: missionId,
      freshnessRequirement,
      currentOrFreshEvidenceRequired,
      canPresentAsCurrentTechnicalTruth,
      freshPrimaryClaimCount: freshPrimaryClaims.length,
      freshPrimaryClaimTopics: Object.freeze(freshPrimaryTopics),
      secondaryOnlyClaimTopics: Object.freeze(secondaryOnlyTopics),
      conflictCount,
      recommendedNextAction,
      presenterBoundary: Object.freeze({
        mayShowSecondaryEvidence: true,
        mustLabelInsufficientCurrentTruth: !canPresentAsCurrentTechnicalTruth,
        rawResearcherTranscriptRequired: false,
      }),
      authority: authorityBoundary(),
    });
  } catch {
    return invalid('research-evidence-adequacy-failed-closed');
  }
}
