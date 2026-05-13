import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const appPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../App.jsx');

const aiStorePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../state/aiStore.js');

test('App registers Mission Console pane and keeps OpenClaw tile present', async () => {
  const source = await fs.readFile(appPath, 'utf8');
  assert.equal(source.includes("import MissionConsoleTile from './components/MissionConsoleTile.jsx';"), true);
  assert.equal(source.includes("id: 'missionConsolePanel'"), true);
  assert.equal(source.includes('<MissionConsoleTile'), true);
  assert.equal(source.includes("const missionConsoleSurfaceMode = surfaceMode === 'mission-console';"), true);
  assert.equal(source.includes('MISSION CONSOLE SURFACE'), true);
  assert.equal(source.includes("id: 'openClawPanel'"), true);
  assert.equal(source.includes('<OpenClawTile'), true);
});


test('App default shell keeps command deck width mode independent from missionConsolePanel collapse state', async () => {
  const source = await fs.readFile(appPath, 'utf8');
  const missionConsoleWidthModeSegment = source.split('const missionConsoleWideShellMode')[1]?.split('const missionConsoleIntentToBuildOpen')[0] || '';
  assert.equal(source.includes('missionConsoleWideShellMode'), true);
  assert.equal(missionConsoleWidthModeSegment.includes('safeUiLayout.missionConsoleCommandDeckMode !== false'), true);
  assert.equal(missionConsoleWidthModeSegment.includes('safeUiLayout.missionConsolePanel !== false'), false);
  assert.equal(source.includes('mission-console-command-deck-mode'), true);
});

test('default pane order keeps Mission Console mounted in Stephanos tile workspace', async () => {
  const source = await fs.readFile(aiStorePath, 'utf8');
  assert.match(source, /const DEFAULT_OPERATOR_PANE_ORDER = \[[\s\S]*'missionConsolePanel'/m);
});

test('Stephanos Tile workspace renders missionConsolePanel via canonical pane registry path', async () => {
  const source = await fs.readFile(appPath, 'utf8');
  assert.equal(source.includes("id: 'missionConsolePanel'"), true);
  assert.equal(source.includes('orderedPanes.map((pane) => {'), true);
  assert.equal(source.includes('<StephanosSurfacePane'), true);
  assert.equal(source.includes('<MissionConsoleTile'), true);
});

test('pane definitions include safeUiLayout dependency so togglePanel state updates re-render pane shells', async () => {
  const source = await fs.readFile(appPath, 'utf8');
  assert.equal(source.includes('safeUiLayout,'), true);
});
