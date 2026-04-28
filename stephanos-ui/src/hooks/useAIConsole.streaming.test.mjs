import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, 'useAIConsole.js'), 'utf8');

test('useAIConsole appends streaming token chunks into a separate stream buffer field', () => {
  assert.match(source, /stream_buffer_text/);
  assert.match(source, /onStreamEvent:\s*\(event\)\s*=>\s*\{/);
  assert.match(source, /event\.type !== 'token'/);
  assert.match(source, /streamBuffer \+= String\(event\.content \|\| ''\)/);
});

test('useAIConsole finalizes streamed answer entry with immutable final output_text', () => {
  assert.match(source, /stream_finalized:\s*streamFinalizationMissing \? false : true/);
  assert.match(source, /output_text:\s*effectiveOutputText/);
});

test('useAIConsole preserves successful streamed token answers when metadata finalization is missing', () => {
  assert.match(source, /streamFinalizationMissing/);
  assert.match(source, /executionMetadata\.streaming_used/);
  assert.match(source, /executionMetadata\.streaming_finalized !== true/);
  assert.match(source, /streaming_diagnostics_warning/);
  assert.doesNotMatch(source, /\[Streaming warning\] Final metadata was incomplete/);
});

test('useAIConsole keeps streaming request and provider\/model truth sticky on partial-success SSE responses', () => {
  assert.match(source, /streamPolicyDecision === 'stream-enabled'/);
  assert.match(source, /streamRequestSource === 'auto-heavy-ollama'/);
  assert.match(source, /streamRequestSource === 'operator-on'/);
  assert.match(source, /streamOpenedOrEventsObserved/);
  assert.match(source, /streaming_requested:\s*streamingRequested/);
  assert.match(source, /streaming_used:\s*streamingUsed/);
  assert.match(source, /streaming_provider:\s*streamingProvider/);
  assert.match(source, /streaming_model:\s*streamingModel/);
  assert.match(source, /final_metadata_missing:\s*finalMetadataMissing/);
  assert.match(source, /streaming_completion_quality:\s*streamingCompletionQuality/);
  assert.match(source, /stream-ended-before-final-metadata/);
});

test('useAIConsole tracks streaming request truth metadata and cancellation truth', () => {
  assert.match(source, /const streamingPolicy = resolveStreamingRequestPolicy\(/);
  assert.match(source, /executionProvider:\s*timeoutExecutionEnvelope\.effectiveProvider/);
  assert.match(source, /executionModel:\s*timeoutExecutionEnvelope\.effectiveModel/);
  assert.match(source, /streaming_requested:\s*streamingPolicy\.streamingRequested/);
  assert.match(source, /streaming_request_source:\s*streamingPolicy\.streamingRequestSource/);
  assert.match(source, /streaming_mode_preference/);
  assert.doesNotMatch(source, /streaming_request_source:\s*streamingMode === 'off' \? 'off' : 'pending'/);
  assert.match(source, /execution_cancelled/);
  assert.match(source, /provider_cancelled/);
  assert.match(source, /ollama_abort_sent/);
  assert.match(source, /provider_generation_still_running_unknown/);
  assert.match(source, /cancellation_effectiveness/);
});

test('useAIConsole resets cancellation diagnostics at request start to avoid stale carry-over', () => {
  assert.match(source, /execution_cancelled:\s*false/);
  assert.match(source, /provider_cancelled:\s*false/);
  assert.match(source, /ollama_abort_sent:\s*false/);
  assert.match(source, /abort_forwarded_to_router:\s*false/);
  assert.match(source, /abort_forwarded_to_provider:\s*false/);
  assert.match(source, /abort_forwarded_to_ollama_fetch:\s*false/);
  assert.match(source, /setLastExecutionMetadata\(\(prev\)\s*=>\s*\(\{/);
});

test('useAIConsole normalizes cancellation truth from current request payload instead of stale request trace fallback', () => {
  assert.match(source, /const normalizedCancellation = successClassOutcome && !cancellationClassOutcome/);
  assert.match(source, /execution_cancelled:\s*normalizedCancellation\.execution_cancelled/);
  assert.match(source, /provider_cancelled:\s*normalizedCancellation\.provider_cancelled/);
  assert.match(source, /ollama_abort_sent:\s*normalizedCancellation\.ollama_abort_sent/);
  assert.match(source, /const requestExecutionId = String\(requestPayload\?\.request_execution_id \|\| ''\)\.trim\(\)/);
  assert.match(source, /const currentRequestRouterMetadata = requestExecutionId/);
  assert.match(source, /const rawRouterSelectedProvider = normalizeProviderKey\(/);
  assert.match(source, /requestSideSelectedProvider\s*\|\|\s*executableProvider\s*\|\|\s*actualProviderUsed/);
  assert.match(source, /currentRequestRouterMetadata[\s\S]*executionMetadata\.router_selected_provider[\s\S]*requestTrace\.router_selected_provider/m);
  assert.match(source, /requestPayload\.routeDecision\?\.selectedProvider/);
  assert.match(source, /requestPayload\.router_selected_provider/);
  assert.match(source, /rawRouterSelectedProvider === requestSideSelectedProvider/);
  assert.match(source, /const requestScopedRouterTraceProvider = normalizeProviderKey\(/);
  assert.match(source, /if \(successClassOutcome && !fallbackUsedForRouter && !providerOverrideReasonForRouter\)/);
  assert.match(source, /actualProviderUsed\s*\|\|\s*executableProvider\s*\|\|\s*requestSideSelectedProvider/);
});

test('useAIConsole resets router truth fields at request start and threads request execution id into dispatch payload', () => {
  assert.match(source, /request_execution_id:\s*`req_\$\{Date\.now\(\)\}_\$\{Math\.random\(\)\.toString\(36\)\.slice\(2,\s*10\)\}`/);
  assert.match(source, /router_provider:\s*requestPayload\.router_selected_provider \|\| 'unknown'/);
  assert.match(source, /request_trace:\s*\{\s*request_execution_id:\s*requestPayload\.request_execution_id,/);
  assert.match(source, /requestExecutionId:\s*requestPayload\.request_execution_id/);
});

test('useAIConsole timeout metadata preserves stream truth and uses UI timeout layer instead of fixed label checks', () => {
  assert.match(source, /const uiTimeoutTriggered = timeoutDetails\.timeoutFailureLayer === 'ui'/);
  assert.match(source, /const inactivityTimeoutTriggered = timeoutDetails\.timeoutLabel === 'ui_stream_inactivity_timeout_ms'/);
  assert.match(source, /ui_stream_inactivity_timeout_ms:\s*inactivityTimeoutTriggered \? \(timeoutDetails\.timeoutMs \?\? null\) : null/);
  assert.match(source, /streaming_supported:\s*streamingSupported/);
  assert.match(source, /streaming_used:\s*Boolean\(timeoutDetails\.streamingUsed \?\? false\)/);
  assert.match(source, /streaming_entered_backend:\s*Boolean\(timeoutDetails\.streamingEnteredBackend \?\? streamingRequested\)/);
  assert.match(source, /streaming_client_opened:\s*Boolean\(timeoutDetails\.streamingClientOpened \?\? false\)/);
  assert.match(source, /streaming_first_event_received:\s*Boolean\(timeoutDetails\.streamingFirstEventReceived \?\? false\)/);
  assert.match(source, /streaming_inactivity_timeout_ms:\s*timeoutDetails\.streamingInactivityTimeoutMs/);
  assert.match(source, /streaming_last_event_at:\s*timeoutDetails\.streamingLastEventAt/);
  assert.match(source, /streaming_failure_phase:\s*timeoutDetails\.streamingFailurePhase/);
  assert.match(source, /streaming_provider:\s*streamingSupported \? 'ollama' : null/);
  assert.match(source, /abort_signal_fired:\s*cancelled \|\| uiTimeoutTriggered/);
});

test('useAIConsole keeps route health online and preserves partial output during stream interruption-class errors', () => {
  assert.match(source, /uiError\.errorCode === 'TIMEOUT' \|\| uiError\.errorCode === 'CANCELLED' \|\| uiError\.errorCode === 'STREAM_FINALIZATION_MISSING'/);
  assert.match(source, /stream_finalized:\s*partial \? false : true/);
  assert.match(source, /output_text:\s*partial \|\| uiError\.output/);
});

test('useAIConsole blocks heavy ollama requests when previous cancellation may still be running', () => {
  assert.match(source, /HEAVY_OLLAMA_MODELS = new Set\(\['gpt-oss:20b', 'qwen:14b', 'qwen:32b'\]\)/);
  assert.match(source, /heavyOllamaRequest && previousGenerationUncertain/);
  assert.match(source, /OLLAMA_HEAVY_REQUEST_BLOCKED_PENDING_CANCELLATION_RECOVERY/);
});

test('useAIConsole exposes emergency release ollama load control', () => {
  assert.match(source, /const emergencyReleaseOllamaLoad = useCallback\(async \(\) => \{/);
  assert.match(source, /releaseLocalOllamaLoad\(/);
});
