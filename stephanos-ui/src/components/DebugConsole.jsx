import { buildProviderEndpoint } from '../ai/providerConfig';
import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';

export default function DebugConsole() {
  const {
    debugVisible,
    debugData,
    provider,
    providerSelectionSource,
    getActiveProviderConfig,
    getActiveProviderConfigSource,
    apiStatus,
    uiDiagnostics,
    providerHealth,
    uiLayout,
    togglePanel,
  } = useAIStore();
  if (!debugVisible) return null;

  const activeConfig = getActiveProviderConfig();
  const executionMetadata = debugData.execution_metadata || {};

  return (
    <CollapsiblePanel
      panelId="debugConsole"
      title="Developer Debug Console"
      description="Request, routing, and runtime traces for debugging Stephanos."
      className="debug-console"
      isOpen={uiLayout.debugConsole}
      onToggle={() => togglePanel('debugConsole')}
    >
      <div className="debug-grid">
        <div><strong>Request</strong><pre>{JSON.stringify({ request_id: debugData.response_payload?.debug?.request_id, parsed_command: debugData.parsed_command, ui_requested_provider: debugData.ui_requested_provider || debugData.request_payload?.provider, backend_default_provider: debugData.backend_default_provider || apiStatus.backendDefaultProvider, requested_provider: debugData.requested_provider || debugData.request_payload?.provider, selected_provider: debugData.selected_provider, actual_provider_used: debugData.actual_provider_used }, null, 2)}</pre></div>
        <div><strong>Routing</strong><pre>{JSON.stringify({ provider, provider_router: debugData.provider_diagnostics, health: providerHealth[provider] }, null, 2)}</pre></div>
        <div><strong>Execution</strong><pre>{JSON.stringify({ ui_requested_provider: executionMetadata.ui_requested_provider, backend_default_provider: executionMetadata.backend_default_provider, requested_provider: executionMetadata.requested_provider, selected_provider: executionMetadata.selected_provider, actual_provider_used: executionMetadata.actual_provider_used, model_used: executionMetadata.model_used, ollama_model_default: executionMetadata.ollama_model_default, ollama_model_preferred: executionMetadata.ollama_model_preferred, ollama_model_requested: executionMetadata.ollama_model_requested, ollama_model_selected: executionMetadata.ollama_model_selected, ollama_reasoning_mode: executionMetadata.ollama_reasoning_mode, ollama_escalation_active: executionMetadata.ollama_escalation_active, ollama_escalation_reason: executionMetadata.ollama_escalation_reason, ollama_fallback_model: executionMetadata.ollama_fallback_model, ollama_fallback_model_used: executionMetadata.ollama_fallback_model_used, ollama_fallback_reason: executionMetadata.ollama_fallback_reason, ollama_timeout_ms: executionMetadata.ollama_timeout_ms, ollama_timeout_source: executionMetadata.ollama_timeout_source, ollama_timeout_model: executionMetadata.ollama_timeout_model, fallback_used: executionMetadata.fallback_used, fallback_reason: executionMetadata.fallback_reason, freshness_need: executionMetadata.freshness_need, freshness_reason: executionMetadata.freshness_reason, stale_risk: executionMetadata.stale_risk, selected_answer_mode: executionMetadata.selected_answer_mode, freshness_warning: executionMetadata.freshness_warning, freshness_routed: executionMetadata.freshness_routed, retrieval_mode: executionMetadata.retrieval_mode, retrieval_eligible: executionMetadata.retrieval_eligible, retrieval_used: executionMetadata.retrieval_used, retrieval_reason: executionMetadata.retrieval_reason, retrieved_chunk_count: executionMetadata.retrieved_chunk_count, retrieved_sources: executionMetadata.retrieved_sources, retrieval_query: executionMetadata.retrieval_query, retrieval_index_status: executionMetadata.retrieval_index_status, memory_eligible: executionMetadata.memory_eligible, memory_promoted: executionMetadata.memory_promoted, memory_reason: executionMetadata.memory_reason, memory_source_type: executionMetadata.memory_source_type, memory_source_ref: executionMetadata.memory_source_ref, memory_confidence: executionMetadata.memory_confidence, memory_class: executionMetadata.memory_class, tile_action_type: executionMetadata.tile_action_type, tile_source: executionMetadata.tile_source, memory_candidate_submitted: executionMetadata.memory_candidate_submitted, retrieval_contribution_submitted: executionMetadata.retrieval_contribution_submitted, retrieval_ingested: executionMetadata.retrieval_ingested, retrieval_source_ref: executionMetadata.retrieval_source_ref, timing_ms: debugData.timing_ms, error: debugData.error, error_code: debugData.error_code }, null, 2)}</pre></div>
        <div><strong>Connectivity</strong><pre>{JSON.stringify({ backendReachable: apiStatus.backendReachable, backendTargetEndpoint: apiStatus.backendTargetEndpoint, backendHealthEndpoint: apiStatus.healthEndpoint, backendDefaultProvider: apiStatus.backendDefaultProvider }, null, 2)}</pre></div>
      </div>

      <div className="debug-grid">
        <div><strong>Provider Runtime</strong><pre>{JSON.stringify({ provider, providerSelectionSource, activeProviderConfigSource: getActiveProviderConfigSource(), activeConfig, resolvedEndpoint: buildProviderEndpoint(activeConfig.baseURL || '', '/api/chat'), frontendApiBaseUrl: apiStatus.baseUrl, providerToggleMounted: uiDiagnostics.providerToggleMounted }, null, 2)}</pre></div>
        <div><strong>UI Runtime</strong><pre>{JSON.stringify(uiDiagnostics, null, 2)}</pre></div>
      </div>

      <details>
        <summary>Latest Request Payload</summary>
        <pre>{JSON.stringify(debugData.request_payload, null, 2)}</pre>
      </details>
      <details>
        <summary>Latest Response Payload</summary>
        <pre>{JSON.stringify(debugData.response_payload, null, 2)}</pre>
      </details>
      <details>
        <summary>Latest Request Trace</summary>
        <pre>{JSON.stringify(debugData.request_trace, null, 2)}</pre>
      </details>
    </CollapsiblePanel>
  );
}
