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
    chatContinuity: { status: 'empty', summary: 'none', continuityUsed: false },
    operatorProfile: { known: false, operatorName: 'unknown', source: 'none', confidence: 'unknown', nextAction: 'Ask operator for preferred name when relevant.' },
    agentContext: { status: 'empty', recommendedAgents: [], agentContextUsed: false },
    codexDispatch: { packetId: 'none', status: 'not-ready', approvalRequired: 'yes', targetSubsystems: [] },
    prEvidence: { status: 'none', source: 'none', prNumber: 'unknown', repo: 'unknown', prUrl: 'n/a', parseConfidence: 'none', checksStatus: 'unknown', mergeReadiness: 'wait', missingProof: [], nextAction: 'Collect PR evidence.', tokenConfigured: 'no', tokenAuthority: 'none' },
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
    chatContinuity: {
      status: chatContextPack?.providerSummaries?.conversationContinuity?.status || 'empty',
      summary: chatContextPack?.providerSummaries?.conversationContinuity?.summary || 'none',
      continuityUsed: Boolean(chatContextPack?.providerSummaries?.conversationContinuity),
      seededFromExistingHistory: asText(chatContextPack?.providerSummaries?.conversationContinuity?.seededFromExistingHistory, asText(chatContextPack?.chatContinuity?.seededFromExistingHistory, 'no')),
      continuitySource: asText(chatContextPack?.providerSummaries?.conversationContinuity?.continuitySource, asText(chatContextPack?.chatContinuity?.continuitySource, 'none')),
      summaryCount: Number(chatContextPack?.chatContinuity?.summaries?.length || 0),
      rawTranscriptStored: 'no',
    },
    operatorProfile: {
      used: chatContextPack?.contextProviderIdsUsed?.includes('operatorProfile') ? 'yes' : 'no',
      known: chatContextPack?.providerSummaries?.operatorProfile?.known || 'no',
      operatorName: chatContextPack?.providerSummaries?.operatorProfile?.operatorName || 'unknown',
      source: chatContextPack?.providerSummaries?.operatorProfile?.source || 'none',
      confidence: chatContextPack?.providerSummaries?.operatorProfile?.confidence || 'unknown',
      nextAction: chatContextPack?.providerSummaries?.operatorProfile?.nextAction || 'Ask operator for preferred name when relevant.',
    },
    agentContext: {
      status: chatContextPack?.providerSummaries?.agentState ? 'ready' : 'empty',
      recommendedAgents: asList(chatContextPack?.providerSummaries?.agentState?.recommendedAgents),
      agentContextUsed: Boolean(chatContextPack?.providerSummaries?.agentState),
    },
  };
}

export function attachCodexDispatchToEnvelope(envelope, codexDispatchPacket = null) {
  return {
    ...envelope,
    codexDispatch: {
      packetId: asText(codexDispatchPacket?.packetId, 'none'),
      status: asText(codexDispatchPacket?.status, 'not-ready'),
      approvalRequired: codexDispatchPacket?.approvalRequired === false ? 'no' : 'yes',
      targetSubsystems: asList(codexDispatchPacket?.targetSubsystems),
    },
  };
}


