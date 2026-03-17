import { EMPTY_RESPONSE } from './aiTypes';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 30000);

export async function sendPrompt({ prompt }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const payload = { prompt };

  try {
    const response = await fetch(`${BASE_URL}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const json = await response.json();

    if (!response.ok) {
      return { data: { ...EMPTY_RESPONSE, ...json }, requestPayload: payload };
    }

    return { data: { ...EMPTY_RESPONSE, ...json }, requestPayload: payload };
  } finally {
    clearTimeout(timeout);
  }
}
