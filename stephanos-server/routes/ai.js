import express from 'express';
import { memoryService } from '../services/memoryService.js';
import { executeTool } from '../services/toolRegistry.js';
import { parseCommand, resolveRoute } from '../services/commandRouter.js';
import { buildErrorResponse, buildSuccessResponse } from '../services/responseBuilder.js';
import { createLogger } from '../utils/logger.js';
import { ERROR_CODES, normalizeError } from '../services/errors.js';
import { assistantContextService } from '../services/assistantContextService.js';
import { routeLLMRequest, resolveProviderRequest, getProviderHealthSnapshot } from '../services/llm/providerRouter.js';
import { DEFAULT_PROVIDER_KEY } from '../../shared/ai/providerDefaults.mjs';
import { providerSecretStore } from '../services/providerSecretStore.js';
import { resolveProviderExecutionTruth } from '../services/providerExecutionTruth.js';
import { durableMemoryService } from '../services/durableMemoryService.js';
import { activityLogService } from '../services/activityLogService.js';

const logger = createLogger('ai-route');
const router = express.Router();

function stripRawSecretsFromConfig(config = {}) {
  const source = config && typeof config === 'object' ? config : {};
  const { apiKey, ...rest } = source;
  return rest;
}

function buildServerOwnedProviderConfigs(input = {}) {
  const safeClientConfigs = Object.fromEntries(
    Object.entries(input || {}).map(([provider, config]) => [provider, stripRawSecretsFromConfig(config)]),
  );
  const secretOverlay = Object.fromEntries(
    Object.entries(providerSecretStore.buildProviderConfigOverlay()).map(([provider, config]) => [provider, {
      ...config,
      secretAuthority: 'backend-local-secret-store',
    }]),
  );
  return Object.fromEntries(
    Object.keys({ ...safeClientConfigs, ...secretOverlay }).map((provider) => [
      provider,
      { ...(safeClientConfigs[provider] || {}), ...(secretOverlay[provider] || {}) },
    ]),
  );
}


function formatTileContextForPrompt(tileContext = {}) {
  if (!tileContext || typeof tileContext !== 'object') {
    return '';
  }

  const activeTile = tileContext.activeTileContext || null;
  const relevantTiles = Array.isArray(tileContext.relevantTileContexts) ? tileContext.relevantTileContexts : [];
  const diagnostic = tileContext.diagnostics || {};

  if (!activeTile && relevantTiles.length === 0) {
    return '';
  }

  const contextLines = [
    'Operator tile context (live workspace state):',
    activeTile
      ? `- Active tile: ${activeTile.tileTitle || activeTile.tileId} (${activeTile.tileId}). Summary: ${activeTile.summary || 'n/a'}. Structured data: ${JSON.stringify(activeTile.structuredData || {})}`
      : '- Active tile: none provided.',
  ];

  if (relevantTiles.length > 0) {
    contextLines.push(`- Additional tile snapshots (${relevantTiles.length}):`);
    relevantTiles.forEach((snapshot) => {
      contextLines.push(`  - ${snapshot.tileTitle || snapshot.tileId} (${snapshot.tileId}): ${snapshot.summary || 'n/a'} | data=${JSON.stringify(snapshot.structuredData || {})}`);
    });
  }

  contextLines.push(`- Tile context diagnostics: ${JSON.stringify(diagnostic)}`);
  return contextLines.join('\n');
}

const helpText = 'Commands: /help /status /subsystems /tools /agents /memory /memory list /memory save <text> /memory find <query> /memory propose <id|recent> /proposals /proposals list /proposals stats /proposals show <id> /proposals accept <id> /proposals reject <id> /activity /activity list /activity recent /activity show <id> /roadmap /roadmap list /roadmap add <text> /roadmap done <id> /roadmap show <id> /kg help /simulate help /simulate history list /simulate history show <runId> /simulate history clear /simulate compare <runIdA> <runIdB> /clear';

function safeString(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function createContinuityRecord({ id, type, summary, payload = {}, tags = [], source = 'ai-route' }) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    type,
    source,
    scope: 'runtime',
    summary: safeString(summary),
    payload: payload && typeof payload === 'object' ? payload : {},
    tags: Array.isArray(tags) ? tags.map((tag) => safeString(tag)).filter(Boolean) : [],
    importance: 'normal',
    retentionHint: 'default',
    createdAt: now,
    updatedAt: now,
    surface: 'shared',
    id: safeString(id),
  };
}

