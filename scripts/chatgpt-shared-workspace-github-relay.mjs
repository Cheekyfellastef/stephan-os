#!/usr/bin/env node
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

export async function runChatGptSharedWorkspaceGitHubRelay(options = {}) {
  let qaAnswerDiagnostic = null;
  let goalAdmission = null;
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
    answerQuestionFn: async (questionRecord, answerOptions) => {
      const answered = await answerQuestionFn(questionRecord, answerOptions);
      qaAnswerDiagnostic = rejectionDiagnostic(answered, questionRecord);
      return answered;
    },
    writeAtomicJsonFn: async (root, segments, record, writeOptions) => {
      const augmented = qaAnswerDiagnostic && Array.isArray(segments) && segments[0] === 'receipts'
        ? Object.freeze({ ...record, qaAnswerDiagnostic })
        : record;
      const primaryWrite = await writeAtomicJsonFn(root, segments, augmented, writeOptions);
      if (primaryWrite?.ok !== true) return primaryWrite;

      const promotion = await promoteChatGptGoalIntent({
        root,
        segments,
        record: augmented,
        writeOptions,
        writeAtomicJsonFn,
        readFileFn,
        nowMs: Number.isFinite(options.nowMs) ? options.nowMs : Date.now(),
      });
      if (promotion.applicable) {
        goalAdmission = promotion;
        if (!promotion.ok) {
          return Object.freeze({
            ok: false,
            reason: promotion.reason,
            bytes: Number.isFinite(primaryWrite.bytes) ? primaryWrite.bytes : 0,
          });
        }
      }
      return primaryWrite;
    },
    adapter: Object.freeze({
      readRequest: (...args) => adapter.readRequest(...args),
      writeResponse: (body) => adapter.writeResponse(renderResponseWithDiagnostic(body, qaAnswerDiagnostic)),
    }),
  });

  return Object.freeze({ ...result, qaAnswerDiagnostic, goalAdmission });
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
