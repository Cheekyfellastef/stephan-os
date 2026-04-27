function normalizeAnswerText(message) {
  if (!message || typeof message !== 'object') return '';
  const outputText = message.output_text
    ?? message.outputText
    ?? message.response?.output_text
    ?? message.response?.outputText
    ?? message.response?.data?.output_text
    ?? message.response?.error
    ?? '';
  if (outputText === null || outputText === undefined) return '';
  return String(outputText).trim();
}

function normalizeDebugPayload(message) {
  const payload = {
    ...(message?.data_payload && typeof message.data_payload === 'object' ? { data_payload: message.data_payload } : {}),
    ...(message?.response?.debug && typeof message.response.debug === 'object' ? { response_debug: message.response.debug } : {}),
  };
  return Object.keys(payload).length > 0 ? payload : null;
}

function appendStructuredValue(target, key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  if (Object.keys(value).length === 0) return;
  target[key] = value;
}

export function getAssistantMessageStructuredData(message) {
  const structured = {};
  appendStructuredValue(structured, 'data_payload', message?.data_payload);
  appendStructuredValue(structured, 'response_debug', message?.response?.debug);

  return Object.keys(structured).length > 0 ? structured : null;
}

export function buildAssistantMessageClipboardPayload(message) {
  return buildAssistantAnswerClipboardPayload(message);
}

export function buildAssistantAnswerClipboardPayload(message) {
  const answerText = normalizeAnswerText(message);
  return answerText;
}

export function buildAssistantDebugClipboardPayload(message) {
  const answerText = normalizeAnswerText(message);
  const debugPayload = normalizeDebugPayload(message);
  if (!answerText && !debugPayload) return '';
  if (!debugPayload) return answerText;
  return [
    '[Assistant Answer]',
    answerText,
    '',
    '[Debug Payload - may be large]',
    JSON.stringify(debugPayload, null, 2),
  ].join('\n');
}
