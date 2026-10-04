import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const aiSource = await readFile(new URL('./ai.js', import.meta.url), 'utf8');
const routerSource = await readFile(new URL('../services/llm/router/routeLLMRequest.js', import.meta.url), 'utf8');

test('shared provider router publishes every resolved brain choice into Shared Workspace', () => {
  assert.match(routerSource, /publishSharedWorkspaceBrainStateV1/);
  assert.match(routerSource, /return publishRouterBrainState\(finalResult/);
  assert.match(routerSource, /return publishRouterBrainState\(failedResult/);
  assert.match(routerSource, /requestInput, configInput, routing/);
});

test('AI route surfaces the provider-router Shared Workspace publication truth', () => {
  assert.doesNotMatch(aiSource, /await publishSharedWorkspaceBrainStateV1/);
  assert.match(aiSource, /llmResult\.diagnostics\?\.sharedWorkspaceBrainState\?\.published/);
  assert.match(aiSource, /shared_workspace_brain_state_status_id/);
});
