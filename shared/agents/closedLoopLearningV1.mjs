export const CLOSED_LOOP_LEARNING_SCHEMA_V1 = 'stephanos.closed-loop-learning.v1';

export const CLOSED_LOOP_CAPABILITY_EXAM_V1 = Object.freeze([
  'What capability actually failed, in concrete operator-visible terms?',
  'Which actor or tool attempted it, and what evidence proves the failure was a capability gap rather than a transient fault?',
  'Which existing guarded primitive or recipe already covers part of the missing capability?',
  'Can the missing capability be composed from existing guarded primitives without adding a new authority surface?',
  'What is the narrowest safe scope, target set and mutation boundary for the capability?',
  'Which operator, approval, merge, runtime or destructive-action gates must remain unchanged?',
  'What deterministic self-test proves the taught capability works?',
  'What live runtime proof proves it works on the intended surface rather than only in source or unit tests?',
  'What recovery path handles partial failure without widening authority or creating a duplicate worker/controller?',
  'What exact capability should be retained, and what evidence makes retrying the original task safe?',
]);

export const CLOSED_LOOP_LEARNING_STATES_V1 = Object.freeze({
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  TEACHING_REQUIRED: 'TEACHING_REQUIRED',
  EXAM_REQUIRED: 'EXAM_REQUIRED',
  PROOF_REQUIRED: 'PROOF_REQUIRED',
  RETRY_READY: 'RETRY_READY',
});

