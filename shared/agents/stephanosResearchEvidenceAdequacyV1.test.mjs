import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STEPHANOS_RESEARCH_EVIDENCE_ADEQUACY_SCHEMA_VERSION,
  assessStephanosResearchEvidenceAdequacyV1,
} from './stephanosResearchEvidenceAdequacyV1.mjs';

function mission(overrides = {}) {
  return {
    schemaVersion: 'stephanos.research-mission.v1',
    researchMissionId: 'research-current-technical-001',
    freshnessRequirement: 'CURRENT_WHERE_MATERIAL',
    ...overrides,
  };
}

function packet(overrides = {}) {
  return {
    schemaVersion: 'stephanos.research-packet.v1',
    researchMissionId: 'research-current-technical-001',
    claims: [],
    conflicts: [],
    ...overrides,
  };
}

test('secondary-only research cannot be presented as current technical truth', () => {
  const result = assessStephanosResearchEvidenceAdequacyV1({
    mission: mission(),
    packet: packet({
      claims: [{
        topic: 'provider-current-limit',
        sourceClass: 'SECONDARY_CORROBORATION',
        freshness: 'FRESH',
        evidenceRefs: ['secondary:report'],
      }],
    }),
  });

  assert.equal(result.schemaVersion, STEPHANOS_RESEARCH_EVIDENCE_ADEQUACY_SCHEMA_VERSION);
  assert.equal(result.valid, true);
  assert.equal(result.state, 'PRIMARY_EVIDENCE_REQUIRED');
  assert.equal(result.canPresentAsCurrentTechnicalTruth, false);
  assert.equal(result.freshPrimaryClaimCount, 0);
  assert.deepEqual(result.secondaryOnlyClaimTopics, ['provider-current-limit']);
  assert.equal(result.recommendedNextAction, 'COLLECT_PRIMARY_OR_OFFICIAL_EVIDENCE');
  assert.equal(result.presenterBoundary.mustLabelInsufficientCurrentTruth, true);
});

test('fresh official or repository evidence can satisfy the current-truth boundary', () => {
  const result = assessStephanosResearchEvidenceAdequacyV1({
    mission: mission(),
    packet: packet({
      claims: [
        {
          topic: 'provider-current-limit',
          sourceClass: 'PRIMARY_OFFICIAL',
          freshness: 'FRESH',
          evidenceRefs: ['official:provider-doc'],
        },
        {
          topic: 'implementation-shape',
          sourceClass: 'PRIMARY_REPOSITORY',
          freshness: 'FRESH',
          evidenceRefs: ['repo:commit-proof'],
        },
      ],
    }),
  });

  assert.equal(result.valid, true);
  assert.equal(result.state, 'EVIDENCE_READY_FOR_STEPHANOS_SYNTHESIS');
  assert.equal(result.canPresentAsCurrentTechnicalTruth, true);
  assert.equal(result.freshPrimaryClaimCount, 2);
  assert.deepEqual(result.freshPrimaryClaimTopics, ['provider-current-limit', 'implementation-shape']);
  assert.equal(result.recommendedNextAction, 'STEPHANOS_SYNTHESIZE_WITH_EVIDENCE_DISCLOSURE');
});

test('stale primary evidence does not satisfy a current technical claim', () => {
  const result = assessStephanosResearchEvidenceAdequacyV1({
    mission: mission({ freshnessRequirement: 'FRESH_CURRENT_TECHNICAL_FACTS' }),
    packet: packet({
      claims: [{
        topic: 'sdk-behaviour',
        sourceClass: 'AUTHORITATIVE_SPEC',
        freshness: 'STALE',
        evidenceRefs: ['spec:old-version'],
      }],
    }),
  });

  assert.equal(result.valid, true);
  assert.equal(result.state, 'PRIMARY_EVIDENCE_REQUIRED');
  assert.equal(result.canPresentAsCurrentTechnicalTruth, false);
  assert.equal(result.freshPrimaryClaimCount, 0);
});

test('unresolved research disagreement blocks a current-truth claim even with fresh primary evidence', () => {
  const result = assessStephanosResearchEvidenceAdequacyV1({
    mission: mission(),
    packet: packet({
      claims: [{
        topic: 'runtime-contract',
        sourceClass: 'LOCAL_PROOF',
        freshness: 'FRESH',
        evidenceRefs: ['proof:runtime'],
      }],
      conflicts: [{ topic: 'runtime-contract', kind: 'AGENT_OR_SOURCE_DISAGREEMENT' }],
    }),
  });

  assert.equal(result.valid, true);
  assert.equal(result.state, 'CONFLICT_RECONCILIATION_REQUIRED');
  assert.equal(result.canPresentAsCurrentTechnicalTruth, false);
  assert.equal(result.conflictCount, 1);
  assert.equal(result.recommendedNextAction, 'RECONCILE_CONFLICT_BEFORE_CURRENT_TRUTH_CLAIM');
});

test('presentation metadata cannot counterfeit primary evidence because adequacy is derived from normalized claims', () => {
  const result = assessStephanosResearchEvidenceAdequacyV1({
    mission: mission(),
    packet: packet({
      claims: [{
        topic: 'api-shape',
        sourceClass: 'SECONDARY_CORROBORATION',
        freshness: 'FRESH',
        evidenceRefs: ['secondary:blog'],
      }],
      presentation: { primaryEvidenceCount: 999 },
    }),
  });

  assert.equal(result.state, 'PRIMARY_EVIDENCE_REQUIRED');
  assert.equal(result.freshPrimaryClaimCount, 0);
});

test('mission lineage mismatch and accessor-shaped evidence fail closed', () => {
  const mismatch = assessStephanosResearchEvidenceAdequacyV1({
    mission: mission(),
    packet: packet({ researchMissionId: 'other-mission' }),
  });
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.reason, 'research-mission-lineage-mismatch');

  const hostile = {};
  Object.defineProperty(hostile, 'mission', { enumerable: true, get() { throw new Error('should-not-run'); } });
  Object.defineProperty(hostile, 'packet', { enumerable: true, value: packet() });
  const rejected = assessStephanosResearchEvidenceAdequacyV1(hostile);
  assert.equal(rejected.valid, false);
  assert.equal(rejected.state, 'SAFE_HOLD');
});

test('adequacy gate cannot grant product or construction authority', () => {
  const result = assessStephanosResearchEvidenceAdequacyV1({
    mission: mission(),
    packet: packet({
      claims: [{
        topic: 'official-fact',
        sourceClass: 'PRIMARY_OFFICIAL',
        freshness: 'FRESH',
        evidenceRefs: ['official:fact'],
      }],
    }),
  });

  for (const key of [
    'researchGrantsSourceMutation',
    'researchGrantsMerge',
    'researchGrantsDeployment',
    'researchGrantsRuntimeMutation',
    'researchGrantsArbitraryShell',
    'researchGrantsCredentialOrAccountChange',
    'researchGrantsSpending',
    'automaticKnowledgePromotionAllowed',
    'researchAgentsOwnCanonicalTruth',
  ]) assert.equal(result.authority[key], false, key);
  assert.equal(result.authority.stephanosOwnsFinalSynthesis, true);
});
