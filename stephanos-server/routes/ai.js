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
import { localRetrievalService } from '../services/retrieval/localRetrievalService.js';
import { adjudicateMemoryCandidate } from '../services/memory/memoryAdjudicator.js';
import { buildIntentProposalEnvelope } from '../services/intent-proposal/proposalEngine.js';
import {
  buildCanonicalModelTruth,
  buildCanonicalProviderResolution,
  buildGroundingTruth,
  buildRequestTraceResolutionTruth,
} from '../services/assistantRequestTruth.js';

const logger = createLogger('ai-route');
const router = express.Router();
const STREAMING_MEDIA_TYPE = 'text/event-stream';
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLocalDesktopRequest(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '').trim();
  const forwardedFor = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const candidateIp = forwardedFor || ip;
  if (LOOPBACK_IPS.has(candidateIp)) return true;
  const origin = String(req.headers?.origin || '').trim();
  return origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
}

export function wantsStreaming(req) {
  const accept = String(req.headers?.accept || '').toLowerCase();
  const queryStream = String(req.query?.stream ?? '').toLowerCase();
  const bodyStream = req.body?.stream;
  return accept.includes(STREAMING_MEDIA_TYPE)
    || queryStream === '1'
    || queryStream === 'true'
    || bodyStream === true
    || bodyStream === 1
    || String(bodyStream || '').toLowerCase() === 'true';
}

function writeSseEvent(res, event, payload = {}) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeSseCompletion(res, success = true) {
  writeSseEvent(res, 'complete', {
    type: 'complete',
    done: true,
    success: success === true,
  });
}

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

function resolveMemoryCandidate({ requestBody = {}, runtimeContext = {}, route = '', requestId = '' } = {}) {
  const bodyCandidate = requestBody.memoryCandidate;
  const contextCandidate = runtimeContext.memoryCandidate;
  const sourceCandidate = bodyCandidate && typeof bodyCandidate === 'object'
    ? bodyCandidate
    : (contextCandidate && typeof contextCandidate === 'object' ? contextCandidate : null);

  if (!sourceCandidate) {
    return null;
  }

  return {
    ...sourceCandidate,
    sourceRef: sourceCandidate.sourceRef || `ai-chat:${requestId || 'no-request-id'}:${route || 'assistant'}`,
  };
}

function findAttemptFailureReason(attempts = [], providerKey = '') {
  const normalizedProvider = String(providerKey || '').trim().toLowerCase();
  if (!normalizedProvider || !Array.isArray(attempts)) {
    return '';
  }
  const failedAttempt = attempts.find((attempt) => String(attempt?.provider || '').trim().toLowerCase() === normalizedProvider && attempt?.result?.ok !== true);
  return String(failedAttempt?.failureReason || failedAttempt?.result?.error?.message || '').trim();
}


router.post('/providers/health', async (req, res) => {
  const { provider = DEFAULT_PROVIDER_KEY, routeMode = 'auto', providerConfigs = {}, fallbackEnabled = true, fallbackOrder = undefined, devMode = true, runtimeContext = {} } = req.body || {};
  const serverOwnedProviderConfigs = buildServerOwnedProviderConfigs(providerConfigs);
  const snapshot = await getProviderHealthSnapshot({ provider, routeMode, providerConfigs: serverOwnedProviderConfigs, fallbackEnabled, fallbackOrder, devMode, runtimeContext: { ...runtimeContext, frontendOrigin: runtimeContext.frontendOrigin || req.headers.origin || '' } });
  snapshot.secretAuthority = 'backend-local-secret-store';
  snapshot.secretStatus = providerSecretStore.getMaskedStatusSnapshot();
  Object.entries(snapshot)
    .filter(([providerKey, health]) => providerKey !== 'routing' && health && typeof health === 'object' && 'ok' in health)
    .forEach(([providerKey, health]) => {
      console.info('[PROVIDER HEALTH]', {
        provider: providerKey,
        keyPresent: health.state !== 'MISSING_KEY',
        executable: health.ok === true,
        reason: health.reason || health.detail || '',
      });
    });
  res.json({ success: true, data: snapshot });
});

