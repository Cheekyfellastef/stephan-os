import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMissionEngineV1,
  buildMissionOutcomeContractV1,
  STEPHANOS_MISSION_ENGINE_SCHEMA_V1,
} from './missionEngineV1.mjs';

const mission = {
  missionId: 'starfield-vr-excellence',
  title: 'Starfield VR Excellence',
  desiredOutcome: 'Make Starfield the best VR experience achievable on Battle Bridge.',
  outcomeContract: [
    {
      id: 'motion-clarity',
      title: 'Motion clarity is comfortable and stable',
      severity: 'CRITICAL',
      weight: 5,
      routeHint: 'BATTLE_BRIDGE_FIXED_TEST',
      proofRequired: true,
      resourceIds: ['starfield-vr-rendering'],
    },
    {
      id: 'audio-restoration',
      title: 'Audio returns to the previous device after VR exits',
      severity: 'HIGH',
      weight: 3,
      routeHint: 'OPENCLAW_LOCAL',
      proofRequired: true,
      resourceIds: ['windows-audio'],
    },
    {
      id: 'launcher-reliability',
      title: 'The VR launcher starts the selected route repeatably',
      severity: 'MEDIUM',
      weight: 2,
      routeHint: 'CHATGPT_GITHUB',
      proofRequired: true,
      dependencies: ['motion-clarity'],
    },
  ],
};

test('mission outcome contract is versioned, bounded, and grants no authority', () => {
  const contract = buildMissionOutcomeContractV1(mission);
  assert.equal(contract.valid, true);
  assert.equal(contract.missionId, 'starfield-vr-excellence');
  assert.equal(contract.criteria.length, 3);
  assert.equal(contract.authority.sourceMutationGranted, false);
  assert.equal(contract.authority.dispatchAuthorityGranted, false);
  assert.equal(contract.authority.mergeAuthorityGranted, false);
  assert.ok(Object.isFrozen(contract));
});

test('unknown outcome criteria generate information goals rather than guessed repairs', () => {
  const result = buildMissionEngineV1({ mission });
  assert.equal(result.schemaVersion, STEPHANOS_MISSION_ENGINE_SCHEMA_V1);
  assert.equal(result.finalVerdict, 'STEPHANOS_MISSION_ENGINE_REPLAN_READY');
  assert.equal(result.gaps.length, 3);
  assert.ok(result.candidateGoals.some((goal) => goal.goalKind === 'INFORMATION'));
  const motion = result.candidateGoals.find((goal) => goal.criterionId === 'motion-clarity');
  assert.equal(motion.goalKind, 'INFORMATION');
  assert.match(motion.title, /^Determine current truth:/);
  assert.equal(motion.dispatchRequested, false);
  assert.equal(motion.authorityWidened, false);
  assert.equal(result.authority.schedulerOwner, '#1556');
});

test('fresh unsatisfied evidence changes the next goal from investigation to repair', () => {
  const first = buildMissionEngineV1({ mission });
  const firstMotion = first.candidateGoals.find((goal) => goal.criterionId === 'motion-clarity');
  assert.equal(firstMotion.goalKind, 'INFORMATION');

  const second = buildMissionEngineV1({
    mission,
    previousProjection: first,
    trigger: 'PLAYTEST_EVIDENCE_RECEIVED',
    currentState: [
      {
        criterionId: 'motion-clarity',
        status: 'UNSATISFIED',
        summary: 'Head movement produces alternate-eye breakup.',
        evidenceRefs: ['playtest:starfield-vr:motion-001'],
        confidence: 0.95,
        freshness: 'CURRENT',
      },
    ],
  });
  const secondMotion = second.candidateGoals.find((goal) => goal.criterionId === 'motion-clarity');
  assert.equal(secondMotion.goalKind, 'OUTCOME_REPAIR');
  assert.match(secondMotion.title, /^Close mission gap:/);
  assert.ok(secondMotion.createdFromEvidenceRefs.includes('playtest:starfield-vr:motion-001'));
  assert.equal(second.replanEvent.trigger, 'PLAYTEST_EVIDENCE_RECEIVED');
  assert.equal(second.replanEvent.nextGoalChanged, true);
});

