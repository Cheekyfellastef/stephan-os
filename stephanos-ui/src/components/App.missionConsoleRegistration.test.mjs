import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const appPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../App.jsx');

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
