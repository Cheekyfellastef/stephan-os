import { buildProviderEndpoint } from '../ai/providerConfig';
import { useAIStore } from '../state/aiStore';

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
  } = useAIStore();
  if (!debugVisible) return null;

  const activeConfig = getActiveProviderConfig();
  const executionMetadata = debugData.execution_metadata || {};

  return (
    <section className="debug-console panel">
      <h2>Developer Debug Console</h2>
      <div className="debug-grid">
        <div><strong>Request</strong><pre>{JSON.stringify({ request_id: debugData.response_payload?.debug?.request_id, parsed_command: debugData.parsed_command, requested_provider: debugData.requested_provider || debugData.request_payload?.provider }, null, 2)}</pre></div>
        <div><strong>Routing</strong><pre>{JSON.stringify({ provider, provider_router: debugData.provider_diagnostics, health: providerHealth[provider] }, null, 2)}</pre></div>
        <div><strong>Execution</strong><pre>{JSON.stringify({ requested_provider: executionMetadata.requested_provider, actual_provider_used: executionMetadata.actual_provider_used, model_used: executionMetadata.model_used, fallback_used: executionMetadata.fallback_used, fallback_reason: executionMetadata.fallback_reason, timing_ms: debugData.timing_ms, error: debugData.error, error_code: debugData.error_code }, null, 2)}</pre></div>
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
    </section>
  );
}