test('a later goal can emerge only after an information goal produces new evidence', () => {
  const initial = buildMissionEngineV1({
    mission: {
      missionId: 'adaptive-chain',
      title: 'Adaptive chain',
      desiredOutcome: 'Prove one evolving criterion.',
      outcomeContract: [{ id: 'root-cause', title: 'Root cause resolved', severity: 'CRITICAL', proofRequired: true }],
    },
  });
  assert.equal(initial.nextGoal.goalKind, 'INFORMATION');
  const informationGoalId = initial.nextGoal.candidateGoalId;

  const diagnosed = buildMissionEngineV1({
    mission: initial.outcomeContract,
    previousProjection: initial,
    currentState: [{
      criterionId: 'root-cause',
      status: 'UNSATISFIED',
      summary: 'Diagnosis isolated the defect.',
      evidenceRefs: ['experiment:diagnosis-001'],
      confidence: 1,
      freshness: 'CURRENT',
    }],
  });
  assert.equal(diagnosed.nextGoal.goalKind, 'OUTCOME_REPAIR');
  assert.notEqual(diagnosed.nextGoal.candidateGoalId, informationGoalId);
  const repairGoalId = diagnosed.nextGoal.candidateGoalId;

  const proven = buildMissionEngineV1({
    mission: diagnosed.outcomeContract,
    previousProjection: diagnosed,
    currentState: [{
      criterionId: 'root-cause',
      status: 'SATISFIED',
      summary: 'Repair passed controlled verification.',
      evidenceRefs: ['proof:repair-001'],
      confidence: 1,
      freshness: 'CURRENT',
    }],
    existingGoals: [{
      issue: 9001,
      title: diagnosed.nextGoal.title,
      missionId: diagnosed.missionId,
      gapId: diagnosed.nextGoal.gapId,
      candidateGoalId: repairGoalId,
      state: 'COMPLETE',
      resultProofRefs: ['proof:repair-001'],
      reusableCapabilityId: 'root-cause-repair',
      sharedLessonId: 'lesson-root-cause-repair',
      evidenceAt: '2026-10-03T10:00:00.000Z',
    }],
  });
  assert.equal(proven.acceptance.provenComplete, true);
  assert.equal(proven.nextGoal, null);
  assert.equal(proven.finalVerdict, 'STEPHANOS_MISSION_ENGINE_OUTCOME_PROVEN');
});

test('candidate goals preserve provenance and proof/failure contracts', () => {
  const result = buildMissionEngineV1({
    mission,
    currentState: [{
      criterionId: 'audio-restoration',
      status: 'UNSATISFIED',
      summary: 'Quest exit leaves Quest selected.',
      evidenceRefs: ['playtest:audio-002'],
      confidence: 1,
      freshness: 'CURRENT',
    }],
  });
  const goal = result.candidateGoals.find((candidate) => candidate.criterionId === 'audio-restoration');
  assert.equal(goal.missionId, 'starfield-vr-excellence');
  assert.match(goal.gapId, /^audio-restoration:/);
  assert.equal(goal.reasonCreated.includes('evidenced as unsatisfied'), true);
  assert.ok(goal.expectedOutcomeEffect.length > 0);
  assert.ok(goal.proofRequired.length > 0);
  assert.ok(goal.failureStrategy.length > 0);
  assert.deepEqual(goal.createdFromEvidenceRefs, ['playtest:audio-002']);
});

test('generated goals dedupe against provenance-bound existing work', () => {
  const first = buildMissionEngineV1({
    mission,
    currentState: [{
      criterionId: 'audio-restoration',
      status: 'UNSATISFIED',
      evidenceRefs: ['playtest:audio-003'],
      freshness: 'CURRENT',
    }],
  });
  const proposed = first.candidateGoals.find((goal) => goal.criterionId === 'audio-restoration');

  const second = buildMissionEngineV1({
    mission,
    currentState: [{
      criterionId: 'audio-restoration',
      status: 'UNSATISFIED',
      evidenceRefs: ['playtest:audio-003'],
      freshness: 'CURRENT',
    }],
    existingGoals: [{
      issue: 2660,
      title: proposed.title,
      missionId: proposed.missionId,
      gapId: proposed.gapId,
      candidateGoalId: proposed.candidateGoalId,
      state: 'QUEUED',
      evidenceAt: '2026-10-03T10:00:00.000Z',
    }],
  });
  const deduped = second.candidateGoals.find((goal) => goal.criterionId === 'audio-restoration');
  assert.equal(deduped.status, 'DEDUPED_EXISTING_WORK');
  assert.equal(deduped.duplicateOf.issue, 2660);
});

