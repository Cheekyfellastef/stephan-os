import { createHash } from 'node:crypto';

export const STEPHANOS_RESEARCH_COUNCIL_SCHEMA_VERSION = 'stephanos.native-research-council.v1';
export const STEPHANOS_RESEARCH_PACKET_SCHEMA_VERSION = 'stephanos.research-packet.v1';
export const STEPHANOS_RESEARCH_MISSION_SCHEMA_VERSION = 'stephanos.research-mission.v1';
export const STEPHANOS_RESEARCH_PRESENTATION_KIND = 'RESEARCH_EXPEDITION';

export const STEPHANOS_RESEARCH_ROUTES = Object.freeze([
  'ANSWER_FROM_CANONICAL_KNOWLEDGE',
  'DIRECT_BOUNDED_RESEARCH',
  'SINGLE_SPECIALIST_RESEARCH',
  'MULTI_AGENT_RESEARCH_COUNCIL',
  'WAIT_FOR_EXTERNAL_EVIDENCE',
  'OPERATOR_JUDGMENT_REQUIRED',
  'UNSUPPORTED_OR_UNSAFE',
]);

export const STEPHANOS_RESEARCH_ROLES = Object.freeze([
  'PRIMARY_SOURCE_RESEARCHER',
  'TECHNICAL_ARCHITECTURE_RESEARCHER',
  'SECURITY_AND_FAILURE_RESEARCHER',
  'MARKET_OR_PROVIDER_RESEARCHER',
  'VR_SPATIAL_RESEARCHER',
  'LICENCE_AND_PROVENANCE_RESEARCHER',
  'IMPLEMENTATION_PATTERN_RESEARCHER',
  'SCEPTICAL_COUNTEREVIDENCE_RESEARCHER',
  'DOMAIN_SPECIALIST',
]);

export const STEPHANOS_RESEARCH_SOURCE_PRIORITY = Object.freeze([
  'PRIMARY_OFFICIAL',
  'PRIMARY_REPOSITORY',
  'AUTHORITATIVE_SPEC',
  'LOCAL_PROOF',
  'SECONDARY_CORROBORATION',
]);

export const STEPHANOS_RESEARCH_FORBIDDEN_ACTIONS = Object.freeze([
  'SOURCE_MUTATION',
  'MERGE',
  'DEPLOYMENT',
  'RUNTIME_MUTATION',
  'ARBITRARY_SHELL',
  'CREDENTIAL_OR_ACCOUNT_CHANGE',
  'SPENDING',
  'UNGOVERNED_KNOWLEDGE_PROMOTION',
  'PRIVATE_AGENT_TRUTH',
]);

export const STEPHANOS_RESEARCH_PEER_EVALUATION_CASES = Object.freeze([
  'CURRENT_SYSTEM_ARCHITECTURE_AND_OWNER_TRUTH',
  'CURRENT_PROVIDER_MESH_AND_ZERO_CODEX_CONTINUITY',
  'OPENCLAW_FORGE_AND_GITHUB_ROLE_BOUNDARIES',
  'BATTLE_BRIDGE_AND_IGNITION_SELF_HEALING_TRUTH',
  'CANONICAL_KNOWLEDGE_FIRST_NO_UNNECESSARY_RESEARCH',
  'NARROW_CURRENT_TECHNICAL_FACT_DIRECT_RESEARCH',
  'CONTESTED_ARCHITECTURE_MULTI_AGENT_COUNCIL',
  'PROVIDER_OUTAGE_RESEARCH_SUBSTITUTION',
  'IMPROVE_STEPHANOS_EXISTING_OWNER_AND_AUTHORITY_CLASSIFICATION',
  'RESEARCH_LED_IMPROVEMENT_WITH_EXPERIENCE_DEBT_SEPARATION',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const PRIMARY_SOURCE_CLASSES = new Set(['PRIMARY_OFFICIAL', 'PRIMARY_REPOSITORY', 'AUTHORITATIVE_SPEC', 'LOCAL_PROOF']);
const ROUTES = new Set(STEPHANOS_RESEARCH_ROUTES);
const ROLES = new Set(STEPHANOS_RESEARCH_ROLES);

function plainObject(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') return null;
    }
    return value;
  } catch {
    return null;
  }
}

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const output = String(value).trim();
  return output || fallback;
}

