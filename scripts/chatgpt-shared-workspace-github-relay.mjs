#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  createSharedWorkspaceGoalRecord,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { answerStephanosWorkspaceQuestionRecord } from '../shared/agents/stephanosSharedParticipantLiveQaResponseProjectionV1.mjs';
import { buildSharedWorkspaceQaAnswerDiagnosticV1 } from '../shared/agents/sharedWorkspaceQaAnswerDiagnosticV1.mjs';
import { buildStephanosQaFlywheelContinuationV1 } from '../shared/agents/stephanosQaFlywheelContinuationV1.mjs';
import {
  CHATGPT_SHARED_WORKSPACE_GITHUB_RELAY_SCHEMA,
  CHATGPT_SHARED_WORKSPACE_ISSUE,
  CHATGPT_SHARED_WORKSPACE_OWNER,
  CHATGPT_SHARED_WORKSPACE_REPOSITORY,
  CHATGPT_SHARED_WORKSPACE_REQUEST_COMMENT_ID,
  CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER,
  CHATGPT_SHARED_WORKSPACE_RESPONSE_COMMENT_ID,
  CHATGPT_SHARED_WORKSPACE_RESPONSE_MARKER,
  createFixedChatGptSharedWorkspaceGitHubAdapter,
  parseChatGptSharedWorkspaceRequestComment,
  renderChatGptSharedWorkspaceResponse,
  resolveChatGptSharedWorkspaceRelayPaths,
  runChatGptSharedWorkspaceGitHubRelay as runCoreRelay,
  validateChatGptSharedWorkspaceResponseBody,
} from './chatgpt-shared-workspace-github-relay-core.mjs';

export {
  CHATGPT_SHARED_WORKSPACE_GITHUB_RELAY_SCHEMA,
  CHATGPT_SHARED_WORKSPACE_ISSUE,
  CHATGPT_SHARED_WORKSPACE_OWNER,
  CHATGPT_SHARED_WORKSPACE_REPOSITORY,
  CHATGPT_SHARED_WORKSPACE_REQUEST_COMMENT_ID,
  CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER,
  CHATGPT_SHARED_WORKSPACE_RESPONSE_COMMENT_ID,
  CHATGPT_SHARED_WORKSPACE_RESPONSE_MARKER,
  createFixedChatGptSharedWorkspaceGitHubAdapter,
  parseChatGptSharedWorkspaceRequestComment,
  renderChatGptSharedWorkspaceResponse,
  resolveChatGptSharedWorkspaceRelayPaths,
  validateChatGptSharedWorkspaceResponseBody,
};

export const CHATGPT_GOAL_INTENT_RECORD_KIND = 'goal-intent-proposal';
export const CHATGPT_GOAL_ADMISSION_ROUTE = 'CHATGPT_GITHUB';
export const CHATGPT_GOAL_ADMISSION_STATUS = 'READY';
export const CHATGPT_GOAL_ADMISSION_MAX_PREREQUISITES = 32;

