import { getAIResponse } from '../../openaiService.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('openai-provider');

export async function runOpenAIProvider({ prompt, context }) {
  logger.info('Resolved OpenAI provider config', {
    provider: 'openai',
    model: process.env.OPENAI_MODEL || 'gpt-5.4',
    configSource: process.env.OPENAI_MODEL ? 'env-default' : 'service-default',
  });

  const aiResult = await getAIResponse({ userInput: prompt, context });

  return {
    output_text: aiResult.outputText,
    provider: 'openai',
    model: process.env.OPENAI_MODEL || 'gpt-5.4',
    raw: {
      response_id: aiResult.responseId,
      usage: aiResult.usage,
    },
    diagnostics: {
      provider: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-5.4',
      configSource: process.env.OPENAI_MODEL ? 'env-default' : 'service-default',
    },
  };
}
