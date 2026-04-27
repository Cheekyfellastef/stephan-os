import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const THIS_DIR = path.dirname(new URL(import.meta.url).pathname);
const source = fs.readFileSync(path.join(THIS_DIR, 'aiClient.js'), 'utf8');

test('streaming request policy gives operator on precedence across providers', () => {
  assert.match(source, /if \(normalizedMode === 'on'\) \{/);
  assert.match(source, /streamingRequested:\s*true/);
  assert.match(source, /streamingRequestSource:\s*'operator-on'/);
});

test('streaming request policy gives operator off precedence', () => {
  assert.match(source, /if \(normalizedMode === 'off'\) \{/);
  assert.match(source, /streamingRequestSource:\s*'operator-off'/);
});

test('streaming request policy keeps auto heavy-ollama behavior and non-heavy auto fallback', () => {
  assert.match(source, /HEAVY_OLLAMA_MODELS = new Set\(\['gpt-oss:20b', 'qwen:14b', 'qwen:32b'\]\)/);
  assert.match(source, /normalizedMode === 'auto' && heavyOllamaModel/);
  assert.match(source, /streamingRequestSource:\s*'auto-heavy-ollama'/);
  assert.match(source, /streamingRequestSource:\s*'auto-default-off'/);
});

test('streaming request policy resolves heavy model from execution model before configured model fallback', () => {
  assert.match(source, /executionProvider = ''/);
  assert.match(source, /executionModel = ''/);
  assert.match(source, /const resolvedModel = firstNonEmpty\(\s*executionModel,/);
});