const SAFE_REPOSITORY = 'Cheekyfellastef/stephan-os';
const SAFE_TITLE_MAX = 240;
const REVERSIBILITY = new Set(['UNKNOWN', 'REVERSIBLE', 'PARTIAL', 'IRREVERSIBLE']);
const TERMINAL_GOAL_STATES = new Set(['COMPLETE', 'CLOSED', 'CANCELLED', 'SUPERSEDED']);
const GOAL_PAYLOAD_KEYS = new Set([
  'criticalPathWeight',
  'issueNumber',
  'operatorPriority',
  'prerequisites',
  'priority',
  'repository',
  'reversibility',
  'summary',
  'title',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value) {
  const normalized = typeof value === 'number' ? String(value) : text(value).replace(/^#/, '');
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function boundedNumber(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback;
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseGoalProposalBody(record = {}) {
  if (
    record.kind !== SHARED_WORKSPACE_RECORD_KINDS.MESSAGE
    || text(record.participantId) !== 'chatgpt-bridge'
    || text(record.channel) !== 'chatgpt-participant-bridge'
  ) return Object.freeze({ applicable: false, ok: true, reason: 'NOT_CHATGPT_GOAL_INTENT' });

  let parsed;
  try {
    parsed = JSON.parse(String(record.body ?? ''));
  } catch {
    return Object.freeze({ applicable: false, ok: true, reason: 'NOT_CHATGPT_GOAL_INTENT' });
  }
  if (parsed?.recordKind !== CHATGPT_GOAL_INTENT_RECORD_KIND) {
    return Object.freeze({ applicable: false, ok: true, reason: 'NOT_CHATGPT_GOAL_INTENT' });
  }
  if (!plainObject(parsed.boundedPayload)) {
    return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_PAYLOAD_INVALID' });
  }
  const payload = parsed.boundedPayload;
  if (Object.keys(payload).some((key) => !GOAL_PAYLOAD_KEYS.has(key))) {
    return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_PAYLOAD_NOT_CLOSED_WORLD' });
  }
  return Object.freeze({ applicable: true, ok: true, reason: 'CHATGPT_GOAL_INTENT_READY', payload });
}

function normalizePrerequisites(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > CHATGPT_GOAL_ADMISSION_MAX_PREREQUISITES) return null;
  const normalized = value.map(positiveInteger);
  if (normalized.some((item) => item === null) || normalized.length !== new Set(normalized).size) return null;
  return normalized;
}

export function buildChatGptSchedulerGoalRecord(messageRecord = {}, options = {}) {
  const parsed = parseGoalProposalBody(messageRecord);
  if (!parsed.applicable) return Object.freeze({ applicable: false, ok: true, reason: parsed.reason, record: null });
  if (!parsed.ok) return Object.freeze({ applicable: true, ok: false, reason: parsed.reason, record: null });

  const payload = parsed.payload;
  const issueNumber = positiveInteger(payload.issueNumber);
  const relatedIssue = positiveInteger(messageRecord.relatedIssue);
  if (!issueNumber || !relatedIssue || issueNumber !== relatedIssue) {
    return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_ISSUE_IDENTITY_MISMATCH', record: null });
  }

  const repository = text(payload.repository) || SAFE_REPOSITORY;
  if (repository.toLowerCase() !== SAFE_REPOSITORY.toLowerCase()) {
    return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_REPOSITORY_NOT_CANONICAL', record: null });
  }

  const title = text(payload.title || payload.summary);
  if (!title || title.length > SAFE_TITLE_MAX) {
    return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_TITLE_INVALID', record: null });
  }

  const prerequisites = normalizePrerequisites(payload.prerequisites);
  if (!prerequisites || prerequisites.includes(issueNumber)) {
    return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_PREREQUISITES_INVALID', record: null });
  }

  const reversibility = text(payload.reversibility || 'UNKNOWN').toUpperCase();
  if (!REVERSIBILITY.has(reversibility)) {
    return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_REVERSIBILITY_INVALID', record: null });
  }
  if (payload.operatorPriority !== undefined && typeof payload.operatorPriority !== 'boolean') {
    return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_OPERATOR_PRIORITY_INVALID', record: null });
  }
  if (payload.priority !== undefined && boundedNumber(payload.priority, null) === null) {
    return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_PRIORITY_INVALID', record: null });
  }
  if (payload.criticalPathWeight !== undefined && boundedNumber(payload.criticalPathWeight, null) === null) {
    return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_CRITICAL_PATH_WEIGHT_INVALID', record: null });
  }

  const timestampUtc = text(messageRecord.timestampUtc);
  const goalId = `goal-${issueNumber}`;
  const record = Object.freeze({
    ...createSharedWorkspaceGoalRecord({
      goalId,
      participantId: 'chatgpt-bridge',
      timestampUtc,
      title,
      status: CHATGPT_GOAL_ADMISSION_STATUS,
    }),
    issueNumber,
    repository: SAFE_REPOSITORY,
    route: CHATGPT_GOAL_ADMISSION_ROUTE,
    prerequisites: Object.freeze([...prerequisites]),
    priority: boundedNumber(payload.priority),
    criticalPathWeight: boundedNumber(payload.criticalPathWeight),
    reversibility,
    approvalRequired: false,
    operatorPriority: payload.operatorPriority === true,
    proofState: 'PROPOSAL_ADMITTED',
    evidenceAt: timestampUtc,
    resultProofRefs: Object.freeze([]),
    admissionSource: CHATGPT_GOAL_INTENT_RECORD_KIND,
    correlationId: text(messageRecord.correlationId),
  });
  const validation = validateSharedWorkspaceRecord(record, {
    nowMs: Number.isFinite(options.nowMs) ? options.nowMs : Date.now(),
  });
  if (!validation.valid) {
    return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_WORKSPACE_RECORD_INVALID', record: null, validation });
  }
  return Object.freeze({ applicable: true, ok: true, reason: 'CHATGPT_GOAL_RECORD_READY', record, validation });
}

function sameJson(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export async function promoteChatGptGoalIntent({
  root,
  segments,
  record,
  writeOptions = {},
  writeAtomicJsonFn = writeAtomicJson,
  readFileFn = readFile,
  nowMs = Date.now(),
} = {}) {
  if (!Array.isArray(segments) || segments[0] !== 'inbox') {
    return Object.freeze({ applicable: false, ok: true, reason: 'GOAL_PROMOTION_NOT_INBOX_WRITE', record: null });
  }
  const built = buildChatGptSchedulerGoalRecord(record, { nowMs });
  if (!built.applicable || !built.ok) return built;

  const goalRecord = built.record;
  const goalSegments = ['goals', `${goalRecord.goalId}.json`];
  const resolved = resolveSharedWorkspacePath({
    root,
    repoRoot: writeOptions.repoRoot,
    segments: goalSegments,
  });
  if (!resolved.ok) {
    return Object.freeze({ applicable: true, ok: false, reason: resolved.reason, record: goalRecord });
  }

  try {
    const existing = JSON.parse(await readFileFn(resolved.path, 'utf8'));
    if (sameJson(existing, goalRecord)) {
      return Object.freeze({ applicable: true, ok: true, reason: 'CHATGPT_GOAL_ALREADY_ADMITTED', record: goalRecord });
    }
    return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_CONFLICT', record: goalRecord });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return Object.freeze({ applicable: true, ok: false, reason: 'CHATGPT_GOAL_EXISTING_RECORD_READ_FAILED', record: goalRecord });
    }
  }

  const write = await writeAtomicJsonFn(root, goalSegments, goalRecord, writeOptions);
  if (write?.ok !== true) {
    return Object.freeze({ applicable: true, ok: false, reason: text(write?.reason) || 'CHATGPT_GOAL_WRITE_FAILED', record: goalRecord });
  }
  return Object.freeze({
    applicable: true,
    ok: true,
    reason: 'CHATGPT_GOAL_ADMITTED',
    record: goalRecord,
    goalId: goalRecord.goalId,
    issueNumber: goalRecord.issueNumber,
  });
}

function qaAnswerLineageMatches(questionRecord = {}, answerRecord = {}) {
  return text(answerRecord.participantId).toLowerCase() === 'stephanos'
    && text(answerRecord.recipientParticipantId) === 'chatgpt-bridge'
    && text(answerRecord.correlationId) === text(questionRecord.correlationId)
    && text(answerRecord.relatedIssue) === text(questionRecord.relatedIssue)
    && text(answerRecord.relatedPr) === text(questionRecord.relatedPr)
    && text(answerRecord.subjectId) === text(questionRecord.subjectId)
    && text(answerRecord.channel) === 'shared-participant-qa'
    && text(answerRecord.recordSubtype) === 'conversation-answer';
}

function rejectionDiagnostic(answered, questionRecord) {
  if (!answered?.ok) {
    return buildSharedWorkspaceQaAnswerDiagnosticV1(answered)
      || buildSharedWorkspaceQaAnswerDiagnosticV1({
        classification: 'WORKSPACE_QA_COGNITION_REJECTED_UNCLASSIFIED',
        errors: ['cognition-result-not-ok'],
      });
  }
  if (!answered.answerRecord) {
    return buildSharedWorkspaceQaAnswerDiagnosticV1({
      classification: 'WORKSPACE_QA_COGNITION_ANSWER_RECORD_MISSING',
      errors: ['answer-record-missing-after-cognition'],
    });
  }
  if (!qaAnswerLineageMatches(questionRecord, answered.answerRecord)) {
    return buildSharedWorkspaceQaAnswerDiagnosticV1({
      classification: 'WORKSPACE_QA_COGNITION_ANSWER_LINEAGE_REJECTED',
      errors: ['answer-record-lineage-mismatch'],
    });
  }
  return null;
}

function renderResponseWithDiagnostic(body, diagnostic) {
  if (!diagnostic) return body;
  const match = String(body ?? '').match(/```json\s*([\s\S]*?)\s*```/i);
  if (!match) return body;
  try {
    const payload = JSON.parse(match[1]);
    return renderChatGptSharedWorkspaceResponse({ ...payload, qaAnswerDiagnostic: diagnostic });
  } catch {
    return body;
  }
}

function hash24(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 24);
}

async function readWorkspaceJson({ root, repoRoot, segments, readFileFn }) {
  const resolved = resolveSharedWorkspacePath({ root, repoRoot, segments });
  if (!resolved.ok) return Object.freeze({ ok: false, reason: resolved.reason, record: null });
  try {
    return Object.freeze({ ok: true, reason: 'WORKSPACE_RECORD_READ', record: JSON.parse(await readFileFn(resolved.path, 'utf8')) });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error?.code === 'ENOENT' ? 'WORKSPACE_RECORD_NOT_FOUND' : 'WORKSPACE_RECORD_READ_FAILED',
      record: null,
    });
  }
}

