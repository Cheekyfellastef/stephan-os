import { useCallback, useEffect, useState } from 'react';
import { parseCommand } from '../ai/commandParser';
import { checkApiHealth, getApiRuntimeConfig, getProviderHealth, sendPrompt } from '../ai/aiClient';
import { buildProviderDisplayLabel } from '../ai/providerConfig';
import { useAIStore } from '../state/aiStore';

const BACKEND_UNREACHABLE_MESSAGE = 'Backend unreachable from current frontend origin.';

function transportErrorToUi(error) {
  if (!error?.code) {
    return { error: 'Unexpected transport error.', errorCode: 'UNKNOWN_TRANSPORT_ERROR', output: 'Unable to process request due to an unknown network issue.' };
  }
  if (error.code === 'BACKEND_OFFLINE') {
    return { error: error.message, errorCode: error.code, output: `${BACKEND_UNREACHABLE_MESSAGE} Start stephanos-server or update VITE_API_BASE_URL to a reachable API.` };
  }
  if (error.code === 'TIMEOUT') {
    return { error: error.message, errorCode: error.code, output: 'Request timed out. Try again or increase VITE_API_TIMEOUT_MS.' };
  }
  if (error.code === 'INVALID_JSON') {
    return { error: error.message, errorCode: error.code, output: 'Backend responded with invalid JSON. Check server logs for serialization issues.' };
  }
  return { error: error.message, errorCode: error.code, output: error.message };
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
    devMode,
    fallbackEnabled,
    fallbackOrder,
    savedProviderConfigs,
    providerSelectionSource,
    getActiveProviderConfigSource,
    setProviderHealth,
  } = useAIStore();

  const runtimeConfig = getApiRuntimeConfig();

  const refreshHealth = useCallback(async () => {
    try {
      const health = await checkApiHealth();
      const providerHealth = await getProviderHealth({ provider, providerConfigs: savedProviderConfigs, fallbackEnabled, fallbackOrder, devMode });
      setProviderHealth(providerHealth.data || {});
      setApiStatus({
        state: health.ok ? 'online' : 'error',
        label: `Connected to ${health.target} API`,
        detail: health.ok
          ? `Backend reachable. Default provider: ${health.data?.default_provider || 'mock'}.`
          : `Health check failed (${health.status}).`,
        target: health.target,
        baseUrl: health.baseUrl,
        frontendOrigin: runtimeConfig.frontendOrigin,
        strategy: runtimeConfig.strategy,
        backendTargetEndpoint: health.data?.backend_target_endpoint || runtimeConfig.backendTargetEndpoint,
        healthEndpoint: runtimeConfig.healthEndpoint,
        backendReachable: health.ok,
        backendDefaultProvider: health.data?.default_provider || 'mock',
        lastCheckedAt: new Date().toISOString(),
        meta: health.data,
      });
    } catch (error) {
      const uiError = transportErrorToUi(error);
      setApiStatus({
        state: 'offline',
        label: 'Backend offline',
        detail: uiError.output,
        target: runtimeConfig.target,
        baseUrl: runtimeConfig.baseUrl,
        frontendOrigin: runtimeConfig.frontendOrigin,
        strategy: runtimeConfig.strategy,
        backendTargetEndpoint: runtimeConfig.backendTargetEndpoint,
        healthEndpoint: runtimeConfig.healthEndpoint,
        backendReachable: false,
        backendDefaultProvider: 'unknown',
        lastCheckedAt: new Date().toISOString(),
        meta: null,
      });
    }
  }, [runtimeConfig, setApiStatus, provider, savedProviderConfigs, fallbackEnabled, fallbackOrder, devMode, setProviderHealth]);

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
      const { data, requestPayload } = await sendPrompt({
        prompt,
        provider,
        providerConfigs: savedProviderConfigs,
        fallbackEnabled,
        fallbackOrder,
        devMode,
      });

      const providerHealth = data.data?.provider_health || {};
      if (Object.keys(providerHealth).length) {
        setProviderHealth(providerHealth);
      }

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

      setCommandHistory((prev) => [...prev, entry]);
      setLastRoute(data.route || 'assistant');
      setStatus(data.success ? 'ok' : 'error');

      const activeProviderLabel = buildProviderDisplayLabel(provider, savedProviderConfigs[provider]);
      const providerMessage = !data.success && provider !== 'mock'
        ? `${data.error || 'Provider failed.'} Use Mock instead if you want a zero-cost response.`
        : data.output_text;

      setApiStatus((prev) => ({
        ...prev,
        state: 'online',
        label: `Connected to ${runtimeConfig.target} API`,
        detail: data.success
          ? `Backend reachable. Active provider: ${activeProviderLabel}.`
          : `Provider issue: ${providerMessage}`,
        backendReachable: true,
        lastCheckedAt: new Date().toISOString(),
      }));

      setDebugData({
        request_payload: requestPayload,
        response_payload: data,
        parsed_command: parsed,
        providerSelectionSource,
        activeProviderConfigSource: getActiveProviderConfigSource(),
        provider_health: providerHealth,
        provider_diagnostics: data.data?.provider_diagnostics || null,
        frontend_origin: runtimeConfig.frontendOrigin,
        frontend_api_base_url: runtimeConfig.baseUrl,
        backend_target_endpoint: runtimeConfig.backendTargetEndpoint,
        backend_health_endpoint: runtimeConfig.healthEndpoint,
      });
    } catch (error) {
      const uiError = transportErrorToUi(error);
      setStatus('error');
      setApiStatus((prev) => ({ ...prev, state: 'offline', label: 'Backend offline', detail: uiError.output, backendReachable: false, lastCheckedAt: new Date().toISOString() }));

      setCommandHistory((prev) => [...prev, {
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
        response: { type: 'assistant_response', route: 'assistant', success: false, output_text: uiError.output, error: uiError.error, error_code: uiError.errorCode },
      }]);
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

  return { input, setInput, commandHistory, submitPrompt, clearConsole, refreshHealth };
}
