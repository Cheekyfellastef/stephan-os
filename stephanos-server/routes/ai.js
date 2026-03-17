import express from 'express';
import { getAIResponse, isAIServiceAvailable } from '../services/openaiService.js';
import { memoryService } from '../services/memoryService.js';
import { executeTool } from '../services/toolRegistry.js';
import { parseCommand, resolveRoute } from '../services/commandRouter.js';
import { buildErrorResponse, buildSuccessResponse } from '../services/responseBuilder.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ai-route');
const router = express.Router();

function isUserInputError(message = '') {
  return [
    'Usage:',
    'requires',
    'cannot be empty',
    'was not found',
    'does not exist',
    'Duplicate edge',
    'already exists',
    'not allowed',
    'Unknown /memory subcommand',
  ].some((fragment) => message.includes(fragment));
}

router.post('/chat', async (req, res) => {
  const startedAt = Date.now();
  const { prompt } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json(buildErrorResponse({
      route: 'assistant',
      output_text: 'Prompt is required.',
      error: 'Prompt is required.',
      timing_ms: Date.now() - startedAt,
      debug: { route_reason: 'Input validation failed' },
    }));
  }

  const parsedCommand = parseCommand(prompt);
  const decision = resolveRoute(parsedCommand, prompt);
  const memoryHits = memoryService.getRelevantMemory(prompt);
  const requestId = req.headers['x-request-id'];

  try {
    if (decision.action === 'help') {
      return res.json(buildSuccessResponse({
        type: 'tool_result',
        route: decision.route,
        command: '/help',
        output_text: 'Commands: /help /status /tools /agents /memory /memory list /memory save <text> /memory find <query> /kg /kg status /kg stats /kg list nodes /kg list edges /kg add node <label> --type <type> --description <text> --tags <comma tags> /kg add edge <from> <to> --type <type> --label <label> /kg search <query> /kg related <nodeId> /kg help /clear',
        data: {
          commands: ['/help', '/status', '/tools', '/agents', '/memory', '/memory list', '/memory save <text>', '/memory find <query>', '/kg', '/kg status', '/kg stats', '/kg list nodes', '/kg list edges', '/kg add node <label> --type <type> --description <text> --tags <comma tags>', '/kg add edge <from> <to> --type <type> --label <label>', '/kg search <query>', '/kg related <nodeId>', '/kg help', '/clear'],
        },
        timing_ms: Date.now() - startedAt,
        debug: { parsed_command: parsedCommand, route_reason: decision.reason, request_id: requestId },
      }));
    }

    if (decision.action === 'memory_help') {
      return res.json(buildSuccessResponse({
        type: 'memory_result',
        route: decision.route,
        command: '/memory',
        output_text: 'Memory commands: /memory list, /memory save <text>, /memory find <query>.',
        data: { commands: ['list', 'save', 'find'] },
        memory_hits: memoryHits,
        timing_ms: Date.now() - startedAt,
        debug: { parsed_command: parsedCommand, route_reason: decision.reason, request_id: requestId },
      }));
    }

    if (decision.action === 'kg_help') {
      return res.json(buildSuccessResponse({
        type: 'tool_result',
        route: 'kg',
        command: '/kg help',
        output_text: 'Knowledge graph commands: /kg status /kg stats /kg list nodes /kg list edges /kg add node <label> --type <type> --description <text> --tags <csv> /kg add edge <from> <to> --type <type> --label <label> /kg search <query> /kg related <nodeId>.',
        data: {
          commands: ['status', 'stats', 'list nodes', 'list edges', 'add node', 'add edge', 'search', 'related'],
        },
        timing_ms: Date.now() - startedAt,
        debug: { parsed_command: parsedCommand, route_reason: decision.reason, request_id: requestId },
      }));
    }

    if (decision.action === 'clear') {
      return res.json(buildSuccessResponse({
        type: 'tool_result',
        route: decision.route,
        command: '/clear',
        output_text: 'Console clear acknowledged on backend.',
        timing_ms: Date.now() - startedAt,
        debug: { parsed_command: parsedCommand, route_reason: decision.reason, request_id: requestId },
      }));
    }

    if (
      decision.action === 'invalid_memory_subcommand'
      || decision.action === 'invalid_command'
      || decision.action === 'invalid_kg_subcommand'
    ) {
      const errorMessage = decision.action === 'invalid_memory_subcommand'
        ? 'Unknown /memory subcommand. Use list, save, or find.'
        : decision.action === 'invalid_kg_subcommand'
          ? 'Unknown /kg subcommand. Use /kg help.'
          : `Unknown command /${parsedCommand.command}. Use /help.`;

      return res.status(400).json(buildErrorResponse({
        route: decision.route,
        command: parsedCommand.isSlash ? `/${parsedCommand.command}` : null,
        output_text: 'Invalid command.',
        error: errorMessage,
        memory_hits: memoryHits,
        timing_ms: Date.now() - startedAt,
        debug: { parsed_command: parsedCommand, route_reason: decision.reason, request_id: requestId },
      }));
    }

    if (decision.tool) {
      const toolStart = Date.now();
      const { tool, result } = await executeTool(decision.tool, decision.args, {
        aiAvailable: isAIServiceAvailable(),
      });

      return res.json(buildSuccessResponse({
        type: decision.route === 'memory' ? 'memory_result' : 'tool_result',
        route: decision.route,
        command: parsedCommand.raw,
        output_text: result.output_text,
        data: result.data,
        tools_used: [tool.name],
        memory_hits: decision.route === 'memory' ? [] : memoryHits,
        timing_ms: Date.now() - startedAt,
        debug: {
          parsed_command: parsedCommand,
          route_reason: decision.reason,
          request_id: requestId,
          selected_tool: tool.name,
          tool_state: tool.state,
          tool_args: decision.args ?? null,
          graph_action: tool.category === 'knowledge_graph' ? tool.name : null,
          result_summary: {
            output_text: result.output_text,
            keys: Object.keys(result.data ?? {}),
          },
          tool_timing_ms: Date.now() - toolStart,
          storage_outcome: tool.category === 'knowledge_graph' ? 'Graph store operation completed' : null,
        },
      }));
    }

    const aiResult = await getAIResponse({
      userInput: prompt,
      context: {
        route: decision.route,
        parsed_command: parsedCommand,
        memory_hits: memoryHits,
      },
    });

    return res.json(buildSuccessResponse({
      type: 'assistant_response',
      route: decision.route,
      command: parsedCommand.isSlash ? parsedCommand.raw : null,
      output_text: aiResult.outputText,
      data: {
        openai_response_id: aiResult.responseId,
        usage: aiResult.usage,
      },
      memory_hits: memoryHits,
      timing_ms: Date.now() - startedAt,
      debug: {
        parsed_command: parsedCommand,
        route_reason: decision.reason,
        request_id: requestId,
      },
    }));
  } catch (error) {
    logger.error('Failed to process /api/ai/chat', { message: error.message });
    const statusCode = isUserInputError(error.message) ? 400 : 500;
    return res.status(statusCode).json(buildErrorResponse({
      route: decision.route,
      command: parsedCommand.isSlash ? parsedCommand.raw : null,
      output_text: 'The AI Core encountered an error.',
      error: error.message,
      memory_hits: memoryHits,
      timing_ms: Date.now() - startedAt,
      debug: {
        parsed_command: parsedCommand,
        route_reason: decision.reason,
        request_id: requestId,
        tool_args: decision.args ?? null,
      },
    }));
  }
});

export default router;
