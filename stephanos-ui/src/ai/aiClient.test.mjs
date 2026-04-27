import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientSource = fs.readFileSync(path.join(__dirname, 'aiClient.js'), 'utf8');

test('setLocalProviderSecret uses PUT /api/ai-admin/provider-secrets/:provider', () => {
  assert.match(clientSource, /requestJson\(`\/api\/ai-admin\/provider-secrets\/\$\{encodeURIComponent\(provider\)\}`,[\s\S]*method:\s*'PUT'/m);
  assert.match(clientSource, /resolveAdminAuthorityUrl\(runtimeConfig\)/);
  assert.match(clientSource, /baseUrl:\s*authority\.target/);
});

test('clearLocalProviderSecret uses DELETE /api/ai-admin/provider-secrets/:provider', () => {
  assert.match(clientSource, /requestJson\(`\/api\/ai-admin\/provider-secrets\/\$\{encodeURIComponent\(provider\)\}`,[\s\S]*method:\s*'DELETE'/m);
  assert.match(clientSource, /Local admin access required\./);
});

test('sendPrompt strips provider secrets from chat payloads', () => {
  assert.match(clientSource, /stripSecretsFromProviderConfigs\(providerConfigs\)/);
  assert.match(clientSource, /providerConfigs:\s*safeProviderConfigs/);
});

test('sendPrompt derives timeout from shared timeout policy before request dispatch', () => {
  assert.match(clientSource, /resolveUiRequestTimeoutPolicy\(/);
  assert.match(clientSource, /timeoutPolicy:\s*\{/);
  assert.match(clientSource, /requestJson\('\/api\/ai\/chat'[\s\S]*timeoutPolicyWithExecution/m);
});

test('getProviderHealth uses canonical timeout policy instead of hidden defaults', () => {
  assert.match(clientSource, /const timeoutPolicy = resolveUiRequestTimeoutPolicy\([\s\S]*provider:\s*requestedProvider[\s\S]*requestedModel/m);
  assert.match(clientSource, /requestJson\('\/api\/ai\/providers\/health'[\s\S]*runtimeConfig,\s*timeoutPolicy\)/m);
});

test('sendPrompt resolves timeout policy from effective execution provider truth', () => {
  assert.match(clientSource, /const timeoutExecutionTruth = resolveTimeoutExecutionTruth\(/);
  assert.match(clientSource, /provider:\s*timeoutExecutionTruth\.effectiveProvider/);
  assert.match(clientSource, /requestedModel:\s*timeoutExecutionTruth\.effectiveModel/);
  assert.match(clientSource, /timeoutExecutionEnvelope:\s*\{/);
  assert.match(clientSource, /timeoutProvider:\s*timeoutExecutionTruth\.effectiveProvider/);
});

test('sendPrompt supports hosted cloud cognition fallback path when backend transport fails', () => {
  assert.match(clientSource, /const hostedDispatch = resolveHostedCloudDispatch\(/);
  assert.match(clientSource, /if \(!hostedDispatch\.enabled\) \{\s*throw error;\s*\}/m);
  assert.match(clientSource, /hostedCloudExecutionPath:\s*\{/);
  assert.match(clientSource, /authorityLevel:\s*hostedDispatch\.authorityLevel/);
  assert.match(clientSource, /hostedConfig\?\.enabled === true/);
  assert.match(clientSource, /providerEnabled/);
});

test('sendPrompt streams token events through onStreamEvent callback', () => {
  assert.match(clientSource, /onStreamEvent\s*=\s*null/);
  assert.match(clientSource, /streamingMode\s*=\s*'off'/);
  assert.match(clientSource, /const streamingPolicy = resolveStreamingRequestPolicy\(/);
  assert.match(clientSource, /const explicitStreamingRequest = streamingPolicy\.streamingRequested[\s\S]*provider.*'ollama'/m);
  assert.match(clientSource, /payload\.streamingMode = streamingPolicy\.normalizedMode/);
  assert.match(clientSource, /payload\.streaming_mode_preference = streamingPolicy\.normalizedMode/);
  assert.match(clientSource, /payload\.streaming_requested = streamingPolicy\.streamingRequested/);
  assert.match(clientSource, /payload\.streaming_request_source = streamingPolicy\.streamingRequestSource/);
  assert.match(clientSource, /requestEventStream\('\/api\/ai\/chat\?stream=1'[\s\S]*onEvent:/m);
  assert.match(clientSource, /onStreamEvent\(\{\s*event:\s*eventName,/m);
  assert.match(clientSource, /body:\s*JSON\.stringify\(\{\s*\.\.\.payload,\s*stream:\s*true\s*\}\)/m);
  assert.match(clientSource, /Accept:\s*'text\/event-stream'/);
});

test('sendPrompt auto-streams only heavy Ollama models in auto mode', () => {
  assert.match(clientSource, /HEAVY_OLLAMA_MODELS = new Set\(\['gpt-oss:20b', 'qwen:14b', 'qwen:32b'\]\)/);
  assert.match(clientSource, /normalizedMode === 'auto' && heavyOllamaModel/);
  assert.match(clientSource, /streamingRequestSource: 'auto-heavy-ollama'/);
});

test('transport cancellation uses explicit CANCELLED code with cancellationSource', () => {
  assert.match(clientSource, /code:\s*'CANCELLED'/);
  assert.match(clientSource, /cancellationSource:/);
});

test('sendPrompt falls back to non-stream JSON when explicit SSE dispatch fails', () => {
  assert.match(clientSource, /if \(explicitStreamingRequest\) \{[\s\S]*requestJson\('\/api\/ai\/chat'/m);
  assert.match(clientSource, /code:\s*'STREAM_FINALIZATION_MISSING'/);
});

test('resolveTimeoutExecutionTruth prioritizes canonical execution truth before requested provider intent', () => {
  assert.match(clientSource, /effectiveProvider = firstNonEmpty\([\s\S]*runtimeFinalRouteTruth\?\.executedProvider[\s\S]*runtimeFinalRouteTruth\?\.selectedProvider[\s\S]*canonicalRouteTruth\?\.executedProvider[\s\S]*canonicalRouteTruth\?\.selectedProvider[\s\S]*hydratedEnvelope\?\.effectiveProvider[\s\S]*providerModeReconciled[\s\S]*routeDecision\?\.requestedProviderForRequest[\s\S]*requestedProviderNormalized[\s\S]*\)\.toLowerCase\(\)/m);
  assert.match(clientSource, /const effectiveModel = firstNonEmpty\([\s\S]*providerConfigs\?\.\[effectiveProvider\]\?\.model[\s\S]*\)/m);
});

test('resolveTimeoutExecutionTruth reconciles local-private request dispatch gate to ollama before arming timeout', () => {
  assert.match(clientSource, /const localRouteViable = routeDecision\?\.requestDispatchGate\?\.localRouteViable \?\? routeDecision\?\.localRouteAvailable \?\? null/);
  assert.match(clientSource, /const selectedAnswerMode = String\([\s\S]*requestDispatchGate\?\.selectedAnswerMode[\s\S]*routeDecision\?\.selectedAnswerMode/);
  assert.match(clientSource, /const providerModeReconciled = \(selectedAnswerMode === 'local-private' \|\| selectedAnswerMode === 'fallback-stale-risk'\)\s*&&\s*localRouteViable === true\s*\?\s*'ollama'/m);
});

test('transport timeout diagnostics are labeled as ui_request_timeout_ms', () => {
  assert.match(clientSource, /timeoutLabel:\s*'ui_request_timeout_ms'/);
  assert.doesNotMatch(clientSource, /vite_api_timeout_ms/);
  assert.match(clientSource, /backendRouteTimeoutMs:\s*timeoutPolicy\?\.backendRouteTimeoutMs\s*\|\|\s*null/);
  assert.match(clientSource, /providerTimeoutMs:\s*timeoutPolicy\?\.providerTimeoutMs\s*\|\|\s*null/);
  assert.match(clientSource, /modelTimeoutMs:\s*timeoutPolicy\?\.modelTimeoutMs\s*\|\|\s*null/);
  assert.match(clientSource, /timeoutProvider:\s*timeoutPolicy\?\.timeoutProvider\s*\|\|\s*null/);
});



test('getLocalGitRitualState queries /api/local/git-ritual-state', () => {
  assert.match(clientSource, /requestJson\('\/api\/local\/git-ritual-state'/m);
});

test('openRepoPowerShell uses POST /api/local/open-repo-powershell', () => {
  assert.match(clientSource, /requestJson\('\/api\/local\/open-repo-powershell',[\s\S]*method:\s*'POST'/m);
  assert.match(clientSource, /pid:\s*Number\.isFinite\(Number\(result\.data\?\.pid\)\)/);
  assert.match(clientSource, /focusApplied:\s*result\.data\?\.focusApplied === true/);
});

test('focusRepoPowerShell uses POST /api/local/focus-repo-powershell', () => {
  assert.match(clientSource, /requestJson\('\/api\/local\/focus-repo-powershell',[\s\S]*method:\s*'POST'/m);
});

test('getLocalRepoShellConfig queries /api/local/repo-shell-config', () => {
  assert.match(clientSource, /requestJson\('\/api\/local\/repo-shell-config'/m);
});
