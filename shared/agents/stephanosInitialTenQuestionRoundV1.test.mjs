import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
  STEPHANOS_INITIAL_QUESTION_CLASSES,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import { createStephanosWorkspaceAnswerRecord } from './stephanosSharedWorkspaceConversationAdapterV1.mjs';
import {
  buildInitialStephanosTenQuestionPacketV1,
  createInitialStephanosTenQuestionRoundV1,
  evaluateInitialStephanosTenQuestionRoundV1,
  initialStephanosQuestionClassesV1,
} from './stephanosInitialTenQuestionRoundV1.mjs';

const CREATED = '2026-08-14T11:30:00.000Z';
const ANSWERED = '2026-08-14T11:31:00.000Z';
const QUESTION_PROOFS = Object.freeze(['evidence/receipts/programme-truth-001']);
const WORKSPACE_VALIDATION_OPTIONS = Object.freeze({ nowMs: Date.parse(ANSWERED) });

function groundedAnswer(question, overrides = {}) {
  return {
    schemaVersion:STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
    answerId:`answer-${question.questionId}`,
    questionId:question.questionId,
    roundId:question.roundId,
    responderParticipantId:'stephanos',
    answerText:`Grounded answer for ${question.questionClass}.`,
    epistemicState:'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs:[`evidence/receipts/${question.questionId}`],
    freshness:'FRESH',
    sourcesConsulted:['github-canonical-state','shared-workspace'],
    cannotAnswerReason:null,
    answerVerdict:'ANSWERED_GROUNDED',
    gapRefs:[],
    answeredAtUtc:ANSWERED,
    ...overrides,
  };
}

function issuedRound() {
  const packet = buildInitialStephanosTenQuestionPacketV1({
    createdAtUtc:CREATED,
    proofRefs:QUESTION_PROOFS,
    workspaceValidationOptions:WORKSPACE_VALIDATION_OPTIONS,
  });
  assert.equal(packet.valid, true, packet.errors.join(','));
  return packet;
}

function answerRecords(round, issuedPacketRef, overrideAt = -1, override = {}) {
  return round.questions.map((question, index) => {
    const answer = groundedAnswer(question, index === overrideAt ? override : {});
    const built = createStephanosWorkspaceAnswerRecord(answer, {
      recipientParticipantId:'chatgpt-bridge',
      relatedIssue:'#1308',
      relatedPr:'#1777',
      proofRefs:[issuedPacketRef, ...(answer.evidenceRefs || [])],
      workspaceValidationOptions:WORKSPACE_VALIDATION_OPTIONS,
    });
    assert.equal(built.valid, true, built.errors.join(','));
    return built.record;
  });
}

test('initial proving round contains exactly the ten canonical capability classes', () => {
  const built = createInitialStephanosTenQuestionRoundV1({ createdAtUtc:CREATED });
  assert.equal(built.valid, true);
  assert.equal(built.round.questions.length, 10);
  assert.deepEqual(built.round.questions.map((question) => question.questionClass), STEPHANOS_INITIAL_QUESTION_CLASSES);
  assert.deepEqual(initialStephanosQuestionClassesV1(), STEPHANOS_INITIAL_QUESTION_CLASSES);
  assert.equal(new Set(built.round.questions.map((question) => question.intentFingerprint)).size, 10);
});

test('questions are materially different probes and the cross-domain question does not seed a target conclusion', () => {
  const { round } = createInitialStephanosTenQuestionRoundV1({ createdAtUtc:CREATED });
  const texts = round.questions.map((question) => question.questionText.toLowerCase());
  assert.equal(new Set(texts).size, 10);
  assert.ok(texts.some((text) => text.includes('memory') || text.includes('restarts')));
  assert.ok(texts.some((text) => text.includes('openclaw')));
  const crossDomain = round.questions.find((question) => question.questionClass === 'CROSS_DOMAIN_CONNECTION');
  assert.match(crossDomain.questionText, /what connections, if any, can you prove/i);
  assert.doesNotMatch(crossDomain.questionText, /compound each other toward/i);
  assert.ok(texts.some((text) => text.includes('do not know') || text.includes('not prove')));
});

