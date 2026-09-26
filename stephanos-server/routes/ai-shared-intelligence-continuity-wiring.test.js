import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const aiRouteUrl = new URL('./ai.js', import.meta.url);

test('canonical AI chat consumes and completes shared intelligence continuity', async () => {
  const source = await readFile(aiRouteUrl, 'utf8');

  assert.match(source, /prepareSharedIntelligenceForAiTurnV1/);
  assert.match(source, /completeSharedIntelligenceAiTurnV1/);
  assert.match(source, /sharedIntelligencePrepared\?\.ok \? sharedIntelligencePrepared\.contextBlock/);
  assert.match(source, /shared_intelligence_continuity:\s*sharedIntelligencePrepared/);
  assert.match(source, /answerText:\s*llmResult\.outputText/);
  assert.match(source, /conversation_canvas_view:\s*sharedIntelligenceCompleted\?\.ok/);

  const prepareIndex = source.indexOf('prepareSharedIntelligenceForAiTurnV1({');
  const promptIndex = source.indexOf('const memoryAwareSystemPrompt = [');
  const providerIndex = source.indexOf('const llmResult = await routeLLMRequest');
  const completeIndex = source.indexOf('const sharedIntelligenceCompleted =');
  const successIndex = source.indexOf('const successPayload = buildSuccessResponse');

  assert.ok(prepareIndex > 0);
  assert.ok(prepareIndex < promptIndex);
  assert.ok(promptIndex < providerIndex);
  assert.ok(providerIndex < completeIndex);
  assert.ok(completeIndex < successIndex);
});

test('shared intelligence metadata is bounded and Canvas is exposed through existing assistant response data', async () => {
  const source = await readFile(aiRouteUrl, 'utf8');

  assert.match(source, /classification:\s*sharedIntelligenceCompleted\.classification/);
  assert.match(source, /knowledge_twin_valid:\s*sharedIntelligenceCompleted\.knowledgeTwin\?\.valid === true/);
  assert.match(source, /visible_context_items:\s*sharedIntelligenceCompleted\.knowledgeTwin\?\.visibleItems\?\.length \|\| 0/);
  assert.doesNotMatch(source, /shared_intelligence_continuity:\s*sharedIntelligenceCompleted\.knowledgeTwin/);
});
