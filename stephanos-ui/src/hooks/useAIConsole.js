import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCommand } from '../ai/commandParser';
import { checkApiHealth, getApiRuntimeConfig, getProviderHealth, sendPrompt } from '../ai/aiClient';
import { applyDetectedOllamaConnection, createSearchingOllamaHealth, runOllamaDiscovery, shouldAutoSyncOllama } from '../ai/ollamaRuntimeSync';
import {
  discoverStephanosHomeNode,
  summarizeStephanosHomeNode,
} from '../../../shared/runtime/stephanosHomeNode.mjs';
import { useAIStore } from '../state/aiStore';

const BACKEND_UNREACHABLE_MESSAGE = 'Backend unreachable from current frontend origin.';

function normalizeExecutionMetadata({ data, requestPayload, backendDefaultProvider }) {
  const executionMetadata = data.data?.execution_metadata || {};
  const requestTrace = data.data?.request_trace || {};
  const actualProviderUsed = executionMetadata.actual_provider_used || data.data?.actual_provider_used || data.data?.provider || null;
  const modelUsed = executionMetadata.model_used || data.data?.model_used || data.data?.provider_model || null;

  return {
    ui_requested_provider: executionMetadata.ui_requested_provider || requestTrace.ui_requested_provider || requestPayload.provider,
    backend_default_provider: executionMetadata.backend_default_provider || requestTrace.backend_default_provider || backendDefaultProvider || 'unknown',
    route_mode: executionMetadata.route_mode || requestTrace.route_mode || requestPayload.routeMode || 'auto',
    effective_route_mode: executionMetadata.effective_route_mode || requestTrace.effective_route_mode || requestPayload.routeMode || 'auto',
    requested_provider: executionMetadata.requested_provider || requestTrace.requested_provider || requestPayload.provider,
    selected_provider: executionMetadata.selected_provider || requestTrace.selected_provider || requestPayload.provider,
    actual_provider_used: actualProviderUsed,
    model_used: modelUsed,
    fallback_used: Boolean(executionMetadata.fallback_used ?? requestTrace.fallback_used ?? false),
    fallback_reason: executionMetadata.fallback_reason || requestTrace.fallback_reason || null,
  };
}

function deriveExecutionStatus(executionMetadata) {
  if (!executionMetadata?.actual_provider_used) {
    return 'ok';
  }

  if (executionMetadata.actual_provider_used === 'mock') {
    return executionMetadata.fallback_used ? 'mock-fallback' : 'mock';
  }

  return executionMetadata.fallback_used ? `fallback:${executionMetadata.actual_provider_used}` : `ok:${executionMetadata.actual_provider_used}`;
}