test('canonical first-round identities cannot be overridden', () => {
  assert.throws(() => createInitialStephanosTenQuestionRoundV1({ createdAtUtc:CREATED, roundId:'other-round' }), /roundId must remain/);
  assert.throws(() => createInitialStephanosTenQuestionRoundV1({ createdAtUtc:CREATED, askerParticipantId:'openclaw' }), /askerParticipantId must remain/);
  assert.throws(() => createInitialStephanosTenQuestionRoundV1({ createdAtUtc:CREATED, targetParticipantId:'other-agent' }), /targetParticipantId must remain/);
});

test('first proving packet requires caller proof and fans out ten existing Shared Workspace records with an issued-packet binding', () => {
  const missingProof = buildInitialStephanosTenQuestionPacketV1({
    createdAtUtc:CREATED,
    workspaceValidationOptions:WORKSPACE_VALIDATION_OPTIONS,
  });
  assert.equal(missingProof.valid, false);
  assert.ok(missingProof.errors.includes('proofRefs-required-from-caller'));

  const packet = issuedRound();
  assert.match(packet.issuedPacketRef, /^evidence\/receipts\/stephanos-round-001-/);
  assert.equal(packet.records.length, 10);
  for (const record of packet.records) {
    assert.equal(record.participantId, 'chatgpt-bridge');
    assert.equal(record.recipientParticipantId, 'stephanos');
    assert.equal(record.channel, 'shared-participant-qa');
    assert.equal(record.proofRefs.includes(packet.issuedPacketRef), true);
    assert.equal(record.proofRefs.includes(QUESTION_PROOFS[0]), true);
    assert.equal(record.sourceMutationAllowed, false);
    assert.equal(record.commandExecutionAllowed, false);
    assert.equal(record.approvalAllowed, false);
    assert.equal(record.mergeAllowed, false);
    assert.equal(record.deploymentAllowed, false);
    const body = JSON.parse(record.body);
    assert.equal(body.subtype, 'conversation-question');
    assert.equal(Object.hasOwn(body.payload, 'answerText'), false);
  }
  assert.equal(packet.completionClaimAllowed, false);
  assert.equal(packet.liveConversationClaimAllowed, false);
});

test('ten structurally grounded answers remain on safe hold until independent canonical evidence is resolved', () => {
  const packet = issuedRound();
  const evaluation = evaluateInitialStephanosTenQuestionRoundV1({
    createdAtUtc:CREATED,
    answerRecords:answerRecords(packet.round, packet.issuedPacketRef),
    workspaceValidationOptions:WORKSPACE_VALIDATION_OPTIONS,
  });
  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.state, 'SAFE_HOLD');
  assert.equal(evaluation.refusalReason, 'independent-evidence-resolution-required');
  assert.equal(evaluation.independentEvidenceResolutionRequired, true);
  assert.equal(evaluation.evaluation.counts.grounded, 10);
  assert.equal(evaluation.evaluation.mayAdvanceToNovelRound, false);
});

test('answer evidence references must be bound into the Shared Workspace record proof set', () => {
  const packet = issuedRound();
  const records = answerRecords(packet.round, packet.issuedPacketRef);
  const tampered = records.map((record, index) => index === 0
    ? Object.freeze({ ...record, proofRefs:Object.freeze([packet.issuedPacketRef]) })
    : record);
  const evaluation = evaluateInitialStephanosTenQuestionRoundV1({
    createdAtUtc:CREATED,
    answerRecords:tampered,
    workspaceValidationOptions:WORKSPACE_VALIDATION_OPTIONS,
  });
  assert.equal(evaluation.valid, false);
  assert.equal(evaluation.state, 'SAFE_HOLD');
  assert.ok(evaluation.errors.some((error) => error.includes('evidence-ref-not-bound-to-record')));
});