function usableGoalRecord(record, expectedIssue) {
  if (!record || record.kind !== SHARED_WORKSPACE_RECORD_KINDS.GOAL) return false;
  const issue = positiveInteger(record.issueNumber ?? record.issue ?? record.relatedIssue ?? record.goalId?.replace(/^goal-/, ''));
  if (!issue || issue !== expectedIssue) return false;
  return !TERMINAL_GOAL_STATES.has(text(record.state ?? record.status).toUpperCase());
}

async function readGoalRecord({ root, repoRoot, issueNumber, readFileFn }) {
  if (!issueNumber) return null;
  const result = await readWorkspaceJson({
    root,
    repoRoot,
    segments: ['goals', `goal-${issueNumber}.json`],
    readFileFn,
  });
  return result.ok && usableGoalRecord(result.record, issueNumber) ? result.record : null;
}

function priorGapFromHandoff(record, expectedSignature) {
  if (!record || record.kind !== SHARED_WORKSPACE_RECORD_KINDS.HANDOFF) return null;
  try {
    const body = JSON.parse(String(record.body || ''));
    const gap = body?.gapObservation;
    return gap?.gapSignature === expectedSignature ? gap : null;
  } catch {
    return null;
  }
}

export async function reconcileWorkspaceQaFlywheelV1({
  questionRecord,
  root,
  repoRoot,
  nowMs,
  readFileFn = readFile,
  writeAtomicJsonFn = writeAtomicJson,
} = {}) {
  if (!questionRecord) return Object.freeze({ ok: true, classification: 'NO_QA_FLYWHEEL_INPUT' });
  const answerSegments = ['outbox', `qa-answer-${hash24(text(questionRecord.messageId))}.json`];
  const answerRead = await readWorkspaceJson({ root, repoRoot, segments: answerSegments, readFileFn });
  if (!answerRead.ok) return Object.freeze({ ok: false, classification: 'QA_ANSWER_NOT_DURABLE', reason: answerRead.reason });

  const relatedIssue = positiveInteger(questionRecord.relatedIssue);
  let existingGoalRecord = await readGoalRecord({ root, repoRoot, issueNumber: relatedIssue, readFileFn });
  let ownerSource = existingGoalRecord ? 'QUESTION_RELATED_GOAL' : '';
  if (!existingGoalRecord && relatedIssue !== 1721) {
    existingGoalRecord = await readGoalRecord({ root, repoRoot, issueNumber: 1721, readFileFn });
    if (existingGoalRecord) ownerSource = 'AMBIENT_GAP_UMBRELLA';
  }

  let continuation = buildStephanosQaFlywheelContinuationV1({
    questionRecord,
    answerRecord: answerRead.record,
    existingGoalRecord,
    nowMs,
  });
  if (!continuation.ok) return Object.freeze({ ok: false, classification: continuation.classification, continuation });
  if (!continuation.handoffRecord) {
    return Object.freeze({ ok: true, classification: continuation.classification, continuation, ownerSource });
  }

  const handoffSegments = ['outbox', `${continuation.handoffRecord.handoffId}.json`];
  const priorRead = await readWorkspaceJson({ root, repoRoot, segments: handoffSegments, readFileFn });
  if (priorRead.ok) {
    const priorGap = priorGapFromHandoff(priorRead.record, continuation.gapObservation.gapSignature);
    if (!priorGap) {
      return Object.freeze({ ok: false, classification: 'QA_GAP_HANDOFF_CONFLICT', continuation, ownerSource });
    }
    continuation = buildStephanosQaFlywheelContinuationV1({
      questionRecord,
      answerRecord: answerRead.record,
      existingGoalRecord,
      existingGapObservation: priorGap,
      nowMs,
    });
    if (!continuation.ok) return Object.freeze({ ok: false, classification: continuation.classification, continuation, ownerSource });
  } else if (priorRead.reason !== 'WORKSPACE_RECORD_NOT_FOUND') {
    return Object.freeze({ ok: false, classification: 'QA_GAP_HANDOFF_READ_FAILED', reason: priorRead.reason, continuation, ownerSource });
  }

  const handoffWrite = await writeAtomicJsonFn(root, handoffSegments, continuation.handoffRecord, { repoRoot, nowMs });
  if (handoffWrite?.ok !== true) {
    return Object.freeze({ ok: false, classification: 'QA_GAP_HANDOFF_WRITE_FAILED', reason: handoffWrite?.reason, continuation, ownerSource });
  }

  let goalWrite = Object.freeze({ ok: true, reason: 'NO_EXISTING_GOAL_UPDATE_REQUIRED' });
  if (continuation.goalRecordUpdate) {
    const issueNumber = positiveInteger(continuation.goalRecordUpdate.issueNumber ?? continuation.goalRecordUpdate.issue ?? continuation.goalRecordUpdate.relatedIssue);
    if (!issueNumber) return Object.freeze({ ok: false, classification: 'QA_GAP_GOAL_IDENTITY_INVALID', continuation, ownerSource });
    goalWrite = await writeAtomicJsonFn(root, ['goals', `goal-${issueNumber}.json`], continuation.goalRecordUpdate, { repoRoot, nowMs });
    if (goalWrite?.ok !== true) {
      return Object.freeze({ ok: false, classification: 'QA_GAP_GOAL_UPDATE_FAILED', reason: goalWrite?.reason, continuation, ownerSource });
    }
  }

  return Object.freeze({
    ok: true,
    classification: continuation.classification,
    continuation,
    ownerSource,
    handoffWrite,
    goalWrite,
  });
}