function id(value, fallback = '') {
  const output = text(value);
  return SAFE_ID.test(output) ? output : fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter((entry) => entry !== null && entry !== undefined) : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function freezeList(values) {
  return Object.freeze([...values]);
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
    researchMayAutoPromoteKnowledge: false,
    researchAgentsOwnCanonicalTruth: false,
    stephanosOwnsFinalSynthesis: true,
    operatorAuthorityPreserved: true,
  });
}

function normalizeSpecialists(input) {
  return list(input).map((candidate, index) => {
    const item = plainObject(candidate);
    if (!item) return null;
    const role = text(item.role).toUpperCase();
    if (!ROLES.has(role)) return null;
    const providerId = id(item.providerId, `provider-${index + 1}`);
    const researcherId = id(item.researcherId, `${role.toLowerCase()}-${index + 1}`);
    return Object.freeze({
      researcherId,
      role,
      providerId,
      qualified: item.qualified === true,
      available: item.available !== false,
      providerNeutral: item.providerNeutral !== false,
    });
  }).filter(Boolean);
}

function canonicalKnowledgeState(input) {
  const knowledge = plainObject(input) || {};
  return Object.freeze({
    sufficient: knowledge.sufficient === true,
    fresh: knowledge.fresh === true,
    conflictCount: list(knowledge.conflicts).length,
    evidenceRefs: freezeList(unique(list(knowledge.evidenceRefs).map((entry) => text(entry)).filter(Boolean))),
  });
}

function invalidPlan(reason) {
  return Object.freeze({
    schemaVersion: STEPHANOS_RESEARCH_COUNCIL_SCHEMA_VERSION,
    valid: false,
    route: 'UNSUPPORTED_OR_UNSAFE',
    reason,
    canonicalKnowledgeCheckedFirst: false,
    researchers: freezeList([]),
    authority: authorityBoundary(),
  });
}

export function planStephanosResearchRouteV1(input = {}) {
  try {
    const request = plainObject(input);
    if (!request) return invalidPlan('research-request-invalid');
    const question = text(request.question);
    if (!question) return invalidPlan('research-question-required');

    const canonical = canonicalKnowledgeState(request.canonicalKnowledge);
    const specialists = normalizeSpecialists(request.specialists);
    const eligible = specialists.filter((entry) => entry.qualified && entry.available && entry.providerNeutral);
    const domains = unique(list(request.domains).map((entry) => text(entry).toLowerCase()).filter(Boolean));
    const consequence = text(request.consequence, 'LOW').toUpperCase();
    const contested = request.contested === true || canonical.conflictCount > 0;
    const needsCounterevidence = request.needsCounterevidence === true;
    const broad = request.broad === true || domains.length >= 2;
    const narrow = request.narrow === true || (!broad && !contested);
    const directResearchAvailable = request.directResearchAvailable === true;

    let route;
    let reason;
    let researchers = [];

    if (request.unsupportedOrUnsafe === true) {
      route = 'UNSUPPORTED_OR_UNSAFE';
      reason = 'request-explicitly-unsupported-or-unsafe';
    } else if (request.operatorJudgmentRequired === true) {
      route = 'OPERATOR_JUDGMENT_REQUIRED';
      reason = 'operator-values-or-consequential-judgment-required';
    } else if (canonical.sufficient && canonical.fresh && canonical.conflictCount === 0) {
      route = 'ANSWER_FROM_CANONICAL_KNOWLEDGE';
      reason = 'canonical-knowledge-sufficient-fresh-and-unconflicted';
    } else {
      const councilJustified = contested || needsCounterevidence || domains.length >= 3 || consequence === 'HIGH';
      if (councilJustified && eligible.length >= 2) {
        const sceptic = eligible.find((entry) => entry.role === 'SCEPTICAL_COUNTEREVIDENCE_RESEARCHER');
        const primary = eligible.find((entry) => entry.role === 'PRIMARY_SOURCE_RESEARCHER');
        const selected = [];
        if (primary) selected.push(primary);
        if (sceptic && !selected.includes(sceptic)) selected.push(sceptic);
        for (const entry of eligible) {
          if (selected.length >= Math.min(5, eligible.length)) break;
          if (!selected.includes(entry)) selected.push(entry);
        }
        route = 'MULTI_AGENT_RESEARCH_COUNCIL';
        reason = contested
          ? 'conflict-or-contestation-justifies-independent-evidence'
          : 'breadth-consequence-or-counterevidence-justifies-council';
        researchers = selected;
      } else if (narrow && directResearchAvailable) {
        route = 'DIRECT_BOUNDED_RESEARCH';
        reason = request.freshnessSensitive === true
          ? 'narrow-freshness-question-direct-route-smallest-sufficient'
          : 'narrow-question-direct-route-smallest-sufficient';
      } else if (eligible.length >= 1) {
        route = 'SINGLE_SPECIALIST_RESEARCH';
        reason = broad
          ? 'bounded-specialist-adds-value-without-council-overhead'
          : 'direct-route-unavailable-specialist-is-smallest-qualified-route';
        researchers = [eligible[0]];
      } else if (request.externalEvidenceRequired === true || !directResearchAvailable) {
        route = 'WAIT_FOR_EXTERNAL_EVIDENCE';
        reason = 'no-qualified-evidence-route-currently-available';
      } else {
        route = 'DIRECT_BOUNDED_RESEARCH';
        reason = 'direct-route-only-qualified-evidence-path';
      }
    }

    return Object.freeze({
      schemaVersion: STEPHANOS_RESEARCH_COUNCIL_SCHEMA_VERSION,
      valid: true,
      route,
      reason,
      question,
      canonicalKnowledgeCheckedFirst: true,
      canonicalKnowledge: canonical,
      researchers: freezeList(researchers),
      sourcePriority: STEPHANOS_RESEARCH_SOURCE_PRIORITY,
      authority: authorityBoundary(),
    });
  } catch {
    return invalidPlan('research-route-planning-failed-closed');
  }
}

