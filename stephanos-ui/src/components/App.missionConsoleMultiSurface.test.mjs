import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const componentsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const appPath = path.join(componentsDir, '../App.jsx');
const missionConsolePath = path.join(componentsDir, 'MissionConsoleTile.jsx');

test('mission console can render in both landing tile and Stephanos AI Core surface from canonical component path', async () => {
  const appSource = await fs.readFile(appPath, 'utf8');
  const missionConsoleSource = await fs.readFile(missionConsolePath, 'utf8');

  assert.match(appSource, /import MissionConsoleTile from '\.\/components\/MissionConsoleTile\.jsx';/);
  assert.match(missionConsoleSource, /import AIConsole from '\.\/AIConsole';/);

  const missionConsoleMountCount = (appSource.match(/<MissionConsoleTile/g) || []).length;
  assert.ok(missionConsoleMountCount >= 2, 'App should mount MissionConsoleTile in multiple legitimate surfaces');

  assert.match(appSource, /id: 'missionConsolePanel'/);
  assert.match(appSource, /id: 'aiConsole'/);
  assert.match(appSource, /id: 'aiCoreMissionConsolePanel'/);
});

test('embedded Stephanos AI Core MissionConsoleTile is explicitly exempt from missionConsolePanel collapse filtering', async () => {
  const missionConsoleSource = await fs.readFile(missionConsolePath, 'utf8');

  assert.match(missionConsoleSource, /forcePanelOpen = false/);
  assert.match(missionConsoleSource, /const missionConsolePanelOpen = forcePanelOpen \? true : uiLayout\[panelId\] !== false;/);
  assert.match(missionConsoleSource, /if \(forcePanelOpen\) \{[\s\S]*blockedByForcePanelOpen: true,[\s\S]*return;\s*\}/m);
  assert.match(missionConsoleSource, /dispatchPanelToggle\(panelId\)/);
});

test('App wires canonical MissionConsoleTile mount props for AI Core and dedicated Mission Console surfaces', async () => {
  const appSource = await fs.readFile(appPath, 'utf8');

  assert.match(
    appSource,
    /id: 'aiCoreMissionConsolePanel'[\s\S]*?<MissionConsoleTile[\s\S]*?panelId="aiCoreMissionConsolePanel"/m,
  );
  assert.match(
    appSource,
    /id: 'missionConsolePanel'[\s\S]*?<MissionConsoleTile[\s\S]*?panelId="missionConsolePanel"/m,
  );
});
