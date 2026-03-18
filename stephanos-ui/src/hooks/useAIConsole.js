import { useCallback, useEffect, useState } from 'react';
import { parseCommand } from '../ai/commandParser';
import { checkApiHealth, getApiRuntimeConfig, sendPrompt } from '../ai/aiClient';
import { buildProviderDisplayLabel, buildProviderEndpoint } from '../ai/providerConfig';
import { useAIStore } from '../state/aiStore';

const BACKEND_UNREACHABLE_MESSAGE = 'Backend unreachable from current frontend origin.';

function transportErrorToUi(error) {
  if (!error?.code) {
    return {
      error: 'Unexpected transport error.',
      errorCode: 'UNKNOWN_TRANSPORT_ERROR',
      output: 'Unable to process request due to an unknown network issue.',
    };
  }

  const fallback = {
    error: error.message,
    errorCode: error.code,
    output: error.message,
  };

  if (error.code === 'BACKEND_OFFLINE') {
    return {
      error: error.message,
      errorCode: error.code,
      output: `${BACKEND_UNREACHABLE_MESSAGE} Start stephanos-server or update VITE_API_BASE_URL to a reachable API.`,
    };
  }

  if (error.code === 'TIMEOUT') {
    return {
      error: error.message,
      errorCode: error.code,
      output: 'Request timed out. Try again or increase VITE_API_TIMEOUT_MS.',
    };
  }

  if (error.code === 'INVALID_JSON') {
    return {
      error: error.message,
      errorCode: error.code,
      output: 'Backend responded with invalid JSON. Check server logs for serialization issues.',
    };
  }

  return fallback;
}

