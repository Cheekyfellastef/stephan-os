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
        <div><strong>Execution</strong><pre>{JSON.stringify({ ui_requested_provider: executionMetadata.ui_requested_provider, backend_default_provider: executionMetadata.backend_default_provider, requested_provider: executionMetadata.requested_provider, selected_provider: executionMetadata.selected_provider, actual_provider_used: executionMetadata.actual_provider_used, model_used: executionMetadata.model_used, fallback_used: executionMetadata.fallback_used, fallback_reason: executionMetadata.fallback_reason, timing_ms: debugData.timing_ms, error: debugData.error, error_code: debugData.error_code }, null, 2)}</pre></div>
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
