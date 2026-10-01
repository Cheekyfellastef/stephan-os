import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./ProviderToggle.jsx', import.meta.url), 'utf8');

test('ProviderToggle consumes the canonical Ollama heavy-model projection', () => {
  assert.match(
    source,
    /import \{ OLLAMA_HEAVY_MODELS \} from '\.\.\/\.\.\/\.\.\/shared\/ai\/ollamaLoadGovernor\.mjs';/,
  );
  assert.match(
    source,
    /const heavyModelSelected = OLLAMA_HEAVY_MODELS\s*\.includes\(/,
  );
  assert.doesNotMatch(
    source,
    /\['gpt-oss:20b', 'qwen:14b', 'qwen:32b'\]/,
  );
});