router.post('/ollama/release', async (req, res) => {
  if (!isLocalDesktopRequest(req)) {
    return res.status(403).json({
      success: false,
      error: 'Emergency Ollama release is local-desktop only.',
      error_code: 'LOCAL_ONLY_OPERATION',
    });
  }
  return res.json({
    success: true,
    data: {
      release_requested: true,
      release_mode: 'active-request-only',
      safe_targeted_kill_available: false,
      targeted_request_cancelled: false,
      provider_generation_confirmed_stopped: false,
      provider_generation_still_running_unknown: true,
      cancellation_effectiveness: 'attempted-unknown',
      note: 'No safe process-level targeted kill is currently available. Use normal Stop generating for active requests; if load persists, operator must manually intervene in local Ollama tooling.',
    },
  });
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
    staleFallbackPermitted = undefined,
    streaming_mode_preference: streamingModePreference = 'off',
    streaming_mode_preference_input: streamingModePreferenceInput = 'off',
    streaming_requested: clientStreamingRequested = false,
    streaming_request_source: clientStreamingRequestSource = 'off',
    streaming_policy_decision: clientStreamingPolicyDecision = null,
    streaming_policy_reason: clientStreamingPolicyReason = null,
  } = req.body || {};
  const requestId = req.headers['x-request-id'];
  const streamingEnabled = wantsStreaming(req);
  const requestAbortController = new AbortController();
  let cancellationSource = null;
  const markCancelled = (source) => {
    if (cancellationSource) return;
    cancellationSource = source;
    requestAbortController.abort();
  };
  req.on('aborted', () => markCancelled('client-disconnect'));
  req.on('close', () => {
    if (!res.writableEnded) {
      markCancelled('client-disconnect');
    }
  });
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
    const intentProposalEnvelope = buildIntentProposalEnvelope({ requestText: prompt, context: { route: decision.route } });
    const retrieval = localRetrievalService.query({
      prompt,
      freshnessContext,
    });
    const memoryCandidate = resolveMemoryCandidate({
      requestBody: req.body || {},
      runtimeContext: normalizedRuntimeContext,
      route: decision.route,
      requestId,
    });
    const memoryTruth = adjudicateMemoryCandidate(memoryCandidate);
    const memoryAwareSystemPrompt = [
      'You are Stephanos OS, a command-deck style mission console assistant. Keep responses concise, practical, and operator-friendly.',
      'Do not claim which provider/model answered. Provider execution truth is surfaced separately by runtime telemetry.',
      memorySummary ? `Relevant local memory:
${memorySummary}
Use these memories when they help, but do not repeat them unless they are relevant.` : '',
      formatTileContextForPrompt(assembledTileContext),
      retrieval.contextBlock
        ? `Local retrieval context (bounded, local-first, non-fresh-web):
${retrieval.contextBlock}
Use it only as cited local project evidence. If freshness-sensitive truth is requested, acknowledge local limits.`
        : '',
    ].filter(Boolean).join('\n\n');

    if (streamingEnabled) {
      res.status(200);
      res.setHeader('Content-Type', STREAMING_MEDIA_TYPE);
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      res.on('close', () => {
        if (!res.writableEnded) {
          markCancelled('client-disconnect');
        }
      });
    }

    const llmResult = await routeLLMRequest({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: memoryAwareSystemPrompt,
      freshnessContext,
      routeDecision,
    }, {
      provider,
      providerConfigs: mergedProviderConfigs,
      routeMode,
      freshnessContext,
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
      staleFallbackPermitted: staleFallbackPermitted ?? routeDecision?.staleFallbackPermitted ?? freshnessContext?.staleFallbackPermitted ?? false,
      streamObserver: streamingEnabled
        ? (event) => {
          if (!event || event.type !== 'token' || !event.content) return;
          writeSseEvent(res, 'token', {
            type: 'token',
            content: String(event.content || ''),
            done: false,
          });
        }
        : null,
      abortSignal: requestAbortController.signal,
    });

    const providerHealthSnapshot = await getProviderHealthSnapshot({ provider, routeMode, providerConfigs: mergedProviderConfigs, fallbackEnabled, fallbackOrder, devMode, runtimeContext: normalizedRuntimeContext });
    const routingDiagnostics = llmResult.diagnostics?.routing || providerHealthSnapshot?.routing || {};
    const attemptDiagnostics = Array.isArray(llmResult.diagnostics?.attempts) ? llmResult.diagnostics.attempts : [];
    const requestedProviderForRequest = routingDiagnostics.requestedProviderForRequest
      || routeDecision?.requestedProviderForRequest
      || llmResult.requestedProvider
      || providerResolution.requestedProvider;
    const selectedProviderForRequest = llmResult.diagnostics?.selectedProvider
      || routingDiagnostics.selectedProvider
      || providerHealthSnapshot?.routing?.selectedProvider
      || providerResolution.resolvedProvider;
    const selectedProviderAttempt = attemptDiagnostics.find((attempt) => String(attempt?.provider || '').trim().toLowerCase() === String(selectedProviderForRequest || '').trim().toLowerCase()) || null;
    const actualProviderUsed = llmResult.actualProviderUsed || llmResult.provider;
    const canonicalProviderResolution = buildCanonicalProviderResolution({
      uiRequestedProvider: provider,
      initialResolution: providerResolution,
      requestedProviderForRequest,
      selectedProvider: selectedProviderForRequest,
      actualProviderUsed,
    });
    const freshnessTruth = llmResult.diagnostics?.freshnessTruth || {};
    const fastResponseLaneTruth = llmResult.diagnostics?.fastResponseLane || {};
    const fastLaneModelTruth = String(
      fastResponseLaneTruth.model
      || llmResult.diagnostics?.ollama?.requestedModel
      || llmResult.diagnostics?.ollama?.selectedModel
      || llmResult.modelUsed
      || llmResult.model
      || '',
    ).trim();
    const fastLaneEligibleTruth = Boolean(
      fastResponseLaneTruth.eligible
      || (
        actualProviderUsed === 'ollama'
        && fastLaneModelTruth.toLowerCase() === 'llama3.2:3b'
      ),
    );
    const fastLaneActiveTruth = Boolean(
      fastResponseLaneTruth.active
      || (
        fastLaneEligibleTruth
        && actualProviderUsed === 'ollama'
        && fastLaneModelTruth.toLowerCase() === 'llama3.2:3b'
      ),
    );
    const fallbackProviderUsed = llmResult.fallbackUsed ? actualProviderUsed : null;
    const freshProviderAttempted = freshnessContext?.freshnessNeed === 'high'
      || routeDecision?.freshnessNeed === 'high'
      || routingDiagnostics.freshnessNeed === 'high'
      ? requestedProviderForRequest
      : null;
    const freshProviderFailureReason = findAttemptFailureReason(attemptDiagnostics, freshProviderAttempted);
    const effectiveAnswerMode = freshnessTruth.answerTruthMode
      || (llmResult.fallbackUsed
      ? (actualProviderUsed === 'ollama' ? 'stale-risk-local-fallback' : 'cloud-fallback')
      : ((freshnessContext?.freshnessNeed === 'high' || routeDecision?.freshnessNeed === 'high') && actualProviderUsed !== 'ollama'
        ? 'fresh-cloud'
        : (actualProviderUsed === 'ollama' ? 'local-private' : 'cloud')));
    const canonicalModelTruth = buildCanonicalModelTruth({
      configuredModel: mergedProviderConfigs?.[actualProviderUsed]?.model || null,
      requestedModel: llmResult.diagnostics?.ollama?.requestedModel
        || mergedProviderConfigs?.[selectedProviderForRequest]?.model
        || mergedProviderConfigs?.[actualProviderUsed]?.model
        || null,
      selectedModel: llmResult.model || llmResult.modelUsed || null,
      executedModel: llmResult.modelUsed || llmResult.model || null,
      selectionReason: llmResult.diagnostics?.ollama?.policyReason
        || llmResult.diagnostics?.ollama?.fallbackReason
        || llmResult.diagnostics?.ollama?.escalationReason
        || (llmResult.diagnostics?.groq?.freshWebActive ? 'fresh-web-route' : 'provider-default'),
      overrideReason: llmResult.diagnostics?.ollama?.policyReason
        || llmResult.diagnostics?.ollama?.fallbackReason
        || llmResult.diagnostics?.ollama?.escalationReason
        || null,
    });
    const groundingTruth = buildGroundingTruth({
      executedProvider: canonicalProviderResolution.executedProvider,
      freshProviderAttempted,
      freshProviderFailureReason,
      fallbackUsed: Boolean(llmResult.fallbackUsed),
      geminiGroundingEnabled: Boolean(llmResult.diagnostics?.gemini?.groundingEnabled),
      configGroundingEnabled: mergedProviderConfigs?.gemini?.groundingEnabled !== false,
    });
    const requestTraceResolutionTruth = buildRequestTraceResolutionTruth({
      canonicalProviderResolution,
      initialProviderResolution: providerResolution,
    });
    const executionMetadata = {
      saved_preferred_provider: provider,
      ui_default_provider: routeDecision?.defaultProvider || provider,
      ui_requested_provider: provider,
      requested_provider_for_request: canonicalProviderResolution.requestProvider,
      backend_default_provider: DEFAULT_PROVIDER_KEY,
      route_mode: routeMode,
      requested_route_mode: llmResult.diagnostics?.requestedRouteMode || providerHealthSnapshot?.routing?.requestedRouteMode || routeMode,
      effective_route_mode: llmResult.diagnostics?.effectiveRouteMode || providerHealthSnapshot?.routing?.effectiveRouteMode || routeMode,
      requested_provider: canonicalProviderResolution.requestProvider
        || llmResult.requestedProvider
        || providerResolution.requestedProvider,
      routing_requested_provider: llmResult.requestedProvider || providerResolution.requestedProvider,
      selected_provider: canonicalProviderResolution.selectedProvider,
      actual_provider_used: canonicalProviderResolution.executedProvider,
      fallback_provider_used: fallbackProviderUsed,
      provider_intent_ui: canonicalProviderResolution.intentProvider,
      provider_request_policy: canonicalProviderResolution.requestProvider,
      provider_selected_policy: canonicalProviderResolution.selectedProvider,
      provider_executed_actual: canonicalProviderResolution.executedProvider,
      provider_resolution: canonicalProviderResolution,
      provider_selection_source: llmResult.diagnostics?.providerSelectionSource || providerHealthSnapshot?.routing?.providerSelectionSource || 'auto:policy',
      model_used: canonicalModelTruth.executedModel || '',
      configured_model: canonicalModelTruth.configuredModel,
      requested_model: canonicalModelTruth.requestedModel,
      selected_model: canonicalModelTruth.selectedModel,
      executed_model: canonicalModelTruth.executedModel,
      model_selection_reason: canonicalModelTruth.modelSelectionReason,
      model_policy_override_applied: canonicalModelTruth.modelPolicyOverrideApplied,
      model_policy_override_reason: canonicalModelTruth.modelPolicyOverrideReason,
      fallback_used: Boolean(llmResult.fallbackUsed),
      fallback_reason: llmResult.fallbackReason || null,
      effective_answer_mode: effectiveAnswerMode,
      fresh_provider_attempted: freshProviderAttempted,
      fresh_provider_failure_reason: freshProviderFailureReason || null,
      config_grounding_enabled: groundingTruth.config_grounding_enabled,
      grounding_active_for_request: groundingTruth.grounding_active_for_request,
      provider_capability: providerHealthSnapshot?.[llmResult.actualProviderUsed || llmResult.provider]?.providerCapability || null,
      ollama_base_url: llmResult.diagnostics?.ollama?.baseURL || providerHealthSnapshot?.ollama?.baseURL || null,
      ollama_model_requested: llmResult.diagnostics?.ollama?.requestedModel || mergedProviderConfigs?.ollama?.model || null,
      ollama_model_selected: llmResult.diagnostics?.ollama?.selectedModel || null,
      ollama_model_default: llmResult.diagnostics?.ollama?.defaultModel || mergedProviderConfigs?.ollama?.model || null,
      ollama_model_preferred: llmResult.diagnostics?.ollama?.preferredModel || mergedProviderConfigs?.ollama?.model || null,
      ollama_reasoning_mode: llmResult.diagnostics?.ollama?.localReasoningMode || null,
      ollama_escalation_model: llmResult.diagnostics?.ollama?.escalationModel || null,
      ollama_escalation_active: Boolean(llmResult.diagnostics?.ollama?.escalationActive),
      ollama_escalation_reason: llmResult.diagnostics?.ollama?.escalationReason || null,
      fast_response_lane_eligible: fastLaneEligibleTruth,
      fast_response_lane_active: fastLaneActiveTruth,
      fast_response_lane_reason: fastResponseLaneTruth.reason || llmResult.diagnostics?.ollama?.policyReason || null,
      fast_response_model: fastLaneActiveTruth ? (fastLaneModelTruth || 'llama3.2:3b') : (fastResponseLaneTruth.model || null),
      escalation_model: fastResponseLaneTruth.escalationModel || llmResult.diagnostics?.ollama?.escalationModel || null,
      escalation_reason: fastResponseLaneTruth.escalationReason || llmResult.diagnostics?.ollama?.escalationReason || 'fast-lane-not-selected',
      streaming_mode_preference: String(streamingModePreference || 'off').trim().toLowerCase(),
      streaming_mode_preference_input: String(streamingModePreferenceInput || streamingModePreference || 'off').trim().toLowerCase(),
      streaming_requested: Boolean(streamingEnabled || clientStreamingRequested === true),
      streaming_request_source: String(clientStreamingRequestSource || (streamingEnabled ? 'operator-on' : 'off')).trim().toLowerCase(),
      streaming_policy_decision: clientStreamingPolicyDecision || (streamingEnabled ? 'stream-enabled' : 'stream-disabled'),
      streaming_policy_reason: clientStreamingPolicyReason || null,
      streaming_supported: actualProviderUsed === 'ollama',
      streaming_used: Boolean(streamingEnabled && actualProviderUsed === 'ollama'),
      streaming_provider: actualProviderUsed === 'ollama' ? 'ollama' : null,
      streaming_model: actualProviderUsed === 'ollama' ? (canonicalModelTruth.executedModel || null) : null,
      streaming_finalized: Boolean(
        streamingEnabled
        ? (actualProviderUsed === 'ollama' && llmResult.ok && llmResult.outputText)
        : true
      ),
      streaming_fallback_reason: streamingEnabled && actualProviderUsed !== 'ollama'
        ? 'provider-streaming-not-enabled'
        : null,
      fast_response_streaming: Boolean(streamingEnabled && fastLaneActiveTruth && actualProviderUsed === 'ollama'),
      ollama_fallback_model: llmResult.diagnostics?.ollama?.fallbackModel || null,
      ollama_fallback_model_used: Boolean(llmResult.diagnostics?.ollama?.fallbackModelUsed),
      ollama_fallback_reason: llmResult.diagnostics?.ollama?.fallbackReason || null,
      ollama_timeout_ms: llmResult.diagnostics?.ollama?.timeoutMs || null,
      ollama_timeout_source: llmResult.diagnostics?.ollama?.timeoutSource || null,
      ollama_timeout_model: llmResult.diagnostics?.ollama?.timeoutModel || null,
      ollama_available_models: llmResult.diagnostics?.ollama?.availableModels || providerHealthSnapshot?.ollama?.models || [],
      ollama_request_ok: Boolean(llmResult.ok && (llmResult.actualProviderUsed || llmResult.provider) === 'ollama'),
      ollama_error: llmResult.error?.message || null,
      secret_authority: 'backend-local-secret-store',
      ai_policy_mode: routeDecision?.aiPolicy?.aiPolicyMode || 'local-first-cloud-when-needed',
      ai_policy_reason: routeDecision?.policyReason || 'Local-first policy applied.',
      groq_endpoint_used: llmResult.diagnostics?.groq?.endpoint || null,
      groq_model_used: llmResult.diagnostics?.groq?.selectedModel || null,
      groq_fresh_web_active: Boolean(llmResult.diagnostics?.groq?.freshWebActive),
      groq_fresh_web_candidate_available: Boolean(llmResult.diagnostics?.groq?.freshWebModelCandidateAvailable),
      groq_fresh_candidate_model: llmResult.diagnostics?.groq?.freshWebModelCandidate || routeDecision?.candidateFreshModel || null,
      groq_fresh_web_path: llmResult.diagnostics?.groq?.freshWebPath || null,
      groq_capability_reason: providerHealthSnapshot?.groq?.providerCapability?.capabilityReason || null,
      zero_cost_policy: providerHealthSnapshot?.groq?.providerCapability?.zeroCostPolicy ?? true,
      paid_fresh_routes_enabled: providerHealthSnapshot?.groq?.providerCapability?.paidFreshRoutesEnabled ?? false,
      fresh_capability_mode: providerHealthSnapshot?.groq?.providerCapability?.freshCapabilityMode || 'zero-cost-only',
      freshness_required_for_truth: Boolean(freshnessTruth.freshnessRequiredForTruth),
      fresh_answer_required: Boolean(freshnessTruth.freshAnswerRequired),
      fresh_provider_available_for_request: Boolean(freshnessTruth.freshProviderAvailableForRequest),
      fresh_provider_attempted: freshnessTruth.freshProviderAttempted || freshProviderAttempted,
      fresh_provider_succeeded: Boolean(freshnessTruth.freshProviderSucceeded),
      stale_fallback_permitted: Boolean(freshnessTruth.staleFallbackPermitted ?? (staleFallbackPermitted ?? routeDecision?.staleFallbackPermitted ?? freshnessContext?.staleFallbackPermitted ?? false)),
      stale_fallback_attempted: Boolean(freshnessTruth.staleFallbackAttempted ?? routeDecision?.staleFallbackAttempted),
      stale_fallback_used: Boolean(freshnessTruth.staleFallbackUsed),
      stale_answer_warning: freshnessTruth.staleAnswerWarning || null,
      answer_truth_mode: freshnessTruth.answerTruthMode || null,
      freshness_integrity_preserved: Boolean(freshnessTruth.freshnessIntegrityPreserved),
      freshness_integrity_failure_reason: freshnessTruth.freshnessIntegrityFailureReason || null,
      freshness_truth_reason: freshnessTruth.truthReason || null,
      freshness_next_actions: Array.isArray(freshnessTruth.nextActions) ? freshnessTruth.nextActions : [],
      retrieval_mode: retrieval.truth.retrievalMode,
      retrieval_eligible: retrieval.truth.retrievalEligible,
      retrieval_used: retrieval.truth.retrievalUsed,
      retrieval_reason: retrieval.truth.retrievalReason,
      retrieved_chunk_count: retrieval.truth.retrievedChunkCount,
      retrieved_sources: retrieval.truth.retrievedSources,
      retrieval_query: retrieval.truth.retrievalQuery,
      retrieval_index_status: retrieval.truth.retrievalIndexStatus,
      memory_eligible: memoryTruth.memoryEligible,
      memory_promoted: memoryTruth.memoryPromoted,
      memory_reason: memoryTruth.memoryReason,
      memory_source_type: memoryTruth.memorySourceType,
      memory_source_ref: memoryTruth.memorySourceRef,
      memory_confidence: memoryTruth.memoryConfidence,
      memory_class: memoryTruth.memoryClass,
      intent_detected: intentProposalEnvelope.intent.intentDetected,
      intent_type: intentProposalEnvelope.intent.intentType,
      intent_confidence: intentProposalEnvelope.intent.intentConfidence,
      proposal_created: intentProposalEnvelope.proposal.proposalCreated,
      proposal_status: intentProposalEnvelope.proposal.proposalStatus,
      proposal_reason: intentProposalEnvelope.proposal.proposalReason,
      proposal_step_count: intentProposalEnvelope.proposal.proposalStepCount,
      proposal_steps: intentProposalEnvelope.proposal.steps,
      execution_eligible: intentProposalEnvelope.execution.executionEligible,
      execution_started: intentProposalEnvelope.execution.executionStarted,
      execution_completed: intentProposalEnvelope.execution.executionCompleted,
      execution_blocked_reason: intentProposalEnvelope.execution.executionBlockedReason,
      execution_result_summary: intentProposalEnvelope.execution.executionResultSummary,
      provider_answered: Boolean(llmResult.ok && llmResult.outputText),
      execution_cancelled: cancellationSource != null,
      cancellation_source: cancellationSource,
      provider_cancelled: cancellationSource != null,
      provider_cancel_reason: cancellationSource ? `provider request aborted (${cancellationSource})` : null,
      ollama_abort_sent: cancellationSource != null && String(canonicalProviderResolution.executedProvider || '').trim().toLowerCase() === 'ollama',
      ui_timeout_triggered: false,
      backend_timeout_triggered: false,
      abort_signal_created: true,
      abort_signal_fired: cancellationSource != null,
      abort_forwarded_to_router: cancellationSource != null,
      abort_forwarded_to_provider: cancellationSource != null,
      abort_forwarded_to_ollama_fetch: false,
      ollama_fetch_aborted: false,
      ollama_reader_cancelled: false,
      provider_generation_still_running_unknown: false,
      provider_generation_confirmed_stopped: cancellationSource == null,
      cancellation_effectiveness: cancellationSource != null ? 'attempted-unknown' : 'not-needed',
    };
    executionMetadata.executable_provider = providerHealthSnapshot?.[executionMetadata.selected_provider]?.ok
      ? executionMetadata.selected_provider
      : '';
    executionMetadata.executable_provider_reason = executionMetadata.executable_provider
      ? 'Selected provider is healthy and executable.'
      : (providerHealthSnapshot?.[executionMetadata.selected_provider]?.detail
        || providerHealthSnapshot?.[executionMetadata.selected_provider]?.reason
        || 'Selected provider is not executable.');
    executionMetadata.selected_provider_health_ok = providerHealthSnapshot?.[executionMetadata.selected_provider]?.ok === true;
    executionMetadata.selected_provider_health_state = providerHealthSnapshot?.[executionMetadata.selected_provider]?.state
      || providerHealthSnapshot?.[executionMetadata.selected_provider]?.badge
      || 'unknown';
    executionMetadata.selected_provider_execution_viability = selectedProviderAttempt?.result?.ok === true
      ? 'viable'
      : (selectedProviderAttempt ? 'failed' : 'not-attempted');
    executionMetadata.selected_provider_execution_failure_layer = selectedProviderAttempt?.result?.error?.details?.failureLayer
      || selectedProviderAttempt?.result?.diagnostics?.ollama?.executionFailureLayer
      || null;
    executionMetadata.selected_provider_execution_failure_label = selectedProviderAttempt?.result?.error?.details?.failureLabel
      || selectedProviderAttempt?.result?.diagnostics?.ollama?.executionFailureLabel
      || null;
    executionMetadata.selected_provider_execution_failure_phase = selectedProviderAttempt?.result?.error?.details?.failurePhase
      || selectedProviderAttempt?.result?.diagnostics?.ollama?.executionFailurePhase
      || null;
    executionMetadata.selected_provider_model_warmup_likely = Boolean(
      selectedProviderAttempt?.result?.error?.details?.modelWarmupLikely
      ?? selectedProviderAttempt?.result?.diagnostics?.ollama?.modelWarmupLikely
      ?? false,
    );
    executionMetadata.selected_provider_timeout_category = selectedProviderAttempt?.result?.error?.details?.timeoutCategory
      || selectedProviderAttempt?.result?.diagnostics?.ollama?.timeoutCategory
      || null;
    executionMetadata.selected_provider_warmup_retry_applied = Boolean(
      selectedProviderAttempt?.result?.error?.details?.warmupRetryApplied
      ?? selectedProviderAttempt?.result?.diagnostics?.ollama?.warmupRetryApplied
      ?? false,
    );
    executionMetadata.selected_provider_warmup_retry_timeout_ms = selectedProviderAttempt?.result?.diagnostics?.ollama?.warmupRetryTimeoutMs
      || null;
    executionMetadata.selected_provider_warmup_retry_eligible = Boolean(
      selectedProviderAttempt?.result?.error?.details?.warmupRetryEligible
      ?? selectedProviderAttempt?.result?.diagnostics?.ollama?.warmupRetryEligible
      ?? false,
    );
    executionMetadata.selected_provider_warmup_retry_reason = selectedProviderAttempt?.result?.error?.details?.warmupRetryReason
      || selectedProviderAttempt?.result?.diagnostics?.ollama?.warmupRetryReason
      || null;
    executionMetadata.selected_provider_warmup_retry_attempt_count = selectedProviderAttempt?.result?.error?.details?.warmupRetryAttemptCount
      ?? selectedProviderAttempt?.result?.diagnostics?.ollama?.warmupRetryAttemptCount
      ?? null;
    executionMetadata.selected_provider_first_attempt_elapsed_ms = selectedProviderAttempt?.result?.error?.details?.firstAttemptElapsedMs
      ?? selectedProviderAttempt?.result?.diagnostics?.ollama?.firstAttemptElapsedMs
      ?? null;
    executionMetadata.selected_provider_final_attempt_elapsed_ms = selectedProviderAttempt?.result?.error?.details?.finalAttemptElapsedMs
      ?? selectedProviderAttempt?.result?.diagnostics?.ollama?.finalAttemptElapsedMs
      ?? null;
    executionMetadata.selected_provider_initial_failure_layer = selectedProviderAttempt?.result?.error?.details?.initialProviderFailureLayer
      || selectedProviderAttempt?.result?.diagnostics?.ollama?.initialProviderFailureLayer
      || null;
    executionMetadata.selected_provider_initial_failure_label = selectedProviderAttempt?.result?.error?.details?.initialProviderFailureLabel
      || selectedProviderAttempt?.result?.diagnostics?.ollama?.initialProviderFailureLabel
      || null;
    executionMetadata.selected_provider_initial_failure_phase = selectedProviderAttempt?.result?.error?.details?.initialProviderFailurePhase
      || selectedProviderAttempt?.result?.diagnostics?.ollama?.initialProviderFailurePhase
      || null;
    executionMetadata.selected_provider_initial_timeout_category = selectedProviderAttempt?.result?.error?.details?.initialProviderTimeoutCategory
      || selectedProviderAttempt?.result?.diagnostics?.ollama?.initialProviderTimeoutCategory
      || null;
    executionMetadata.selected_provider_final_execution_outcome = selectedProviderAttempt?.result?.error?.details?.finalExecutionOutcome
      || selectedProviderAttempt?.result?.diagnostics?.ollama?.finalExecutionOutcome
      || (selectedProviderAttempt?.result?.ok ? 'success' : 'error');
    executionMetadata.selected_provider_fallback_after_warmup_retry = Boolean(
      executionMetadata.fallback_used
      && executionMetadata.actual_provider_used !== executionMetadata.selected_provider
      && executionMetadata.selected_provider_warmup_retry_applied === true,
    );
    executionMetadata.selected_provider_elapsed_ms = selectedProviderAttempt?.result?.error?.details?.elapsedMs
      || selectedProviderAttempt?.result?.diagnostics?.ollama?.elapsedMs
      || null;
    const selectedProviderFailureDetails = selectedProviderAttempt?.result?.error?.details || {};
    const selectedProviderOllamaDiagnostics = selectedProviderAttempt?.result?.diagnostics?.ollama || {};
    const timeoutFailureLayer = selectedProviderFailureDetails.failureLayer || executionMetadata.selected_provider_execution_failure_layer || null;
    executionMetadata.ui_timeout_triggered = timeoutFailureLayer === 'ui' || executionMetadata.timeout_failure_layer === 'ui';
    executionMetadata.backend_timeout_triggered = timeoutFailureLayer === 'backend' || timeoutFailureLayer === 'provider';
    executionMetadata.abort_forwarded_to_ollama_fetch = Boolean(
      executionMetadata.ollama_abort_sent
      || selectedProviderFailureDetails.abortSource
      || selectedProviderOllamaDiagnostics.ollamaFetchAborted,
    );
    executionMetadata.ollama_fetch_aborted = Boolean(
      selectedProviderFailureDetails.abortSource
      || selectedProviderOllamaDiagnostics.ollamaFetchAborted,
    );
    executionMetadata.ollama_reader_cancelled = Boolean(
      selectedProviderFailureDetails.ollamaReaderCancelled
      || selectedProviderOllamaDiagnostics.ollamaReaderCancelled,
    );
    executionMetadata.provider_generation_still_running_unknown = Boolean(
      executionMetadata.ollama_abort_sent
      && executionMetadata.actual_provider_used === 'ollama'
      && !executionMetadata.ollama_reader_cancelled,
    );
    executionMetadata.provider_generation_confirmed_stopped = Boolean(
      executionMetadata.actual_provider_used !== 'ollama'
      || !executionMetadata.ollama_abort_sent
      || executionMetadata.ollama_reader_cancelled,
    );
    executionMetadata.cancellation_effectiveness = executionMetadata.ollama_abort_sent
      ? (executionMetadata.provider_generation_confirmed_stopped ? 'attempted-confirmed' : 'attempted-unknown')
      : 'not-needed';
    executionMetadata.explicit_provider_fallback_policy_triggered = Boolean(
      executionMetadata.fallback_used && executionMetadata.actual_provider_used !== executionMetadata.selected_provider,
    );
    const requestTrace = {
      ui_requested_provider: provider,
      backend_default_provider: DEFAULT_PROVIDER_KEY,
      requested_provider: executionMetadata.requested_provider_for_request,
      routing_requested_provider: executionMetadata.routing_requested_provider,
      selected_provider: executionMetadata.selected_provider,
      actual_provider_used: executionMetadata.actual_provider_used,
      model_used: executionMetadata.model_used,
      ollama_model_default: executionMetadata.ollama_model_default,
      ollama_model_preferred: executionMetadata.ollama_model_preferred,
      ollama_model_requested: executionMetadata.ollama_model_requested,
      ollama_model_selected: executionMetadata.ollama_model_selected,
      ollama_reasoning_mode: executionMetadata.ollama_reasoning_mode,
      ollama_escalation_active: executionMetadata.ollama_escalation_active,
      ollama_escalation_reason: executionMetadata.ollama_escalation_reason,
      fast_response_lane_eligible: executionMetadata.fast_response_lane_eligible,
      fast_response_lane_active: executionMetadata.fast_response_lane_active,
      fast_response_lane_reason: executionMetadata.fast_response_lane_reason,
      fast_response_model: executionMetadata.fast_response_model,
      fast_response_streaming: executionMetadata.fast_response_streaming,
      escalation_model: executionMetadata.escalation_model,
      escalation_reason: executionMetadata.escalation_reason,
      streaming_requested: executionMetadata.streaming_requested,
      streaming_mode_preference: executionMetadata.streaming_mode_preference,
      streaming_mode_preference_input: executionMetadata.streaming_mode_preference_input,
      streaming_request_source: executionMetadata.streaming_request_source,
      streaming_policy_decision: executionMetadata.streaming_policy_decision,
      streaming_policy_reason: executionMetadata.streaming_policy_reason,
      streaming_supported: executionMetadata.streaming_supported,
      streaming_used: executionMetadata.streaming_used,
      streaming_provider: executionMetadata.streaming_provider,
      streaming_model: executionMetadata.streaming_model,
      streaming_finalized: executionMetadata.streaming_finalized,
      streaming_fallback_reason: executionMetadata.streaming_fallback_reason,
      execution_cancelled: executionMetadata.execution_cancelled,
      cancellation_source: executionMetadata.cancellation_source,
      provider_cancelled: executionMetadata.provider_cancelled,
      provider_cancel_reason: executionMetadata.provider_cancel_reason,
      ollama_abort_sent: executionMetadata.ollama_abort_sent,
      ui_timeout_triggered: executionMetadata.ui_timeout_triggered,
      backend_timeout_triggered: executionMetadata.backend_timeout_triggered,
      abort_signal_created: executionMetadata.abort_signal_created,
      abort_signal_fired: executionMetadata.abort_signal_fired,
      abort_forwarded_to_router: executionMetadata.abort_forwarded_to_router,
      abort_forwarded_to_provider: executionMetadata.abort_forwarded_to_provider,
      abort_forwarded_to_ollama_fetch: executionMetadata.abort_forwarded_to_ollama_fetch,
      ollama_fetch_aborted: executionMetadata.ollama_fetch_aborted,
      ollama_reader_cancelled: executionMetadata.ollama_reader_cancelled,
      provider_generation_still_running_unknown: executionMetadata.provider_generation_still_running_unknown,
      provider_generation_confirmed_stopped: executionMetadata.provider_generation_confirmed_stopped,
      cancellation_effectiveness: executionMetadata.cancellation_effectiveness,
      ollama_fallback_model: executionMetadata.ollama_fallback_model,
      ollama_fallback_model_used: executionMetadata.ollama_fallback_model_used,
      ollama_fallback_reason: executionMetadata.ollama_fallback_reason,
      ollama_timeout_ms: executionMetadata.ollama_timeout_ms,
      ollama_timeout_source: executionMetadata.ollama_timeout_source,
      ollama_timeout_model: executionMetadata.ollama_timeout_model,
      fallback_used: executionMetadata.fallback_used,
      fallback_reason: executionMetadata.fallback_reason,
      fallback_provider_used: executionMetadata.fallback_provider_used,
      selected_provider_health_ok: executionMetadata.selected_provider_health_ok,
      selected_provider_health_state: executionMetadata.selected_provider_health_state,
      selected_provider_execution_viability: executionMetadata.selected_provider_execution_viability,
      selected_provider_execution_failure_layer: executionMetadata.selected_provider_execution_failure_layer,
      selected_provider_execution_failure_label: executionMetadata.selected_provider_execution_failure_label,
      selected_provider_execution_failure_phase: executionMetadata.selected_provider_execution_failure_phase,
      selected_provider_timeout_category: executionMetadata.selected_provider_timeout_category,
      selected_provider_model_warmup_likely: executionMetadata.selected_provider_model_warmup_likely,
      selected_provider_warmup_retry_applied: executionMetadata.selected_provider_warmup_retry_applied,
      selected_provider_warmup_retry_timeout_ms: executionMetadata.selected_provider_warmup_retry_timeout_ms,
      selected_provider_warmup_retry_eligible: executionMetadata.selected_provider_warmup_retry_eligible,
      selected_provider_warmup_retry_reason: executionMetadata.selected_provider_warmup_retry_reason,
      selected_provider_warmup_retry_attempt_count: executionMetadata.selected_provider_warmup_retry_attempt_count,
      selected_provider_first_attempt_elapsed_ms: executionMetadata.selected_provider_first_attempt_elapsed_ms,
      selected_provider_final_attempt_elapsed_ms: executionMetadata.selected_provider_final_attempt_elapsed_ms,
      selected_provider_initial_failure_layer: executionMetadata.selected_provider_initial_failure_layer,
      selected_provider_initial_failure_label: executionMetadata.selected_provider_initial_failure_label,
      selected_provider_initial_failure_phase: executionMetadata.selected_provider_initial_failure_phase,
      selected_provider_initial_timeout_category: executionMetadata.selected_provider_initial_timeout_category,
      selected_provider_final_execution_outcome: executionMetadata.selected_provider_final_execution_outcome,
      selected_provider_fallback_after_warmup_retry: executionMetadata.selected_provider_fallback_after_warmup_retry,
      selected_provider_elapsed_ms: executionMetadata.selected_provider_elapsed_ms,
      explicit_provider_fallback_policy_triggered: executionMetadata.explicit_provider_fallback_policy_triggered,
      effective_answer_mode: executionMetadata.effective_answer_mode,
      freshness_required_for_truth: executionMetadata.freshness_required_for_truth,
      fresh_answer_required: executionMetadata.fresh_answer_required,
      fresh_provider_available_for_request: executionMetadata.fresh_provider_available_for_request,
      fresh_provider_attempted: executionMetadata.fresh_provider_attempted,
      fresh_provider_succeeded: executionMetadata.fresh_provider_succeeded,
      fresh_provider_failure_reason: executionMetadata.fresh_provider_failure_reason,
      stale_fallback_permitted: executionMetadata.stale_fallback_permitted,
      stale_fallback_attempted: executionMetadata.stale_fallback_attempted,
      stale_fallback_used: executionMetadata.stale_fallback_used,
      stale_answer_warning: executionMetadata.stale_answer_warning,
      answer_truth_mode: executionMetadata.answer_truth_mode,
      freshness_integrity_preserved: executionMetadata.freshness_integrity_preserved,
      freshness_integrity_failure_reason: executionMetadata.freshness_integrity_failure_reason,
      freshness_truth_reason: executionMetadata.freshness_truth_reason,
      freshness_next_actions: executionMetadata.freshness_next_actions,
      config_grounding_enabled: executionMetadata.config_grounding_enabled,
      grounding_active_for_request: executionMetadata.grounding_active_for_request,
      freshness_need: freshnessContext?.freshnessNeed || 'low',
      freshness_reason: freshnessContext?.freshnessReason || 'n/a',
      stale_risk: freshnessContext?.staleRisk || 'low',
      selected_answer_mode: routeDecision?.selectedAnswerMode || 'local-private',
      override_denial_reason: routeDecision?.overrideDeniedReason || null,
      freshness_warning: routeDecision?.freshnessWarning || llmResult.diagnostics?.routing?.freshnessWarning || null,
      freshness_routed: Boolean(routeDecision?.freshnessRouted),
      ai_policy_mode: routeDecision?.aiPolicy?.aiPolicyMode || 'local-first-cloud-when-needed',
      ai_policy_reason: routeDecision?.policyReason || 'Local-first policy applied.',
      route_mode: routeMode,
      requested_route_mode: executionMetadata.requested_route_mode,
      effective_route_mode: executionMetadata.effective_route_mode,
      provider_selection_source: executionMetadata.provider_selection_source,
      provider_intent_ui: executionMetadata.provider_intent_ui,
      provider_request_policy: executionMetadata.provider_request_policy,
      provider_selected_policy: executionMetadata.provider_selected_policy,
      provider_executed_actual: executionMetadata.provider_executed_actual,
      configured_model: executionMetadata.configured_model,
      requested_model: executionMetadata.requested_model,
      selected_model: executionMetadata.selected_model,
      executed_model: executionMetadata.executed_model,
      model_selection_reason: executionMetadata.model_selection_reason,
      model_policy_override_applied: executionMetadata.model_policy_override_applied,
      model_policy_override_reason: executionMetadata.model_policy_override_reason,
      groq_endpoint_used: executionMetadata.groq_endpoint_used,
      groq_model_used: executionMetadata.groq_model_used,
      groq_fresh_web_active: executionMetadata.groq_fresh_web_active,
      groq_fresh_web_candidate_available: executionMetadata.groq_fresh_web_candidate_available,
      groq_fresh_candidate_model: executionMetadata.groq_fresh_candidate_model,
      groq_fresh_web_path: executionMetadata.groq_fresh_web_path,
      groq_capability_reason: executionMetadata.groq_capability_reason,
      zero_cost_policy: executionMetadata.zero_cost_policy,
      paid_fresh_routes_enabled: executionMetadata.paid_fresh_routes_enabled,
      fresh_capability_mode: executionMetadata.fresh_capability_mode,
      retrieval_mode: executionMetadata.retrieval_mode,
      retrieval_eligible: executionMetadata.retrieval_eligible,
      retrieval_used: executionMetadata.retrieval_used,
      retrieval_reason: executionMetadata.retrieval_reason,
      retrieved_chunk_count: executionMetadata.retrieved_chunk_count,
      retrieved_sources: executionMetadata.retrieved_sources,
      retrieval_query: executionMetadata.retrieval_query,
      retrieval_index_status: executionMetadata.retrieval_index_status,
      memory_eligible: executionMetadata.memory_eligible,
      memory_promoted: executionMetadata.memory_promoted,
      memory_reason: executionMetadata.memory_reason,
      memory_source_type: executionMetadata.memory_source_type,
      memory_source_ref: executionMetadata.memory_source_ref,
      memory_confidence: executionMetadata.memory_confidence,
      memory_class: executionMetadata.memory_class,
      intent_detected: executionMetadata.intent_detected,
      intent_type: executionMetadata.intent_type,
      intent_confidence: executionMetadata.intent_confidence,
      proposal_created: executionMetadata.proposal_created,
      proposal_status: executionMetadata.proposal_status,
      proposal_reason: executionMetadata.proposal_reason,
      proposal_step_count: executionMetadata.proposal_step_count,
      execution_eligible: executionMetadata.execution_eligible,
      execution_started: executionMetadata.execution_started,
      execution_completed: executionMetadata.execution_completed,
      execution_blocked_reason: executionMetadata.execution_blocked_reason,
      execution_result_summary: executionMetadata.execution_result_summary,
      provider_resolution: requestTraceResolutionTruth.provider_resolution,
      secondary_diagnostics: {
        ...(requestTraceResolutionTruth.secondary_diagnostics || {}),
        config_grounding_enabled: executionMetadata.config_grounding_enabled,
      },
    };
    const providerExecutionTruth = resolveProviderExecutionTruth({
      actualProviderUsed: executionMetadata.actual_provider_used,
      executionStatus: executionMetadata.provider_answered ? `ok:${executionMetadata.actual_provider_used}` : 'failed',
      executableProvider: executionMetadata.executable_provider,
      selectedProvider: executionMetadata.selected_provider,
      backendDefaultProvider: executionMetadata.backend_default_provider,
      requestedProviderForRequest: executionMetadata.requested_provider_for_request,
      fallbackUsed: executionMetadata.fallback_used,
      fallbackProviderUsed: executionMetadata.fallback_provider_used,
      fallbackReason: executionMetadata.fallback_reason,
    });
    console.info('[PROVIDER EXECUTION]', {
      requested: executionMetadata.requested_provider,
      selected: executionMetadata.selected_provider,
      executable: executionMetadata.executable_provider || 'none',
      actual: executionMetadata.actual_provider_used || 'none',
      mode: executionMetadata.selected_answer_mode || 'unknown',
      route: normalizedRuntimeContext.sessionKind || 'unknown',
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
      const failurePayload = buildErrorResponse({
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
          freshness_next_actions: executionMetadata.freshness_next_actions,
          assistant_context: contextBundle,
          relevant_memory: memoryHits,
          tile_context_diagnostics: assembledTileContext?.diagnostics || null,
          retrieval_truth: retrieval.truth,
          retrieval_status: localRetrievalService.getStatus(),
          intent_proposal_truth: intentProposalEnvelope,
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
      });
      if (streamingEnabled) {
        res.status(200);
        res.setHeader('Content-Type', STREAMING_MEDIA_TYPE);
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        writeSseEvent(res, 'final', {
          type: 'final',
          content: failurePayload.output_text || '',
          done: true,
        });
      writeSseEvent(res, 'metadata', {
        type: 'metadata',
        done: true,
        success: false,
        data: failurePayload,
      });
      writeSseCompletion(res, false);
      return res.end();
    }
      return res.status(502).json(failurePayload);
    }

    persistAiContinuityArtifacts({
      prompt,
      route: decision.route,
      executionMetadata,
      outputText: llmResult.outputText,
      memoryHits,
      tileContext: assembledTileContext,
    });

    const successPayload = buildSuccessResponse({
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
        freshness_next_actions: executionMetadata.freshness_next_actions,
        assistant_context: contextBundle,
        relevant_memory: memoryHits,
        suggested_actions: [{ label: 'List pending proposals', command: '/proposals list' }, { label: 'View recent activity', command: '/activity recent' }],
        tile_context_diagnostics: assembledTileContext?.diagnostics || null,
        retrieval_truth: retrieval.truth,
        retrieval_status: localRetrievalService.getStatus(),
        intent_proposal_truth: intentProposalEnvelope,
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
    });
    if (streamingEnabled) {
      res.status(200);
      res.setHeader('Content-Type', STREAMING_MEDIA_TYPE);
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      writeSseEvent(res, 'final', {
        type: 'final',
        content: llmResult.outputText,
        done: true,
      });
      writeSseEvent(res, 'metadata', {
        type: 'metadata',
        done: true,
        success: true,
        data: successPayload,
      });
      writeSseCompletion(res, true);
      return res.end();
    }
    return res.json(successPayload);
  } catch (error) {
    if (requestAbortController.signal.aborted || error?.name === 'AbortError') {
      logger.info('Client disconnected; AI execution cancelled.', {
        requestId,
        cancellationSource: cancellationSource || 'client-disconnect',
      });
      if (!res.headersSent) {
        return res.status(499).json({
          success: false,
          error: 'Request cancelled by client disconnect.',
          error_code: 'REQUEST_CANCELLED',
          data: {
            execution_metadata: {
              execution_cancelled: true,
              cancellation_source: cancellationSource || 'client-disconnect',
              provider_cancelled: true,
              provider_cancel_reason: 'client disconnected before completion',
              ollama_abort_sent: true,
              ui_timeout_triggered: false,
              backend_timeout_triggered: false,
              abort_signal_created: true,
              abort_signal_fired: true,
              abort_forwarded_to_router: true,
              abort_forwarded_to_provider: true,
              abort_forwarded_to_ollama_fetch: true,
              ollama_fetch_aborted: true,
              ollama_reader_cancelled: true,
              provider_generation_still_running_unknown: false,
              provider_generation_confirmed_stopped: true,
              cancellation_effectiveness: 'attempted-confirmed',
            },
          },
        });
      }
      return res.end();
    }
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
