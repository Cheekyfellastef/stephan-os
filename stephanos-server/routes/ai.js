import express from 'express';
import { getAIResponse } from '../services/openaiService.js';
import { memoryService } from '../services/memoryService.js';
import { listAvailableAgents, runTool } from '../services/toolRouter.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ai-route');
const router = express.Router();

function classifyRoute(input = '') {
  const normalized = input.toLowerCase();
  if (normalized.includes('/simulate') || normalized.includes('simulation')) return 'simulation';
  if (normalized.includes('/kg') || normalized.includes('knowledge graph')) return 'knowledge_graph';
  if (normalized.includes('/vrlab') || normalized.includes('vr')) return 'vr_lab';
  if (normalized.includes('research')) return 'research';
  if (normalized.startsWith('/')) return 'command';
  return 'assistant';
}

router.post('/chat', async (req, res) => {
  const startedAt = Date.now();
  const { prompt, parsedCommand } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ success: false, error: 'Prompt is required.' });
  }

  const route = classifyRoute(prompt);
  const toolsUsed = [];
  const memoryHits = memoryService.getRelevantMemory(prompt);

  try {
    if (parsedCommand?.name === 'status') {
      toolsUsed.push('getSystemStatus');
      const toolResult = await runTool('getSystemStatus');
      return res.json({
        success: true,
        output_text: `System status: ${toolResult.status}`,
        route,
        tools_used: toolsUsed,
        memory_hits: memoryHits,
        debug: {
          parsedCommand,
          selected_route: route,
          tool_results: [toolResult],
          timing_ms: Date.now() - startedAt,
        },
      });
    }

    if (parsedCommand?.name === 'agents') {
      toolsUsed.push('listAvailableAgents');
      const agents = await listAvailableAgents();
      return res.json({
        success: true,
        output_text: `Available agents: ${agents.map((a) => a.id).join(', ')}`,
        route,
        tools_used: toolsUsed,
        memory_hits: memoryHits,
        debug: {
          parsedCommand,
          selected_route: route,
          tool_results: [{ agents }],
          timing_ms: Date.now() - startedAt,
        },
      });
    }

    const aiResult = await getAIResponse({
      userInput: prompt,
      context: {
        route,
        parsedCommand,
        memoryHits,
      },
    });

    memoryService.saveMemory({ content: prompt, tags: [route] });

    return res.json({
      success: true,
      output_text: aiResult.outputText,
      route,
      tools_used: toolsUsed,
      memory_hits: memoryHits,
      debug: {
        parsedCommand,
        selected_route: route,
        tool_results: [],
        openai_response_id: aiResult.responseId,
        usage: aiResult.usage,
        timing_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    logger.error('Failed to process /api/ai/chat', { message: error.message });
    return res.status(500).json({
      success: false,
      error: 'AI request failed.',
      output_text: 'The AI Core encountered an error. Check debug console for details.',
      route,
      tools_used: toolsUsed,
      memory_hits: memoryHits,
      debug: {
        parsedCommand,
        selected_route: route,
        tool_results: [],
        error: error.message,
        timing_ms: Date.now() - startedAt,
      },
    });
  }
});

export default router;
