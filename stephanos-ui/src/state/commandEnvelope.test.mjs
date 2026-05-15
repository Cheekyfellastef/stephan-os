import test from 'node:test';
import assert from 'node:assert/strict';
import { attachChatContextToEnvelope, attachCodexDispatchToEnvelope, attachExecutionMetadataToEnvelope, attachProviderRequestToEnvelope, createCommandEnvelope, projectEnvelopeToExecutionMetadata, projectEnvelopeToSupportSnapshot } from './commandEnvelope.js';

test('createCommandEnvelope produces command-envelope.v1 with identity fields', () => {
  const env = createCommandEnvelope({ operatorMessage: 'do i merge this pr', submissionSource: 'stephanos-mission-console', submissionRoute: 'assistant-router', commandId: 'req_1' });
  assert.equal(env.version, 'command-envelope.v1');
  assert.ok(env.envelopeId);
  assert.equal(env.operatorMessage, 'do i merge this pr');
  assert.equal(env.submission.source, 'stephanos-mission-console');
  assert.equal(env.submission.route, 'assistant-router');
});

test('envelope attachment + projection covers chat context/provider/execution/support snapshot fields', () => {
  let env = createCommandEnvelope({ operatorMessage: 'do i merge this pr', commandId: 'req_2' });
  env = attachChatContextToEnvelope(env, { version: 'v1', recommendedResponseMode: 'merge-decision', intentClassifierMatchedRule: 'merge-decision', recommendedNextAction: 'collect-proof', contextProviderIdsUsed: ['uiReality', 'proofState', 'canonRules'], compactSummary: { status: 'active', contextProviderCanonLinksCount: 11 }, providerSummaries: { conversationContinuity: { status: 'ready', summary: 'merge proof thread', seededFromExistingHistory: 'yes', continuitySource: 'command-history' }, agentState: { recommendedAgents: ['proof-agent'] } }, chatContinuity: { summaries: [{ id: '1' }] } });
  env = attachProviderRequestToEnvelope(env, { requestedProvider: 'ollama', selectedProvider: 'ollama', selectedModel: 'llama3.2:3b' });
  env = attachExecutionMetadataToEnvelope(env, { execution_status: 'ok', execution_truth: 'answered', actual_provider_used: 'ollama', model_used: 'llama3.2:3b', proof_status: 'pending', chat_context_ui_reality_status: 'OK', elapsed_ms: 321 });
  const projected = projectEnvelopeToExecutionMetadata(env);
  assert.equal(projected.command_envelope_status, 'active');
  assert.equal(projected.command_envelope_response_mode, 'merge-decision');
  assert.match(projected.command_envelope_context_providers_used, /uiReality/);
  assert.equal(projected.command_envelope_execution_status, 'ok');
  assert.equal(projected.command_envelope_actual_provider, 'ollama');
  assert.equal(projected.command_envelope_actual_model, 'llama3.2:3b');
  assert.equal(projected.command_envelope_ui_reality_status, 'OK');
  const snapshot = projectEnvelopeToSupportSnapshot(env);
  assert.equal(snapshot.command_envelope_actual_provider, 'ollama');
  assert.equal(snapshot.chat_continuity_seeded_from_existing_history, 'yes');
  assert.equal(snapshot.chat_continuity_source, 'command-history');
  assert.equal(snapshot.chat_continuity_raw_transcript_stored, 'no');
  assert.equal(projected.command_envelope_operator_profile_used, 'no');
});


test('command envelope carries codex dispatch packet id/status', () => {
  let env = createCommandEnvelope({ operatorMessage: 'get codex to fix this' });
  env = attachCodexDispatchToEnvelope(env, { packetId: 'cdp_1', status: 'ready-for-approval', approvalRequired: true, targetSubsystems: ['ui','proof'] });
  const projected = projectEnvelopeToExecutionMetadata(env);
  assert.equal(projected.command_envelope_codex_dispatch_packet_id, 'cdp_1');
  assert.equal(projected.command_envelope_codex_dispatch_status, 'ready-for-approval');
  assert.equal(projected.command_envelope_operator_approval_required, 'yes');
  assert.equal(projected.command_envelope_repair_loop_status, 'unknown');
});
