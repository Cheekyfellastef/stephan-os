import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');

test('Mission Console operator relief panel renders mission brain sections and copy controls', () => {
  assert.match(source, /Operator Relief v2 · Mission Brain/);
  assert.match(source, /Merge Safety Verdict/);
  assert.match(source, /Next Best Action/);
  assert.match(source, /Copy Repair Prompt/);
  assert.match(source, /Lesson Candidates/);
  assert.match(source, /Mission Handoff Pack/);
  assert.match(source, /operator_relief\.browser_proof_missing/);
});


test('Mission Console operator relief uses canonical collapsible panel wiring with persisted layout key', () => {
  assert.match(source, /panelId=\"missionConsoleOperatorReliefPanel\"/);
  assert.match(source, /isOpen=\{uiLayout\.missionConsoleOperatorReliefPanel !== false\}/);
  assert.equal(source.includes("togglePanel('missionConsoleOperatorReliefPanel')"), true);
});
