import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOSED_LOOP_CAPABILITY_EXAM_V1,
  CLOSED_LOOP_LEARNING_STATES_V1,
  buildClosedLoopLearningPlanV1,
} from './closedLoopLearningV1.mjs';

const BASE = Object.freeze({
  failureClass: 'CAPABILITY_GAP',
  genuineCapabilityFailure: true,
  capabilityId: 'PRODUCT_SURFACE_DISCOVERY_AND_MUTATION',
  attemptedBy: 'sovereign-commander',
  observedAtUtc: '2026-10-02T22:45:00.000Z',
  targetRefs: [
    'apps/stephanos',
    'stephanos-ui/src',
    'shared/agents',
  ],
  taskId: 'landing-page-stephanos-ai-tile',
});

function passedExam() {
  return {
    passed: true,
    answers: CLOSED_LOOP_CAPABILITY_EXAM_V1.map((question, index) => `answer-${index + 1}:${question.slice(0, 24)}`),
    proofRefs: ['proof:closed-loop-exam-product-surface'],
  };
}

test('product-surface capability gaps enter teaching automatically and select OpenClaw Local', () => {
  const plan = buildClosedLoopLearningPlanV1(BASE);

  assert.equal(plan.genuineCapabilityFailure, true);
  assert.equal(plan.capabilityId, 'product-surface-discovery-and-mutation');
  assert.equal(plan.lessonId, 'closed-loop-product-surface-discovery-and-mutation');
  assert.equal(plan.teacherId, 'openclaw-local');
  assert.equal(plan.state, CLOSED_LOOP_LEARNING_STATES_V1.TEACHING_REQUIRED);
  assert.equal(plan.learningCandidate, null);
  assert.equal(plan.retryDirective, null);
  assert.equal(plan.telemetry.retained, false);
  assert.equal(plan.authority.mergeAllowed, false);
  assert.equal(plan.authority.runtimeMutationAllowed, false);
  assert.equal(plan.authority.duplicateWorkerAllowed, false);
});

test('taught capability cannot be retained before the full exam and proof pass', () => {
  const examRequired = buildClosedLoopLearningPlanV1({
    ...BASE,
    retainedMethod: 'Discover canonical product surfaces, mutate bounded source targets and verify the served projection.',
  });
  assert.equal(examRequired.state, CLOSED_LOOP_LEARNING_STATES_V1.EXAM_REQUIRED);
  assert.equal(examRequired.learningCandidate, null);

  const proofRequired = buildClosedLoopLearningPlanV1({
    ...BASE,
    retainedMethod: 'Discover canonical product surfaces, mutate bounded source targets and verify the served projection.',
    exam: passedExam(),
  });
  assert.equal(proofRequired.state, CLOSED_LOOP_LEARNING_STATES_V1.PROOF_REQUIRED);
  assert.equal(proofRequired.exam.passed, true);
  assert.equal(proofRequired.learningCandidate, null);

  const runtimeProofRequired = buildClosedLoopLearningPlanV1({
    ...BASE,
    retainedMethod: 'Discover canonical product surfaces, mutate bounded source targets and verify the served projection.',
    exam: passedExam(),
    verification: {
      passed: true,
      proofRefs: ['proof:product-surface-source-test'],
    },
  });
  assert.equal(runtimeProofRequired.state, CLOSED_LOOP_LEARNING_STATES_V1.PROOF_REQUIRED);
  assert.equal(runtimeProofRequired.verification.passed, false);

  const runtimeProofMustBeLinked = buildClosedLoopLearningPlanV1({
    ...BASE,
    retainedMethod: 'Discover canonical product surfaces, mutate bounded source targets and verify the served projection.',
    exam: passedExam(),
    verification: {
      passed: true,
      proofRefs: ['proof:product-surface-source-test'],
    },
    runtimeEvidenceRefs: ['proof:product-surface-runtime-test'],
  });
  assert.equal(runtimeProofMustBeLinked.state, CLOSED_LOOP_LEARNING_STATES_V1.PROOF_REQUIRED);
  assert.equal(runtimeProofMustBeLinked.verification.passed, false);
});

test('exam plus deterministic proof produces a durable lesson candidate and bounded retry directive', () => {
  const plan = buildClosedLoopLearningPlanV1({
    ...BASE,
    retainedMethod: 'Discover the canonical Stephanos landing-page surface, make the bounded source mutation, verify the canonical build path, and report exact proof.',
    exam: passedExam(),
    verification: {
      passed: true,
      proofRefs: [
        'proof:product-surface-source-test',
        'proof:product-surface-runtime-test',
      ],
    },
    runtimeEvidenceRefs: ['proof:product-surface-runtime-test'],
  });

  assert.equal(plan.state, CLOSED_LOOP_LEARNING_STATES_V1.RETRY_READY);
  assert.equal(plan.telemetry.examPassed, true);
  assert.equal(plan.telemetry.proofPassed, true);
  assert.equal(plan.telemetry.retained, true);
  assert.equal(plan.telemetry.retryReady, true);
  assert.equal(plan.learningCandidate.recordClass, 'REUSABLE_METHOD');
  assert.equal(plan.learningCandidate.problemClass, 'closed-loop-capability-learning');
  assert.ok(plan.learningCandidate.componentAndOwnerRefs.includes('#2647'));
  assert.equal(plan.retryDirective.taskId, 'landing-page-stephanos-ai-tile');
  assert.equal(plan.retryDirective.authorityGranted, false);
  assert.equal(plan.retryDirective.requiresExistingExecutionAuthority, true);
});

