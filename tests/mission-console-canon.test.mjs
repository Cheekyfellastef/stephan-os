import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('AIConsole renders answer history directly with CommandResultCard and no parallel canonical wrappers', () => {
  const source = readFileSync(new URL('../stephanos-ui/src/components/AIConsole.jsx', import.meta.url), 'utf8');
  assert.match(source, /CommandResultCard/);
  assert.doesNotMatch(source, /CanonicalAnswerPane/);
  assert.doesNotMatch(source, /CanonicalPaneStack/);
});