test('dependency-blocked candidate is held until prerequisite outcome is proven', () => {
  const held = buildMissionEngineV1({
    mission,
    currentState: [{
      criterionId: 'launcher-reliability',
      status: 'UNSATISFIED',
      evidenceRefs: ['test:launcher-001'],
      freshness: 'CURRENT',
    }],
  });
  const launcherHeld = held.candidateGoals.find((goal) => goal.criterionId === 'launcher-reliability');
  assert.equal(launcherHeld.status, 'HELD_DEPENDENCY');
  assert.deepEqual(launcherHeld.missingDependencies, ['motion-clarity']);

  const released = buildMissionEngineV1({
    mission,
    currentState: [
      {
        criterionId: 'motion-clarity',
        status: 'SATISFIED',
        evidenceRefs: ['proof:motion-001'],
        confidence: 1,
        freshness: 'CURRENT',
      },
      {
        criterionId: 'launcher-reliability',
        status: 'UNSATISFIED',
        evidenceRefs: ['test:launcher-001'],
        confidence: 1,
        freshness: 'CURRENT',
      },
    ],
  });
  const launcherReady = released.candidateGoals.find((goal) => goal.criterionId === 'launcher-reliability');
  assert.equal(launcherReady.status, 'CANDIDATE');
  assert.deepEqual(launcherReady.missingDependencies, []);
});

test('mission completion requires proof for proof-required satisfied criteria', () => {
  const noProof = buildMissionEngineV1({
    mission: {
      missionId: 'proof-gate',
      desiredOutcome: 'Prove the acceptance criterion.',
      outcomeContract: [{ id: 'verified', title: 'Verified', proofRequired: true }],
    },
    currentState: [{ criterionId: 'verified', status: 'SATISFIED', confidence: 1, freshness: 'CURRENT' }],
  });
  assert.equal(noProof.acceptance.provenComplete, false);
  assert.equal(noProof.currentState[0].proofSatisfied, false);

  const proven = buildMissionEngineV1({
    mission: {
      missionId: 'proof-gate',
      desiredOutcome: 'Prove the acceptance criterion.',
      outcomeContract: [{ id: 'verified', title: 'Verified', proofRequired: true }],
    },
    currentState: [{
      criterionId: 'verified',
      status: 'SATISFIED',
      confidence: 1,
      freshness: 'CURRENT',
      evidenceRefs: ['proof:verified-001'],
    }],
  });
  assert.equal(proven.acceptance.provenComplete, true);
});

test('shared workspace projection exposes mission, gaps, candidate goals, evidence and next-goal rationale', () => {
  const result = buildMissionEngineV1({
    mission,
    currentState: [{
      criterionId: 'motion-clarity',
      status: 'UNSATISFIED',
      evidenceRefs: ['playtest:motion-004'],
      confidence: 1,
      freshness: 'CURRENT',
    }],
    lessons: ['Collect playtest telemetry before renderer mutation.'],
  });
  const projection = result.sharedWorkspaceProjection;
  assert.equal(projection.missionId, 'starfield-vr-excellence');
  assert.ok(projection.candidateGoals.length >= 1);
  assert.ok(projection.evidenceRefs.includes('playtest:motion-004'));
  assert.ok(projection.nextGoal);
  assert.ok(projection.nextGoal.why.length > 0);
  assert.equal(result.lessons[0], 'Collect playtest telemetry before renderer mutation.');
});

test('candidate generation does not widen execution or merge authority', () => {
  const result = buildMissionEngineV1({ mission });
  assert.equal(result.authority.readOnlyPlanning, true);
  assert.equal(result.authority.dispatchAuthority, false);
  assert.equal(result.authority.sourceMutationAuthority, false);
  assert.equal(result.authority.runtimeMutationAuthority, false);
  assert.equal(result.authority.mergeAuthority, false);
  assert.equal(result.authority.approvalBypass, false);
  assert.ok(result.candidateGoals.every((goal) => goal.dispatchRequested === false));
});