function buildContinuityRecordKey(record = {}) {
  return `continuity::${safeString(record.id)}`;
}

function persistAiContinuityArtifacts({
  prompt = '',
  route = '',
  executionMetadata = {},
  outputText = '',
  memoryHits = [],
  tileContext = null,
}) {
  try {
    const state = durableMemoryService.getStore();
    const records = { ...(state.records || {}) };
    const baseId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const promptPreview = String(prompt || '').slice(0, 280);
    const outputPreview = String(outputText || '').slice(0, 420);
    const tags = ['ai.continuity', `route.${safeString(route, 'assistant')}`];
    const tileLinked = Boolean(tileContext?.activeTileContext || (Array.isArray(tileContext?.relevantTileContexts) && tileContext.relevantTileContexts.length > 0));

    const intentRecord = createContinuityRecord({
      id: `${baseId}-intent`,
      type: 'ai.decision',
      summary: `Operator intent captured for ${safeString(route, 'assistant')} route.`,
      payload: {
        promptPreview,
        route: safeString(route, 'assistant'),
        requestedProvider: executionMetadata.requested_provider || '',
        selectedProvider: executionMetadata.selected_provider || '',
      },
      tags: [...tags, 'ai.intent'],
      source: 'ai-continuity-intent',
    });
    const outcomeRecord = createContinuityRecord({
      id: `${baseId}-outcome`,
      type: 'ai.summary',
      summary: `AI outcome recorded (${executionMetadata.actual_provider_used || 'unknown-provider'}).`,
      payload: {
        outputPreview,
        provider: executionMetadata.actual_provider_used || '',
        model: executionMetadata.model_used || '',
        fallbackUsed: executionMetadata.fallback_used === true,
        fallbackReason: executionMetadata.fallback_reason || '',
        memoryHitCount: Array.isArray(memoryHits) ? memoryHits.length : 0,
        tileLinked,
      },
      tags: [...tags, 'ai.outcome', tileLinked ? 'tile-linked' : 'tile-unlinked'],
      source: 'ai-continuity-outcome',
    });

    records[buildContinuityRecordKey(intentRecord)] = intentRecord;
    records[buildContinuityRecordKey(outcomeRecord)] = outcomeRecord;

    durableMemoryService.setStore({
      schemaVersion: 2,
      records,
    }, 'ai-route-continuity');

    activityLogService.record({
      type: 'ai.continuity.persisted',
      subsystem: 'ai',
      summary: `Stored AI continuity artifacts for ${safeString(route, 'assistant')} route.`,
      payload: {
        provider: executionMetadata.actual_provider_used || '',
        fallbackUsed: executionMetadata.fallback_used === true,
        tileLinked,
      },
    });
    logger.info('[AI CONTINUITY] persisted ai continuity artifacts', {
      route,
      provider: executionMetadata.actual_provider_used || '',
      tileLinked,
    });
  } catch (error) {
    logger.warn('[AI CONTINUITY] unable to persist continuity artifacts', {
      message: error?.message || 'unknown-error',
      code: error?.code || '',
    });
  }
}


router.post('/providers/health', async (req, res) => {
  const { provider = DEFAULT_PROVIDER_KEY, routeMode = 'auto', providerConfigs = {}, fallbackEnabled = true, fallbackOrder = undefined, devMode = true, runtimeContext = {} } = req.body || {};
  const serverOwnedProviderConfigs = buildServerOwnedProviderConfigs(providerConfigs);
  const snapshot = await getProviderHealthSnapshot({ provider, routeMode, providerConfigs: serverOwnedProviderConfigs, fallbackEnabled, fallbackOrder, devMode, runtimeContext: { ...runtimeContext, frontendOrigin: runtimeContext.frontendOrigin || req.headers.origin || '' } });
  snapshot.secretAuthority = 'backend-local-secret-store';
  snapshot.secretStatus = providerSecretStore.getMaskedStatusSnapshot();
  res.json({ success: true, data: snapshot });
});

