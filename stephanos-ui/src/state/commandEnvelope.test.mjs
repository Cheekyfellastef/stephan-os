import test from 'node:test';
import assert from 'node:assert/strict';
import { attachChatContextToEnvelope, attachCodexDispatchToEnvelope, attachExecutionMetadataToEnvelope, attachPrEvidenceToEnvelope, attachProviderRequestToEnvelope, createCommandEnvelope, projectEnvelopeToExecutionMetadata, projectEnvelopeToSupportSnapshot } from './commandEnvelope.js';

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
  env = attachPrEvidenceToEnvelope(env, { status: 'needs-connector', prNumber: 123, parsedPrNumber: 123, parseInput: 'do i merge PR 123', parsedNumberSource: 'retrieval_query', repo: 'acme/stephan-os', checksStatus: 'failed', mergeReadiness: 'wait', missingProof: ['browser'], recommendedNextAction: 'Connector unavailable; connect read-only GitHub evidence or paste PR summary.' });
  env = attachExecutionMetadataToEnvelope(env, { execution_status: 'ok', execution_truth: 'answered', actual_provider_used: 'ollama', model_used: 'llama3.2:3b', proof_status: 'pending', chat_context_ui_reality_status: 'OK', elapsed_ms: 321 });
  const projected = projectEnvelopeToExecutionMetadata(env);
  assert.equal(projected.command_envelope_status, 'active');
  assert.equal(projected.command_envelope_response_mode, 'merge-decision');
  assert.match(projected.command_envelope_context_providers_used, /uiReality/);
  assert.equal(projected.command_envelope_execution_status, 'ok');
  assert.equal(projected.command_envelope_actual_provider, 'ollama');
  assert.equal(projected.command_envelope_actual_model, 'llama3.2:3b');
  assert.equal(projected.command_envelope_ui_reality_status, 'OK');
  assert.equal(projected.command_envelope_pr_number, '123');
  assert.equal(projected.command_envelope_pr_repo, 'acme/stephan-os');
  assert.equal(projected.command_envelope_pr_parse_confidence, 'none');
  assert.equal(projected.command_envelope_pr_checks_status, 'failed');
  assert.equal(projected.command_envelope_pr_merge_readiness, 'wait');
  assert.equal(projected.command_envelope_pr_evidence_parsed_pr_number, '123');
  assert.equal(projected.pr_evidence_parsed_pr_number, '123');
  assert.equal(projected.github_pr_evidence_number, '123');
  assert.equal(projected.github_pr_evidence_provider_status, 'needs-connector');
  assert.equal(projected.github_pr_evidence_projection_integrity, 'complete');
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


test('command envelope projects PR evidence parse input metadata fields', () => {
  let env = createCommandEnvelope({ operatorMessage: 'do i merge PR 123' });
  env = attachPrEvidenceToEnvelope(env, { status: 'needs-connector', prNumber: 123, parsedPrNumber: 123, parseInput: 'do i merge PR 123', parsedNumberSource: 'matchInput' });
  const projected = projectEnvelopeToExecutionMetadata(env);
  assert.equal(projected.pr_evidence_parse_input, 'do i merge PR 123');
  assert.equal(projected.pr_evidence_parsed_number_source, 'matchInput');
  assert.equal(projected.pr_evidence_provider_output_number, '123');
  assert.equal(projected.command_envelope_pr_evidence_parse_input, 'do i merge PR 123');
});


test('command envelope projects fetched github evidence metadata and diagnostics', () => {
  let env = createCommandEnvelope({ operatorMessage: 'do i merge PR 970' });
  env = attachPrEvidenceToEnvelope(env, { status: 'fetched', source: 'github-api', prNumber: 970, repo: 'Cheekyfellastef/stephan-os', prTitle: 'Fix projection', prState: 'open', merged: false, headSha: 'abc123', changedFileCount: 3, checksStatus: 'passed', buildStatus: 'passed', verifyStatus: 'passed', retrievedAt: '2026-05-20T00:00:00.000Z', projectionIntegrity: 'complete', tokenStatus: { configured: true, authority: 'backend-local-secret-store' }, fetchDiagnostics: { github_pr_evidence_fetch_attempted: 'yes', github_pr_evidence_fetch_url_or_mode: 'backend:Cheekyfellastef/stephan-os#970' } });
  const projected = projectEnvelopeToExecutionMetadata(env);
  assert.equal(projected.github_pr_evidence_provider_status, 'fetched');
  assert.equal(projected.github_pr_evidence_source, 'github-api');
  assert.equal(projected.github_pr_evidence_title, 'Fix projection');
  assert.equal(projected.github_pr_evidence_state, 'open');
  assert.equal(projected.github_token_configured, 'yes');
  assert.equal(projected.github_token_authority, 'backend-local-secret-store');
  assert.equal(projected.github_pr_evidence_fetch_attempted, 'yes');
});