const SAFE_REF = /^[a-z0-9][a-z0-9._:/#@+-]{0,239}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const KNOWN_TEACHERS = new Set([
  'openclaw-local',
  'openclaw-standalone',
  'sovereign-commander',
  'stephanos',
  'flywheel',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function safeId(value, fallback = '') {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return SAFE_ID.test(normalized) ? normalized : fallback;
}

function safeRefs(value) {
  return [...new Set(list(value).filter((item) => SAFE_REF.test(item)))];
}

function canonicalCapabilityId(value, fallback = 'unknown-capability') {
  return safeId(text(value).replace(/_/g, '-'), fallback);
}

function zeroAuthority() {
  return Object.freeze({
    sourceMutationAllowed: false,
    runtimeMutationAllowed: false,
    arbitraryShellAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    destructiveGitAllowed: false,
    duplicateControllerAllowed: false,
    duplicateSchedulerAllowed: false,
    duplicateWorkerAllowed: false,
    operatorFallbackAllowed: false,
  });
}

function selectTeacher(input = {}) {
  const explicit = text(input.teacherHint).toLowerCase();
  if (KNOWN_TEACHERS.has(explicit)) return explicit;

  const refs = safeRefs(input.targetRefs).join(' ').toLowerCase();
  const capability = text(input.capabilityId).toLowerCase().replace(/_/g, '-');
  if (/sovereign-commander|commander-parity/.test(capability)) return 'sovereign-commander';

  if (
    refs.includes('apps/stephanos')
    || refs.includes('stephanos-ui')
    || refs.includes('stephanos-server')
    || refs.includes('shared/agents')
    || refs.includes('shared/runtime')
    || /product-surface|landing-page|shared-workspace|source-construction/.test(capability)
  ) return 'openclaw-local';

  if (
    refs.includes('battle-bridge')
    || refs.includes('windows')
    || /whole-pc|desktop-ui|windows|device/.test(capability)
  ) return 'openclaw-standalone';

  return 'flywheel';
}

function examPassed(exam = {}) {
  return exam?.passed === true
    && safeRefs(exam?.proofRefs).length > 0
    && (Array.isArray(exam?.answers) ? exam.answers.filter((answer) => text(answer)).length : 0)
      >= CLOSED_LOOP_CAPABILITY_EXAM_V1.length;
}

function proofPassed(verification = {}, runtimeEvidenceRefs = []) {
  const proofRefs = safeRefs(verification?.proofRefs);
  const runtimeRefs = safeRefs(runtimeEvidenceRefs);
  return verification?.passed === true
    && proofRefs.length > 0
    && runtimeRefs.length > 0
    && runtimeRefs.some((ref) => proofRefs.includes(ref));
}

function buildLearningCandidate(input, teacherId, lessonId, proofRefs, examProofRefs) {
  const retainedMethod = text(input.retainedMethod);
  if (!retainedMethod) return null;
  const timestampUtc = text(input.observedAtUtc);
  const componentRefs = [
    '#2647',
    ...safeRefs(input.targetRefs),
  ];
  return Object.freeze({
    lessonId,
    recordKey: lessonId,
    recordClass: 'REUSABLE_METHOD',
    problemClass: 'closed-loop-capability-learning',
    componentAndOwnerRefs: Object.freeze([...new Set(componentRefs)]),
    observedAtUtc: timestampUtc,
    repairOrMethod: retainedMethod,
    prerequisites: Object.freeze([
      'The capability failure must be explicitly typed as a genuine capability gap.',
      'The assigned teacher must preserve the existing authority boundary.',
      'The full closed-loop capability exam and deterministic verification must both pass.',
    ]),
    forbiddenShortcuts: Object.freeze([
      'Do not retain a capability merely because one attempted route failed.',
      'Do not convert missing proof into success.',
      'Do not widen merge, runtime, shell, deployment or destructive-action authority while teaching.',
      'Do not create a duplicate controller, scheduler, worker, mailbox or truth store.',
    ]),
    failureModes: Object.freeze([
      'A transient outage is misclassified as a capability gap.',
      'The taught method passes unit proof but lacks live runtime proof.',
      'The original task is retried before exam and proof pass.',
    ]),
    counterexamples: Object.freeze([
      'A single successful fallback execution is discovery evidence, not durable retained capability proof.',
    ]),
    testAndProofRefs: Object.freeze([...new Set(['goal:#2647', ...examProofRefs, ...proofRefs])]),
    runtimeEvidenceRefs: Object.freeze(safeRefs(input.runtimeEvidenceRefs)),
    confidenceBasis: `Teacher ${teacherId} passed the full capability exam and deterministic verification before retention.`,
    freshness: 'CURRENT',
    applicableDomains: Object.freeze([
      'closed-loop-learning',
      canonicalCapabilityId(input.capabilityId, 'capability-gap'),
    ]),
    privacyAndSensitivity: 'INTERNAL_BOUNDED',
    status: 'CURRENT',
  });
}

export function buildClosedLoopLearningPlanV1(input = {}) {
  const genuineGap = input.genuineCapabilityFailure === true
    && text(input.failureClass).toUpperCase() === 'CAPABILITY_GAP';
  const normalizedCapabilityId = canonicalCapabilityId(input.capabilityId);
  const capabilityId = normalizedCapabilityId;
  const eventId = safeId(input.eventId, `capability-gap-${capabilityId}`);
  const lessonId = safeId(
    input.lessonId || `closed-loop-${capabilityId}`,
    'closed-loop-capability-gap',
  ).slice(0, 80);
  const teacherId = selectTeacher(input);
  const retainedMethod = text(input.retainedMethod);
  const didPassExam = examPassed(input.exam);
  const didPassProof = proofPassed(input.verification, input.runtimeEvidenceRefs);
  const examProofRefs = safeRefs(input.exam?.proofRefs);
  const proofRefs = safeRefs(input.verification?.proofRefs);
  const learningCandidate = genuineGap && retainedMethod && didPassExam && didPassProof
    ? buildLearningCandidate(input, teacherId, lessonId, proofRefs, examProofRefs)
    : null;

  let state = CLOSED_LOOP_LEARNING_STATES_V1.NOT_APPLICABLE;
  if (genuineGap && !retainedMethod) state = CLOSED_LOOP_LEARNING_STATES_V1.TEACHING_REQUIRED;
  else if (genuineGap && !didPassExam) state = CLOSED_LOOP_LEARNING_STATES_V1.EXAM_REQUIRED;
  else if (genuineGap && !didPassProof) state = CLOSED_LOOP_LEARNING_STATES_V1.PROOF_REQUIRED;
  else if (genuineGap && learningCandidate) state = CLOSED_LOOP_LEARNING_STATES_V1.RETRY_READY;

  const retryTaskId = safeId(input.retryTaskId || input.taskId || eventId, eventId);
  const retryDirective = state === CLOSED_LOOP_LEARNING_STATES_V1.RETRY_READY
    ? Object.freeze({
      taskId: retryTaskId,
      capabilityId,
      reason: 'CAPABILITY_RETAINED_AFTER_EXAM_AND_PROOF',
      bounded: true,
      authorityGranted: false,
      requiresExistingExecutionAuthority: true,
    })
    : null;

  return Object.freeze({
    schemaVersion: CLOSED_LOOP_LEARNING_SCHEMA_V1,
    eventId,
    capabilityId,
    lessonId,
    failureClass: genuineGap ? 'CAPABILITY_GAP' : text(input.failureClass, 'UNKNOWN').toUpperCase(),
    genuineCapabilityFailure: genuineGap,
    attemptedBy: safeId(input.attemptedBy, 'unknown-actor'),
    teacherId,
    targetRefs: Object.freeze(safeRefs(input.targetRefs)),
    state,
    exam: Object.freeze({
      questionCount: CLOSED_LOOP_CAPABILITY_EXAM_V1.length,
      questions: CLOSED_LOOP_CAPABILITY_EXAM_V1,
      passed: didPassExam,
      proofRefs: Object.freeze(examProofRefs),
    }),
    verification: Object.freeze({
      passed: didPassProof,
      proofRefs: Object.freeze(proofRefs),
    }),
    learningCandidate,
    retryDirective,
    telemetry: Object.freeze({
      capabilityId,
      lessonId,
      teacherId,
      state,
      examPassed: didPassExam,
      proofPassed: didPassProof,
      retained: Boolean(learningCandidate),
      retryReady: Boolean(retryDirective),
    }),
    authority: zeroAuthority(),
    finalVerdict: state === CLOSED_LOOP_LEARNING_STATES_V1.RETRY_READY
      ? 'CLOSED_LOOP_LEARNING_RETRY_READY'
      : genuineGap
        ? `CLOSED_LOOP_LEARNING_${state}`
        : 'CLOSED_LOOP_LEARNING_NOT_APPLICABLE',
  });
}
