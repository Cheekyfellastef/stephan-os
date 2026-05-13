import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const componentsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const surfacePanePath = path.join(componentsDir, 'StephanosSurfacePane.jsx');
const appPath = path.join(componentsDir, '../App.jsx');

test('outer Stephanos surface pane hides rendered pane body when collapsed', async () => {
  const source = await fs.readFile(surfacePanePath, 'utf8');
  assert.match(source, /const paneNode = paneCollapsed \? null : pane\.render\(\{ moveControlGroup \}\);/);
  assert.match(source, /data-pane-collapsed=\{paneCollapsed \? 'true' : 'false'\}/);
});

test('App diagnostics distinguish Agent Mission Console outer and inner layers', async () => {
  const source = await fs.readFile(appPath, 'utf8');
  assert.match(source, /agentMissionConsole:\s*\{\s*outer:/m);
  assert.match(source, /visibleChevronLayer: 'outer-pane-shell'/);
  assert.match(source, /childMountedWhenCollapsed: false/);
  assert.match(source, /inner:\s*\{\s*title: 'Stephanos • Mission Console \/ Command Deck'/m);
});
