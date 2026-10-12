import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOVEREIGN_COMMANDER_CAPABILITY_COMPILER_SCHEMA,
  SOVEREIGN_COMMANDER_SKILL_CONJURER_SCHEMA,
  SOVEREIGN_COMMANDER_SKILL_PACKET_SCHEMA,
  SOVEREIGN_COMMANDER_PRIMITIVE,
  compileSovereignCommanderCapabilityPlanV1,
} from './sovereignCommanderCapabilityCompilerV1.mjs';

test('compiler decomposes process parity into a guarded primitive recipe without arbitrary shell', () => {
  const result = compileSovereignCommanderCapabilityPlanV1({
    timestampUtc: '2026-10-02T14:30:00.000Z',
    capabilities: [{
      capabilityId: 'start-process',
      state: 'BUILDABLE_GAP',
      sovereignEquivalent: 'sovereign-start-process',
    }],
  });

  assert.equal(result.schemaVersion, SOVEREIGN_COMMANDER_CAPABILITY_COMPILER_SCHEMA);
  assert.equal(result.buildableCapabilityCount, 1);
  assert.equal(result.plans[0].primitive, SOVEREIGN_COMMANDER_PRIMITIVE.EXECUTE_GUARDED_PROCESS);
  assert.equal(result.plans[0].compilerAction, 'COMPOSE_GUARDED_RECIPE');
  assert.equal(result.plans[0].requiresKernelChange, false);
  assert.equal(result.plans[0].arbitraryShellAllowed, false);
  assert.equal(result.flywheelExam.length, 10);
  assert.equal(result.flywheelImprovementTargetCount, 1);
});

test('unknown capability proves a minimum primitive need instead of inventing a broad shell', () => {
  const result = compileSovereignCommanderCapabilityPlanV1({
    capabilities: [{
      capabilityId: 'future-widget-control',
      state: 'BUILDABLE_GAP',
    }],
  });
  assert.equal(result.plans[0].primitive, SOVEREIGN_COMMANDER_PRIMITIVE.COMPOSE_RECIPE);
  assert.equal(result.plans[0].requiresKernelChange, true);
  assert.equal(result.primitiveGapCount, 1);
  assert.match(result.plans[0].strategy, /add one new primitive/i);
});

test('only proven parity transitions become Flywheel learning candidates', () => {
  const result = compileSovereignCommanderCapabilityPlanV1({
    timestampUtc: '2026-10-02T14:30:00.000Z',
    capabilities: [
      {
        capabilityId: 'start-process',
        state: 'BUILDABLE_GAP',
        newlyProvenParity: false,
      },
      {
        capabilityId: 'read-file',
        state: 'PARITY_PRESENT',
        newlyProvenParity: true,
        sovereignEquivalent: 'read_file',
      },
      {
        capabilityId: 'arbitrary-shell',
        state: 'BOUNDARY_HOLD',
        newlyProvenParity: false,
      },
    ],
  });

  assert.equal(result.learningCandidates.length, 1);
  assert.equal(result.learningCandidates[0].recordClass, 'REUSABLE_METHOD');
  assert.equal(result.learningCandidates[0].recordKey, 'sovereign-capability-read-file');
  assert.match(result.learningCandidates[0].repairOrMethod, /read_file/);
  assert.equal(result.learningCandidates[0].status, 'CURRENT');
  assert.equal(result.arbitraryShellAllowed, false);
});

test('conjurer publishes deterministic, evidence-bound Skill Forge drafts but never self-activates', () => {
  const ledger = {
    timestampUtc: '2026-10-12T11:10:00.000Z',
    capabilities: [{
      capabilityId: 'start-process',
      state: 'BUILDABLE_GAP',
      sovereignEquivalent: 'sovereign-start-process',
      observationCount: 3,
      queuePaths: ['C:/PRIVATE/secret-worktree'],
      missionIds: ['private-mission-token'],
    }, {
      capabilityId: 'read-file',
      state: 'PARITY_PRESENT',
      newlyProvenParity: true,
    }, {
      capabilityId: 'arbitrary-shell',
      state: 'BOUNDARY_HOLD',
    }],
  };
  const a = compileSovereignCommanderCapabilityPlanV1(ledger);
  const b = compileSovereignCommanderCapabilityPlanV1(ledger);
  assert.deepEqual(a.skillForgeCandidates, b.skillForgeCandidates);
  assert.equal(a.skillConjurerSchema, SOVEREIGN_COMMANDER_SKILL_CONJURER_SCHEMA);
  assert.equal(a.skillForgeCandidateCount, 1);
  assert.equal(a.blockedSkillCount, 0);
  const skill = a.skillForgeCandidates[0];
  assert.equal(skill.schemaVersion, SOVEREIGN_COMMANDER_SKILL_PACKET_SCHEMA);
  assert.equal(skill.id, 'sovereign-skill-start-process');
  assert.equal(skill.status, 'DRAFT');
  assert.equal(skill.riskLevel, 'HIGH');
  assert.equal(skill.permissionLevel, 'NEEDS_OPERATOR_APPROVAL');
  assert.equal(skill.observationCount, 3);
  assert.equal(skill.canonicalOwnerGoal, '#2573');
  assert.equal(skill.recipeSteps.length, 5);
  assert.deepEqual(skill.recipeSteps.map((step) => step.step), [
    'REUSE_CANONICAL_PRIMITIVES',
    'PREPARE_BOUNDED_SOURCE_CHANGE',
    'PROVE_SAFE_BEHAVIOUR',
    'REVIEW_AND_AUTHORISE',
    'VERIFY_RUNTIME_PARITY',
  ]);
  assert.equal(skill.constructionAdmissionAllowed, false);
  assert.equal(skill.activationAllowed, false);
  assert.equal(skill.executionAllowed, false);
  assert.equal(skill.approvalInherited, false);
  assert.equal(skill.mergeAuthority, false);
  assert.equal(skill.arbitraryShellAllowed, false);
  assert.equal(a.automaticCapabilityConstructionAllowed, false);
  const serialized = JSON.stringify(a.skillForgeCandidates);
  assert.doesNotMatch(serialized, /secret-worktree|private-mission-token/);
  assert.match(serialized, /Correlated terminal DONE receipt/);
});

test('known read-only parity gaps remain proposal-only and forbidden authority stays blocked', () => {
  const result = compileSovereignCommanderCapabilityPlanV1({
    timestampUtc: '2026-10-12T11:11:00.000Z',
    capabilities: [{
      capabilityId: 'get-file-info',
      state: 'BUILDABLE_GAP',
      observationCount: 1,
    }, {
      capabilityId: 'credential-export',
      state: 'BUILDABLE_GAP',
      observationCount: 1,
    }],
  });
  assert.equal(result.skillForgeCandidateCount, 2);
  assert.equal(result.blockedSkillCount, 1);
  const observe = result.skillForgeCandidates.find((skill) => skill.capabilityId === 'get-file-info');
  assert.equal(observe.permissionLevel, 'PROPOSE_ONLY');
  assert.equal(observe.riskLevel, 'LOW_MEDIUM');
  assert.equal(observe.activationAllowed, false);
  const unsafe = result.skillForgeCandidates.find((skill) => skill.capabilityId === 'credential-export');
  assert.equal(unsafe.riskLevel, 'BLOCKED');
  assert.equal(unsafe.permissionLevel, 'EXTERNAL_ACTION_BLOCKED');
  assert.equal(unsafe.blockedByPolicy, true);
  assert.equal(unsafe.constructionAdmissionAllowed, false);
  assert.match(unsafe.suggestedNextAction, /do not implement/i);
});
