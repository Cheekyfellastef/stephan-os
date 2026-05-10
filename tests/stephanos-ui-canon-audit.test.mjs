import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = {
  app: readFileSync(new URL('../stephanos-ui/src/App.jsx', import.meta.url), 'utf8'),
  aiConsole: readFileSync(new URL('../stephanos-ui/src/components/AIConsole.jsx', import.meta.url), 'utf8'),
  missionConsole: readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8'),
  openClaw: readFileSync(new URL('../stephanos-ui/src/components/OpenClawTile.jsx', import.meta.url), 'utf8'),
  agents: readFileSync(new URL('../stephanos-ui/src/components/AgentsTile.jsx', import.meta.url), 'utf8'),
  capabilityRadar: readFileSync(new URL('../stephanos-ui/src/components/CapabilityRadarTile.jsx', import.meta.url), 'utf8'),
  skillForge: readFileSync(new URL('../stephanos-ui/src/components/SkillForgeTile.jsx', import.meta.url), 'utf8'),
  collapse: readFileSync(new URL('../stephanos-ui/src/components/CollapsiblePanel.jsx', import.meta.url), 'utf8'),
  commandResultCard: readFileSync(new URL('../stephanos-ui/src/components/CommandResultCard.jsx', import.meta.url), 'utf8'),
  answerCopy: readFileSync(new URL('../stephanos-ui/src/components/AnswerPaneCopyButton.jsx', import.meta.url), 'utf8'),
};

test('Stephanos canon audit: mission console path stays shared via MissionConsoleTile + AIConsole', () => {
  assert.match(files.app, /<MissionConsoleTile/);
  assert.match(files.missionConsole, /import AIConsole from '\.\/AIConsole';/);
  assert.match(files.missionConsole, /<AIConsole/);
  assert.match(files.aiConsole, /CommandResultCard/);
  assert.match(files.commandResultCard, /AnswerPaneCopyButton/);
});

test('Stephanos canon audit: major tiles use CollapsiblePanel canonical collapse shell', () => {
  for (const key of ['missionConsole', 'openClaw', 'agents', 'capabilityRadar', 'skillForge']) {
    assert.match(files[key], /<CollapsiblePanel/);
  }
});

test('Stephanos canon audit: chevron collapse control is wired to body state + drag guard markers', () => {
  assert.match(files.collapse, /stephanos-canon-rotating-chevron-button/);
  assert.match(files.collapse, /aria-controls=\{bodyId\}/);
  assert.match(files.collapse, /hidden=\{!isOpen\}/);
  assert.match(files.collapse, /data-no-drag="true"/);
});

test('Stephanos canon audit: command composer controls keep required operator controls', () => {
  assert.match(files.aiConsole, /placeholder="Enter command or prompt\.\.\."/);
  assert.match(files.aiConsole, />\{isBusy \? 'Routing\.\.\.' : 'Execute'\}<\/button>/);
  assert.match(files.aiConsole, /Emergency release Ollama load/);
});

test('Stephanos canon audit: answer pane canon keeps copy controls', () => {
  assert.match(files.answerCopy, /Copy Answer/);
  assert.match(files.answerCopy, /Copy Debug Payload/);
});
