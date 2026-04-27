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
  assert.match(source, /\[Streaming warning\] Final metadata was incomplete/);
});

test('useAIConsole tracks streaming request truth metadata and cancellation truth', () => {
  assert.match(source, /streaming_mode_preference/);
  assert.match(source, /streaming_request_source/);
  assert.match(source, /execution_cancelled/);
  assert.match(source, /provider_cancelled/);
  assert.match(source, /ollama_abort_sent/);
});
