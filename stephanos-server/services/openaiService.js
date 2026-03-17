import OpenAI from 'openai';
import { createLogger } from '../utils/logger.js';
import { buildSystemPrompt } from './systemPrompt.js';

const logger = createLogger('openai-service');

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildInput(userInput, context = {}) {
  return [
    {
      role: 'system',
      content: [{ type: 'input_text', text: buildSystemPrompt() }],
    },
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: JSON.stringify({
            prompt: userInput,
            context,
            instruction: 'Provide concise, practical guidance for Stephanos OS operation.',
          }),
        },
      ],
    },
  ];
}

export function isAIServiceAvailable() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function getAIResponse({ userInput, context = {} }) {
  if (!isAIServiceAvailable()) {
    throw new Error('OPENAI_API_KEY is missing. Configure stephanos-server/.env first.');
  }

  const startedAt = Date.now();

  try {
    const response = await client.responses.create({
      model: MODEL,
      input: buildInput(userInput, context),
      temperature: 0.3,
    }, {
      timeout: REQUEST_TIMEOUT_MS,
    });

    const outputText = response.output_text || 'No output_text returned.';

    logger.info('OpenAI Responses API request complete', {
      model: MODEL,
      elapsed_ms: Date.now() - startedAt,
    });

    return {
      outputText,
      usage: response.usage,
      responseId: response.id,
      raw: response,
    };
  } catch (error) {
    logger.error('OpenAI request failed', {
      message: error?.message,
      status: error?.status,
    });
    throw error;
  }
}
