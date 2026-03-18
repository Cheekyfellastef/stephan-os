import { buildProviderEndpoint } from '../ai/providerConfig';
import { useAIStore } from '../state/aiStore';

export default function DebugConsole() {
  const {
    debugVisible,
    debugData,
    provider,
    providerDraftStatus,
    providerSelectionSource,
    getActiveProviderConfig,
    getActiveProviderConfigSource,
    apiStatus,
    uiDiagnostics,
  } = useAIStore();
  if (!debugVisible) return null;

  const activeConfig = getActiveProviderConfig();

  return (
    <section className="debug-console panel">
      <h2>Developer Debug Console</h2>
      <div className="debug-grid">
        <div><strong>Request</strong><pre>{JSON.stringify({ request_id: debugData.response_payload?.debug?.request_id, parsed_command: debugData.parsed_command }, null, 2)}</pre></div>
        <div><strong>Routing</strong><pre>{JSON.stringify({ subsystem: debugData.selected_subsystem, route: debugData.selected_route, tool: debugData.selected_tool, subsystem_state: debugData.subsystem_state, provider_router: debugData.backend_provider_router }, null, 2)}</pre></div>
        <div><strong>Execution</strong><pre>{JSON.stringify({ execution_payload: debugData.execution_payload, simulation_id: debugData.simulation_id, validated_input: debugData.validated_input, storage_outcome: debugData.storage_outcome }, null, 2)}</pre></div>
        <div><strong>Result</strong><pre>{JSON.stringify({ result_summary: debugData.result_summary, timing_ms: debugData.timing_ms, tool_timing_ms: debugData.tool_timing_ms }, null, 2)}</pre></div>
        <div><strong>Memory</strong><pre>{JSON.stringify({ memory_hits: debugData.memory_hits }, null, 2)}</pre></div>
        <div><strong>Errors</strong><pre>{JSON.stringify({ error_code: debugData.error_code, error: debugData.error }, null, 2)}</pre></div>
      </div>

      <div className="debug-grid">
        <div><strong>Connectivity</strong><pre>{JSON.stringify({
          frontendOrigin: apiStatus.frontendOrigin || debugData.frontend_origin,
          frontendApiBaseUrl: apiStatus.baseUrl || debugData.frontend_api_base_url,
          apiBaseUrlStrategy: apiStatus.strategy,
          backendReachable: apiStatus.backendReachable,
          backendTargetEndpoint: apiStatus.backendTargetEndpoint || debugData.backend_target_endpoint,
          backendHealthEndpoint: apiStatus.healthEndpoint || debugData.backend_health_endpoint,
          backendDefaultProvider: apiStatus.backendDefaultProvider || apiStatus.meta?.default_provider,
          activeProvider: provider,
          providerTarget: 'browser -> Stephanos backend only',
          resolvedOllamaEndpoint: apiStatus.resolvedOllamaEndpoint || apiStatus.meta?.ollama_endpoint,
          corsAllowedOrigins: apiStatus.corsAllowedOrigins,
          providerRouterPath: apiStatus.providerRouterPath,
          backendHealthMeta: apiStatus.meta,
        }, null, 2)}</pre></div>
        <div><strong>Provider Runtime</strong><pre>{JSON.stringify({
          provider,
          providerSelectionSource,
          configMode: provider === 'custom' ? providerDraftStatus.custom.mode : 'saved',
          activeProviderConfigSource: getActiveProviderConfigSource(),
          activeConfig,
          resolvedEndpoint: buildProviderEndpoint(activeConfig.baseUrl || '', activeConfig.chatEndpoint || ''),
          frontendApiBaseUrl: apiStatus.baseUrl,
          backendDefaultProvider: apiStatus.meta?.default_provider,
          backendProviderDefaults: apiStatus.meta?.provider_defaults,
          lastProviderDiagnostics: debugData.provider_diagnostics,
          providerToggleMounted: uiDiagnostics.providerToggleMounted,
          appRootRendered: uiDiagnostics.appRootRendered,
          aiConsoleRendered: uiDiagnostics.aiConsoleRendered,
          componentMarker: uiDiagnostics.componentMarker,
          providerToggleMarker: uiDiagnostics.providerToggleMarker,
        }, null, 2)}</pre></div>
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