test('answer records from an older issued round cannot be replayed against a newly timestamped packet', () => {
  const packet = issuedRound();
  const records = answerRecords(packet.round, packet.issuedPacketRef);
  const evaluation = evaluateInitialStephanosTenQuestionRoundV1({
    createdAtUtc:'2026-08-14T11:30:30.000Z',
    answerRecords:records,
    workspaceValidationOptions:WORKSPACE_VALIDATION_OPTIONS,
  });
  assert.equal(evaluation.valid, false);
  assert.equal(evaluation.state, 'SAFE_HOLD');
  assert.ok(evaluation.errors.some((error) => error.includes('issued-packet-proof-mismatch')));
});

test('answers predating the issued round fail closed even when IDs and proof references otherwise match', () => {
  const packet = issuedRound();
  const records = answerRecords(packet.round, packet.issuedPacketRef, 0, { answeredAtUtc:'2026-08-14T11:29:59.000Z' });
  const evaluation = evaluateInitialStephanosTenQuestionRoundV1({
    createdAtUtc:CREATED,
    answerRecords:records,
    workspaceValidationOptions:WORKSPACE_VALIDATION_OPTIONS,
  });
  assert.equal(evaluation.valid, false);
  assert.equal(evaluation.state, 'SAFE_HOLD');
  assert.ok(evaluation.errors.includes('answer-record-1:answer-predates-issued-round'));
});

test('one truthful retrieval miss becomes a buildable gap instead of being hidden by fluent text', () => {
  const packet = issuedRound();
  const evaluation = evaluateInitialStephanosTenQuestionRoundV1({
    createdAtUtc:CREATED,
    answerRecords:answerRecords(packet.round, packet.issuedPacketRef, 6, {
      answerText:'I cannot prove the latest material changes from current retrievable evidence.',
      epistemicState:'UNKNOWN',
      evidenceRefs:[],
      freshness:'UNKNOWN',
      sourcesConsulted:['shared-workspace'],
      cannotAnswerReason:'Current recent-change evidence is not retrievable through this response path.',
      answerVerdict:'GAP_RETRIEVAL',
      gapRefs:[],
    }),
    workspaceValidationOptions:WORKSPACE_VALIDATION_OPTIONS,
  });
  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.state, 'GAPS_IDENTIFIED');
  assert.equal(evaluation.evaluation.counts.buildableGaps, 1);
  assert.equal(evaluation.evaluation.requiresRepairReplay, true);
  assert.equal(evaluation.evaluation.mayAdvanceToNovelRound, false);
  assert.ok(evaluation.evaluation.gapObservations[0].existingGoalCandidates.includes('#1308'));
});

test('a partial answer holds the ladder for repair/replay even when no explicit gap verdict is returned', () => {
  const packet = issuedRound();
  const evaluation = evaluateInitialStephanosTenQuestionRoundV1({
    createdAtUtc:CREATED,
    answerRecords:answerRecords(packet.round, packet.issuedPacketRef, 7, {
      answerText:'I can identify candidate next work but cannot yet prove the priority ordering.',
      epistemicState:'INFERRED_FROM_EVIDENCE',
      evidenceRefs:['evidence/receipts/partial-next-action'],
      freshness:'RECENT',
      sourcesConsulted:['github-canonical-state'],
      cannotAnswerReason:null,
      answerVerdict:'ANSWERED_PARTIAL',
      gapRefs:[],
    }),
    workspaceValidationOptions:WORKSPACE_VALIDATION_OPTIONS,
  });
  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.state, 'REGRESSION_PROVING');
  assert.equal(evaluation.evaluation.counts.partial, 1);
  assert.equal(evaluation.evaluation.requiresRepairReplay, true);
});

test('wrong or missing answer record count fails closed', () => {
  const evaluation = evaluateInitialStephanosTenQuestionRoundV1({
    createdAtUtc:CREATED,
    answerRecords:[],
    workspaceValidationOptions:WORKSPACE_VALIDATION_OPTIONS,
  });
  assert.equal(evaluation.valid, false);
  assert.equal(evaluation.state, 'SAFE_HOLD');
  assert.ok(evaluation.errors.includes('answer-records-must-contain-exactly-10'));
});

test('non-exact time input cannot create a proving round', () => {
  assert.throws(() => createInitialStephanosTenQuestionRoundV1({ createdAtUtc:'now' }), /exact ISO timestamp/);
});