export function useAIConsole() {
  const [input, setInput] = useState('');
  const {
    commandHistory,
    setCommandHistory,
    setIsBusy,
    setStatus,
    setLastRoute,
    setDebugData,
    setApiStatus,
    provider,
    providerDraftStatus,
    providerSelectionSource,
    getActiveProviderConfig,
    getActiveProviderConfigSource,
  } = useAIStore();

  const runtimeConfig = getApiRuntimeConfig();

  const refreshHealth = useCallback(async () => {
    try {
      const health = await checkApiHealth();
      const backendDefaults = health.data?.provider_defaults;
      const defaultOllamaEndpoint = buildProviderEndpoint(
        backendDefaults?.ollama?.baseUrl,
        backendDefaults?.ollama?.chatEndpoint,
      );

      setApiStatus({
        state: health.ok ? 'online' : 'error',
        label: `Connected to ${health.target} API`,
        target: health.target,
        baseUrl: health.baseUrl,
        frontendOrigin: runtimeConfig.frontendOrigin,
        strategy: runtimeConfig.strategy,
        backendTargetEndpoint: health.data?.backend_target_endpoint || runtimeConfig.backendTargetEndpoint,
        healthEndpoint: runtimeConfig.healthEndpoint,
        backendReachable: health.ok,
        backendDefaultProvider: health.data?.default_provider || 'unknown',
        resolvedOllamaEndpoint: health.data?.ollama_endpoint || defaultOllamaEndpoint,
        corsAllowedOrigins: health.data?.cors?.allowed_origins || [],
        providerRouterPath: health.data?.provider_router_path || 'browser -> /api/ai/chat -> provider router -> ollama/openai/custom',
        lastCheckedAt: new Date().toISOString(),
        detail: health.ok
          ? `Backend reachable. Default provider: ${health.data?.default_provider || 'unknown'}. Ollama target: ${health.data?.ollama_endpoint || defaultOllamaEndpoint}.`
          : `Health check failed (${health.status}).`,
        meta: health.data,
      });
    } catch (error) {
      const uiError = transportErrorToUi(error);
      setApiStatus({
        state: 'offline',
        label: 'Backend offline',
        target: runtimeConfig.target,
        baseUrl: runtimeConfig.baseUrl,
        frontendOrigin: runtimeConfig.frontendOrigin,
        strategy: runtimeConfig.strategy,
        backendTargetEndpoint: runtimeConfig.backendTargetEndpoint,
        healthEndpoint: runtimeConfig.healthEndpoint,
        backendReachable: false,
        backendDefaultProvider: 'unknown',
        resolvedOllamaEndpoint: 'http://127.0.0.1:11434/api/chat',
        corsAllowedOrigins: [],
        providerRouterPath: 'browser -> /api/ai/chat -> provider router -> ollama/openai/custom',
        lastCheckedAt: new Date().toISOString(),
        detail: uiError.output,
        meta: null,
      });
    }
  }, [runtimeConfig, setApiStatus]);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  async function submitPrompt(rawPrompt) {
    const prompt = rawPrompt.trim();
    if (!prompt) return;

    if (prompt === '/clear') {
      clearConsole();
      return;
    }

    const parsed = parseCommand(prompt);
    const startedAt = performance.now();

    setIsBusy(true);
    setStatus('processing');

    try {
      const activeProviderConfig = getActiveProviderConfig();
      const { data, requestPayload } = await sendPrompt({
        prompt,
        provider,
        providerConfig: provider === 'openai' ? null : activeProviderConfig,
      });
      const entry = {
        id: `cmd_${Date.now()}`,
        raw_input: prompt,
        parsed_command: parsed,
        route: data.route,
        tool_used: data.tools_used?.[0] ?? null,
        success: data.success,
        output_text: data.output_text,
        data_payload: data.data,
        timing_ms: data.timing_ms ?? Math.round(performance.now() - startedAt),
        timestamp: new Date().toISOString(),
        error: data.error,
        error_code: data.error_code ?? data.debug?.error_code ?? null,
        response: data,
      };

      const activeProviderLabel = buildProviderDisplayLabel(provider, getActiveProviderConfig());
      const providerDiagnostics = data.data?.provider_diagnostics || null;
      const providerSpecificDetail = provider === 'ollama' && !data.success
        ? `Local Ollama not reachable at ${activeProviderConfig.baseUrl || 'http://127.0.0.1:11434'}. Start Ollama with: ollama serve`
        : data.output_text;

      setCommandHistory((prev) => [...prev, entry]);
      setLastRoute(data.route || 'assistant');
      setStatus(data.success ? 'ok' : 'error');
      setApiStatus((prev) => ({
        ...prev,
        state: 'online',
        label: `Connected to ${runtimeConfig.target} API`,
        target: runtimeConfig.target,
        baseUrl: runtimeConfig.baseUrl,
        frontendOrigin: runtimeConfig.frontendOrigin,
        strategy: runtimeConfig.strategy,
        backendTargetEndpoint: prev.backendTargetEndpoint || runtimeConfig.backendTargetEndpoint,
        healthEndpoint: runtimeConfig.healthEndpoint,
        backendReachable: true,
        backendDefaultProvider: prev.backendDefaultProvider || prev.meta?.default_provider || 'unknown',
        resolvedOllamaEndpoint: prev.resolvedOllamaEndpoint || prev.meta?.ollama_endpoint || 'http://127.0.0.1:11434/api/chat',
        corsAllowedOrigins: prev.corsAllowedOrigins || prev.meta?.cors?.allowed_origins || [],
        providerRouterPath: prev.providerRouterPath || prev.meta?.provider_router_path || 'browser -> /api/ai/chat -> provider router -> ollama/openai/custom',
        detail: data.success
          ? `Backend reachable. Active provider: ${activeProviderLabel}. Backend target: ${prev.backendTargetEndpoint || runtimeConfig.backendTargetEndpoint}.`
          : `Active provider (${activeProviderLabel}) error: ${providerSpecificDetail}`,
        configMode: provider === 'custom' ? providerDraftStatus.custom.mode : 'saved',
        lastCheckedAt: new Date().toISOString(),
      }));
      setDebugData({
        request_payload: requestPayload,
        response_payload: data,
        parsed_command: parsed,
        selected_route: data.route,
        selected_subsystem: data.debug?.selected_subsystem,
        selected_tool: data.debug?.selected_tool ?? data.tools_used?.[0] ?? null,
        execution_payload: data.debug?.execution_payload,
        simulation_id: data.data?.simulationId ?? null,
        validated_input: data.data?.input ?? null,
        result_summary: data.debug?.result_summary,
        storage_outcome: data.debug?.storage_outcome,
        memory_hits: data.memory_hits,
        timing_ms: entry.timing_ms,
        tool_timing_ms: data.debug?.timing?.tool_ms,
        subsystem_state: data.debug?.subsystem_state,
        error: data.error,
        error_code: data.error_code ?? data.debug?.error_code ?? null,
        providerSelectionSource,
        activeProviderConfigSource: getActiveProviderConfigSource(),
        provider_diagnostics: providerDiagnostics,
        backend_provider_router: data.debug?.provider_router ?? null,
        frontend_origin: runtimeConfig.frontendOrigin,
        frontend_api_base_url: runtimeConfig.baseUrl,
        backend_target_endpoint: runtimeConfig.backendTargetEndpoint,
        backend_health_endpoint: runtimeConfig.healthEndpoint,
      });
    } catch (error) {
      const uiError = transportErrorToUi(error);
      setStatus('error');
      setApiStatus((prev) => ({
        ...prev,
        state: 'offline',
        label: 'Backend offline',
        frontendOrigin: runtimeConfig.frontendOrigin,
        strategy: runtimeConfig.strategy,
        backendTargetEndpoint: runtimeConfig.backendTargetEndpoint,
        healthEndpoint: runtimeConfig.healthEndpoint,
        backendReachable: false,
        detail: uiError.output,
        configMode: provider === 'custom' ? providerDraftStatus.custom.mode : 'saved',
        lastCheckedAt: new Date().toISOString(),
      }));

      const failureEntry = {
        id: `cmd_${Date.now()}`,
        raw_input: prompt,
        parsed_command: parsed,
        route: 'assistant',
        tool_used: null,
        success: false,
        output_text: uiError.output,
        data_payload: null,
        timing_ms: Math.round(performance.now() - startedAt),
        timestamp: new Date().toISOString(),
        error: uiError.error,
        error_code: uiError.errorCode,
        response: {
          type: 'assistant_response',
          route: 'assistant',
          success: false,
          output_text: uiError.output,
          error: uiError.error,
          error_code: uiError.errorCode,
        },
      };

      setCommandHistory((prev) => [...prev, failureEntry]);
      setDebugData({
        parsed_command: parsed,
        error: uiError.error,
        error_code: uiError.errorCode,
        providerSelectionSource,
        activeProviderConfigSource: getActiveProviderConfigSource(),
        frontend_origin: runtimeConfig.frontendOrigin,
        frontend_api_base_url: runtimeConfig.baseUrl,
        backend_target_endpoint: runtimeConfig.backendTargetEndpoint,
        backend_health_endpoint: runtimeConfig.healthEndpoint,
      });
    } finally {
      setIsBusy(false);
    }
  }

  function clearConsole() {
    setCommandHistory([]);
    setStatus('idle');
    setLastRoute('assistant');
    setDebugData({});
    setInput('');
  }

  return {
    input,
    setInput,
    commandHistory,
    submitPrompt,
    clearConsole,
    refreshHealth,
  };
}