export function createStephanosResearchMissionV1(input = {}) {
  try {
    const request = plainObject(input);
    const routePlan = plainObject(request?.routePlan);
    if (!request || !routePlan || routePlan.valid !== true || !ROUTES.has(routePlan.route)) return null;
    const question = text(routePlan.question || request.question);
    if (!question) return null;
    const missionId = id(request.researchMissionId, `research-${hash({ question, route: routePlan.route, parentIntentId: request.parentIntentId }).slice(0, 24)}`);
    const parentIntentId = id(request.parentIntentId, 'operator-intent');
    const researchers = list(routePlan.researchers).map((entry, index) => Object.freeze({
      researcherId: id(entry?.researcherId, `researcher-${index + 1}`),
      role: ROLES.has(text(entry?.role).toUpperCase()) ? text(entry.role).toUpperCase() : 'DOMAIN_SPECIALIST',
      providerId: id(entry?.providerId, `provider-${index + 1}`),
      boundedScope: text(request.boundedScope, question),
    }));
    const missionCore = Object.freeze({
      schemaVersion: STEPHANOS_RESEARCH_MISSION_SCHEMA_VERSION,
      researchMissionId: missionId,
      parentIntentId,
      question,
      researchRoute: routePlan.route,
      whyDelegated: text(routePlan.reason, 'evidence-required'),
      researchers: freezeList(researchers),
      knownContextRefs: freezeList(unique(list(request.knownContextRefs).map((entry) => text(entry)).filter(Boolean))),
      sourcePriority: STEPHANOS_RESEARCH_SOURCE_PRIORITY,
      sourceExclusions: freezeList(unique(list(request.sourceExclusions).map((entry) => text(entry)).filter(Boolean))),
      freshnessRequirement: text(request.freshnessRequirement, 'CURRENT_WHERE_MATERIAL'),
      licencePrivacyBoundary: text(request.licencePrivacyBoundary, 'PUBLIC_OR_EXPLICITLY_AUTHORISED_EVIDENCE_ONLY'),
      contradictionsToCheck: freezeList(unique(list(request.contradictionsToCheck).map((entry) => text(entry)).filter(Boolean))),
      forbiddenActions: STEPHANOS_RESEARCH_FORBIDDEN_ACTIONS,
      returnBudgetClass: text(request.returnBudgetClass, 'BOUNDED'),
      finalSynthesizer: 'stephanos',
      authority: authorityBoundary(),
    });
    return Object.freeze({
      ...missionCore,
      missionFingerprint: hash(missionCore),
    });
  } catch {
    return null;
  }
}

