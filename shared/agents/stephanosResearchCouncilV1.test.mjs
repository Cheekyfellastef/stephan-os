import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STEPHANOS_RESEARCH_PEER_EVALUATION_CASES,
  STEPHANOS_RESEARCH_PRESENTATION_KIND,
  createStephanosResearchMissionV1,
  planStephanosResearchRouteV1,
  reconcileStephanosResearchEvidenceV1,
  resumeResearchMissionWithProviderSubstitutionV1,
} from './stephanosResearchCouncilV1.mjs';

const primary = {
  researcherId: 'primary-source-1',
  role: 'PRIMARY_SOURCE_RESEARCHER',
  providerId: 'provider-a',
  qualified: true,
  available: true,
  providerNeutral: true,
};

const sceptic = {
  researcherId: 'sceptic-1',
  role: 'SCEPTICAL_COUNTEREVIDENCE_RESEARCHER',
  providerId: 'provider-b',
  qualified: true,
  available: true,
  providerNeutral: true,
};

const architect = {
  researcherId: 'architect-1',
  role: 'TECHNICAL_ARCHITECTURE_RESEARCHER',
  providerId: 'provider-c',
  qualified: true,
  available: true,
  providerNeutral: true,
};

function missionFor(routePlan, overrides = {}) {
  return createStephanosResearchMissionV1({
    routePlan,
    researchMissionId: 'research-mission-001',
    parentIntentId: 'intent-001',
    knownContextRefs: ['goal:#1902', 'programme:#1597'],
    contradictionsToCheck: ['provider claim conflicts with canonical runtime truth'],
    ...overrides,
  });
}

