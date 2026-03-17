import { createLogger } from '../utils/logger';

const logger = createLogger('ai-client');
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 30000);

export async function sendPrompt({ prompt, parsedCommand }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const payload = { prompt, parsedCommand };

  try {
    const response = await fetch(`${BASE_URL}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const json = await response.json();

    if (!response.ok || !json?.success) {
      throw new Error(json?.error || `Request failed with HTTP ${response.status}`);
    }

    logger.info('AI response received', json);
    return { data: json, requestPayload: payload };
  } catch (error) {
    logger.error('AI request failed', { message: error.message });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
