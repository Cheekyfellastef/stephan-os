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

test('resolveExecuteRouteTruth promotes local-desktop execute route from routeDiagnosticsSummary candidate evidence', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /const routeDiagnosticsSummary = Array\.isArray\(runtimeContext\.routeDiagnosticsSummary\) \? runtimeContext\.routeDiagnosticsSummary : \[\]/);
  assert.match(source, /const localDesktopSummaryLine = routeDiagnosticsSummary\.find\(\(line\) => \/-\\s\*local-desktop\\b\/i\.test\(String\(line \|\| ''\)\)\) \|\| ''/);
  assert.match(source, /const localDesktopSummaryAvailable = \/\\b\(available\|usable\)\\b\/i\.test\(localDesktopSummaryLine\) && !\/\\bunavailable\|blocked\\b\/i\.test\(localDesktopSummaryLine\)/);
  assert.match(source, /const localDesktopReachable = localDesktopDiagnostics\.available === true[\s\S]*\|\| localDesktopSummaryAvailable;/);
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
  assert.match(source, /chat_context_intent_classifier_matched_rule:\s*classifierProof\?\.intentClassifierMatchedRule/);
  assert.match(source, /chat_context_attachment_probe_response_mode:\s*pickChatContextFieldPreferRequestNonDefault/);
  assert.match(source, /defaultPackUsed = \(deterministicRuleMatched && deterministicRuleMatched !== 'direct-answer'\)\s*\?\s*'no'/);
});

test('buildChatContextAttachmentMetadata prefers request-pack classifier proof fields', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /const requestPackClassifierProof = requestPack\.classifierProof/);
  assert.match(source, /chat_context_merge_rule_pattern: classifierProof\?\.mergeRulePattern \|\| 'none'/);
  assert.match(source, /chat_context_match_input: resolvedMatchInput/);
  assert.match(source, /chat_context_merge_rule_test_result: classifierProof\?\.mergeRuleTestResult \|\| 'no'/);
  assert.match(source, /chat_context_first_matching_rule: classifierProof\?\.firstMatchingRule \|\| 'direct-answer'/);
  assert.match(source, /chat_context_evaluated_rule_results: resolvedRuleResults\.length > 0 \? resolvedRuleResults\.join\(','\) : 'n\/a'/);
  assert.match(source, /chat_context_classifier_proof_missing: classifierProofMissing \? 'yes' : 'no'/);
});

test('buildChatContextAttachmentMetadata uses operator-message fallback + proof warning when classifier proof missing', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /const resolvedMatchInput = classifierProof\?\.matchInput \|\| normalizedOperatorMessage \|\| rawOperatorMessage \|\| rebuiltOperatorMessage \|\| 'n\/a'/);
  assert.match(source, /chat_context_match_input: resolvedMatchInput/);
  assert.match(source, /chat_context_classifier_proof_warning: classifierProofMissing \? 'classifier-proof-missing-after-final-attachment-rebuild' : 'none'/);
});

test('useAIConsole re-attaches chat context metadata in final execution metadata setter path', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /const finalExecutionMetadata = attachChatContextToExecutionMetadata\(\{/);
  assert.match(source, /setLastExecutionMetadata\(finalExecutionMetadata\)/);
});

test('request classifier proof wins over raw\/trace direct-answer defaults', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /pickChatContextFieldPreferRequestNonDefault\('chat_context_response_mode', raw\.chat_context_response_mode, trace\.chat_context_response_mode, requestChatContext\.chat_context_response_mode\)/);
  assert.match(source, /chat_context_intent_classifier_matched_rule: classifierProof\?\.intentClassifierMatchedRule \|\| requestPack\.intentClassifierMatchedRule \|\| requestPack\.recommendedResponseMode \|\| rebuiltPack\?\.intentClassifierMatchedRule \|\| 'direct-answer'/);
  assert.match(source, /const defaultPackUsed = \(deterministicRuleMatched && deterministicRuleMatched !== 'direct-answer'\)\s*\?\s*'no'/);
});