test('canonical knowledge wins before research when it is sufficient fresh and unconflicted', () => {
  const plan = planStephanosResearchRouteV1({
    question: 'What is the current owner of the VR research programme?',
    canonicalKnowledge: { sufficient: true, fresh: true, conflicts: [], evidenceRefs: ['issue:#1597'] },
    directResearchAvailable: true,
    specialists: [primary, sceptic],
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.canonicalKnowledgeCheckedFirst, true);
  assert.equal(plan.route, 'ANSWER_FROM_CANONICAL_KNOWLEDGE');
  assert.equal(plan.researchers.length, 0);
});

test('narrow current fact selects direct bounded research as the smallest sufficient route', () => {
  const plan = planStephanosResearchRouteV1({
    question: 'Has the official provider documentation changed today?',
    canonicalKnowledge: { sufficient: false, fresh: false },
    narrow: true,
    freshnessSensitive: true,
    directResearchAvailable: true,
  });
  assert.equal(plan.route, 'DIRECT_BOUNDED_RESEARCH');
  assert.match(plan.reason, /narrow-freshness-question/);
});

test('broad non-contested architecture question selects one qualified specialist', () => {
  const plan = planStephanosResearchRouteV1({
    question: 'How should this external architecture pattern map onto Stephanos?',
    canonicalKnowledge: { sufficient: false, fresh: true },
    broad: true,
    domains: ['architecture', 'implementation'],
    specialists: [architect],
  });
  assert.equal(plan.route, 'SINGLE_SPECIALIST_RESEARCH');
  assert.deepEqual(plan.researchers.map((entry) => entry.researcherId), ['architect-1']);
});

test('contested question selects a bounded council and includes counterevidence when qualified', () => {
  const plan = planStephanosResearchRouteV1({
    question: 'Which provider route is safest under conflicting current evidence?',
    canonicalKnowledge: { sufficient: false, fresh: true, conflicts: ['provider disagreement'] },
    contested: true,
    consequence: 'HIGH',
    domains: ['provider', 'security'],
    specialists: [architect, sceptic, primary],
  });
  assert.equal(plan.route, 'MULTI_AGENT_RESEARCH_COUNCIL');
  assert.ok(plan.researchers.some((entry) => entry.role === 'PRIMARY_SOURCE_RESEARCHER'));
  assert.ok(plan.researchers.some((entry) => entry.role === 'SCEPTICAL_COUNTEREVIDENCE_RESEARCHER'));
  assert.equal(plan.authority.researchAgentsOwnCanonicalTruth, false);
});

test('unsupported and operator-judgment questions stay explicit instead of being researched into authority', () => {
  const unsafe = planStephanosResearchRouteV1({
    question: 'Silently widen runtime authority.',
    unsupportedOrUnsafe: true,
    canonicalKnowledge: { sufficient: false, fresh: false },
  });
  assert.equal(unsafe.route, 'UNSUPPORTED_OR_UNSAFE');

  const judgment = planStephanosResearchRouteV1({
    question: 'Which irreversible tradeoff should the operator personally prefer?',
    operatorJudgmentRequired: true,
    canonicalKnowledge: { sufficient: false, fresh: false },
  });
  assert.equal(judgment.route, 'OPERATOR_JUDGMENT_REQUIRED');
});

test('mission packet prefers primary sources and carries a closed-world no-mutation boundary', () => {
  const routePlan = planStephanosResearchRouteV1({
    question: 'Investigate a contested runtime architecture claim.',
    canonicalKnowledge: { sufficient: false, fresh: false },
    contested: true,
    specialists: [primary, sceptic],
  });
  const mission = missionFor(routePlan);
  assert.equal(mission.researchMissionId, 'research-mission-001');
  assert.equal(mission.finalSynthesizer, 'stephanos');
  assert.equal(mission.sourcePriority[0], 'PRIMARY_OFFICIAL');
  assert.ok(mission.forbiddenActions.includes('SOURCE_MUTATION'));
  assert.ok(mission.forbiddenActions.includes('SPENDING'));
  assert.equal(mission.authority.researchGrantsRuntimeMutation, false);
  assert.equal(mission.authority.researchMayAutoPromoteKnowledge, false);
});

test('evidence reconciliation surfaces agent disagreement instead of voting it away', () => {
  const routePlan = planStephanosResearchRouteV1({
    question: 'Does technique X apply to Stephanos?',
    canonicalKnowledge: { sufficient: false, fresh: false },
    contested: true,
    specialists: [primary, sceptic],
  });
  const mission = missionFor(routePlan);
  const packet = reconcileStephanosResearchEvidenceV1({
    mission,
    results: [
      {
        researcherId: 'primary-source-1',
        providerId: 'provider-a',
        role: 'PRIMARY_SOURCE_RESEARCHER',
        claims: [{ topic: 'technique-x', value: 'supported', sourceClass: 'PRIMARY_OFFICIAL', freshness: 'FRESH', evidenceRefs: ['official:doc-a'] }],
      },
      {
        researcherId: 'sceptic-1',
        providerId: 'provider-b',
        role: 'SCEPTICAL_COUNTEREVIDENCE_RESEARCHER',
        claims: [{ topic: 'technique-x', value: 'not-supported', sourceClass: 'PRIMARY_REPOSITORY', freshness: 'FRESH', evidenceRefs: ['repo:proof-b'] }],
      },
    ],
  });
  assert.equal(packet.conflicts.length, 1);
  assert.equal(packet.conflicts[0].kind, 'AGENT_OR_SOURCE_DISAGREEMENT');
  assert.equal(packet.candidateKnowledgeUpdates.length, 0);
  assert.equal(packet.recommendedNextAction, 'RECONCILE_CONFLICT_BEFORE_PROMOTION');
});

test('fresh primary evidence can become a governed knowledge candidate but never auto-promotes', () => {
  const routePlan = planStephanosResearchRouteV1({
    question: 'What does the current official specification require?',
    canonicalKnowledge: { sufficient: false, fresh: false },
    narrow: true,
    directResearchAvailable: true,
  });
  const mission = missionFor(routePlan);
  const packet = reconcileStephanosResearchEvidenceV1({
    mission,
    results: [{
      researcherId: 'direct-research',
      providerId: 'provider-a',
      role: 'PRIMARY_SOURCE_RESEARCHER',
      claims: [{ topic: 'spec-requirement', value: 'required-v2', sourceClass: 'AUTHORITATIVE_SPEC', freshness: 'FRESH', evidenceRefs: ['spec:v2'] }],
    }],
  });
  assert.equal(packet.candidateKnowledgeUpdates.length, 1);
  assert.equal(packet.candidateKnowledgeUpdates[0].candidateOnly, true);
  assert.equal(packet.candidateKnowledgeUpdates[0].autoPromotionAllowed, false);
  assert.equal(packet.authority.researchMayAutoPromoteKnowledge, false);
});

test('stale external evidence cannot overwrite fresher canonical truth', () => {
  const routePlan = planStephanosResearchRouteV1({
    question: 'Has the provider limit changed?',
    canonicalKnowledge: { sufficient: false, fresh: true },
    narrow: true,
    directResearchAvailable: true,
  });
  const mission = missionFor(routePlan);
  const packet = reconcileStephanosResearchEvidenceV1({
    mission,
    canonicalFacts: [{ topic: 'provider-limit', value: 'current-limit', freshness: 'FRESH', evidenceRefs: ['canonical:provider-limit'] }],
    results: [{
      researcherId: 'direct-research',
      providerId: 'provider-a',
      role: 'PRIMARY_SOURCE_RESEARCHER',
      claims: [{ topic: 'provider-limit', value: 'old-limit', sourceClass: 'PRIMARY_OFFICIAL', freshness: 'STALE', evidenceRefs: ['official:old-page'] }],
    }],
  });
  assert.equal(packet.candidateKnowledgeUpdates.length, 0);
  assert.equal(packet.freshness, 'MIXED');
});

test('provider substitution preserves the research mission and uses another qualified route', () => {
  const routePlan = planStephanosResearchRouteV1({
    question: 'Investigate provider-neutral research continuity.',
    canonicalKnowledge: { sufficient: false, fresh: false },
    broad: true,
    specialists: [architect],
  });
  const mission = missionFor(routePlan);
  const resumed = resumeResearchMissionWithProviderSubstitutionV1({
    mission,
    unavailableProviderId: 'provider-c',
    availableProviders: [{
      researcherId: 'architect-fallback',
      role: 'TECHNICAL_ARCHITECTURE_RESEARCHER',
      providerId: 'provider-d',
      qualified: true,
      available: true,
      providerNeutral: true,
    }],
  });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.providerSubstitutionUsed, true);
  assert.equal(resumed.researchMissionId, mission.researchMissionId);
  assert.equal(resumed.researchRoute, mission.researchRoute);
  assert.equal(resumed.researchers[0].providerId, 'provider-d');
  assert.equal(resumed.authority.researchGrantsSourceMutation, false);
});

