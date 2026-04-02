import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('App imports PromptBuilder with explicit .jsx module target', () => {
  const source = readFileSync('stephanos-ui/src/App.jsx', 'utf8');
  assert.match(
    source,
    /import\s+PromptBuilder\s+from\s+['"]\.\/components\/system\/PromptBuilder\.jsx['"];/,
  );
});