test('stephanos-mission-console and command deck label path share orchestrator INTENT_RULES classifier source', async () => {
  const hookSource = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  const orchestratorSource = await fs.readFile(path.join(new URL('..', import.meta.url).pathname, 'state/chatContextOrchestrator.js'), 'utf8');
  assert.match(hookSource, /chat_context_classifier_function_source:\s*requestPayload\?\.chatContextPack\?\.classifierDebug\?\.classifierFunctionSource/);
  assert.match(orchestratorSource, /classifierFunctionSource:\s*'chatContextOrchestrator\.INTENT_RULES'/);
  assert.match(orchestratorSource, /id:\s*'merge-decision'/);
});




test('buildChatContextAttachmentMetadata copies classifierProof directly from request pack', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /const requestPackClassifierProof = requestPack\.classifierProof/);
  assert.match(source, /chat_context_merge_rule_test_result: classifierProof\?\.mergeRuleTestResult \|\| 'no'/);
  assert.match(source, /chat_context_first_matching_rule: classifierProof\?\.firstMatchingRule \|\| 'direct-answer'/);
  assert.match(source, /chat_context_evaluated_rule_results: resolvedRuleResults\.length > 0 \? resolvedRuleResults\.join\(','\) : 'n\/a'/);
});

test('buildChatContextAttachmentMetadata reports proof missing rather than inventing fallback proof', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /const classifierProofMissing = !classifierProof/);
  assert.match(source, /chat_context_classifier_proof_missing: classifierProofMissing \? 'yes' : 'no'/);
  assert.match(source, /chat_context_classifier_proof_warning: classifierProofMissing \? 'classifier-proof-missing-after-final-attachment-rebuild' : 'none'/);
});


test('buildChatContextAttachmentMetadata rebuild path is wired for request-pack fallback and source tagging', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /const requestPackClassifierProof = requestPack\.classifierProof/);
  assert.match(source, /const rebuiltPack = \(!requestPackClassifierProof && rebuiltOperatorMessage\)/);
  assert.match(source, /buildChatContextPack\(\{/);
  assert.match(source, /chat_context_classifier_proof_source: classifierProofSource/);
  assert.match(source, /chat_context_rebuilt_at_final_attachment: rebuiltAtFinalAttachment/);
  assert.match(source, /chat_context_rebuild_source_field: rebuildSourceField/);
});

test('buildChatContextAttachmentMetadata rebuild candidate priority includes retrieval_query and raw_input', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /\['retrieval_query', normalized\.retrieval_query\]/);
  assert.match(source, /\['raw_input', requestPayload\?\.raw_input\]/);
  assert.match(source, /chat_context_intent_classifier_matched_rule: classifierProof\?\.intentClassifierMatchedRule \|\| requestPack\.intentClassifierMatchedRule \|\| requestPack\.recommendedResponseMode \|\| rebuiltPack\?\.intentClassifierMatchedRule \|\| 'direct-answer'/);
});

test('buildChatContextExecutionMetadata emits provider registry metadata fields', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /chat_context_provider_registry_status/);
  assert.match(source, /chat_context_provider_ids_registered/);
  assert.match(source, /chat_context_provider_ids_used/);
  assert.match(source, /chat_context_provider_warning_count/);
  assert.match(source, /chat_context_provider_proof_state/);
  assert.match(source, /chat_context_provider_next_actions/);
  assert.match(source, /chat_context_provider_canon_links_count/);
});

test('buildChatContextAttachmentMetadata rebuild path rehydrates provider registry fields', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /const rebuiltExecutionMetadata = buildChatContextExecutionMetadata\(rebuiltPack\)/);
  assert.match(source, /chat_context_provider_registry_status: resolvedProviderRegistryStatus/);
  assert.match(source, /chat_context_provider_ids_registered: resolvedProviderIdsRegistered/);
  assert.match(source, /chat_context_provider_ids_used: resolvedProviderIdsUsed/);
  assert.match(source, /chat_context_provider_warning_count: resolvedProviderWarningCount/);
  assert.match(source, /chat_context_provider_proof_state: resolvedProviderProofState/);
  assert.match(source, /chat_context_provider_next_actions: resolvedProviderNextActions/);
  assert.match(source, /chat_context_provider_canon_links_count: resolvedProviderCanonLinksCount/);
});