export async function runChatGptSharedWorkspaceGitHubRelay(options = {}) {
  let qaAnswerDiagnostic = null;
  let goalAdmission = null;
  let qaQuestionRecord = null;
  let qaFlywheelContinuation = null;
  let qaFlywheelAttempted = false;
  const answerQuestionFn = typeof options.answerQuestionFn === 'function'
    ? options.answerQuestionFn
    : answerStephanosWorkspaceQuestionRecord;
  const writeAtomicJsonFn = typeof options.writeAtomicJsonFn === 'function'
    ? options.writeAtomicJsonFn
    : writeAtomicJson;
  const readFileFn = typeof options.readFileFn === 'function' ? options.readFileFn : readFile;
  const adapter = options.adapter || createFixedChatGptSharedWorkspaceGitHubAdapter();

  const result = await runCoreRelay({
    ...options,
    reconcileInboxFn: async ({ root, segments, record, resumed, writeOptions }) => {
      if (!parseGoalProposalBody(record).applicable) return { ok: true };
      let persisted = record;
      if (resumed) {
        const resolved = resolveSharedWorkspacePath({ root, repoRoot: writeOptions.repoRoot, segments });
        if (!resolved.ok) return { ok: false, reason: resolved.reason };
        try {
          persisted = JSON.parse(await readFileFn(resolved.path, 'utf8'));
        } catch {
          return { ok: false, reason: 'CHATGPT_GOAL_INBOX_READ_FAILED' };
        }
        // Retry-time timestamps are not a new proposal. All other identity and
        // payload fields must still match the original durable inbox record.
        if (!sameJson({ ...record, timestampUtc: persisted?.timestampUtc }, persisted)) {
          return { ok: false, reason: 'CHATGPT_GOAL_INBOX_CONFLICT' };
        }
      }
      goalAdmission = await promoteChatGptGoalIntent({
        root, segments, record: persisted, writeOptions, writeAtomicJsonFn, readFileFn,
        nowMs: writeOptions.nowMs,
      });
      return goalAdmission;
    },
    answerQuestionFn: async (questionRecord, answerOptions) => {
      qaQuestionRecord = questionRecord;
      const answered = await answerQuestionFn(questionRecord, answerOptions);
      qaAnswerDiagnostic = rejectionDiagnostic(answered, questionRecord);
      return answered;
    },
    writeAtomicJsonFn: async (root, segments, record, writeOptions) => {
      const isQaCompletion = qaQuestionRecord
        && Array.isArray(segments)
        && segments[0] === 'receipts'
        && text(record?.disposition).endsWith(':WORKSPACE_QA_PASS')
        && text(record?.disposition).startsWith('RELAY_COMPLETE:');
      if (isQaCompletion && !qaFlywheelAttempted) {
        qaFlywheelAttempted = true;
        qaFlywheelContinuation = await reconcileWorkspaceQaFlywheelV1({
          questionRecord: qaQuestionRecord,
          root,
          repoRoot: writeOptions.repoRoot,
          nowMs: writeOptions.nowMs,
          readFileFn,
          writeAtomicJsonFn,
        });
        if (qaFlywheelContinuation?.ok !== true) {
          return { ok: false, reason: 'QA_FLYWHEEL_CONTINUATION_FAILED', qaFlywheelContinuation };
        }
      }
      const augmented = qaAnswerDiagnostic && Array.isArray(segments) && segments[0] === 'receipts'
        ? Object.freeze({ ...record, qaAnswerDiagnostic })
        : record;
      return writeAtomicJsonFn(root, segments, augmented, writeOptions);
    },
    adapter: Object.freeze({
      readRequest: (...args) => {
        const observed = adapter.readRequest(...args);
        const parsed = observed?.ok ? parseChatGptSharedWorkspaceRequestComment(observed.body) : null;
        const candidate = parsed?.ok ? parsed.request?.boundedPayload?.questionRecord : null;
        if (candidate) qaQuestionRecord = candidate;
        return observed;
      },
      writeResponse: (body) => adapter.writeResponse(renderResponseWithDiagnostic(body, qaAnswerDiagnostic)),
    }),
  });

  return Object.freeze({ ...result, qaAnswerDiagnostic, goalAdmission, qaFlywheelContinuation });
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  if (!argv1) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
}

if (isDirectCliEntrypoint()) {
  const result = await runChatGptSharedWorkspaceGitHubRelay();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
