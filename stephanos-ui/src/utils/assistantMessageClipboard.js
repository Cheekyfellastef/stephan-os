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
  const answerText = normalizeAnswerText(message);
  const structured = getAssistantMessageStructuredData(message);

  if (!answerText && !structured) {
    return '';
  }

  if (!structured) {
    return answerText;
  }

  return [
    '[Assistant Answer]',
    answerText,
    '',
    '[Structured Data]',
    JSON.stringify(structured, null, 2),
  ].join('\n');
}
