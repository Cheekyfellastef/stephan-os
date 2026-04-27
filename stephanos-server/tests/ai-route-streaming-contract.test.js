import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, '../routes/ai.js'), 'utf8');

test('/api/ai/chat defaults to JSON unless explicit SSE request signals streaming', () => {
  assert.match(source, /accept\.includes\(STREAMING_MEDIA_TYPE\)/);
  assert.match(source, /queryStream === '1'/);
  assert.match(source, /queryStream === 'true'/);
  assert.match(source, /bodyStream === true/);
});

test('/api/ai/chat SSE emits final, metadata, and completion marker events', () => {
  assert.match(source, /writeSseEvent\(res,\s*'final'/);
  assert.match(source, /writeSseEvent\(res,\s*'metadata'/);
  assert.match(source, /writeSseCompletion\(res,\s*true\)/);
  assert.match(source, /writeSseCompletion\(res,\s*false\)/);
});

test('/api/ai/chat execution metadata tracks streaming_used only when SSE is active', () => {
  assert.match(source, /streaming_used:\s*Boolean\(streamingEnabled && actualProviderUsed === 'ollama'\)/);
  assert.match(source, /fast_response_streaming:\s*Boolean\(streamingEnabled && fastResponseLaneTruth\.active && actualProviderUsed === 'ollama'\)/);
});