export function attachPrEvidenceToEnvelope(envelope, prEvidence = null) {
  return {
    ...envelope,
    prEvidence: {
      status: asText(prEvidence?.status, 'none'),
      source: asText(prEvidence?.source, 'none'),
      prNumber: asText(prEvidence?.prNumber, 'unknown'),
      parsedPrNumber: asText(prEvidence?.parsedPrNumber, asText(prEvidence?.prNumber, 'unknown')),
      repo: asText(prEvidence?.repo, 'unknown'),
      prUrl: asText(prEvidence?.prUrl, 'n/a'),
      parseConfidence: asText(prEvidence?.parseConfidence, 'none'),
      parseInput: asText(prEvidence?.parseInput, 'n/a'),
      parsedNumberSource: asText(prEvidence?.parsedNumberSource, 'none'),
      prTitle: asText(prEvidence?.prTitle, ''),
      prState: asText(prEvidence?.prState, 'unknown'),
      merged: prEvidence?.merged === true ? 'yes' : 'no',
      headSha: asText(prEvidence?.headSha, 'n/a'),
      changedFileCount: asText(prEvidence?.changedFileCount, '0'),
      checksStatus: asText(prEvidence?.checksStatus, 'unknown'),
      buildStatus: asText(prEvidence?.buildStatus, 'unknown'),
      verifyStatus: asText(prEvidence?.verifyStatus, 'unknown'),
      retrievedAt: asText(prEvidence?.retrievedAt, 'n/a'),
      tokenConfigured: prEvidence?.tokenStatus?.configured === true ? 'yes' : 'no',
      tokenAuthority: asText(prEvidence?.tokenStatus?.authority, 'none'),
      tokenMasked: asText(prEvidence?.tokenStatus?.masked, 'n/a'),
      tokenUpdatedAt: asText(prEvidence?.tokenStatus?.updatedAt, 'n/a'),
      mergeReadiness: asText(prEvidence?.mergeReadiness, 'wait'),
      missingProof: asList(prEvidence?.missingProof),
      nextAction: asText(prEvidence?.recommendedNextAction, 'Collect PR evidence.'),
      projectionIntegrity: asText(prEvidence?.projectionIntegrity, 'complete'),
      fetchAttempted: asText(prEvidence?.fetchDiagnostics?.github_pr_evidence_fetch_attempted, 'no'),
      fetchUrlOrMode: asText(prEvidence?.fetchDiagnostics?.github_pr_evidence_fetch_url_or_mode, 'none'),
      backendStatus: asText(prEvidence?.fetchDiagnostics?.github_pr_evidence_backend_status, 'unknown'),
      backendSource: asText(prEvidence?.fetchDiagnostics?.github_pr_evidence_backend_source, 'none'),
      backendRepo: asText(prEvidence?.fetchDiagnostics?.github_pr_evidence_backend_repo, 'unknown'),
      backendTitlePresent: asText(prEvidence?.fetchDiagnostics?.github_pr_evidence_backend_title_present, 'no'),
      backendTokenConfigured: asText(prEvidence?.fetchDiagnostics?.github_pr_evidence_backend_token_configured, 'no'),
      backendPayloadKeys: asText(prEvidence?.fetchDiagnostics?.github_pr_evidence_backend_payload_keys, 'none'),
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
    command_envelope_continuity_used: envelope?.chatContinuity?.continuityUsed ? 'yes' : 'no',
    command_envelope_agent_context_used: envelope?.agentContext?.agentContextUsed ? 'yes' : 'no',
    command_envelope_recommended_agents: asList(envelope?.agentContext?.recommendedAgents).join('|') || 'none',
    chat_continuity_seeded_from_existing_history: asText(envelope?.chatContinuity?.seededFromExistingHistory, 'no'),
    chat_continuity_source: asText(envelope?.chatContinuity?.continuitySource, 'none'),
    chat_continuity_summary_count: Number(envelope?.chatContinuity?.summaryCount || 0),
    chat_continuity_raw_transcript_stored: asText(envelope?.chatContinuity?.rawTranscriptStored, 'no'),
    command_envelope_operator_profile_used: asText(envelope?.operatorProfile?.used, 'no'),
    command_envelope_operator_name_known: asText(envelope?.operatorProfile?.known, 'no'),
    command_envelope_operator_name: asText(envelope?.operatorProfile?.operatorName, 'unknown'),
    command_envelope_operator_identity_source: asText(envelope?.operatorProfile?.source, 'none'),
    command_envelope_operator_identity_confidence: asText(envelope?.operatorProfile?.confidence, 'unknown'),
    command_envelope_codex_dispatch_packet_id: asText(envelope?.codexDispatch?.packetId, 'none'),
    command_envelope_codex_dispatch_status: asText(envelope?.codexDispatch?.status, 'not-ready'),
    command_envelope_codex_dispatch_approval_required: asText(envelope?.codexDispatch?.approvalRequired, 'yes'),
    command_envelope_operator_approval_required: asText(envelope?.codexDispatch?.approvalRequired, 'yes'),
    command_envelope_codex_dispatch_target_subsystems: asList(envelope?.codexDispatch?.targetSubsystems).join('|') || 'none',
    command_envelope_repair_loop_status: asText(envelope?.proof?.missionRepairLoopStatus || envelope?.missionRepairLoopStatus, 'unknown'),
    command_envelope_pr_evidence_status: asText(envelope?.prEvidence?.status, 'none'),
    command_envelope_pr_number: asText(envelope?.prEvidence?.prNumber, 'unknown'),
    command_envelope_pr_repo: asText(envelope?.prEvidence?.repo, 'unknown'),
    command_envelope_pr_evidence_parsed_pr_number: asText(envelope?.prEvidence?.parsedPrNumber, asText(envelope?.prEvidence?.prNumber, 'unknown')),
    command_envelope_pr_url: asText(envelope?.prEvidence?.prUrl, 'n/a'),
    command_envelope_pr_parse_confidence: asText(envelope?.prEvidence?.parseConfidence, 'none'),
    command_envelope_pr_evidence_parse_input: asText(envelope?.prEvidence?.parseInput, 'n/a'),
    command_envelope_pr_evidence_parsed_number_source: asText(envelope?.prEvidence?.parsedNumberSource, 'none'),
    command_envelope_pr_evidence_provider_output_number: asText(envelope?.prEvidence?.prNumber, asText(envelope?.prEvidence?.parsedPrNumber, 'unknown')),
    pr_evidence_parse_input: asText(envelope?.prEvidence?.parseInput, 'n/a'),
    pr_evidence_parsed_number_source: asText(envelope?.prEvidence?.parsedNumberSource, 'none'),
    pr_evidence_provider_output_number: asText(envelope?.prEvidence?.prNumber, asText(envelope?.prEvidence?.parsedPrNumber, 'unknown')),
    command_envelope_pr_checks_status: asText(envelope?.prEvidence?.checksStatus, 'unknown'),
    command_envelope_pr_head_sha: asText(envelope?.prEvidence?.headSha, 'n/a'),
    command_envelope_pr_changed_file_count: asText(envelope?.prEvidence?.changedFileCount, '0'),
    command_envelope_pr_merge_readiness: asText(envelope?.prEvidence?.mergeReadiness, 'wait'),
    command_envelope_pr_missing_proof: asList(envelope?.prEvidence?.missingProof).join('|') || 'none',
    command_envelope_pr_next_action: asText(envelope?.prEvidence?.nextAction, 'Collect PR evidence.'),
    pr_evidence_parsed_pr_number: asText(envelope?.prEvidence?.parsedPrNumber, asText(envelope?.prEvidence?.prNumber, 'unknown')),
    github_pr_evidence_number: asText(envelope?.prEvidence?.prNumber, asText(envelope?.prEvidence?.parsedPrNumber, 'unknown')),
    github_pr_evidence_provider_status: asText(envelope?.prEvidence?.status, 'none'),
    github_pr_evidence_source: asText(envelope?.prEvidence?.source, 'none'),
    github_pr_evidence_title: asText(envelope?.prEvidence?.prTitle, 'n/a'),
    github_pr_evidence_state: asText(envelope?.prEvidence?.prState, 'unknown'),
    github_pr_evidence_merged: asText(envelope?.prEvidence?.merged, 'no'),
    github_pr_evidence_checks_status: asText(envelope?.prEvidence?.checksStatus, 'unknown'),
    github_pr_evidence_build_status: asText(envelope?.prEvidence?.buildStatus, 'unknown'),
    github_pr_evidence_verify_status: asText(envelope?.prEvidence?.verifyStatus, 'unknown'),
    github_pr_evidence_retrieved_at: asText(envelope?.prEvidence?.retrievedAt, 'n/a'),
    github_token_configured: asText(envelope?.prEvidence?.tokenConfigured, 'no'),
    github_token_authority: asText(envelope?.prEvidence?.tokenAuthority, 'none'),
    github_token_masked: asText(envelope?.prEvidence?.tokenMasked, 'n/a'),
    github_token_updated_at: asText(envelope?.prEvidence?.tokenUpdatedAt, 'n/a'),
    github_pr_evidence_projection_integrity: asText(envelope?.prEvidence?.projectionIntegrity, 'complete'),
    github_pr_evidence_fetch_attempted: asText(envelope?.prEvidence?.fetchAttempted, 'no'),
    github_pr_evidence_fetch_url_or_mode: asText(envelope?.prEvidence?.fetchUrlOrMode, 'none'),
    github_pr_evidence_backend_status: asText(envelope?.prEvidence?.backendStatus, 'unknown'),
    github_pr_evidence_backend_source: asText(envelope?.prEvidence?.backendSource, 'none'),
    github_pr_evidence_backend_repo: asText(envelope?.prEvidence?.backendRepo, 'unknown'),
    github_pr_evidence_backend_title_present: asText(envelope?.prEvidence?.backendTitlePresent, 'no'),
    github_pr_evidence_backend_token_configured: asText(envelope?.prEvidence?.backendTokenConfigured, 'no'),
    github_pr_evidence_backend_payload_keys: asText(envelope?.prEvidence?.backendPayloadKeys, 'none'),
    command_envelope_github_token_configured: asText(envelope?.prEvidence?.tokenConfigured, 'no'),
    command_envelope_github_token_authority: asText(envelope?.prEvidence?.tokenAuthority, 'none'),
    command_envelope_github_token_masked: asText(envelope?.prEvidence?.tokenMasked, 'n/a'),
    command_envelope_github_token_updated_at: asText(envelope?.prEvidence?.tokenUpdatedAt, 'n/a'),
  };
}
export function projectEnvelopeToSupportSnapshot(envelope = {}) { return projectEnvelopeToExecutionMetadata(envelope); }
