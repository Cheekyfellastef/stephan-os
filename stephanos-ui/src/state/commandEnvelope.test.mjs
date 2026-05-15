import test from 'node:test';
import assert from 'node:assert/strict';
import { attachChatContextToEnvelope, attachExecutionMetadataToEnvelope, attachProviderRequestToEnvelope, createCommandEnvelope, projectEnvelopeToExecutionMetadata, projectEnvelopeToSupportSnapshot } from './commandEnvelope.js';

test('creates stable envelope with operator message and submission identity', () => {
  const env = createCommandEnvelope({ operatorMessage: 'do i merge this pr', submissionSource: 'stephanos-mission-console', submissionRoute: 'assistant-router', commandId: 'req_1' });
  assert.equal(env.version, 'command-envelope.v1');
  assert.equal(env.submission.source, 'stephanos-mission-console');
});

test('attaches chat context/provider/execution and projects metadata safely', () => {
  let env = createCommandEnvelope({ operatorMessage: 'do i merge this pr', commandId: 'req_2' });
  env = attachChatContextToEnvelope(env, { version: 'v1', recommendedResponseMode: 'merge-decision', intentClassifierMatchedRule: 'merge-decision', contextProviderIdsUsed: ['uiReality', 'proofState'], compactSummary: { status: 'active' } });
  env = attachProviderRequestToEnvelope(env, { requestedProvider: 'ollama' });
  env = attachExecutionMetadataToEnvelope(env, { execution_status: 'ok', actual_provider_used: 'ollama', model_used: 'llama3.2:3b', chat_context_ui_reality_status: 'OK' });
  const projected = projectEnvelopeToExecutionMetadata(env);
  assert.equal(projected.command_envelope_status, 'active');
  assert.equal(projected.command_envelope_response_mode, 'merge-decision');
  assert.match(projected.command_envelope_context_providers_used, /uiReality/);
  const snapshot = projectEnvelopeToSupportSnapshot(env);
  assert.equal(snapshot.command_envelope_actual_provider, 'ollama');
});
