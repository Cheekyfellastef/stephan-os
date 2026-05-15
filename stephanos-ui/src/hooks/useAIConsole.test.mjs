import test from 'node:test';
import assert from 'node:assert/strict';
import { appendCommandHistory, MAX_COMMAND_HISTORY } from './commandHistory.js';

test('appendCommandHistory keeps command history bounded', () => {
  let history = [];
  for (let index = 0; index < MAX_COMMAND_HISTORY + 5; index += 1) {
    history = appendCommandHistory(history, { id: `cmd_${index}` });
  }

  assert.equal(history.length, MAX_COMMAND_HISTORY);
  assert.equal(history[0].id, 'cmd_5');
  assert.equal(history.at(-1).id, `cmd_${MAX_COMMAND_HISTORY + 4}`);
});

import fs from 'node:fs/promises';
import path from 'node:path';

test('useAIConsole request path includes chat context pack metadata', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /buildChatContextPack/);
  assert.match(source, /chatContextPack/);
  assert.match(source, /chat_context_response_mode/);
});


test('useAIConsole stores compact chat context metadata in latest execution metadata', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /function buildChatContextExecutionMetadata/);
  assert.match(source, /submissionSource = 'stephanos-mission-console'/);
  assert.match(source, /submissionRoute = 'assistant-router'/);
  assert.match(source, /chat_context_pack_status/);
  assert.match(source, /setLastExecutionMetadata\(\(prev\) => attachChatContextToExecutionMetadata\(\{/);
  assert.match(source, /\.\.\.buildChatContextExecutionMetadata\(chatContextPack\)/);
  assert.match(source, /function attachChatContextToExecutionMetadata/);
  assert.match(source, /setLastExecutionMetadata\(attachChatContextToExecutionMetadata\(\{/);
  assert.match(source, /submission_console: executionMetadata\.submission_console \|\| requestTrace\.submission_console \|\| requestPayload\.submissionSource \|\| 'stephanos-mission-console'/);
  assert.match(source, /submission_route: executionMetadata\.submission_route \|\| requestTrace\.submission_route \|\| requestPayload\.submissionRoute \|\| 'assistant-router'/);
  assert.match(source, /chat_context_pack_status/);
  assert.match(source, /chat_context_version/);
  assert.match(source, /chat_context_response_mode/);
  assert.match(source, /chat_context_relevant_canon_count/);
  assert.match(source, /chat_context_sources_used/);
  assert.match(source, /chat_context_warning_count/);
  assert.match(source, /request_payload_chat_context_present:\s*Boolean\(\(effectiveRequestPayload\?\.chatContextPack\) \|\|/);
});


test('useAIConsole final execution metadata includes chat context attachment probe fields', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /chat_context_attachment_probe:\s*'attached-at-final-execution-metadata'/);
  assert.match(source, /chat_context_attachment_probe_request_id/);
  assert.match(source, /chat_context_attachment_probe_prompt/);
  assert.match(source, /chat_context_attachment_probe_response_mode/);
});


test('useAIConsole chat context metadata includes operator message proof fields', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /chat_context_raw_operator_message_seen/);
  assert.match(source, /chat_context_normalized_operator_message/);
  assert.match(source, /chat_context_intent_classifier_matched_rule/);
  assert.match(source, /chat_context_build_source/);
  assert.match(source, /chat_context_default_pack_used/);
  assert.match(source, /chat_context_was_overwritten/);
  assert.match(source, /operatorMessage:\s*prompt/);
  assert.match(source, /buildSource:\s*submissionSource/);
  assert.match(source, /chat_context_builder_function/);
  assert.match(source, /chat_context_fallback_branch_taken/);
  assert.match(source, /chat_context_fallback_branch_reason/);
});

test('useAIConsole live submit path preserves merge-decision metadata attachment fields', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /chat_context_response_mode:\s*pickChatContextFieldPreferRequestNonDefault/);
  assert.match(source, /chat_context_intent_classifier_matched_rule:\s*requestPack\.intentClassifierMatchedRule/);
  assert.match(source, /chat_context_attachment_probe_response_mode:\s*pickChatContextFieldPreferRequestNonDefault/);
  assert.match(source, /defaultPackUsed = \(deterministicRuleMatched && deterministicRuleMatched !== 'direct-answer'\)\s*\?\s*'no'/);
});

test('buildChatContextAttachmentMetadata prefers request-pack classifier proof fields', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /const requestPackMatchInput = pickChatContextField\(\s*requestPack\.matchInput,\s*requestPackClassifierDebug\.classifierMatchInput,/);
  assert.match(source, /const requestPackMergeRulePattern = pickChatContextField\(\s*requestPack\.mergeRulePattern,\s*requestPackClassifierDebug\.classifierMergeRulePattern,/);
  assert.match(source, /chat_context_match_input: requestPackMatchInput \|\| 'n\/a'/);
  assert.match(source, /chat_context_merge_rule_test_result: requestPackMergeRuleTestResult \|\| 'no'/);
  assert.match(source, /chat_context_first_matching_rule: requestPackFirstMatchingRule \|\| 'direct-answer'/);
  assert.match(source, /chat_context_evaluated_rule_results: requestPackEvaluatedRuleResults\.length > 0 \? requestPackEvaluatedRuleResults\.join\(','\) : 'n\/a'/);
  assert.match(source, /chat_context_classifier_proof_missing: classifierProofMissing \? 'yes' : 'no'/);
});

test('request classifier proof wins over raw\/trace direct-answer defaults', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /pickChatContextFieldPreferRequestNonDefault\('chat_context_response_mode', raw\.chat_context_response_mode, trace\.chat_context_response_mode, requestChatContext\.chat_context_response_mode\)/);
  assert.match(source, /chat_context_intent_classifier_matched_rule: requestPack\.intentClassifierMatchedRule \|\| requestPack\.recommendedResponseMode \|\| 'direct-answer'/);
  assert.match(source, /const defaultPackUsed = \(deterministicRuleMatched && deterministicRuleMatched !== 'direct-answer'\)\s*\?\s*'no'/);
});


test('stephanos-mission-console and command deck label path share orchestrator INTENT_RULES classifier source', async () => {
  const hookSource = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  const orchestratorSource = await fs.readFile(path.join(new URL('..', import.meta.url).pathname, 'state/chatContextOrchestrator.js'), 'utf8');
  assert.match(hookSource, /chat_context_classifier_function_source:\s*requestPayload\?\.chatContextPack\?\.classifierDebug\?\.classifierFunctionSource/);
  assert.match(orchestratorSource, /classifierFunctionSource:\s*'chatContextOrchestrator\.INTENT_RULES'/);
  assert.match(orchestratorSource, /id:\s*'merge-decision'/);
});
