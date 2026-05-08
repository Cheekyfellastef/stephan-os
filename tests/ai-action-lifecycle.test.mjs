import test from 'node:test';
import assert from 'node:assert/strict';
import { runAiActionLifecycle } from '../shared/runtime/aiActionLifecycle.mjs';

test('ai lifecycle handles structured/text/error/timeout/finally', async () => {
  const events = [];
  let finallyHit = 0;
  const structured = await runAiActionLifecycle({ actionId: 'a', emitEvent: (e) => events.push(e.kind), onFinally: () => { finallyHit += 1; }, run: async () => ({ ok: true, mode: 'structured' }) });
  assert.equal(structured.mode, 'structured');
  const text = await runAiActionLifecycle({ actionId: 'b', emitEvent: (e) => events.push(e.kind), run: async () => ({ ok: true, mode: 'text-fallback' }) });
  assert.equal(text.mode, 'text-fallback');
  const error = await runAiActionLifecycle({ actionId: 'c', emitEvent: (e) => events.push(e.kind), run: async () => { throw new Error('boom'); } });
  assert.equal(error.mode, 'error');
  const timeout = await runAiActionLifecycle({ actionId: 'd', timeoutMs: 5, emitEvent: (e) => events.push(e.kind), run: async () => new Promise((r) => setTimeout(() => r({ ok: true }), 100)) });
  assert.equal(timeout.mode, 'timeout');
  assert.equal(finallyHit, 1);
  assert.equal(events.includes('ai.action_completed'), true);
});