test('transient or untyped failures do not enter the capability-learning loop', () => {
  const plan = buildClosedLoopLearningPlanV1({
    ...BASE,
    failureClass: 'TRANSIENT_ROUTE_FAILURE',
    genuineCapabilityFailure: false,
    retainedMethod: 'Do not retain this.',
    exam: passedExam(),
    verification: { passed: true, proofRefs: ['proof:transient'] },
  });

  assert.equal(plan.state, CLOSED_LOOP_LEARNING_STATES_V1.NOT_APPLICABLE);
  assert.equal(plan.genuineCapabilityFailure, false);
  assert.equal(plan.learningCandidate, null);
  assert.equal(plan.retryDirective, null);
});


test('parity-specific gaps select Sovereign Commander before broad repository routing', () => {
  const plan = buildClosedLoopLearningPlanV1({
    ...BASE,
    capabilityId: 'SOVEREIGN_COMMANDER_PARITY_SOURCE_REPAIR',
    targetRefs: ['shared/agents', 'shared/agents/sovereignCommanderCapabilityCompilerV1.mjs'],
  });

  assert.equal(plan.teacherId, 'sovereign-commander');
  assert.equal(plan.state, CLOSED_LOOP_LEARNING_STATES_V1.TEACHING_REQUIRED);
  assert.equal(plan.authority.runtimeMutationAllowed, false);
});


test('anonymous or lossy capability identities fail closed before retention or retry', () => {
  for (const capabilityId of [
    '',
    '   ',
    '%%%invalid%%%',
    'a'.repeat(69),
  ]) {
    const plan = buildClosedLoopLearningPlanV1({
      ...BASE,
      capabilityId,
      retainedMethod: 'Do not retain an unidentified capability.',
      exam: passedExam(),
      verification: {
        passed: true,
        proofRefs: ['proof:identity-source', 'proof:identity-runtime'],
      },
      runtimeEvidenceRefs: ['proof:identity-runtime'],
    });

    assert.equal(plan.genuineCapabilityFailure, true);
    assert.equal(plan.learningEligibleCapabilityFailure, false);
    assert.equal(plan.capabilityIdentityValid, false);
    assert.equal(plan.state, CLOSED_LOOP_LEARNING_STATES_V1.NOT_APPLICABLE);
    assert.equal(plan.learningCandidate, null);
    assert.equal(plan.retryDirective, null);
    assert.equal(plan.telemetry.retryReady, false);
    assert.equal(plan.finalVerdict, 'CLOSED_LOOP_LEARNING_INVALID_CAPABILITY_ID');
  }
});

test('overlong capability IDs cannot collapse into the same promoted lesson identity', () => {
  const sharedPrefix = 'capability-' + 'x'.repeat(58);
  const first = buildClosedLoopLearningPlanV1({
    ...BASE,
    capabilityId: sharedPrefix + 'first',
    retainedMethod: 'First distinct method.',
    exam: passedExam(),
    verification: {
      passed: true,
      proofRefs: ['proof:first-source', 'proof:first-runtime'],
    },
    runtimeEvidenceRefs: ['proof:first-runtime'],
  });
  const second = buildClosedLoopLearningPlanV1({
    ...BASE,
    capabilityId: sharedPrefix + 'second',
    retainedMethod: 'Second distinct method.',
    exam: passedExam(),
    verification: {
      passed: true,
      proofRefs: ['proof:second-source', 'proof:second-runtime'],
    },
    runtimeEvidenceRefs: ['proof:second-runtime'],
  });

  assert.ok((sharedPrefix + 'first').length > 68);
  assert.ok((sharedPrefix + 'second').length > 68);
  assert.equal(first.capabilityIdentityValid, false);
  assert.equal(second.capabilityIdentityValid, false);
  assert.equal(first.learningCandidate, null);
  assert.equal(second.learningCandidate, null);
  assert.equal(first.retryDirective, null);
  assert.equal(second.retryDirective, null);
});

test('explicit lesson IDs must fit losslessly inside the durable lesson key', () => {
  const plan = buildClosedLoopLearningPlanV1({
    ...BASE,
    lessonId: 'l'.repeat(81),
    retainedMethod: 'Do not truncate durable lesson keys.',
    exam: passedExam(),
    verification: {
      passed: true,
      proofRefs: ['proof:lesson-source', 'proof:lesson-runtime'],
    },
    runtimeEvidenceRefs: ['proof:lesson-runtime'],
  });

  assert.equal(plan.capabilityIdentityValid, true);
  assert.equal(plan.lessonIdentityValid, false);
  assert.equal(plan.learningEligibleCapabilityFailure, false);
  assert.equal(plan.state, CLOSED_LOOP_LEARNING_STATES_V1.NOT_APPLICABLE);
  assert.equal(plan.learningCandidate, null);
  assert.equal(plan.retryDirective, null);
  assert.equal(plan.finalVerdict, 'CLOSED_LOOP_LEARNING_INVALID_LESSON_ID');
});