function normalizeClaim(claim, resultIndex, claimIndex) {
  const item = plainObject(claim);
  if (!item) return null;
  const topic = id(item.topic, `topic-${resultIndex + 1}-${claimIndex + 1}`);
  const value = text(item.value);
  if (!value) return null;
  const sourceClass = text(item.sourceClass, 'SECONDARY_CORROBORATION').toUpperCase();
  return Object.freeze({
    claimId: id(item.claimId, `claim-${resultIndex + 1}-${claimIndex + 1}`),
    topic,
    value,
    sourceClass,
    primary: PRIMARY_SOURCE_CLASSES.has(sourceClass),
    freshness: text(item.freshness, 'UNKNOWN').toUpperCase(),
    evidenceRefs: freezeList(unique(list(item.evidenceRefs).map((entry) => text(entry)).filter(Boolean))),
    retrievedAtUtc: text(item.retrievedAtUtc),
  });
}

function normalizeCanonicalFacts(input) {
  return list(input).map((fact, index) => {
    const item = plainObject(fact);
    if (!item) return null;
    const topic = id(item.topic, `canonical-${index + 1}`);
    const value = text(item.value);
    if (!value) return null;
    return Object.freeze({
      topic,
      value,
      freshness: text(item.freshness, 'UNKNOWN').toUpperCase(),
      evidenceRefs: freezeList(unique(list(item.evidenceRefs).map((entry) => text(entry)).filter(Boolean))),
    });
  }).filter(Boolean);
}

export function reconcileStephanosResearchEvidenceV1(input = {}) {
  try {
    const request = plainObject(input);
    const mission = plainObject(request?.mission);
    if (!request || !mission || mission.schemaVersion !== STEPHANOS_RESEARCH_MISSION_SCHEMA_VERSION || !id(mission.researchMissionId)) return null;
    const results = list(request.results).map((result, resultIndex) => {
      const item = plainObject(result);
      if (!item) return null;
      return Object.freeze({
        researcherId: id(item.researcherId, `researcher-${resultIndex + 1}`),
        providerId: id(item.providerId, `provider-${resultIndex + 1}`),
        role: ROLES.has(text(item.role).toUpperCase()) ? text(item.role).toUpperCase() : 'DOMAIN_SPECIALIST',
        claims: freezeList(list(item.claims).map((claim, claimIndex) => normalizeClaim(claim, resultIndex, claimIndex)).filter(Boolean)),
        unknowns: freezeList(unique(list(item.unknowns).map((entry) => text(entry)).filter(Boolean))),
      });
    }).filter(Boolean);

    const claims = results.flatMap((entry) => entry.claims);
    const canonicalFacts = normalizeCanonicalFacts(request.canonicalFacts);
    const byTopic = new Map();
    for (const claim of claims) {
      if (!byTopic.has(claim.topic)) byTopic.set(claim.topic, []);
      byTopic.get(claim.topic).push(claim);
    }
    const conflicts = [];
    for (const [topic, topicClaims] of byTopic.entries()) {
      const values = unique(topicClaims.map((entry) => entry.value));
      if (values.length > 1) conflicts.push(Object.freeze({ topic, values: freezeList(values), kind: 'AGENT_OR_SOURCE_DISAGREEMENT' }));
    }

    const candidateKnowledgeUpdates = [];
    for (const claim of claims) {
      if (!claim.primary || claim.freshness !== 'FRESH') continue;
      const topicConflict = conflicts.some((entry) => entry.topic === claim.topic);
      if (topicConflict) continue;
      const canonical = canonicalFacts.find((entry) => entry.topic === claim.topic);
      if (canonical?.freshness === 'FRESH' && canonical.value !== claim.value) continue;
      if (canonical?.freshness === 'FRESH' && canonical.value === claim.value) continue;
      candidateKnowledgeUpdates.push(Object.freeze({
        topic: claim.topic,
        value: claim.value,
        evidenceRefs: claim.evidenceRefs,
        candidateOnly: true,
        autoPromotionAllowed: false,
      }));
    }

    const unknowns = unique(results.flatMap((entry) => entry.unknowns));
    const primaryEvidenceCount = claims.filter((entry) => entry.primary && entry.freshness === 'FRESH').length;
    const sources = unique(claims.flatMap((entry) => entry.evidenceRefs));
    const researchersUsed = unique(results.map((entry) => entry.researcherId));
    const packetCore = Object.freeze({
      schemaVersion: STEPHANOS_RESEARCH_PACKET_SCHEMA_VERSION,
      researchMissionId: mission.researchMissionId,
      question: mission.question,
      researchRoute: mission.researchRoute,
      researchersUsed: freezeList(researchersUsed),
      providerIds: freezeList(unique(results.map((entry) => entry.providerId))),
      sources: freezeList(sources),
      claims: freezeList(claims),
      conflicts: freezeList(conflicts),
      unknowns: freezeList(unknowns),
      licenceAndReuseNotes: text(request.licenceAndReuseNotes, 'Retain source-specific licence and reuse boundaries.'),
      freshness: conflicts.length > 0 ? 'CONFLICTING' : (claims.some((entry) => entry.freshness === 'STALE') ? 'MIXED' : 'CURRENT_WHERE_PROVEN'),
      confidenceBasis: text(request.confidenceBasis, `${primaryEvidenceCount} fresh primary evidence claim(s); ${conflicts.length} unresolved conflict(s).`),
      stephanosSynthesis: text(request.stephanosSynthesis, `Stephanos reconciled ${claims.length} claim(s) from ${researchersUsed.length} researcher(s); ${conflicts.length} conflict(s) remain explicit.`),
      implicationsForStephanos: text(request.implicationsForStephanos, 'No architecture or authority change follows automatically from research.'),
      candidateKnowledgeUpdates: freezeList(candidateKnowledgeUpdates),
      candidateMethodUpdates: freezeList(unique(list(request.candidateMethodUpdates).map((entry) => text(entry)).filter(Boolean))),
      candidateCapabilityGaps: freezeList(unique(list(request.candidateCapabilityGaps).map((entry) => text(entry)).filter(Boolean))),
      recommendedNextAction: text(request.recommendedNextAction, conflicts.length > 0 ? 'RECONCILE_CONFLICT_BEFORE_PROMOTION' : 'GOVERNED_REVIEW_OF_CANDIDATES'),
      authority: authorityBoundary(),
    });

    return Object.freeze({
      ...packetCore,
      packetFingerprint: hash(packetCore),
      presentation: Object.freeze({
        kind: STEPHANOS_RESEARCH_PRESENTATION_KIND,
        researchMissionId: mission.researchMissionId,
        sourceCount: sources.length,
        specialistCount: researchersUsed.length,
        primaryEvidenceCount,
        conflictCount: conflicts.length,
        whatChangedMyView: text(request.whatChangedMyView, 'No claimed view change without evidence.'),
        implicationForStephanos: packetCore.implicationsForStephanos,
        evidenceExpandable: true,
        rawAgentTranscriptShownByDefault: false,
      }),
    });
  } catch {
    return null;
  }
}

