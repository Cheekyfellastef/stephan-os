#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { writeAtomicJson } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
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

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
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
  const answerQuestionFn = typeof options.answerQuestionFn === 'function'
    ? options.answerQuestionFn
    : answerStephanosWorkspaceQuestionRecord;
  const writeAtomicJsonFn = typeof options.writeAtomicJsonFn === 'function'
    ? options.writeAtomicJsonFn
    : writeAtomicJson;
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
      return writeAtomicJsonFn(root, segments, augmented, writeOptions);
    },
    adapter: Object.freeze({
      readRequest: (...args) => adapter.readRequest(...args),
      writeResponse: (body) => adapter.writeResponse(renderResponseWithDiagnostic(body, qaAnswerDiagnostic)),
    }),
  });

  return Object.freeze({ ...result, qaAnswerDiagnostic });
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
