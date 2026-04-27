import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wantsStreaming } from '../routes/ai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, '../routes/ai.js'), 'utf8');

test('/api/ai/chat defaults to JSON unless explicit SSE request signals streaming', () => {
  assert.match(source, /accept\.includes\(STREAMING_MEDIA_TYPE\)/);
  assert.match(source, /queryStream === '1'/);
  assert.match(source, /queryStream === 'true'/);
  assert.match(source, /bodyStream === true/);
});

test('/api/ai/chat enables streaming when request body stream=true even without Accept header', () => {
  assert.equal(
    wantsStreaming({
      headers: {},
      query: {},
      body: { stream: true },
    }),
    true,
  );
  assert.equal(
    wantsStreaming({
      headers: { accept: 'application/json' },
      query: {},
      body: { stream: false },
    }),
    false,
  );
});

test('/api/ai/chat SSE emits stream-open, final, metadata, and completion marker events', () => {
  assert.match(source, /writeSseEvent\(res,\s*'stream-open'/);
  assert.match(source, /writeSseEvent\(res,\s*'final'/);
  assert.match(source, /writeSseEvent\(res,\s*'metadata'/);
  assert.match(source, /writeSseCompletion\(res,\s*true\)/);
  assert.match(source, /writeSseCompletion\(res,\s*false\)/);
});

test('/api/ai/chat execution metadata tracks streaming_used only when SSE is active', () => {
  assert.match(source, /streaming_used:\s*Boolean\(streamingEnabled && actualProviderUsed === 'ollama'\)/);
  assert.match(source, /streaming_entered_backend:\s*streamingEnteredBackend/);
  assert.match(source, /streaming_client_opened:\s*streamingClientOpened/);
  assert.match(source, /streaming_first_event_received:\s*streamingFirstEventReceived/);
  assert.match(source, /streaming_inactivity_timeout_ms:\s*streamingInactivityTimeoutMs/);
  assert.match(source, /streaming_last_event_at:\s*streamingLastEventAt/);
  assert.match(source, /streaming_failure_phase:\s*null/);
  assert.match(source, /fast_response_streaming:\s*Boolean\(streamingEnabled && fastLaneActiveTruth && actualProviderUsed === 'ollama'\)/);
  assert.match(source, /streaming_mode_preference:/);
  assert.match(source, /streaming_request_source:/);
  assert.match(source, /streaming_policy_decision:/);
  assert.match(source, /streaming_policy_reason:/);
  assert.match(source, /resolveFinalStreamingPolicy\(/);
  assert.match(source, /executedModel:\s*canonicalModelTruth\.executedModel/);
  assert.match(source, /executionMetadata\.streaming_policy_decision = finalStreamingPolicy\.streamingPolicyDecision/);
  assert.match(source, /executionMetadata\.streaming_request_source = finalStreamingPolicy\.streamingRequestSource/);
});

test('/api/ai/chat execution metadata exposes ollama load governor truth fields', () => {
  assert.match(source, /ollama_load_mode:/);
  assert.match(source, /ollama_load_policy_applied:/);
  assert.match(source, /ollama_load_policy_reason:/);
  assert.match(source, /ollama_heavy_model_requested:/);
  assert.match(source, /ollama_heavy_model_allowed:/);
  assert.match(source, /ollama_model_before_load_policy:/);
  assert.match(source, /ollama_model_after_load_policy:/);
});

test('/api/ai/chat propagates client disconnect cancellation into provider execution', () => {
  assert.match(source, /req\.on\('aborted'/);
  assert.match(source, /req\.on\('close'/);
  assert.match(source, /abortSignal:\s*requestAbortController\.signal/);
  assert.match(source, /execution_cancelled:/);
  assert.match(source, /ollama_abort_sent:/);
  assert.match(source, /abort_forwarded_to_provider:/);
  assert.match(source, /provider_generation_still_running_unknown:/);
  assert.match(source, /cancellation_effectiveness:/);
});

test('/api/ai\/ollama\/release is local-desktop only and reports targeted-kill truth', () => {
  assert.match(source, /router\.post\('\/ollama\/release'/);
  assert.match(source, /safe_targeted_kill_available:\s*false/);
  assert.match(source, /provider_generation_still_running_unknown:\s*true/);
});
