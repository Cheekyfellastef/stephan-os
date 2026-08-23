import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStephanosResearchMissionV1,
  planStephanosResearchRouteV1,
  reconcileStephanosResearchEvidenceV1,
} from './stephanosResearchCouncilV1.mjs';
import {
  STEPHANOS_RESEARCH_RICH_RESPONSE_EXTENSION_SCHEMA_VERSION,
  buildStephanosResearchRichResponseExtensionV1,
} from './stephanosResearchRichResponseExtensionV1.mjs';

function missionFor() {
  const routePlan = planStephanosResearchRouteV1({
    question: 'What is the current authoritative source for this technical fact?',
    canonicalKnowledge: { sufficient: false, fresh: false, conflicts: [], evidenceRefs: ['proofs/canonical-check'] },
    narrow: true,
    directResearchAvailable: false,
    specialists: [{
      researcherId: 'primary-researcher',
      role: 'PRIMARY_SOURCE_RESEARCHER',
      providerId: 'provider-a',
      qualified: true,
      available: true,
      providerNeutral: true,
    }],
  });
  assert.equal(routePlan.valid, true);
  assert.equal(routePlan.route, 'SINGLE_SPECIALIST_RESEARCH');
  const mission = createStephanosResearchMissionV1({
    routePlan,
    parentIntentId: 'intent-research-extension',
    researchMissionId: 'research-extension-001',
    knownContextRefs: ['#1902', '#1308', '#1722'],
  });
  assert.ok(mission);
  return mission;
}

function packetFor({ conflicts = false } = {}) {
  const mission = missionFor();
  const claims = [{
    claimId: 'claim-a',
    topic: 'current-api-contract',
    value: 'primary-value',
    sourceClass: 'PRIMARY_OFFICIAL',
    freshness: 'FRESH',
    evidenceRefs: ['proofs/primary-a'],
    retrievedAtUtc: '2026-08-20T18:00:00.000Z',
  }];
  if (conflicts) claims.push({
    claimId: 'claim-b',
    topic: 'current-api-contract',
    value: 'conflicting-value',
    sourceClass: 'PRIMARY_REPOSITORY',
    freshness: 'FRESH',
    evidenceRefs: ['proofs/primary-b'],
    retrievedAtUtc: '2026-08-20T18:01:00.000Z',
  });
  const packet = reconcileStephanosResearchEvidenceV1({
    mission,
    results: [{
      researcherId: 'primary-researcher',
      providerId: 'provider-a',
      role: 'PRIMARY_SOURCE_RESEARCHER',
      claims,
      unknowns: conflicts ? ['The authoritative interpretation is unsettled.'] : [],
    }],
    stephanosSynthesis: conflicts
      ? 'Stephanos preserves disagreement pending reconciliation.'
      : 'Stephanos accepts the fresh primary claim as current where proven.',
    implicationsForStephanos: 'No implementation or authority change follows automatically from this research.',
    recommendedNextAction: conflicts ? 'RECONCILE_CONFLICT_BEFORE_PROMOTION' : 'GOVERNED_REVIEW_OF_CANDIDATES',
  });
  assert.ok(packet);
  return packet;
}

test('maps reconciled research into the existing rich-response structured extension shape', () => {
  const packet = packetFor();
  const result = buildStephanosResearchRichResponseExtensionV1({ researchPacket: packet });

  assert.equal(result.valid, true, result.errors?.join(','));
  assert.equal(result.schemaVersion, STEPHANOS_RESEARCH_RICH_RESPONSE_EXTENSION_SCHEMA_VERSION);
  assert.match(result.extensionId, /^research-rich-extension-/);
  assert.equal(result.researchLineage.researchMissionId, packet.researchMissionId);
  assert.equal(result.researchLineage.packetFingerprint, packet.packetFingerprint);
  assert.equal(result.researchLineage.presentationKind, 'RESEARCH_EXPEDITION');
  assert.equal(result.researchLineage.finalSynthesizer, 'stephanos');
  assert.equal(result.researchLineage.automaticKnowledgePromotionAllowed, false);
  assert.equal(result.structured.goalsMissions[0].state, 'RESEARCH_COMPLETE');
  assert.equal(result.structured.agentProviderContributions[0].contributionType, 'RESEARCH_SCOUT');
  assert.deepEqual(result.structured.visualisationCandidates, ['RESEARCH_EXPEDITION']);
  assert.equal(result.structured.approvalState.state, 'NOT_REQUESTED');
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.runtimeMutationAllowed, false);
});

test('preserves research disagreement as explicit Canvas unknowns instead of majority-vote truth', () => {
  const packet = packetFor({ conflicts: true });
  const result = buildStephanosResearchRichResponseExtensionV1({ researchPacket: packet });

  assert.equal(result.valid, true, result.errors?.join(','));
  assert.equal(result.structured.goalsMissions[0].state, 'CONFLICTED');
  assert.ok(result.structured.unknowns.some((item) => item.includes('authoritative interpretation is unsettled')));
  assert.ok(result.structured.unknowns.some((item) => item.includes('Unresolved research disagreement on current-api-contract')));
  assert.equal(result.researchLineage.conflictCount, 1);
});

test('keeps governed knowledge candidates inert and visible only as lineage', () => {
  const packet = packetFor();
  assert.ok(packet.candidateKnowledgeUpdates.length >= 1);
  assert.ok(packet.candidateKnowledgeUpdates.every((candidate) => candidate.autoPromotionAllowed === false));

  const result = buildStephanosResearchRichResponseExtensionV1({ researchPacket: packet });
  assert.equal(result.valid, true);
  assert.equal(result.researchLineage.candidateKnowledgeUpdateCount, packet.candidateKnowledgeUpdates.length);
  assert.equal(result.researchLineage.automaticKnowledgePromotionAllowed, false);
  assert.equal(result.authority.automaticKnowledgePromotionAllowed, false);
});

test('fails closed on wrong schema, widened authority, and presentation lineage mismatch', () => {
  const packet = packetFor();

  const wrongSchema = buildStephanosResearchRichResponseExtensionV1({
    researchPacket: { ...packet, schemaVersion: 'not-research-packet' },
  });
  assert.equal(wrongSchema.valid, false);
  assert.ok(wrongSchema.errors.includes('research-packet-schema-mismatch'));

  const widened = buildStephanosResearchRichResponseExtensionV1({
    researchPacket: { ...packet, authority: { ...packet.authority, researchGrantsSourceMutation: true } },
  });
  assert.equal(widened.valid, false);
  assert.ok(widened.errors.includes('research-packet-authority-must-remain-governed'));

  const mismatched = buildStephanosResearchRichResponseExtensionV1({
    researchPacket: { ...packet, presentation: { ...packet.presentation, researchMissionId: 'other-mission' } },
  });
  assert.equal(mismatched.valid, false);
  assert.ok(mismatched.errors.includes('research-presentation-lineage-mismatch'));
});