export function resumeResearchMissionWithProviderSubstitutionV1(input = {}) {
  try {
    const request = plainObject(input);
    const mission = plainObject(request?.mission);
    if (!request || !mission || mission.schemaVersion !== STEPHANOS_RESEARCH_MISSION_SCHEMA_VERSION) return null;
    const unavailableProviderId = id(request.unavailableProviderId);
    if (!unavailableProviderId) return null;
    const alternatives = normalizeSpecialists(request.availableProviders).filter((entry) => entry.qualified && entry.available && entry.providerNeutral && entry.providerId !== unavailableProviderId);
    const replacements = new Map();
    const researchers = list(mission.researchers).map((researcher, index) => {
      const item = plainObject(researcher);
      if (!item) return null;
      if (item.providerId !== unavailableProviderId) return Object.freeze({ ...item });
      const role = text(item.role).toUpperCase();
      const replacement = alternatives.find((entry) => entry.role === role && !replacements.has(entry.providerId)) || alternatives.find((entry) => !replacements.has(entry.providerId));
      if (!replacement) return null;
      replacements.set(replacement.providerId, true);
      return Object.freeze({ ...item, providerId: replacement.providerId, substitutedFromProviderId: unavailableProviderId });
    });
    if (researchers.some((entry) => entry === null)) return Object.freeze({
      schemaVersion: STEPHANOS_RESEARCH_MISSION_SCHEMA_VERSION,
      resumed: false,
      researchMissionId: mission.researchMissionId,
      reason: 'no-qualified-provider-substitute',
      authority: authorityBoundary(),
    });
    return Object.freeze({
      ...mission,
      researchers: freezeList(researchers),
      resumed: true,
      providerSubstitutionUsed: true,
      originalMissionFingerprint: mission.missionFingerprint || null,
      missionFingerprint: hash({ researchMissionId: mission.researchMissionId, researchRoute: mission.researchRoute, researchers }),
      authority: authorityBoundary(),
    });
  } catch {
    return null;
  }
}
