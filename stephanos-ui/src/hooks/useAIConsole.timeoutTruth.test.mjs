import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, 'useAIConsole.js'), 'utf8');

test('timeout failures persist canonical timeout truth into lastExecutionMetadata', () => {
  assert.match(source, /const timeoutFailureMetadata = buildTimeoutFailureExecutionMetadata\(/);
  assert.match(source, /setLastExecutionMetadata\(timeoutFailureMetadata\)/);
  assert.match(source, /ui_request_timeout_ms:\s*uiError\.timeoutFailureLabel === 'ui_stream_inactivity_timeout_ms'/);
  assert.match(source, /ui_stream_inactivity_timeout_ms:\s*timeoutFailureMetadata\.ui_stream_inactivity_timeout_ms \|\| null/);
  assert.match(source, /backend_route_timeout_ms:\s*timeoutFailureMetadata\.backend_route_timeout_ms\s*\|\|\s*null/);
  assert.match(source, /timeout_policy_source:\s*uiError\.timeoutPolicySource\s*\|\|\s*timeoutFailureMetadata\.timeout_policy_source\s*\|\|\s*null/);
});

test('timeout failure metadata derives from canonical timeout resolver', () => {
  assert.match(source, /const canonicalTimeoutPolicy = resolveUiRequestTimeoutPolicy\(/);
  assert.match(source, /ui_request_timeout_ms:\s*inactivityTimeoutTriggered/);
  assert.match(source, /ui_stream_inactivity_timeout_ms:\s*inactivityTimeoutTriggered \? \(timeoutDetails\.timeoutMs \?\? null\) : null/);
  assert.match(source, /streaming_inactivity_timeout_ms:\s*timeoutDetails\.streamingInactivityTimeoutMs/);
  assert.match(source, /streaming_failure_phase:\s*timeoutDetails\.streamingFailurePhase \|\| null/);
  assert.match(source, /model_timeout_ms:\s*timeoutDetails\.modelTimeoutMs\s*\?\?\s*canonicalTimeoutPolicy\.modelTimeoutMs\s*\?\?\s*null/);
  assert.match(source, /const ollamaLoadGovernor = selectedProvider === 'ollama'/);
  assert.match(source, /ollama_load_mode:\s*selectedProvider === 'ollama'/);
  assert.match(source, /ollama_model_before_load_policy:\s*ollamaModelBeforeLoadPolicy/);
  assert.match(source, /ollama_model_after_load_policy:\s*ollamaModelAfterLoadPolicy/);
  assert.match(source, /const timeoutStreamingPolicyDecision = selectedProvider === 'ollama'/);
  assert.match(source, /const heavyModelAfterLoadPolicy = selectedProvider === 'ollama' && HEAVY_OLLAMA_MODELS\.has\(effectiveStreamingPolicyModel\)/);
  assert.match(source, /const streamingRequestAllowed = timeoutStreamingPolicyDecision\?\.streamingRequested === true/);
  assert.match(source, /streaming_requested:\s*streamingRequested \|\| streamingRequestAllowed/);
  assert.match(source, /streaming_policy_decision:\s*streamingPolicyDecision/);
  assert.match(source, /streaming_request_source:\s*streamingRequestSource/);
});

test('timeout failure metadata keeps requested provider separate from effective provider and prevents ollama contamination', () => {
  assert.match(source, /const requestedProvider = String\(/);
  assert.match(source, /const selectedProvider = String\(/);
  assert.match(source, /runtimeContext\?\.finalRouteTruth\?\.executedProvider[\s\S]*requestPayload\?\.routeDecision\?\.selectedProvider/m);
  assert.match(source, /requested_provider:\s*requestedProvider\s*\|\|\s*fallbackProvider\s*\|\|\s*'unknown'/);
  assert.match(source, /ollama_timeout_model:\s*selectedProvider === 'ollama'/);
});
