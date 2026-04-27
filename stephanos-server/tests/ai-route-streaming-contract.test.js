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

test('/api/ai/chat SSE emits final, metadata, and completion marker events', () => {
  assert.match(source, /writeSseEvent\(res,\s*'final'/);
  assert.match(source, /writeSseEvent\(res,\s*'metadata'/);
  assert.match(source, /writeSseCompletion\(res,\s*true\)/);
  assert.match(source, /writeSseCompletion\(res,\s*false\)/);
});

test('/api/ai/chat execution metadata tracks streaming_used only when SSE is active', () => {
  assert.match(source, /streaming_used:\s*Boolean\(streamingEnabled && actualProviderUsed === 'ollama'\)/);
  assert.match(source, /fast_response_streaming:\s*Boolean\(streamingEnabled && fastLaneActiveTruth && actualProviderUsed === 'ollama'\)/);
  assert.match(source, /streaming_mode_preference:/);
  assert.match(source, /streaming_request_source:/);
});

test('/api/ai/chat propagates client disconnect cancellation into provider execution', () => {
  assert.match(source, /req\.on\('aborted'/);
  assert.match(source, /req\.on\('close'/);
  assert.match(source, /abortSignal:\s*requestAbortController\.signal/);
  assert.match(source, /execution_cancelled:/);
  assert.match(source, /ollama_abort_sent:/);
});
