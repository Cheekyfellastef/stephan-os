export async function runAiActionLifecycle({
  actionId,
  startMessage = 'Contacting Stephanos AI…',
  timeoutMs = 25000,
  run,
  onStart = () => {},
  onTerminal = () => {},
  onFinally = () => {},
  emitEvent = () => {},
}) {
  const startedAt = new Date().toISOString();
  onStart({ actionId, startedAt, message: startMessage });
  emitEvent({ kind: 'ai.action_started', summary: `${actionId} started.` });
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('AI request timed out')), timeoutMs);
  });
  try {
    const result = await Promise.race([run(), timeoutPromise]);
    const mode = String(result?.mode || '').toLowerCase();
    if (mode === 'structured') emitEvent({ kind: 'ai.action_structured_result', summary: `${actionId} returned structured result.` });
    else if (mode === 'text-fallback') emitEvent({ kind: 'ai.action_text_fallback', summary: `${actionId} returned text fallback.` });
    else if (mode === 'rule-fallback') emitEvent({ kind: 'ai.action_rule_fallback', summary: `${actionId} used rule fallback.` });
    else if (mode === 'error') emitEvent({ kind: 'ai.action_failed', summary: `${actionId} failed.` });
    onTerminal({ actionId, terminal: mode || 'structured', result });
    return result;
  } catch (error) {
    const timeoutHit = String(error?.message || '').toLowerCase().includes('timed out');
    emitEvent({ kind: timeoutHit ? 'ai.action_timeout' : 'ai.action_failed', summary: timeoutHit ? 'AI action timed out; fallback used.' : `${actionId} failed.` });
    const failure = { ok: false, mode: timeoutHit ? 'timeout' : 'error', error };
    onTerminal({ actionId, terminal: failure.mode, result: failure });
    return failure;
  } finally {
    clearTimeout(timeoutId);
    emitEvent({ kind: 'ai.action_completed', summary: `${actionId} completed.` });
    onFinally({ actionId, startedAt });
  }
}
