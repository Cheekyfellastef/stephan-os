import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAwarenessPack,
  buildNextMoveAdvisor,
  buildStephanosRequest,
  classifyStephanosIntent,
  extractStephanosReply,
  parseStephanosCommand,
  requestStephanos,
  resolveFreshnessContext,
  STEPHANOS_AWARENESS_VERSION,
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

test('classifies project awareness and next-move questions', () => {
  assert.equal(classifyStephanosIntent('where are we?'), 'project-awareness');
  assert.equal(classifyStephanosIntent('what should I do next?'), 'project-next-move');
  assert.equal(classifyStephanosIntent('tell me about trees'), 'general-stephanos-question');
});

test('builds bounded Awareness Pack metadata for WhatsApp replies', () => {
  const pack = buildAwarenessPack('what is blocked?');
  assert.equal(pack.version, STEPHANOS_AWARENESS_VERSION);
  assert.equal(pack.issue, 1280);
  assert.equal(pack.mode, 'bounded-project-awareness');
  assert.equal(pack.guardrails.mutationAuthority, 'approval-gated');
  assert.equal(pack.guardrails.noInventedRuntimeState, true);
  assert.equal(pack.preservation.stephanosPr1275, true);
  assert.equal(pack.preservation.standalone, true);
  assert.equal(pack.preservation.scoutCoderDash, true);
  assert.equal(pack.preservation.scoutCoderUnderscore, true);
  assert.equal(pack.preservation.plainChatClean, true);
  assert.ok(pack.responseContract.includes('proofFreshness'));
  assert.deepEqual(pack.freshnessLabels, ['LIVE', 'RECENT', 'STALE', 'UNKNOWN']);
});

test('builds a read-only Next-Move Advisor contract for project questions', () => {
  const advisor = buildNextMoveAdvisor('what should I do next?');
  assert.equal(advisor.enabled, true);
  assert.equal(advisor.issue, 1280);
  assert.ok(advisor.rules.includes('recommend-smallest-safe-action'));
  assert.ok(advisor.rules.includes('route-mutations-through-operator-approval'));
  assert.ok(advisor.outputFields.includes('smallestNextOperatorAction'));
  assert.equal(
    buildNextMoveAdvisor('what is a leaf?').enabled,
    false,
  );
});

test('builds a non-streaming, operator-initiated WhatsApp request with awareness metadata', () => {
  const payload = buildStephanosRequest('What is the latest project status?');
  assert.equal(payload.routeMode, 'auto');
  assert.equal(payload.runtimeContext.channel, 'whatsapp');
  assert.equal(payload.runtimeContext.operatorInitiated, true);
  assert.equal(payload.runtimeContext.awarenessPackVersion, STEPHANOS_AWARENESS_VERSION);
  assert.equal(payload.runtimeContext.mutationAuthority, 'approval-gated');
  assert.equal(payload.freshnessContext.freshnessNeed, 'high');
  assert.equal(payload.staleFallbackPermitted, false);
  assert.equal(payload.awarenessPack.issue, 1280);
  assert.equal(payload.nextMoveAdvisor.enabled, true);
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
  assert.equal(captured.body.awarenessPack.guardrails.mutationAuthority, 'approval-gated');
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
