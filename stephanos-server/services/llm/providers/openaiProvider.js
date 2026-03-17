import { getAIResponse } from '../../openaiService.js';

export async function runOpenAIProvider({ prompt, context }) {
  const aiResult = await getAIResponse({ userInput: prompt, context });

  return {
    output_text: aiResult.outputText,
    provider: 'openai',
    model: process.env.OPENAI_MODEL || 'gpt-5.4',
    raw: {
      response_id: aiResult.responseId,
      usage: aiResult.usage,
    },
  };
}
