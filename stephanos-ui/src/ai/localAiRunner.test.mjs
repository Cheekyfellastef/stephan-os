import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalAiReviewPrompt,
  discoverLocalAiRunnerModels,
  parseLocalAiRunnerWorkbenchReview,
  responseContainsMutationLanguage,
  runLocalAiWorkbenchReview,
} from './localAiRunner.js';

test('Local AI Runner discovers Ollama models from provider health snapshot', async () => {
  const discovery = await discoverLocalAiRunnerModels({
    fetchHealth: async () => ({ ok: true, data: { ollama: { ok: true, models: ['llama3.2:3b', 'qwen2.5-coder:7b'] } } }),
    runtimeConfig: {},
  });
  assert.equal(discovery.ok, true);
  assert.deepEqual(discovery.models, ['llama3.2:3b', 'qwen2.5-coder:7b']);
  assert.equal(discovery.selectedModel, 'llama3.2:3b');
});

test('Local AI Runner sends bounded read-only packet to approved selected model', async () => {
  let captured = null;
  const result = await runLocalAiWorkbenchReview({
    packet: { packetType: 'Local AI Review Packet', explicitForbiddenActions: ['Do not mutate repo files.'] },
    selectedModel: 'llama3.2:3b',
    availableModels: ['llama3.2:3b'],
    runtimeConfig: {},
    sendPromptImpl: async (payload) => {
      captured = payload;
      return { ok: true, data: { output_text: `Summary: Safe review only\nSuspected files: stephanos-ui/src/state/operatorReliefProjection.js\nProposed change type: read-only-review\nRisk level: low\nTests recommended: node --test tests/operator-relief-projection.test.mjs\nConfidence: 90%\nRequires Codex fallback: no\nRequires operator approval: yes\nForbidden actions detected: none\nReasoning: Parsed through Workbench truth.` } };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(captured.provider, 'ollama');
  assert.equal(captured.providerConfigs.ollama.model, 'llama3.2:3b');
  assert.equal(captured.fallbackEnabled, false);
  assert.match(captured.prompt, /Respond as a read-only Builder Workbench review/i);
  assert.match(captured.prompt, /Do not mutate repo files/i);
});

test('Local AI Runner blocks mutation language in responses', async () => {
  assert.equal(responseContainsMutationLanguage('I applied a patch and changed the source file.'), true);
  const result = await runLocalAiWorkbenchReview({
    packet: { packetType: 'Local AI Review Packet' },
    selectedModel: 'llama3.2:3b',
    availableModels: ['llama3.2:3b'],
    sendPromptImpl: async () => ({ ok: true, data: { output_text: 'Summary: I applied a patch and changed the file.\nSuspected files: none\nProposed change type: read-only-review\nRisk level: low\nTests recommended: none\nConfidence: low\nRequires Codex fallback: no\nRequires operator approval: yes\nForbidden actions detected: none\nReasoning: unsafe' } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason, /mutation/i);
});

test('Local AI Runner refuses unapproved selected model', async () => {
  const result = await runLocalAiWorkbenchReview({
    packet: { packetType: 'Local AI Review Packet' },
    selectedModel: 'unlisted:latest',
    availableModels: ['llama3.2:3b'],
    sendPromptImpl: async () => { throw new Error('should not send'); },
  });
  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason, /not in the discovered approved model list/i);
});

test('Local AI Runner prompt bounds packet payload', () => {
  const prompt = buildLocalAiReviewPrompt({ huge: 'x'.repeat(5000) });
  assert.match(prompt, /bounded-read-only-packet-truncated/);
  assert.ok(prompt.length < 4500);
});


test('Local AI Runner parses safe review into Workbench result with local-ai-runner source', () => {
  const parsed = parseLocalAiRunnerWorkbenchReview(`Summary: Safe projection review
Suspected files: stephanos-ui/src/state/operatorReliefProjection.js
Proposed change type: read-only-review
Risk level: low
Tests recommended: node --test tests/operator-relief-projection.test.mjs
Confidence: high
Requires Codex fallback: no
Requires operator approval: yes
Forbidden actions detected: none
Reasoning: Safe read-only analysis only.`);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, 'parsed');
  assert.equal(parsed.parsedResult.source, 'local-ai-runner');
  assert.equal(parsed.parsedResult.requiresCodexFallback, 'no');
});

test('Local AI Runner malformed response produces parse-failed proof, not idle', async () => {
  const result = await runLocalAiWorkbenchReview({
    packet: { packetType: 'Local AI Review Packet' },
    selectedModel: 'llama3.2:3b',
    availableModels: ['llama3.2:3b'],
    sendPromptImpl: async () => ({ ok: true, data: { output_text: 'This is not the required Workbench field format.' } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'parse-failed');
  assert.equal(result.requestSent, true);
  assert.equal(result.responseRetained, 'yes');
  assert.equal(result.parseAttempted, 'yes');
  assert.equal(result.parseResultStatus, 'malformed');
  assert.match(result.blockedReason, /missing required Workbench field/);
});


test('Local AI Runner preflight blocked path sets requestSent no with specific blocked reason', async () => {
  let sent = false;
  const result = await runLocalAiWorkbenchReview({
    packet: { packetType: 'Local AI Review Packet' },
    selectedModel: 'llama3.2:3b',
    availableModels: [],
    sendPromptImpl: async () => { sent = true; return { ok: true, data: { output_text: '' } }; },
  });
  assert.equal(sent, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.dispatchAttempted, true);
  assert.equal(result.requestSent, false);
  assert.match(result.blockedReason, /No discovered approved Ollama models/i);
  assert.match(result.errorMessage, /No discovered approved Ollama models/i);
  assert.equal(result.parseResultStatus, 'blocked');
});

test('Local AI Runner marks request sent before invoking local Ollama request', async () => {
  const events = [];
  const result = await runLocalAiWorkbenchReview({
    packet: { packetType: 'Local AI Review Packet' },
    selectedModel: 'llama3.2:3b',
    availableModels: ['llama3.2:3b'],
    onRequestSent: () => events.push('request-sent'),
    sendPromptImpl: async () => {
      events.push('ollama-call');
      return { ok: false, data: { error: 'Ollama unavailable' } };
    },
  });
  assert.deepEqual(events, ['request-sent', 'ollama-call']);
  assert.equal(result.status, 'failed');
  assert.equal(result.requestSent, true);
  assert.equal(result.parseResultStatus, 'failed');
  assert.match(result.errorMessage, /Ollama unavailable/);
});

test('Local AI Runner request throw becomes failed terminal state, not stuck running', async () => {
  const result = await runLocalAiWorkbenchReview({
    packet: { packetType: 'Local AI Review Packet' },
    selectedModel: 'llama3.2:3b',
    availableModels: ['llama3.2:3b'],
    sendPromptImpl: async () => { throw new Error('network down before response'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.requestSent, true);
  assert.equal(result.parseAttempted, 'no');
  assert.equal(result.parseResultStatus, 'failed');
  assert.match(result.errorMessage, /network down/);
});

test('Local AI Runner timeout guard fails terminally after request-sent boundary', async () => {
  const result = await runLocalAiWorkbenchReview({
    packet: { packetType: 'Local AI Review Packet' },
    selectedModel: 'llama3.2:3b',
    availableModels: ['llama3.2:3b'],
    requestTimeoutMs: 5,
    sendPromptImpl: async () => new Promise(() => {}),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.requestSent, true);
  assert.equal(result.parseResultStatus, 'failed');
  assert.match(result.errorMessage, /timed out/);
});