router.post('/chat', async (req, res) => {
  const startedAt = Date.now();
  const {
    prompt,
    provider = DEFAULT_PROVIDER_KEY,
    routeMode = 'auto',
    providerConfig = {},
    providerConfigs = {},
    fallbackEnabled = true,
    fallbackOrder = undefined,
    devMode = true,
    runtimeContext = {},
    freshnessContext = null,
    routeDecision = null,
  } = req.body || {};
  const requestId = req.headers['x-request-id'];
  const effectiveProviderConfig = Object.keys(providerConfig || {}).length > 0 ? providerConfig : providerConfigs?.[provider] || {};
  const mergedProviderConfigs = buildServerOwnedProviderConfigs({ ...providerConfigs, ...(provider ? { [provider]: effectiveProviderConfig } : {}) });
  const normalizedRuntimeContext = { ...runtimeContext, frontendOrigin: runtimeContext.frontendOrigin || req.headers.origin || '' };
  const assembledTileContext = normalizedRuntimeContext.tileContext && typeof normalizedRuntimeContext.tileContext === 'object'
    ? normalizedRuntimeContext.tileContext
    : null;
  const providerResolution = resolveProviderRequest(provider, effectiveProviderConfig, { routeMode, fallbackEnabled, fallbackOrder, devMode, runtimeContext: normalizedRuntimeContext });

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json(buildErrorResponse({ route: 'assistant', output_text: 'Prompt is required.', error: 'Prompt is required.', error_code: ERROR_CODES.CMD_INVALID, timing_ms: Date.now() - startedAt, debug: { route_reason: 'Input validation failed', request_id: requestId } }));
  }

  const parsedCommand = parseCommand(prompt);
  const decision = resolveRoute(parsedCommand, prompt);
  const { relevantItems: memoryHits, summaryText: memorySummary } = memoryService.buildContextSummary(prompt, { limit: 4 });

  logger.info('Incoming /api/ai/chat request', {
    requestId,
    uiRequestedProvider: provider,
    requestedProvider: providerResolution.requestedProvider,
    resolvedProvider: providerResolution.resolvedProvider,
    fallbackApplied: providerResolution.fallbackApplied,
    overrideKeys: providerResolution.overrideKeys,
  });
  console.log('[BACKEND LIVE] Incoming /api/ai/chat', {
    request_id: requestId || null,
    ui_requested_provider: provider,
    requested_provider: providerResolution.requestedProvider,
    resolved_provider: providerResolution.resolvedProvider,
    fallback_applied: providerResolution.fallbackApplied,
    override_keys: providerResolution.overrideKeys,
  });

  try {
    if (decision.action === 'help') return res.json(buildSuccessResponse({ type: 'tool_result', route: decision.route, command: '/help', output_text: helpText, data: {}, timing_ms: Date.now() - startedAt, debug: { parsed_command: parsedCommand, route_reason: decision.reason, request_id: requestId } }));
    if (decision.action === 'memory_help') return res.json(buildSuccessResponse({ type: 'memory_result', route: decision.route, command: '/memory', output_text: 'Memory commands: /memory list, /memory save <text>, /memory find <query>, /memory propose <id|recent>.', data: { commands: ['list', 'save', 'find', 'propose'] }, memory_hits: memoryHits, timing_ms: Date.now() - startedAt, debug: { parsed_command: parsedCommand, route_reason: decision.reason, request_id: requestId } }));
    if (decision.action === 'kg_help') return res.json(buildSuccessResponse({ type: 'tool_result', route: 'kg', command: '/kg help', output_text: 'Knowledge graph commands include add/update/delete/search and related traversal.', data: { commands: ['status', 'stats', 'list nodes', 'list edges', 'add node', 'update node', 'delete node', 'delete edge', 'add edge', 'search', 'related'] }, timing_ms: Date.now() - startedAt, debug: { parsed_command: parsedCommand, route_reason: decision.reason, request_id: requestId } }));
    if (decision.action === 'simulate_help') return res.json(buildSuccessResponse({ type: 'simulation_result', route: 'simulation', command: '/simulate help', output_text: 'Simulation commands include list/status/run, history, compare plus preset management.', data: { commands: ['list', 'status', 'run <simulationId>', 'history list|show|clear', 'compare <runIdA> <runIdB>', 'preset list|save|load|delete'] }, timing_ms: Date.now() - startedAt, debug: { parsed_command: parsedCommand, route_reason: decision.reason, request_id: requestId } }));
    if (decision.action === 'simulate_preset_help') return res.json(buildSuccessResponse({ type: 'simulation_result', route: 'simulation', command: '/simulate preset', output_text: 'Preset commands: list/save/load/delete.', data: { commands: ['list', 'save <name> --simulation <id>', 'load <name>', 'delete <name>'] }, timing_ms: Date.now() - startedAt, debug: { parsed_command: parsedCommand, route_reason: decision.reason, request_id: requestId } }));
    if (decision.action === 'clear') return res.json(buildSuccessResponse({ type: 'tool_result', route: decision.route, command: '/clear', output_text: 'Console clear acknowledged on backend.', timing_ms: Date.now() - startedAt, debug: { parsed_command: parsedCommand, route_reason: decision.reason, request_id: requestId } }));

    if (decision.action?.startsWith('invalid_')) {
      const actionErrorMap = {
        invalid_memory_subcommand: 'Unknown /memory subcommand. Use list, save, find, or propose.',
        invalid_kg_subcommand: 'Unknown /kg subcommand. Use /kg help.',
        invalid_simulate_subcommand: 'Unknown /simulate subcommand. Use /simulate help.',
        invalid_proposals_subcommand: 'Unknown /proposals subcommand. Use list/stats/show/accept/reject.',
        invalid_activity_subcommand: 'Unknown /activity subcommand. Use list/recent/show.',
        invalid_roadmap_subcommand: 'Unknown /roadmap subcommand. Use list/add/done/show.',
      };
      return res.status(400).json(buildErrorResponse({ route: decision.route, command: parsedCommand.isSlash ? `/${parsedCommand.command}` : null, output_text: 'Invalid command.', error: actionErrorMap[decision.action] ?? `Unknown command /${parsedCommand.command}. Use /help.`, error_code: ERROR_CODES.CMD_INVALID, memory_hits: memoryHits, timing_ms: Date.now() - startedAt, debug: { parsed_command: parsedCommand, route_reason: decision.reason, request_id: requestId } }));
    }

    if (decision.tool) {
      const toolStart = Date.now();
      const { tool, result } = await executeTool(decision.tool, decision.args, { aiAvailable: true });
      return res.json(buildSuccessResponse({
        type: decision.route === 'memory' ? 'memory_result' : decision.route === 'simulation' ? 'simulation_result' : 'tool_result',
        route: decision.route,
        command: parsedCommand.raw,
        output_text: result.output_text,
        data: result.data,
        tools_used: [tool.name],
        memory_hits: decision.route === 'memory' ? [] : memoryHits,
        timing_ms: Date.now() - startedAt,
        debug: { request_id: requestId, parsed_command: parsedCommand, selected_subsystem: tool.subsystem, selected_tool: tool.name, execution_payload: decision.args ?? null, result_summary: { output_text: result.output_text, keys: Object.keys(result.data ?? {}) }, timing: { total_ms: Date.now() - startedAt, tool_ms: Date.now() - toolStart }, error_code: null, subsystem_state: tool.state },
      }));
    }

    const contextBundle = assistantContextService.buildContextBundle({ limit: 3 });
    const memoryAwareSystemPrompt = [
      'You are Stephanos OS, a command-deck style mission console assistant. Keep responses concise, practical, and operator-friendly.',
      'Do not claim which provider/model answered. Provider execution truth is surfaced separately by runtime telemetry.',
      memorySummary ? `Relevant local memory:
${memorySummary}
Use these memories when they help, but do not repeat them unless they are relevant.` : '',
      formatTileContextForPrompt(assembledTileContext),
    ].filter(Boolean).join('\n\n');

    const llmResult = await routeLLMRequest({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: memoryAwareSystemPrompt,
      freshnessContext,
      routeDecision,
    }, {
      provider,
      providerConfigs: mergedProviderConfigs,
      routeMode,
      runtimeContext: normalizedRuntimeContext,
      fallbackEnabled,
      fallbackOrder,
      devMode,
      context: {
        route: decision.route,
        parsed_command: parsedCommand,
        memory_hits: memoryHits,
        subsystem_context: contextBundle,
        relevant_memory: memoryHits,
      },
    });

    const providerHealthSnapshot = await getProviderHealthSnapshot({ provider, routeMode, providerConfigs: mergedProviderConfigs, fallbackEnabled, fallbackOrder, devMode, runtimeContext: normalizedRuntimeContext });
    const executionMetadata = {
      ui_default_provider: routeDecision?.defaultProvider || provider,
      ui_requested_provider: provider,
      requested_provider_for_request: routeDecision?.requestedProviderForRequest || provider,
      backend_default_provider: DEFAULT_PROVIDER_KEY,
      route_mode: routeMode,
      effective_route_mode: llmResult.diagnostics?.effectiveRouteMode || providerHealthSnapshot?.routing?.effectiveRouteMode || routeMode,
      requested_provider: llmResult.requestedProvider || providerResolution.requestedProvider,
      selected_provider: llmResult.diagnostics?.selectedProvider || providerHealthSnapshot?.routing?.selectedProvider || providerResolution.resolvedProvider,
      actual_provider_used: llmResult.actualProviderUsed || llmResult.provider,
      model_used: llmResult.modelUsed || llmResult.model || '',
      fallback_used: Boolean(llmResult.fallbackUsed),
      fallback_reason: llmResult.fallbackReason || null,
      provider_capability: providerHealthSnapshot?.[llmResult.actualProviderUsed || llmResult.provider]?.providerCapability || null,
      ollama_base_url: llmResult.diagnostics?.ollama?.baseURL || providerHealthSnapshot?.ollama?.baseURL || null,
      ollama_model_requested: llmResult.diagnostics?.ollama?.requestedModel || mergedProviderConfigs?.ollama?.model || null,
      ollama_model_selected: llmResult.diagnostics?.ollama?.selectedModel || null,
      ollama_available_models: llmResult.diagnostics?.ollama?.availableModels || providerHealthSnapshot?.ollama?.models || [],
      ollama_request_ok: Boolean(llmResult.ok && (llmResult.actualProviderUsed || llmResult.provider) === 'ollama'),
      ollama_error: llmResult.error?.message || null,
      secret_authority: 'backend-local-secret-store',
      ai_policy_mode: routeDecision?.aiPolicy?.aiPolicyMode || 'local-first-cloud-when-needed',
      ai_policy_reason: routeDecision?.policyReason || 'Local-first policy applied.',
    };
    const requestTrace = {
      ui_requested_provider: provider,
      backend_default_provider: DEFAULT_PROVIDER_KEY,
      requested_provider: executionMetadata.requested_provider,
      selected_provider: executionMetadata.selected_provider,
      actual_provider_used: executionMetadata.actual_provider_used,
      model_used: executionMetadata.model_used,
      fallback_used: executionMetadata.fallback_used,
      fallback_reason: executionMetadata.fallback_reason,
      freshness_need: freshnessContext?.freshnessNeed || 'low',
      freshness_reason: freshnessContext?.freshnessReason || 'n/a',
      stale_risk: freshnessContext?.staleRisk || 'low',
      selected_answer_mode: routeDecision?.selectedAnswerMode || 'local-private',
      override_denial_reason: routeDecision?.overrideDeniedReason || null,
      freshness_warning: routeDecision?.freshnessWarning || null,
      freshness_routed: Boolean(routeDecision?.freshnessRouted),
      ai_policy_mode: routeDecision?.aiPolicy?.aiPolicyMode || 'local-first-cloud-when-needed',
      ai_policy_reason: routeDecision?.policyReason || 'Local-first policy applied.',
      route_mode: routeMode,
      effective_route_mode: executionMetadata.effective_route_mode,
      provider_resolution: providerResolution,
    };
    const providerExecutionTruth = resolveProviderExecutionTruth({
      actualProviderUsed: executionMetadata.actual_provider_used,
      executionStatus: executionMetadata.actual_provider_used ? `ok:${executionMetadata.actual_provider_used}` : '',
      executableProvider: executionMetadata.selected_provider,
      selectedProvider: executionMetadata.selected_provider,
      backendDefaultProvider: executionMetadata.backend_default_provider,
    });

    console.log('[BACKEND LIVE] Execution metadata', executionMetadata);
    console.log('[BACKEND LIVE] Request trace', requestTrace);

    if (!llmResult.ok) {
      persistAiContinuityArtifacts({
        prompt,
        route: decision.route,
        executionMetadata,
        outputText: llmResult.error?.message || 'AI provider failed.',
        memoryHits,
        tileContext: assembledTileContext,
      });
      return res.status(502).json(buildErrorResponse({
        route: decision.route,
        command: parsedCommand.isSlash ? parsedCommand.raw : null,
        output_text: llmResult.error?.message || 'AI provider failed.',
        error: llmResult.error?.message || 'AI provider failed.',
        error_code: llmResult.error?.code || ERROR_CODES.LLM_ROUTER_NO_PROVIDER_AVAILABLE,
        data: {
          provider: llmResult.provider,
          provider_model: llmResult.model,
          provider_raw: llmResult.raw,
          provider_diagnostics: llmResult.diagnostics,
          provider_health: providerHealthSnapshot,
          execution_metadata: executionMetadata,
          request_trace: requestTrace,
          requested_provider: executionMetadata.requested_provider,
          selected_provider: executionMetadata.selected_provider,
          actual_provider_used: executionMetadata.actual_provider_used,
          model_used: executionMetadata.model_used,
          fallback_used: executionMetadata.fallback_used,
          fallback_reason: executionMetadata.fallback_reason,
          provider_execution_truth: providerExecutionTruth,
          assistant_context: contextBundle,
          relevant_memory: memoryHits,
          tile_context_diagnostics: assembledTileContext?.diagnostics || null,
        },
        memory_hits: memoryHits,
        timing_ms: Date.now() - startedAt,
        debug: {
          parsed_command: parsedCommand,
          route_reason: decision.reason,
          request_id: requestId,
          llm_provider: llmResult.provider,
          llm_model: llmResult.model,
          provider_router: llmResult.diagnostics,
          execution_metadata: executionMetadata,
          request_trace: requestTrace,
        },
      }));
    }

    persistAiContinuityArtifacts({
      prompt,
      route: decision.route,
      executionMetadata,
      outputText: llmResult.outputText,
      memoryHits,
      tileContext: assembledTileContext,
    });

    return res.json(buildSuccessResponse({
      type: 'assistant_response',
      route: decision.route,
      command: parsedCommand.isSlash ? parsedCommand.raw : null,
      output_text: llmResult.outputText,
      data: {
        provider: llmResult.provider,
        provider_model: llmResult.model,
        provider_raw: llmResult.raw,
        provider_diagnostics: llmResult.diagnostics,
        provider_health: providerHealthSnapshot,
        execution_metadata: executionMetadata,
        request_trace: requestTrace,
        requested_provider: executionMetadata.requested_provider,
        selected_provider: executionMetadata.selected_provider,
        actual_provider_used: executionMetadata.actual_provider_used,
        model_used: executionMetadata.model_used,
        fallback_used: executionMetadata.fallback_used,
        fallback_reason: executionMetadata.fallback_reason,
        provider_execution_truth: providerExecutionTruth,
        assistant_context: contextBundle,
        relevant_memory: memoryHits,
        suggested_actions: [{ label: 'List pending proposals', command: '/proposals list' }, { label: 'View recent activity', command: '/activity recent' }],
        tile_context_diagnostics: assembledTileContext?.diagnostics || null,
      },
      memory_hits: memoryHits,
      timing_ms: Date.now() - startedAt,
      debug: {
        parsed_command: parsedCommand,
        route_reason: decision.reason,
        request_id: requestId,
        llm_provider: llmResult.provider,
        llm_model: llmResult.model,
        provider_router: llmResult.diagnostics,
        execution_metadata: executionMetadata,
        request_trace: requestTrace,
      },
    }));
  } catch (error) {
    const appError = normalizeError(error);
    logger.error('Failed to process /api/ai/chat', {
      message: appError.message,
      code: appError.code,
      requestedProvider: providerResolution.requestedProvider,
      resolvedProvider: providerResolution.resolvedProvider,
    });
    return res.status(appError.status ?? 500).json(buildErrorResponse({ route: decision.route, command: parsedCommand.isSlash ? parsedCommand.raw : null, output_text: appError.message, error: appError.message, error_code: appError.code, memory_hits: memoryHits, timing_ms: Date.now() - startedAt, debug: { request_id: requestId, parsed_command: parsedCommand, selected_subsystem: decision.route, selected_tool: decision.tool ?? null, execution_payload: decision.args ?? null, error_code: appError.code, provider_router: providerResolution } }));
  }
});

export default router;
