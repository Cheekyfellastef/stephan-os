import { runMockProvider, checkMockHealth } from './mockProvider.js';
import { runGroqProvider, checkGroqHealth } from './groqProvider.js';
import { runGeminiProvider, checkGeminiHealth } from './geminiProvider.js';
import { runOllamaProvider, checkOllamaHealth } from './ollamaProvider.js';
import { runOpenrouterProvider, checkOpenrouterHealth } from './openrouterProvider.js';

export const PROVIDER_RUNNERS = {
  mock: runMockProvider,
  groq: runGroqProvider,
  gemini: runGeminiProvider,
  ollama: runOllamaProvider,
  openrouter: runOpenrouterProvider,
};

export const PROVIDER_HEALTH_CHECKS = {
  mock: checkMockHealth,
  groq: checkGroqHealth,
  gemini: checkGeminiHealth,
  ollama: checkOllamaHealth,
  openrouter: checkOpenrouterHealth,
};
