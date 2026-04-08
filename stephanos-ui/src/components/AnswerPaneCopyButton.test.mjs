import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, 'AnswerPaneCopyButton.jsx'), 'utf8');

test('AnswerPaneCopyButton blocks empty payload copy attempts and reports failure truthfully', () => {
  assert.match(source, /if \(!String\(payload \|\| ''\)\.trim\(\)\) \{/);
  assert.match(source, /setCopyState\(COPY_STATE\.FAILURE\)/);
});

test('AnswerPaneCopyButton only enters success state after confirmed clipboard success', () => {
  assert.match(source, /const result = await writeTextToClipboard\(payload\)/);
  assert.match(source, /setCopyState\(result\.ok \? COPY_STATE\.SUCCESS : COPY_STATE\.FAILURE\)/);
  assert.match(source, /catch \{\s*setCopyState\(COPY_STATE\.FAILURE\);\s*\}/);
});

test('AnswerPaneCopyButton keeps success state visible long enough for user feedback', () => {
  assert.match(source, /const SUCCESS_STATE_DURATION_MS = 3200/);
  assert.match(source, /setTimeout\(\(\) => \{\s*setCopyState\(COPY_STATE\.IDLE\);\s*\}, SUCCESS_STATE_DURATION_MS\)/);
});