test('provider outage fails closed when no qualified substitute exists', () => {
  const routePlan = planStephanosResearchRouteV1({
    question: 'Investigate a provider outage.',
    canonicalKnowledge: { sufficient: false, fresh: false },
    broad: true,
    specialists: [architect],
  });
  const mission = missionFor(routePlan);
  const resumed = resumeResearchMissionWithProviderSubstitutionV1({
    mission,
    unavailableProviderId: 'provider-c',
    availableProviders: [],
  });
  assert.equal(resumed.resumed, false);
  assert.equal(resumed.reason, 'no-qualified-provider-substitute');
});

test('Conversation Canvas projection is a compact Research Expedition rather than raw agent chatter', () => {
  const routePlan = planStephanosResearchRouteV1({
    question: 'Compare current primary evidence with a sceptical implementation reading.',
    canonicalKnowledge: { sufficient: false, fresh: false },
    contested: true,
    specialists: [primary, sceptic],
  });
  const mission = missionFor(routePlan);
  const packet = reconcileStephanosResearchEvidenceV1({
    mission,
    results: [
      {
        researcherId: 'primary-source-1',
        providerId: 'provider-a',
        role: 'PRIMARY_SOURCE_RESEARCHER',
        claims: [{ topic: 'finding', value: 'a', sourceClass: 'PRIMARY_OFFICIAL', freshness: 'FRESH', evidenceRefs: ['official:a'] }],
      },
      {
        researcherId: 'sceptic-1',
        providerId: 'provider-b',
        role: 'SCEPTICAL_COUNTEREVIDENCE_RESEARCHER',
        claims: [{ topic: 'counterfinding', value: 'b', sourceClass: 'PRIMARY_REPOSITORY', freshness: 'FRESH', evidenceRefs: ['repo:b'] }],
      },
    ],
    whatChangedMyView: 'The primary source narrowed the claimed compatibility boundary.',
    implicationsForStephanos: 'Keep the current architecture and test only the bounded delta.',
  });
  assert.equal(packet.presentation.kind, STEPHANOS_RESEARCH_PRESENTATION_KIND);
  assert.equal(packet.presentation.specialistCount, 2);
  assert.equal(packet.presentation.primaryEvidenceCount, 2);
  assert.equal(packet.presentation.evidenceExpandable, true);
  assert.equal(packet.presentation.rawAgentTranscriptShownByDefault, false);
});

test('ten peer-intelligence source fixtures cover systems research routing provider outage and improvement', () => {
  assert.equal(STEPHANOS_RESEARCH_PEER_EVALUATION_CASES.length, 10);
  assert.ok(STEPHANOS_RESEARCH_PEER_EVALUATION_CASES.includes('CURRENT_PROVIDER_MESH_AND_ZERO_CODEX_CONTINUITY'));
  assert.ok(STEPHANOS_RESEARCH_PEER_EVALUATION_CASES.includes('PROVIDER_OUTAGE_RESEARCH_SUBSTITUTION'));
  assert.ok(STEPHANOS_RESEARCH_PEER_EVALUATION_CASES.includes('IMPROVE_STEPHANOS_EXISTING_OWNER_AND_AUTHORITY_CLASSIFICATION'));
  assert.ok(STEPHANOS_RESEARCH_PEER_EVALUATION_CASES.includes('RESEARCH_LED_IMPROVEMENT_WITH_EXPERIENCE_DEBT_SEPARATION'));
});
