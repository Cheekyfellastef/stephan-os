import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const aiConsoleSource = readFileSync(new URL('../stephanos-ui/src/components/AIConsole.jsx', import.meta.url), 'utf8');
const missionConsoleSource = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');
const commandResultCardSource = readFileSync(new URL('../stephanos-ui/src/components/CommandResultCard.jsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../stephanos-ui/src/App.jsx', import.meta.url), 'utf8');

test('Mission Console canon path is MissionConsoleTile + AIConsole + CommandResultCard', () => {
  assert.match(missionConsoleSource, /import AIConsole from '\.\/AIConsole';/);
  assert.match(missionConsoleSource, /<AIConsole/);
  assert.match(aiConsoleSource, /import CommandResultCard from '\.\/CommandResultCard';/);
  assert.match(aiConsoleSource, /safeCommandHistory\.map\(\(entry\) => <CommandResultCard key=\{entry\.id\} entry=\{entry\} \/>\)/);
  assert.match(commandResultCardSource, /AnswerPaneCopyButton/);
});

test('AIConsole preserves execute, emergency release, prompt input, answer history, continuity/diagnostics surfaces', () => {
  assert.match(aiConsoleSource, />\{isBusy \? 'Routing\.\.\.' : 'Execute'\}<\/button>/);
  assert.match(aiConsoleSource, /Emergency release Ollama load/);
  assert.match(aiConsoleSource, /placeholder="Enter command or prompt\.\.\."/);
  assert.match(aiConsoleSource, /<strong>Answer History<\/strong>/);
  assert.match(aiConsoleSource, /Continuity Context Used/);
  assert.match(aiConsoleSource, /Routing Notice/);
});

test('MissionConsoleTile keeps context selector, mission controls, and readiness diagnostics', () => {
  assert.match(missionConsoleSource, /setContextScope/);
  assert.match(missionConsoleSource, /<MissionCommandDeck/);
  assert.match(missionConsoleSource, /Generate Mission Spec/);
  assert.match(missionConsoleSource, /Submit Operator Intent to Mission Bridge/);
  assert.match(missionConsoleSource, /Request AI via Router/);
  assert.match(missionConsoleSource, /Approve for Codex handoff/);
  assert.match(missionConsoleSource, /Copy Mission Spec/);
  assert.match(missionConsoleSource, /Copy Codex Prompt/);
  assert.match(missionConsoleSource, /Generate Codex Handoff Packet/);
  assert.match(missionConsoleSource, /Execution readiness/);
});

test('Landing mission console route continues to mount MissionConsoleTile through App surface modes', () => {
  assert.match(appSource, /missionConsoleSurfaceMode = surfaceMode === 'mission-console'/);
  assert.match(appSource, /openClawSurfaceMode = surfaceMode === 'openclaw'/);
  assert.match(appSource, /<MissionConsoleTile/);
});

test('No false canon component references remain in primary mission console sources', () => {
  assert.doesNotMatch(aiConsoleSource, /CanonicalAnswerPane|CanonicalPaneStack/);
  assert.doesNotMatch(missionConsoleSource, /CanonicalAnswerPane|CanonicalPaneStack/);
  assert.doesNotMatch(appSource, /CanonicalAnswerPane|CanonicalPaneStack/);
});
