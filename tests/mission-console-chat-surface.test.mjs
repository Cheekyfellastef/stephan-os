import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');

test('Mission Console workspace mounts canonical AIConsole surface with input submit and answer history', () => {
  assert.match(source, /<AIConsole/);
  assert.match(source, /submitPrompt=\{\(rawPrompt\) => submitPrompt\?\.\(rawPrompt, \{ orchestrationTruth, submissionSource: 'stephanos-mission-console', submissionRoute: 'assistant-router' \}\)\}/);
  assert.match(source, /commandHistory=\{sharedCommandHistory\}/);
});
