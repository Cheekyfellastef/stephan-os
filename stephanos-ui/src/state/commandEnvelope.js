function asText(value, fallback = 'n/a') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value = []) {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => String(item)) : [];
}

export function createCommandEnvelope(input = {}) {
  const createdAt = input.createdAt || new Date().toISOString();
  const operatorMessage = String(input.operatorMessage || '');
  const normalizedOperatorMessage = String(input.normalizedOperatorMessage || operatorMessage).replace(/\s+/g, ' ').trim();
  return {
    version: 'command-envelope.v1',
    envelopeId: String(input.envelopeId || `env_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`),
    createdAt,
    operatorMessage,
    normalizedOperatorMessage,
    submission: {
      source: asText(input.submission?.source || input.submissionSource, 'unknown'),
      route: asText(input.submission?.route || input.submissionRoute, 'assistant-router'),
      surface: asText(input.submission?.surface, 'mission-console'),
      commandId: asText(input.submission?.commandId || input.commandId, 'unknown'),
    },
    chatContext: { packStatus: 'unavailable', version: 'n/a', responseMode: 'direct-answer', intentClassifierMatchedRule: 'direct-answer', relevantCanonCount: 0, affectedSubsystems: [], sourcesUsed: [], providerIdsUsed: [], warnings: [], nextAction: 'Answer directly with bounded confidence.' },
    providerRequest: {},
    execution: { status: 'pending', truth: 'pending', actualProvider: 'unknown', actualModel: 'unknown', elapsedMs: null, fallbackUsed: false, cancellationState: 'none' },
    proof: { requiredProof: 'standard', proofStatus: 'unknown', uiRealityStatus: 'UNKNOWN', buildVerifyRequired: true, browserProofRequired: false },
    supportProjection: { snapshotFields: [], warnings: [] },
  };
}

export function attachChatContextToEnvelope(envelope, chatContextPack = null) {
  const compact = chatContextPack?.compactSummary || {};
  return {
    ...envelope,
    chatContext: {
      packStatus: compact.status || (chatContextPack ? 'active' : 'unavailable'),
      version: chatContextPack?.version || 'n/a',
      responseMode: chatContextPack?.recommendedResponseMode || compact.responseMode || 'direct-answer',
      intentClassifierMatchedRule: chatContextPack?.intentClassifierMatchedRule || 'direct-answer',
      relevantCanonCount: Array.isArray(chatContextPack?.relevantCanon) ? chatContextPack.relevantCanon.length : Number(compact.relevantCanonCount || 0),
      affectedSubsystems: asList(chatContextPack?.affectedSubsystems || compact.affectedSubsystems),
      sourcesUsed: asList(compact.contextSourcesUsed),
      providerIdsUsed: asList(chatContextPack?.contextProviderIdsUsed || compact.contextProviderIdsUsed),
      warnings: asList(chatContextPack?.warnings || compact.warnings),
      nextAction: chatContextPack?.recommendedNextAction || compact.nextAction || 'Answer directly with bounded confidence.',
    },
  };
}

export function attachProviderRequestToEnvelope(envelope, providerRequestMetadata = {}) { return { ...envelope, providerRequest: { ...providerRequestMetadata } }; }
export function attachExecutionMetadataToEnvelope(envelope, executionMetadata = {}) {
  return { ...envelope, execution: { ...envelope.execution, status: asText(executionMetadata.execution_status || executionMetadata.selected_provider_final_execution_outcome || envelope.execution.status, 'unknown'), truth: asText(executionMetadata.execution_truth || envelope.execution.truth, 'unknown'), actualProvider: asText(executionMetadata.actual_provider_used || executionMetadata.execution_selected_provider || envelope.execution.actualProvider, 'unknown'), actualModel: asText(executionMetadata.model_used || envelope.execution.actualModel, 'unknown'), elapsedMs: executionMetadata.elapsed_ms ?? envelope.execution.elapsedMs ?? null, fallbackUsed: Boolean(executionMetadata.fallback_used ?? envelope.execution.fallbackUsed), cancellationState: executionMetadata.execution_cancelled ? 'cancelled' : 'none' }, proof: { ...envelope.proof, proofStatus: asText(executionMetadata.proof_status || envelope.proof.proofStatus, 'unknown'), uiRealityStatus: asText(executionMetadata.chat_context_ui_reality_status || envelope.proof.uiRealityStatus, 'UNKNOWN') } };
}
export function projectEnvelopeToExecutionMetadata(envelope = {}) {
  const warnings = asList(envelope?.chatContext?.warnings);
  return {
    command_envelope_status: envelope?.version ? 'active' : 'unavailable',
    command_envelope_version: asText(envelope?.version, 'n/a'),
    command_envelope_id: asText(envelope?.envelopeId, 'n/a'),
    command_envelope_submission_source: asText(envelope?.submission?.source, 'unknown'),
    command_envelope_submission_route: asText(envelope?.submission?.route, 'unknown'),
    command_envelope_response_mode: asText(envelope?.chatContext?.responseMode, 'direct-answer'),
    command_envelope_context_providers_used: asList(envelope?.chatContext?.providerIdsUsed).join('|') || 'none',
    command_envelope_execution_status: asText(envelope?.execution?.status, 'unknown'),
    command_envelope_actual_provider: asText(envelope?.execution?.actualProvider, 'unknown'),
    command_envelope_actual_model: asText(envelope?.execution?.actualModel, 'unknown'),
    command_envelope_proof_status: asText(envelope?.proof?.proofStatus, 'unknown'),
    command_envelope_ui_reality_status: asText(envelope?.proof?.uiRealityStatus, 'UNKNOWN'),
    command_envelope_warnings: warnings.join(' | ') || 'none',
  };
}
export function projectEnvelopeToSupportSnapshot(envelope = {}) { return projectEnvelopeToExecutionMetadata(envelope); }
