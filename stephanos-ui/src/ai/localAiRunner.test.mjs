import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalAiReviewPrompt,
  discoverLocalAiRunnerModels,
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
      return { ok: true, data: { output_text: 'Summary: Safe review only\nProposed change type: read-only-review\nRisk level: low\nRequires Codex fallback: no\nRequires operator approval: yes' } };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(captured.provider, 'ollama');
  assert.equal(captured.providerConfigs.ollama.model, 'llama3.2:3b');
  assert.equal(captured.fallbackEnabled, false);
  assert.match(captured.prompt, /read-only review only/i);
  assert.match(captured.prompt, /Do not mutate repo files/i);
});

test('Local AI Runner blocks mutation language in responses', async () => {
  assert.equal(responseContainsMutationLanguage('I applied a patch and changed the source file.'), true);
  const result = await runLocalAiWorkbenchReview({
    packet: { packetType: 'Local AI Review Packet' },
    selectedModel: 'llama3.2:3b',
    availableModels: ['llama3.2:3b'],
    sendPromptImpl: async () => ({ ok: true, data: { output_text: 'Summary: I applied a patch and changed the file.\nRequires Codex fallback: no' } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason, /mutation/i);
});

test('Local AI Runner refuses unapproved selected model', async () => {
  const result = await runLocalAiWorkbenchReview({
    packet: {},
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
