import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';
import { deriveUiRealityStatus } from '../state/uiRealityStatus.js';

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
  assert.match(appSource, /id: 'commandDeck'/);
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

test('ai-core mission console marker is not rendered inside missionConsolePanel body path in App pane definitions', async () => {
  const appSource = await fs.readFile(appPath, 'utf8');
  const missionConsolePaneSegment = appSource.match(/id: 'missionConsolePanel'[\s\S]*?render: \(\) => \([\s\S]*?\),\n\s*\},/m)?.[0] || '';
  assert.equal(missionConsolePaneSegment.includes('data-testid="ai-core-mission-console"'), false);
  assert.match(appSource, /data-testid="ai-core-mission-console"/);
  assert.match(appSource, /panelId="aiCoreMissionConsolePanel"/);
});

test('ai-core mission console ancestry diagnostics require closest pane shell truth markers', async () => {
  const appSource = await fs.readFile(appPath, 'utf8');
  assert.equal(appSource.includes('[data-pane-id="missionConsolePanel"], [data-testid="pane-missionConsolePanel-body"], .mission-console-shell'), true);
  assert.equal(appSource.includes("const parentPaneId = parentPaneShell?.getAttribute('data-pane-id') || 'unknown';"), true);
});

test('rendered App path keeps ai-core mission console in aiCoreMissionConsolePanel first-class pane shell', async () => {
  const { renderApp } = await importBundledModule(
    path.join(srcRoot, 'test/renderAppEntry.jsx'),
    {},
    'app-ai-core-pane-ancestry',
  );
  const html = renderApp();
  assert.equal(html.includes('data-testid="ai-core-mission-console"'), true);
  const aiCoreIndex = html.indexOf('data-testid="ai-core-mission-console"');
  assert.notEqual(aiCoreIndex, -1);
  const before = html.slice(0, aiCoreIndex);
  const paneMatches = [...before.matchAll(/data-pane-id="([^"]+)"/g)];
  const closestPaneId = paneMatches.at(-1)?.[1] || '';
  assert.equal(closestPaneId, 'aiCoreMissionConsolePanel');
  const nearestMissionPanelIndex = before.lastIndexOf('data-pane-id="missionConsolePanel"');
  assert.equal(nearestMissionPanelIndex > before.lastIndexOf('data-pane-id="aiCoreMissionConsolePanel"'), false);
  const missionBodyStart = before.lastIndexOf('data-testid="pane-missionConsolePanel-body"');
  assert.equal(missionBodyStart > before.lastIndexOf('data-testid="pane-aiCoreMissionConsolePanel-body"'), false);

  const uiReality = deriveUiRealityStatus({ reality: {
    paneShells: [{}, {}],
    panesMissingCollapseControls: [],
    moveControlGroups: [{}, {}],
    totalFirstClassPanes: 2,
    panesMissingMoveControls: [],
    orphanMoveControlCount: 0,
    metadata: { sourceDistAlignment: 'aligned', startupStatus: 'ok' },
    copyButtons: [{}],
    layout: {},
    aiCoreMissionConsole: {
      configured: true,
      rendered: true,
      visible: true,
      panelId: 'aiCoreMissionConsolePanel',
      forceOpen: false,
      domParentPaneId: closestPaneId,
      domParentPaneTitle: 'AI Core Mission Console',
      insideAgentMissionConsole: false,
      domAncestryPath: `testid:ai-core-mission-console <- pane:${closestPaneId}`,
      placementReason: 'first-class-pane-shell',
    },
    dedicatedMissionConsole: { rendered: true, visible: true, panelId: 'missionConsolePanel' },
  } });
  assert.equal(uiReality.uiRealityAiCoreMissionConsoleDomParentPaneId, 'aiCoreMissionConsolePanel');
  assert.equal(uiReality.uiRealityAiCoreMissionConsoleInsideAgentMissionConsole, 'no');
});


test('App operator relief projection handler records source surface and bridge diagnostics from MissionConsoleTile mounts', async () => {
  const appSource = await fs.readFile(appPath, 'utf8');
  assert.match(appSource, /const handleOperatorReliefProjectionUpdate = useCallback\(\(projection, options = \{\}\) => \{/);
  assert.match(appSource, /const sourceSurface = typeof options\?\.sourceSurface === 'string' && options\.sourceSurface \? options\.sourceSurface : 'unknown';/);
  assert.match(appSource, /const nextSignature = JSON\.stringify\(\{ sourceSurface, projection: nextProjection \}\);/);
  assert.match(appSource, /sourceSurface,/);
  assert.match(appSource, /onOperatorReliefProjectionUpdate=\{handleOperatorReliefProjectionUpdate\}/);
});
