import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createSharedWorkspaceGoalRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
  STEPHANOS_INITIAL_QUESTION_CLASSES,
} from '../shared/agents/stephanosConversationalCapabilityLadderV1.mjs';
import {
  createStephanosWorkspaceAnswerRecord,
  createStephanosWorkspaceQuestionRecord,
} from '../shared/agents/stephanosSharedWorkspaceConversationAdapterV1.mjs';
import { reconcileWorkspaceQaFlywheelV1 } from './chatgpt-shared-workspace-github-relay.mjs';

const CREATED_AT = '2026-09-19T18:00:00.000Z';
const ANSWERED_AT = '2026-09-19T18:01:00.000Z';
const NOW_MS = Date.parse(ANSWERED_AT);

function hash24(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function buildQuestionRecord(relatedIssue = '#1308') {
  const question = {
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId: 'round-flywheel-live-001',
    questionId: 'question-flywheel-live-001',
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questionText: 'Which project capability is missing from canonical state?',
    questionClass: STEPHANOS_INITIAL_QUESTION_CLASSES[0],
    intentFingerprint: 'intent-flywheel-live-001',
    noveltyRefs: [],
    contextRefs: ['goal-1308'],
    expectedEvidenceClass: 'CANONICAL_EVIDENCE',
    createdAtUtc: CREATED_AT,
  };
  const built = createStephanosWorkspaceQuestionRecord(question, {
    relatedIssue,
    proofRefs: ['proof/question-flywheel-live-001'],
    workspaceValidationOptions: { nowMs: Date.parse(CREATED_AT) },
  });
  assert.equal(built.valid, true, built.errors.join(', '));
  return built.record;
}

function buildAnswerRecord(relatedIssue = '#1308') {
  const answer = {
    schemaVersion: STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
    answerId: 'answer-flywheel-live-001',
    questionId: 'question-flywheel-live-001',
    roundId: 'round-flywheel-live-001',
    responderParticipantId: 'stephanos',
    answerText: 'The required capability evidence is not available through the current route.',
    epistemicState: 'UNKNOWN',
    evidenceRefs: [],
    freshness: 'UNKNOWN',
    sourcesConsulted: [],
    cannotAnswerReason: 'Required tool or data source is not connected.',
    answerVerdict: 'GAP_TOOL_OR_DATA_ACCESS',
    gapRefs: [],
    answeredAtUtc: ANSWERED_AT,
  };
  const built = createStephanosWorkspaceAnswerRecord(answer, {
    recipientParticipantId: 'chatgpt-bridge',
    relatedIssue,
    proofRefs: ['proof/answer-flywheel-live-001'],
    workspaceValidationOptions: { nowMs: NOW_MS },
  });
  assert.equal(built.valid, true, built.errors.join(', '));
  return built.record;
}

async function seedGoal(root, repoRoot, issueNumber, title) {
  const base = createSharedWorkspaceGoalRecord({
    goalId: `goal-${issueNumber}`,
    participantId: 'mission-scheduler',
    timestampUtc: CREATED_AT,
    title,
    status: 'READY',
  });
  const record = {
    ...base,
    issueNumber,
    repository: 'Cheekyfellastef/stephan-os',
    route: 'CHATGPT_GITHUB',
    prerequisites: [],
    priority: 50,
    criticalPathWeight: 50,
    reversibility: 'REVERSIBLE',
    approvalRequired: false,
    operatorPriority: false,
    proofState: 'KNOWN',
    evidenceAt: CREATED_AT,
    resultProofRefs: [],
  };
  const written = await writeAtomicJson(root, ['goals', `goal-${issueNumber}.json`], record, { repoRoot, nowMs: NOW_MS });
  assert.equal(written.ok, true, written.reason);
}

async function seedAnswer(root, repoRoot, questionRecord, answerRecord) {
  const name = `qa-answer-${hash24(questionRecord.messageId)}.json`;
  const written = await writeAtomicJson(root, ['outbox', name], answerRecord, { repoRoot, nowMs: NOW_MS });
  assert.equal(written.ok, true, written.reason);
}

test('durable Q&A miss attaches to the existing related scheduler goal', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-flywheel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repoRoot = process.cwd();
  const questionRecord = buildQuestionRecord('#1308');
  const answerRecord = buildAnswerRecord('#1308');
  await seedGoal(root, repoRoot, 1308, 'Goal: Project Intelligence and Conversational Understanding V1');
  await seedAnswer(root, repoRoot, questionRecord, answerRecord);

  const result = await reconcileWorkspaceQaFlywheelV1({
    questionRecord,
    root,
    repoRoot,
    nowMs: NOW_MS,
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'GAP_ATTACHED_TO_EXISTING_SCHEDULER_GOAL');
  assert.equal(result.ownerSource, 'QUESTION_RELATED_GOAL');
  const goal = JSON.parse(await fs.readFile(path.join(root, 'goals', 'goal-1308.json'), 'utf8'));
  assert.equal(goal.title, 'Goal: Project Intelligence and Conversational Understanding V1');
  assert.equal(goal.route, 'CHATGPT_GITHUB');
  assert.equal(goal.flywheelGapRefs.length, 1);
  assert.equal(goal.flywheelQuestionRefs.length, 1);
  assert.equal(goal.approvalRequired, false);
});

test('missing related goal falls back to #1721 canonical gap-intake owner instead of inventing a goal', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-flywheel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repoRoot = process.cwd();
  const questionRecord = buildQuestionRecord('#1308');
  const answerRecord = buildAnswerRecord('#1308');
  await seedGoal(root, repoRoot, 1721, 'Goal: Ambient Question-to-Goal Capability Gap Intake V1');
  await seedAnswer(root, repoRoot, questionRecord, answerRecord);

  const result = await reconcileWorkspaceQaFlywheelV1({ questionRecord, root, repoRoot, nowMs: NOW_MS });
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'GAP_ATTACHED_TO_EXISTING_SCHEDULER_GOAL');
  assert.equal(result.ownerSource, 'AMBIENT_GAP_UMBRELLA');
  assert.equal(result.continuation.evaluation.canonicalGoalRef, '#1721');
  await assert.rejects(fs.readFile(path.join(root, 'goals', 'goal-1308.json'), 'utf8'), { code: 'ENOENT' });
  const umbrella = JSON.parse(await fs.readFile(path.join(root, 'goals', 'goal-1721.json'), 'utf8'));
  assert.equal(umbrella.title, 'Goal: Ambient Question-to-Goal Capability Gap Intake V1');
  assert.equal(umbrella.flywheelGapRefs.length, 1);
});