test('provider registry resolution prefers rebuilt/request non-default values over inactive raw defaults', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /function pickChatContextFieldPreferPackOrRebuildNonDefault/);
  assert.match(source, /const preferredValue = !isDefaultChatContextValue\(key, requestValue\) \? requestValue : rebuiltValue/);
  assert.match(source, /if \(key === 'chat_context_provider_registry_status'\) return normalized === 'inactive';/);
  assert.match(source, /const resolvedProviderRegistryStatus = pickChatContextFieldPreferPackOrRebuildNonDefault\(/);
  assert.match(source, /const resolvedProviderCanonLinksCount = pickChatContextFieldPreferPackOrRebuildNonDefault\(/);
});


test('useAIConsole live submit path creates and projects command envelope metadata', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /createCommandEnvelope\(\{/);
  assert.match(source, /attachChatContextToEnvelope\(commandEnvelope, chatContextPack\)/);
  assert.match(source, /attachProviderRequestToEnvelope\(commandEnvelope,/);
  assert.match(source, /chat_context_response_mode/);
  assert.match(source, /let commandEnvelopeFinal = effectiveRequestPayload\?\.commandEnvelope \|\| requestPayload\.commandEnvelope \|\| null/);
});


test('useAIConsole wires response planner into metadata and prompt guidance', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /buildResponsePlan/);
  assert.match(source, /response_planner_status/);
  assert.match(source, /responsePlannerGuidance/);
  assert.match(source, /buildResponsePlanExecutionMetadata/);
  assert.match(source, /githubPrEvidence: chatContextPack\?\.githubPrEvidence \|\| null/);
  assert.match(source, /prEvidenceStatus: chatContextPack\?\.githubPrEvidence\?\.status \|\| requestRuntimeStatus\?\.prEvidenceStatus/);
  assert.match(source, /response_planner_identity_prompt_injected/);
  assert.match(source, /operator_profile_prompt_line_present/);
  assert.match(source, /final_answer_used_operator_profile/);
  assert.match(source, /identity_recall_deterministic_answer_used/);
  assert.match(source, /createIdentityRecallDeterministicResult/);
  assert.match(source, /Yes\. Your name is \$\{safeName\}\./);
});

test('deterministic identity recall appends assistant answer through command history path', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /if \(routeUnavailableResult \|\| identityRecallDeterministicResult\) return appendCommandHistory\(prev, entry\);/);
  assert.match(source, /lastFinalizationPath = routeUnavailableResult \? 'error' : \(identityRecallDeterministicResult \? 'deterministic-identity' : 'provider'\);/);
});

test('command input clearing is gated by submit acceptance return contract', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  const aiConsoleSource = await fs.readFile(path.join(new URL('..', import.meta.url).pathname, 'components/AIConsole.jsx'), 'utf8');
  assert.match(source, /submitAccepted = !routeUnavailableResult;/);
  assert.match(source, /command_pipeline_last_input_restore_available:\s*'yes'/);
  assert.match(source, /command_pipeline_last_failure_reason:\s*normalizedFailureCode \|\| fallbackReason \|\| 'route-unavailable'/);
  assert.match(source, /response_planner_status:\s*blockedBeforeProvider \? 'blocked-before-provider' : 'unavailable'/);
  assert.match(source, /execution_selected_provider:\s*'none'/);
  assert.match(source, /actual_provider_used:\s*'none'/);
  assert.match(source, /fallback_active:\s*false/);
  assert.match(aiConsoleSource, /if \(submitResult\?\.inputCleared === true \|\| submitResult\?\.submitAccepted === true\) \{/);
  assert.match(aiConsoleSource, /else if \(submitResult\?\.restoreInput === true\) \{/);
});

test('useAIConsole startup rehydrates operator profile metadata for support snapshot visibility', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /chat_context_operator_profile_rehydrated/);
  assert.match(source, /chat_context_operator_profile_storage_key/);
  assert.match(source, /chat_context_operator_profile_storage_read_status/);
  assert.match(source, /chat_context_operator_profile_last_read_at/);
  assert.match(source, /chat_context_operator_profile_last_write_at/);
  assert.match(source, /setLastExecutionMetadata\(\(prev = \{\}\) => \(\{/);
});
