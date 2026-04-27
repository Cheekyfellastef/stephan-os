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
  assert.match(source, /setAnswerCopyState\(COPY_STATE\.FAILURE\)/);
});

test('AnswerPaneCopyButton only enters success state after confirmed clipboard success', () => {
  assert.match(source, /const result = await writeTextToClipboard\(payload\)/);
  assert.match(source, /setAnswerCopyState\(result\.ok \? COPY_STATE\.SUCCESS : COPY_STATE\.FAILURE\)/);
  assert.match(source, /setDebugCopyState\(result\.ok \? COPY_STATE\.SUCCESS : COPY_STATE\.FAILURE\)/);
});

test('AnswerPaneCopyButton exposes separate answer and debug copy actions', () => {
  assert.match(source, /useClipboardButtonState/);
  assert.match(source, /Copy Answer/);
  assert.match(source, /Copy Debug Payload/);
});
