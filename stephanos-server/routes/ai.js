import express from 'express';
import { isAIServiceAvailable } from '../services/openaiService.js';
import { memoryService } from '../services/memoryService.js';
import { executeTool } from '../services/toolRegistry.js';
import { parseCommand, resolveRoute } from '../services/commandRouter.js';
import { buildErrorResponse, buildSuccessResponse } from '../services/responseBuilder.js';
import { createLogger } from '../utils/logger.js';
import { ERROR_CODES, normalizeError } from '../services/errors.js';
import { assistantContextService } from '../services/assistantContextService.js';
import { routeLLMRequest } from '../services/llm/providerRouter.js';

const logger = createLogger('ai-route');
const router = express.Router();

const helpText = 'Commands: /help /status /subsystems /tools /agents /memory /memory list /memory save <text> /memory find <query> /memory propose <id|recent> /proposals /proposals list /proposals stats /proposals show <id> /proposals accept <id> /proposals reject <id> /activity /activity list /activity recent /activity show <id> /roadmap /roadmap list /roadmap add <text> /roadmap done <id> /roadmap show <id> /kg help /simulate help /simulate history list /simulate history show <runId> /simulate history clear /simulate compare <runIdA> <runIdB> /clear';

router.post('/chat', async (req, res) => {
  const startedAt = Date.now();
  const { prompt, provider = 'openai', providerConfig = {} } = req.body || {};
  const requestId = req.headers['x-request-id'];

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json(buildErrorResponse({ route: 'assistant', output_text: 'Prompt is required.', error: 'Prompt is required.', error_code: ERROR_CODES.CMD_INVALID, timing_ms: Date.now() - startedAt, debug: { route_reason: 'Input validation failed', request_id: requestId } }));
  }

  const parsedCommand = parseCommand(prompt);
  const decision = resolveRoute(parsedCommand, prompt);
  const memoryHits = memoryService.getRelevantMemory(prompt);

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
      const { tool, result } = await executeTool(decision.tool, decision.args, { aiAvailable: isAIServiceAvailable() });
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
    const llmResult = await routeLLMRequest({
      prompt,
      provider,
      providerConfig,
      context: {
        route: decision.route,
        parsed_command: parsedCommand,
        memory_hits: memoryHits,
        subsystem_context: contextBundle,
      },
    });
    return res.json(buildSuccessResponse({
      type: 'assistant_response',
      route: decision.route,
      command: parsedCommand.isSlash ? parsedCommand.raw : null,
      output_text: llmResult.output_text,
      data: {
        provider: llmResult.provider,
        provider_model: llmResult.model,
        provider_raw: llmResult.raw,
        assistant_context: contextBundle,
        suggested_actions: [{ label: 'List pending proposals', command: '/proposals list' }, { label: 'View recent activity', command: '/activity recent' }],
      },
      memory_hits: memoryHits,
      timing_ms: Date.now() - startedAt,
      debug: {
        parsed_command: parsedCommand,
        route_reason: decision.reason,
        request_id: requestId,
        llm_provider: llmResult.provider,
        llm_model: llmResult.model,
      },
    }));
  } catch (error) {
    const appError = normalizeError(error);
    logger.error('Failed to process /api/ai/chat', { message: appError.message, code: appError.code });
    return res.status(appError.status ?? 500).json(buildErrorResponse({ route: decision.route, command: parsedCommand.isSlash ? parsedCommand.raw : null, output_text: 'The AI Core encountered an error.', error: appError.message, error_code: appError.code, memory_hits: memoryHits, timing_ms: Date.now() - startedAt, debug: { request_id: requestId, parsed_command: parsedCommand, selected_subsystem: decision.route, selected_tool: decision.tool ?? null, execution_payload: decision.args ?? null, error_code: appError.code } }));
  }
});

export default router;
