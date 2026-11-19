// Transport for the existing code builder. Partial model text is never an edit.
// Keep one request, require its terminal frame, and bound time and retained bytes.
export const BOUNDED_OLLAMA_JSON_REPLY_LIMITS_V1 = Object.freeze({
  deadlineMs: 10 * 60 * 1000,
  idleMs: 5 * 60 * 1000,
  wireBytes: 8 * 1024 * 1024,
  contentBytes: 512 * 1024,
});

const fault = code => new Error(`PROVIDER_NEUTRAL_MODEL_${code}`);
const bounded = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : maximum;

export async function requestBoundedOllamaJsonReplyV1(endpoint, payload, {
  fetchImpl = fetch,
  deadlineMs = BOUNDED_OLLAMA_JSON_REPLY_LIMITS_V1.deadlineMs,
  idleMs = BOUNDED_OLLAMA_JSON_REPLY_LIMITS_V1.idleMs,
  wireBytes = BOUNDED_OLLAMA_JSON_REPLY_LIMITS_V1.wireBytes,
  contentBytes = BOUNDED_OLLAMA_JSON_REPLY_LIMITS_V1.contentBytes,
} = {}) {
  const controller = new AbortController();
  let reader;
  let idleTimer;
  let stopped;
  const abort = error => { stopped ||= error; controller.abort(); };
  const deadlineTimer = setTimeout(() => abort(fault('REQUEST_DEADLINE_EXCEEDED')),
    bounded(deadlineMs, BOUNDED_OLLAMA_JSON_REPLY_LIMITS_V1.deadlineMs));
  const refreshIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abort(fault('RESPONSE_STALLED')),
      bounded(idleMs, BOUNDED_OLLAMA_JSON_REPLY_LIMITS_V1.idleMs));
  };
  const interrupted = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(stopped), { once: true });
  });
  const readReply = async () => {
    const response = await fetchImpl(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, stream: true }), signal: controller.signal,
    });
    if (stopped) throw stopped;
    if (!response.ok) throw fault(`HTTP_${response.status}`);
    if (!response.body?.getReader) throw fault('STREAM_UNAVAILABLE');
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const encoder = new TextEncoder();
    let buffered = '', content = '', receivedBytes = 0, retainedBytes = 0;
    let terminal = false;
    const frame = line => {
      if (!line.trim()) return;
      if (terminal) throw fault('STREAM_AFTER_TERMINAL');
      let value;
      try { value = JSON.parse(line); } catch { throw fault('STREAM_INVALID_JSON'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)
          || (value.done !== true && value.done !== false)) throw fault('STREAM_INVALID_FRAME');
      if (value.error) throw fault('STREAM_API_ERROR');
      if (value.message !== undefined) {
        if (!value.message || typeof value.message.content !== 'string'
            || (value.message.role && value.message.role !== 'assistant')
            || value.message.tool_calls?.length) throw fault('STREAM_INVALID_MESSAGE');
        retainedBytes += encoder.encode(value.message.content).byteLength;
        if (retainedBytes > bounded(contentBytes, BOUNDED_OLLAMA_JSON_REPLY_LIMITS_V1.contentBytes))
          throw fault('RESPONSE_TOO_LARGE');
        content += value.message.content;
      }
      if (value.done === true) {
        if (value.done_reason && value.done_reason !== 'stop') throw fault('RESPONSE_INCOMPLETE');
        terminal = true;
      }
    };
    refreshIdle();
    while (true) {
      const chunk = await reader.read();
      if (stopped) throw stopped;
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > bounded(wireBytes, BOUNDED_OLLAMA_JSON_REPLY_LIMITS_V1.wireBytes))
        throw fault('RESPONSE_TOO_LARGE');
      if (chunk.value.byteLength) refreshIdle();
      buffered += decoder.decode(chunk.value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) frame(line);
    }
    buffered += decoder.decode();
    if (buffered.trim()) frame(buffered);
    if (!terminal) throw fault('RESPONSE_INCOMPLETE');
    return Object.freeze({ message: Object.freeze({ content }) });
  };
  refreshIdle();
  try {
    return await Promise.race([readReply(), interrupted]);
  } catch (error) {
    if (stopped) throw stopped;
    if (String(error?.message).startsWith('PROVIDER_NEUTRAL_MODEL_')) throw error;
    const code = String(error?.cause?.code || error?.code || 'UNKNOWN');
    throw fault(`TRANSPORT_FAILED:${/^[A-Z0-9_]{1,64}$/.test(code) ? code : 'UNKNOWN'}`);
  } finally {
    clearTimeout(deadlineTimer);
    clearTimeout(idleTimer);
    controller.abort();
    if (reader) { try { void reader.cancel().catch(() => {}); } catch {} }
  }
}
