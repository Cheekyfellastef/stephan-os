import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const sourcePath = path.join(new URL('.', import.meta.url).pathname, 'CommandResultCard.jsx');

test('CommandResultCard keeps copy button attached only to assistant response entries', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');
  assert.match(source, /entry\.response\?\.type === 'assistant_response' \? <AnswerPaneCopyButton message=\{entry\} \/> : null/);
});
