import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStephanosRequest,
  extractStephanosReply,
  parseStephanosCommand,
  requestStephanos,
  resolveFreshnessContext,
  validateLoopbackEndpoint,
} from './bridge.mjs';

test('requires a bounded command message', () => {
  assert.deepEqual(parseStephanosCommand('   '), {
    ok: false,
    error: 'Usage: /stephanos <message>',
  });
  assert.equal(parseStephanosCommand('x'.repeat(4001)).ok, false);
  assert.deepEqual(parseStephanosCommand('  show my missions  '), {
    ok: true,
    message: 'show my missions',
  });
});

test('accepts only the canonical loopback AI route', () => {
  assert.equal(
    validateLoopbackEndpoint('http://127.0.0.1:8787/api/ai/chat'),
    'http://127.0.0.1:8787/api/ai/chat',
  );
  assert.throws(() => validateLoopbackEndpoint('https://example.com/api/ai/chat'), /loopback HTTP/);
  assert.throws(() => validateLoopbackEndpoint('http://192.168.1.2:8787/api/ai/chat'), /loopback HTTP/);
  assert.throws(() => validateLoopbackEndpoint('http://127.0.0.1:8787/api/admin'), /api\/ai\/chat/);
  assert.throws(() => validateLoopbackEndpoint('http://127.0.0.1:8787/api/ai/chat?next=x'), /query parameters/);
});

test('marks current and changing facts as high freshness without stale fallback', () => {
  assert.deepEqual(resolveFreshnessContext('Has Keir Starmer resigned today?'), {
    freshnessNeed: 'high',
    freshnessReason: 'whatsapp-command-current-or-changing-fact',
    staleRisk: 'high',
    staleFallbackPermitted: false,
  });
  assert.equal(resolveFreshnessContext('Summarise my project plan').freshnessNeed, 'normal');
});

test('builds a non-streaming, operator-initiated WhatsApp request', () => {
  const payload = buildStephanosRequest('What is the latest project status?');
  assert.equal(payload.routeMode, 'auto');
  assert.equal(payload.runtimeContext.channel, 'whatsapp');
  assert.equal(payload.runtimeContext.operatorInitiated, true);
  assert.equal(payload.freshnessContext.freshnessNeed, 'high');
  assert.equal(payload.staleFallbackPermitted, false);
});

test('extracts only a concrete Stephanos answer', () => {
  assert.equal(extractStephanosReply({ output_text: ' answer ' }), 'answer');
  assert.equal(extractStephanosReply({ data: { output_text: ' nested ' } }), 'nested');
  assert.throws(() => extractStephanosReply({ success: true }), /no answer text/);
});

test('posts to Stephanos and returns its answer', async () => {
  let captured = null;
  const result = await requestStephanos({
    message: 'Has the government changed today?',
    fetchFn: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, output_text: 'Fresh answer.' }),
      };
    },
  });
  assert.equal(result.text, 'Fresh answer.');
  assert.equal(captured.url, 'http://127.0.0.1:8787/api/ai/chat');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.body.freshnessContext.freshnessNeed, 'high');
  assert.equal(captured.body.staleFallbackPermitted, false);
});

test('does not leak backend error bodies into chat-facing failures', async () => {
  await assert.rejects(
    requestStephanos({
      message: 'hello',
      fetchFn: async () => ({
        ok: false,
        status: 503,
        json: async () => ({ secret: 'must-not-be-read' }),
      }),
    }),
    /HTTP 503/,
  );
});
