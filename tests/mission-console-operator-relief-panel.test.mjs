import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');

test('Mission Console operator relief panel renders verdict, next actions, repair prompt and lessons', () => {
  assert.match(source, /Operator Relief v1/);
  assert.match(source, /Merge Safety Verdict/);
  assert.match(source, /Next Actions/);
  assert.match(source, /Copy Repair Prompt/);
  assert.match(source, /Lesson Candidates/);
  assert.match(source, /operator_relief\.browser_proof_missing/);
});