function buildExecutionSummary(executionMetadata) {
  const summaryPrefix = `UI route mode ${executionMetadata.route_mode}. Effective route ${executionMetadata.effective_route_mode}. UI requested ${executionMetadata.ui_requested_provider}. Backend default ${executionMetadata.backend_default_provider}. Requested ${executionMetadata.requested_provider}. Selected ${executionMetadata.selected_provider}. Executed ${executionMetadata.actual_provider_used}`;
  const modelSuffix = executionMetadata.model_used ? ` (${executionMetadata.model_used})` : '';

  if (executionMetadata.fallback_used) {
    return `${summaryPrefix}${modelSuffix}. Fallback used${executionMetadata.fallback_reason ? `: ${executionMetadata.fallback_reason}` : '.'}`;
  }

  if (executionMetadata.actual_provider_used === 'mock') {
    return `${summaryPrefix}${modelSuffix}. Mock answered directly.`;
  }

  return `${summaryPrefix}${modelSuffix}.`;
}

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
    routeMode,
    devMode,
    fallbackEnabled,
    fallbackOrder,
    providerSelectionSource,
    getActiveProviderConfigSource,
    getEffectiveProviderConfigs,
    getDraftProviderConfig,
    updateDraftProviderConfig,
    ollamaConnection,
    rememberSuccessfulOllamaConnection,
    homeNodePreference,
    homeNodeLastKnown,
    setHomeNodeLastKnown,
    setHomeNodeStatus,
    providerHealth,
    apiStatus,
    setProviderHealth,
    setLastExecutionMetadata,
  } = useAIStore();

  const runtimeConfig = getApiRuntimeConfig();
  const runtimeContext = runtimeConfig;
  const startupOllamaSyncAttemptedRef = useRef(false);


  const resolveRuntimeConfig = useCallback(async () => {
    const baseRuntimeConfig = getApiRuntimeConfig();
    const discovery = await discoverStephanosHomeNode({
      currentOrigin: baseRuntimeConfig.frontendOrigin,
      manualNode: homeNodePreference,
      lastKnownNode: homeNodeLastKnown,
      recentHosts: [
        ollamaConnection.lastSuccessfulHost,
        ...(ollamaConnection.recentHosts || []),
      ].filter(Boolean),
    });

    setHomeNodeStatus({
      state: discovery.reachable ? 'ready' : (homeNodePreference?.host || homeNodeLastKnown?.host ? 'unreachable' : 'idle'),
      detail: discovery.reachable
        ? `Using ${summarizeStephanosHomeNode(discovery.preferredNode)}.`
        : (homeNodePreference?.host || homeNodeLastKnown?.host
          ? 'Home PC node unreachable right now.'
          : 'No home PC node configured yet.'),
      attempts: discovery.attempts,
      node: discovery.preferredNode,
      source: discovery.source,
    });

    if (discovery.preferredNode) {
      setHomeNodeLastKnown(discovery.preferredNode);
    }

    const nextRuntimeConfig = getApiRuntimeConfig();
    return {
      runtimeConfig: {
        ...nextRuntimeConfig,
        homeNode: discovery.preferredNode || nextRuntimeConfig.homeNode || homeNodePreference || homeNodeLastKnown || null,
        nodeAddressSource: discovery.preferredNode?.source || discovery.source || nextRuntimeConfig.homeNode?.source || 'unknown',
        preferredTarget: discovery.preferredNode?.uiUrl || nextRuntimeConfig.homeNode?.uiUrl || nextRuntimeConfig.frontendOrigin,
        actualTargetUsed: discovery.preferredNode?.backendUrl || nextRuntimeConfig.baseUrl,
      },
      discovery,
    };
  }, [homeNodeLastKnown, homeNodePreference, ollamaConnection.lastSuccessfulHost, ollamaConnection.recentHosts, setHomeNodeLastKnown, setHomeNodeStatus]);


  const refreshHealth = useCallback(async () => {
    const effectiveProviderConfigs = getEffectiveProviderConfigs();
    try {
      const { runtimeConfig: resolvedRuntimeContext } = await resolveRuntimeConfig();
      const health = await checkApiHealth(resolvedRuntimeContext);
      const providerHealth = await getProviderHealth({ provider, routeMode, providerConfigs: effectiveProviderConfigs, fallbackEnabled, fallbackOrder, devMode, runtimeContext: resolvedRuntimeContext }, resolvedRuntimeContext);
      setProviderHealth(providerHealth.data || {});
      setApiStatus({
        state: health.ok ? 'online' : 'error',
        label: `Connected to ${health.target} API`,
        detail: health.ok
          ? `Backend reachable. Default provider: ${health.data?.default_provider || 'mock'}.`
          : `Health check failed (${health.status}).`,
        target: health.target,
        baseUrl: health.baseUrl,
        frontendOrigin: resolvedRuntimeContext.frontendOrigin,
        strategy: resolvedRuntimeContext.strategy,
        backendTargetEndpoint: health.data?.backend_target_endpoint || resolvedRuntimeContext.backendTargetEndpoint,
        healthEndpoint: resolvedRuntimeContext.healthEndpoint,
        backendReachable: health.ok,
        backendDefaultProvider: health.data?.default_provider || 'mock',
        runtimeContext: resolvedRuntimeContext,
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
  }, [runtimeConfig, runtimeContext, setApiStatus, provider, routeMode, getEffectiveProviderConfigs, fallbackEnabled, fallbackOrder, devMode, setProviderHealth, resolveRuntimeConfig]);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  useEffect(() => {
    if (startupOllamaSyncAttemptedRef.current) return;

    const effectiveProviderConfigs = getEffectiveProviderConfigs();
    const ollamaConfig = effectiveProviderConfigs.ollama || {};
    const ollamaHealth = providerHealth.ollama || {};

    if (!shouldAutoSyncOllama({ apiStatus, ollamaHealth, ollamaConfig })) {
      return;
    }

    startupOllamaSyncAttemptedRef.current = true;

    const startupSearchingHealth = createSearchingOllamaHealth({
      frontendOrigin: runtimeConfig.frontendOrigin,
    });

    setProviderHealth((prev) => ({
      ...prev,
      ollama: startupSearchingHealth,
    }));

    (async () => {
      const draftConfig = getDraftProviderConfig('ollama');
      const { result, searchingState } = await runOllamaDiscovery({
        runtimeConfig,
        ollamaConnection,
        draftConfig,
      });

      setProviderHealth((prev) => ({
        ...prev,
        ollama: {
          ...startupSearchingHealth,
          attempts: searchingState.attempts || [],
        },
      }));

      if (!result.success) {
        setProviderHealth((prev) => ({
          ...prev,
          ollama: {
            ...(prev.ollama || {}),
            ok: false,
            provider: 'ollama',
            badge: 'Offline',
            state: 'OFFLINE',
            message: 'Cannot connect to Ollama',
            detail: result.reason || 'Stephanos could not reach your Ollama server.',
            reason: result.reason || '',
            failureType: result.failureBucket || 'not_running',
            attempts: result.attempts || [],
          },
        }));
        return;
      }

      applyDetectedOllamaConnection({
        result,
        draftConfig,
        ollamaConnection,
        updateDraftProviderConfig,
        rememberSuccessfulOllamaConnection,
      });

      const nextModel = result.models.includes(draftConfig.model)
        ? draftConfig.model
        : (result.models[0] || draftConfig.model || ollamaConnection.lastSelectedModel || '');
      const nextProviderConfigs = {
        ...effectiveProviderConfigs,
        ollama: {
          ...ollamaConfig,
          ...draftConfig,
          baseURL: result.baseURL,
          model: nextModel,
        },
      };

      const { runtimeConfig: resolvedRuntimeContext } = await resolveRuntimeConfig();
      const refreshedProviderHealth = await getProviderHealth({
        provider,
        routeMode,
        providerConfigs: nextProviderConfigs,
        fallbackEnabled,
        fallbackOrder,
        devMode,
        runtimeContext: resolvedRuntimeContext,
      }, resolvedRuntimeContext);

      if (refreshedProviderHealth.data && Object.keys(refreshedProviderHealth.data).length) {
        setProviderHealth((prev) => ({
          ...prev,
          ...refreshedProviderHealth.data,
        }));
      }
    })().catch(() => {
      startupOllamaSyncAttemptedRef.current = false;
    });
  }, [
    apiStatus,
    devMode,
    fallbackEnabled,
    fallbackOrder,
    getDraftProviderConfig,
    getEffectiveProviderConfigs,
    ollamaConnection,
    provider,
    providerHealth,
    rememberSuccessfulOllamaConnection,
    resolveRuntimeConfig,
    runtimeConfig,
    setProviderHealth,
    updateDraftProviderConfig,
    routeMode,
    runtimeContext,
  ]);

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

    console.debug('[Stephanos UI] Preparing AI request', {
      requestedProvider: provider,
      selectedProvider: provider,
      providerConfigSource: getActiveProviderConfigSource(),
      providerSelectionSource,
      fallbackEnabled,
      fallbackOrder,
    });

    try {
      const effectiveProviderConfigs = getEffectiveProviderConfigs();
      const { runtimeConfig: resolvedRuntimeContext } = await resolveRuntimeConfig();
      const { data, requestPayload } = await sendPrompt({
        prompt,
        provider,
        routeMode,
        providerConfigs: effectiveProviderConfigs,
        fallbackEnabled,
        fallbackOrder,
        devMode,
        runtimeConfig: resolvedRuntimeContext,
      });

      const providerHealth = data.data?.provider_health || {};
      if (Object.keys(providerHealth).length) {
        setProviderHealth(providerHealth);
      }

      const executionMetadata = normalizeExecutionMetadata({
        data,
        requestPayload,
        backendDefaultProvider: apiStatus.backendDefaultProvider,
      });

      console.debug('[Stephanos UI] Received AI response', executionMetadata);

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
      setStatus(data.success ? deriveExecutionStatus(executionMetadata) : 'error');

      const providerMessage = !data.success && provider !== 'mock'
        ? `${data.error || 'Provider failed.'} Use Mock instead if you want a zero-cost response.`
        : data.output_text;
      const executionSummary = buildExecutionSummary(executionMetadata);

      setApiStatus((prev) => ({
        ...prev,
        state: 'online',
        label: `Connected to ${resolvedRuntimeContext.target} API`,
        detail: data.success
          ? executionSummary
          : `Provider issue: ${providerMessage}`,
        backendReachable: true,
        backendDefaultProvider: executionMetadata.backend_default_provider || prev.backendDefaultProvider,
        lastCheckedAt: new Date().toISOString(),
      }));

      setLastExecutionMetadata(executionMetadata);

      setDebugData({
        request_payload: requestPayload,
        response_payload: data,
        parsed_command: parsed,
        timing_ms: data.timing_ms ?? Math.round(performance.now() - startedAt),
        error: data.error,
        error_code: data.error_code ?? data.debug?.error_code ?? null,
        ui_requested_provider: executionMetadata.ui_requested_provider,
        backend_default_provider: executionMetadata.backend_default_provider,
        requested_provider: requestPayload.provider,
        selected_provider: executionMetadata.selected_provider,
        actual_provider_used: executionMetadata.actual_provider_used,
        model_used: executionMetadata.model_used,
        fallback_used: executionMetadata.fallback_used,
        fallback_reason: executionMetadata.fallback_reason,
        execution_metadata: executionMetadata,
        providerSelectionSource,
        activeProviderConfigSource: getActiveProviderConfigSource(),
        provider_health: providerHealth,
        provider_diagnostics: data.data?.provider_diagnostics || null,
        frontend_origin: resolvedRuntimeContext.frontendOrigin,
        frontend_api_base_url: resolvedRuntimeContext.baseUrl,
        backend_target_endpoint: resolvedRuntimeContext.backendTargetEndpoint,
        backend_health_endpoint: resolvedRuntimeContext.healthEndpoint,
        request_trace: data.data?.request_trace || null,
      });
    } catch (error) {
      const uiError = transportErrorToUi(error);
      setStatus('error');
      setLastExecutionMetadata(null);
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
