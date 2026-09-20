import { createHash } from 'node:crypto';

import { buildEngineeringIncidentMethodRecordV1 } from './engineeringIncidentMethodMemoryV1.mjs';
import {
  STEPHANOS_PROCEDURAL_MEMORY_SCHEMA_VERSION,
  buildStephanosProceduralMemoryV1,
} from './stephanosProceduralMemoryV1.mjs';

export const STEPHANOS_REPAIR_LEARNING_CONTINUATION_SCHEMA_VERSION =
  'stephanos.repair-learning-continuation.v1';

const SAFE_GOAL_REF = /^#[1-9][0-9]{0,9}$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const PROCEDURAL_REF = /^(?:method|goal|issue|pr|component|agent|workspace|memory|evidence|receipt|proof|project|architecture|lesson|experiment):\/\/[a-z0-9][a-z0-9._:/#@-]{0,220}$/i;

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryMutationAllowed: false,
  methodPromotionAllowed: false,
  automationExecutionAllowed: false,
  schedulerMutationAllowed: false,
  goalCreationAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  authorityWideningAllowed: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hashId(prefix, value) {
  return `${prefix}-${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)}`;
}

function compactHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function ownerRef(record = {}) {
  for (const candidate of [
    record.issueNumber,
    record.issue,
    String(record.relatedIssue ?? '').replace(/^#/, ''),
    String(record.goalId ?? '').replace(/^goal-/, ''),
  ]) {
    const issue = Number(candidate);
    if (Number.isSafeInteger(issue) && issue > 0) return `#${issue}`;
  }
  return '';
}

function sourceHead(record = {}) {
  for (const candidate of [record.headSha, record.sourceHead]) {
    const normalized = text(candidate).toLowerCase();
    if (FULL_SHA.test(normalized)) return normalized;
  }
  return '';
}

function componentRef(capability) {
  const normalized = text(capability)
    .replace(/[^a-z0-9._:-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `component://${normalized || 'conversation-capability'}`;
}

function problemClass(rootCauseClass) {
  const normalized = text(rootCauseClass)
    .replace(/[^a-z0-9._:-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return normalized || 'capability-gap';
}

function proofRefs(input = {}) {
  return Object.freeze([
    ...new Set((Array.isArray(input.evidenceRefs) ? input.evidenceRefs : []).map(text).filter(Boolean)),
  ].slice(0, 48));
}

function proceduralRef(value) {
  const normalized = text(value).replaceAll('\\', '/');
  if (PROCEDURAL_REF.test(normalized) && !normalized.includes('..')) return normalized;
  const slash = normalized.indexOf('/');
  const prefix = slash > 0 ? normalized.slice(0, slash).toLowerCase() : '';
  const suffix = slash > 0 ? normalized.slice(slash + 1) : '';
  if (['proof', 'receipt', 'evidence', 'workspace', 'memory', 'lesson', 'experiment'].includes(prefix)) {
    const candidate = `${prefix}://${suffix}`;
    if (PROCEDURAL_REF.test(candidate) && !candidate.includes('..')) return candidate;
  }
  return `evidence://${compactHash(normalized || 'repair-proof')}`;
}

function proceduralMethodFromRepair({ gap, canonicalOwner, refs, verifiedAtUtc, reusableMethodRecord }) {
  const ownerNumber = canonicalOwner.replace(/^#/, '');
  const problem = problemClass(gap.rootCauseClass);
  const methodId = `repair-method:${compactHash([problem, canonicalOwner])}`;
  const recordId = `repair-method-record:${compactHash([reusableMethodRecord.recordId, verifiedAtUtc])}`;
  return Object.freeze({
    schemaVersion: STEPHANOS_PROCEDURAL_MEMORY_SCHEMA_VERSION,
    recordId,
    methodId,
    version: '1.0.0',
    problemClass: problem,
    methodSummary: reusableMethodRecord.repairOrMethod,
    validationState: 'VALIDATED',
    state: 'CURRENT',
    authorityClass: 'SHARED_AUTHORITY',
    confidence: 1,
    freshness: 'FRESH',
    validatedAtUtc: verifiedAtUtc,
    lastVerifiedAtUtc: verifiedAtUtc,
    supersedesRecordId: null,
    supersededByRecordId: null,
    prerequisiteRefs: Object.freeze([
      `goal://${ownerNumber}`,
      componentRef(gap.affectedCapability),
    ]),
    evidenceRefs: Object.freeze([...new Set(refs.map(proceduralRef))].slice(0, 24)),
    applicableDomains: Object.freeze(['stephanos-core']),
    failureModes: Object.freeze([
      'Canonical owner is bypassed and a duplicate repair lane is created.',
      'Repair is declared complete without attributable proof.',
      'The originating capability question is not replayed after repair.',
      'The proven lesson is not returned to procedural memory before closure.',
    ]),
    steps: Object.freeze([
      Object.freeze({
        stepId: 'preserve-owner',
        instructionSummary: 'Preserve the existing canonical owner and retain the exact gap evidence.',
        expectedEvidenceClass: 'owner-evidence',
      }),
      Object.freeze({
        stepId: 'route-bounded-repair',
        instructionSummary: 'Route the smallest governed repair through existing qualified construction machinery.',
        expectedEvidenceClass: 'repair-plan',
      }),
      Object.freeze({
        stepId: 'prove-repair',
        instructionSummary: 'Verify the repaired capability with attributable evidence under the same owner.',
        expectedEvidenceClass: 'repair-proof',
      }),
      Object.freeze({
        stepId: 'replay-origin',
        instructionSummary: 'Replay the originating capability question and require a grounded current answer.',
        expectedEvidenceClass: 'replay-proof',
      }),
      Object.freeze({
        stepId: 'feed-flywheel',
        instructionSummary: 'Publish the proof, lesson and reusable method before scheduler closure and rearm recurrence detection.',
        expectedEvidenceClass: 'flywheel-output',
      }),
    ]),
  });
}

function safeHold(status, blocker, gapId = '') {
  return Object.freeze({
    schemaVersion: STEPHANOS_REPAIR_LEARNING_CONTINUATION_SCHEMA_VERSION,
    status,
    blocker,
    gapId,
    incidentRecord: null,
    automationCandidateRecord: null,
    successfulRepairRecord: null,
    reusableMethodRecord: null,
    proceduralMethodRecord: null,
    proceduralMemoryProjection: null,
    proceduralMemoryProjectionId: null,
    recurrenceWatch: null,
    sharedLessonId: null,
    reusableCapabilityId: null,
    resultProofRefs: Object.freeze([]),
    authority: AUTHORITY,
  });
}

function recurrenceWatch(gap, canonicalOwner, state = 'WATCHING') {
  return Object.freeze({
    watchId: hashId('repair-watch', [gap.gapSignature || gap.gapId, canonicalOwner]),
    gapSignature: text(gap.gapSignature) || text(gap.gapId),
    canonicalOwner,
    occurrenceCount: Math.max(1, Number(gap.occurrenceCount || 1)),
    trigger: 'GAP_SIGNATURE_REAPPEARS',
    nextAction: 'REOPEN_EXISTING_OWNER_AND_ROUTE_GOVERNED_REPAIR',
    state,
  });
}

function baseRecordInput({ gap, canonicalOwner, refs, observedAtUtc, recordKey, recordClass, status }) {
  return {
    recordKey,
    recordClass,
    problemClass: problemClass(gap.rootCauseClass),
    componentAndOwnerRefs: [canonicalOwner, componentRef(gap.affectedCapability)],
    observedAtUtc,
    sourceHead: null,
    sourceBase: null,
    symptom: text(gap.summary) || `${gap.rootCauseClass} affected ${gap.affectedCapability}.`,
    rootCause: `${gap.rootCauseClass} was deterministically classified from the canonical capability-gap evidence.`,
    repairOrMethod: null,
    prerequisites: [],
    forbiddenShortcuts: [
      'Do not fabricate canonical ownership.',
      'Do not mark an attempted repair successful without attributable proof.',
      'Do not widen source, merge, deployment, runtime or account authority through a learning record.',
    ],
    failureModes: [
      'Repair proposal exists but is never executed.',
      'Repair executes but proof never feeds the flywheel.',
      'The same gap recurs without reopening its existing owner.',
    ],
    counterexamples: [],
    testAndProofRefs: refs,
    runtimeEvidenceRefs: [],
    confidenceBasis: 'Deterministic capability-gap classification with attributable evidence references.',
    freshness: 'CURRENT',
    supersedes: null,
    supersededBy: null,
    applicableDomains: ['stephanos-core'],
    privacyAndSensitivity: 'INTERNAL_BOUNDED',
    status,
    authority: null,
  };
}

export function buildStephanosRepairLearningIntakeV1(input = {}) {
  const gap = input.gapObservation;
  if (!gap?.gapId || !gap?.rootCauseClass || !gap?.affectedCapability) {
    return safeHold('SAFE_HOLD', 'gap-observation-incomplete');
  }
  const canonicalOwner = ownerRef(input.existingGoalRecord);
  if (!SAFE_GOAL_REF.test(canonicalOwner)) {
    return safeHold('CANONICAL_OWNER_REQUIRED', 'existing-scheduler-goal-required', gap.gapId);
  }
  const refs = proofRefs(input);
  if (!refs.length) return safeHold('SAFE_HOLD', 'gap-evidence-refs-required', gap.gapId);
  const observedAtUtc = text(gap.lastSeenAtUtc);
  if (!observedAtUtc) return safeHold('SAFE_HOLD', 'gap-observed-time-required', gap.gapId);

  const fingerprint = gap.gapSignature || gap.gapId;
  const incidentRecord = buildEngineeringIncidentMethodRecordV1(baseRecordInput({
    gap,
    canonicalOwner,
    refs,
    observedAtUtc,
    recordKey: hashId('gap-incident', [fingerprint, canonicalOwner]),
    recordClass: 'ENGINEERING_INCIDENT',
    status: 'CURRENT',
  }));

  const recurrenceCount = Math.max(1, Number(gap.occurrenceCount || 1));
  const automationDebt = recurrenceCount >= 2
    || ['QUESTION_ANSWER_TRANSPORT_MISSING', 'CROSS_PARTICIPANT_COHERENCE_GAP'].includes(gap.rootCauseClass);
  let automationCandidateRecord = null;
  if (automationDebt) {
    const automationInput = baseRecordInput({
      gap,
      canonicalOwner,
      refs,
      observedAtUtc,
      recordKey: hashId('repair-automation', [fingerprint, canonicalOwner]),
      recordClass: 'AUTOMATION_CANDIDATE',
      status: 'CANDIDATE',
    });
    automationInput.repairOrMethod = 'Detect recurrence of this proven gap signature, reopen the existing canonical owner, and route a bounded governed repair without requiring the operator to rediscover the failure.';
    automationInput.confidenceBasis = recurrenceCount >= 2
      ? `The same canonical gap signature has been observed ${recurrenceCount} times.`
      : 'The classified failure is itself an automation or cross-participant continuity gap.';
    automationCandidateRecord = buildEngineeringIncidentMethodRecordV1(automationInput);
  }

  return Object.freeze({
    schemaVersion: STEPHANOS_REPAIR_LEARNING_CONTINUATION_SCHEMA_VERSION,
    status: automationCandidateRecord ? 'INCIDENT_AND_AUTOMATION_LEARNING_READY' : 'INCIDENT_LEARNING_READY',
    blocker: '',
    gapId: gap.gapId,
    incidentRecord,
    automationCandidateRecord,
    successfulRepairRecord: null,
    reusableMethodRecord: null,
    proceduralMethodRecord: null,
    proceduralMemoryProjection: null,
    proceduralMemoryProjectionId: null,
    recurrenceWatch: recurrenceWatch(gap, canonicalOwner),
    sharedLessonId: null,
    reusableCapabilityId: null,
    resultProofRefs: refs,
    sourceHead: sourceHead(input.existingGoalRecord) || null,
    authority: AUTHORITY,
  });
}

export function buildStephanosRepairLearningCompletionV1(input = {}) {
  const gap = input.gapObservation;
  if (!gap?.gapId || !gap?.rootCauseClass || !gap?.affectedCapability) {
    return safeHold('SAFE_HOLD', 'gap-observation-incomplete');
  }
  const canonicalOwner = ownerRef(input.existingGoalRecord);
  if (!SAFE_GOAL_REF.test(canonicalOwner)) {
    return safeHold('CANONICAL_OWNER_REQUIRED', 'existing-scheduler-goal-required', gap.gapId);
  }
  const refs = proofRefs(input);
  if (!refs.length) return safeHold('PROOF_REQUIRED', 'repair-proof-refs-required', gap.gapId);
  const verifiedAtUtc = text(input.verifiedAtUtc);
  if (!verifiedAtUtc) return safeHold('PROOF_REQUIRED', 'repair-verification-time-required', gap.gapId);

  const fingerprint = gap.gapSignature || gap.gapId;
  const repairInput = baseRecordInput({
    gap,
    canonicalOwner,
    refs,
    observedAtUtc: verifiedAtUtc,
    recordKey: hashId('successful-repair', [fingerprint, canonicalOwner]),
    recordClass: 'SUCCESSFUL_REPAIR',
    status: 'CURRENT',
  });
  repairInput.repairOrMethod = 'Restore the affected capability under its existing canonical owner and prove the repair by replaying the originating capability question against current evidence.';
  repairInput.confidenceBasis = 'The originating capability question replayed successfully with attributable proof after the repair path completed.';
  const successfulRepairRecord = buildEngineeringIncidentMethodRecordV1(repairInput);

  const methodInput = baseRecordInput({
    gap,
    canonicalOwner,
    refs,
    observedAtUtc: verifiedAtUtc,
    recordKey: hashId('repair-method', [problemClass(gap.rootCauseClass), canonicalOwner]),
    recordClass: 'REUSABLE_METHOD',
    status: 'CURRENT',
  });
  methodInput.symptom = null;
  methodInput.rootCause = null;
  methodInput.repairOrMethod = 'For this problem class: preserve the canonical owner, retain exact gap evidence, route the smallest governed repair, independently prove it, replay the originating question, then write the proof and reusable method back before scheduler closure.';
  methodInput.confidenceBasis = 'A repair of this problem class completed with attributable replay proof and preserved canonical ownership.';
  const reusableMethodRecord = buildEngineeringIncidentMethodRecordV1(methodInput);

  const proceduralMethodRecord = proceduralMethodFromRepair({
    gap,
    canonicalOwner,
    refs,
    verifiedAtUtc,
    reusableMethodRecord,
  });
  const proceduralMemoryProjection = buildStephanosProceduralMemoryV1({ methods: [proceduralMethodRecord] });
  const projectedMethod = proceduralMemoryProjection.reusableMethods?.find(
    (method) => method.recordId === proceduralMethodRecord.recordId,
  );
  if (proceduralMemoryProjection.valid !== true || !projectedMethod) {
    return Object.freeze({
      ...safeHold(
        'PROCEDURAL_MEMORY_PROJECTION_REQUIRED',
        proceduralMemoryProjection.validationErrors?.[0] || 'proven-repair-method-not-projectable',
        gap.gapId,
      ),
      successfulRepairRecord,
      reusableMethodRecord,
      proceduralMethodRecord,
      proceduralMemoryProjection,
      proceduralMemoryProjectionId: proceduralMemoryProjection.projectionId || null,
      resultProofRefs: refs,
      sourceHead: sourceHead(input.existingGoalRecord) || null,
    });
  }

  return Object.freeze({
    schemaVersion: STEPHANOS_REPAIR_LEARNING_CONTINUATION_SCHEMA_VERSION,
    status: 'REPAIR_VERIFIED_AND_LEARNING_READY',
    blocker: '',
    gapId: gap.gapId,
    incidentRecord: null,
    automationCandidateRecord: null,
    successfulRepairRecord,
    reusableMethodRecord,
    proceduralMethodRecord,
    proceduralMemoryProjection,
    proceduralMemoryProjectionId: proceduralMemoryProjection.projectionId,
    recurrenceWatch: recurrenceWatch(gap, canonicalOwner, 'ARMED_AFTER_PROVEN_REPAIR'),
    sharedLessonId: successfulRepairRecord.recordId,
    reusableCapabilityId: proceduralMethodRecord.recordId,
    resultProofRefs: refs,
    sourceHead: sourceHead(input.existingGoalRecord) || null,
    authority: AUTHORITY,
  });
}
