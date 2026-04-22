import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const THIS_DIR = path.dirname(new URL(import.meta.url).pathname);
const source = fs.readFileSync(path.join(THIS_DIR, 'useAIConsole.js'), 'utf8');

test('hosted cloud responses stage mission/idea candidates without direct canon write', () => {
  assert.match(source, /addHostedStagedItem\(/);
  assert.match(source, /Hosted cognition generated staged item\. Staged only, not yet canon\./);
  assert.match(source, /selectedAnswerMode === 'fresh-cloud' \|\| selectedAnswerMode === 'cloud-basic'/);
});
