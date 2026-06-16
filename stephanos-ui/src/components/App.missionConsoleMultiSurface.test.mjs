import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';
import { deriveUiRealityStatus } from '../state/uiRealityStatus.js';

const componentsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const appPath = path.join(componentsDir, '../App.jsx');
const missionConsolePath = path.join(componentsDir, 'MissionConsoleTile.jsx');
const aiStorePath = path.join(componentsDir, '../state/aiStore.js');

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
    /id: 'aiCoreMissionConsolePanel'[\s\S]*?<MissionConsoleTile[\s\S]*?createMissionConsoleTileBridgeProps\('aiCoreMissionConsolePanel'/m,
  );
  assert.match(
    appSource,
    /id: 'missionConsolePanel'[\s\S]*?<MissionConsoleTile[\s\S]*?createMissionConsoleTileBridgeProps\('missionConsolePanel'/m,
  );
});

test('ai-core mission console marker is not rendered inside missionConsolePanel body path in App pane definitions', async () => {
  const appSource = await fs.readFile(appPath, 'utf8');
  const missionConsolePaneSegment = appSource.match(/id: 'missionConsolePanel'[\s\S]*?render: \(\) => \([\s\S]*?\),\n\s*\},/m)?.[0] || '';
  assert.equal(missionConsolePaneSegment.includes('data-testid="ai-core-mission-console"'), false);
  assert.match(appSource, /data-testid="ai-core-mission-console"/);
  assert.match(appSource, /createMissionConsoleTileBridgeProps\('aiCoreMissionConsolePanel'/);
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

test('rendered App DOM nests MissionConsoleTile marker under visible ai-core wrapper', async () => {
  const { renderApp } = await importBundledModule(
    path.join(srcRoot, 'test/renderAppEntry.jsx'),
    {},
    'app-ai-core-pane-trace-attrs',
  );
  const html = renderApp();
  const aiCoreWrapper = html.match(/<div[^>]*data-testid="ai-core-mission-console"[^>]*>[\s\S]*?<section[^>]*data-mission-console-component="MissionConsoleTile"[^>]*>/);
  assert.ok(aiCoreWrapper, 'expected [data-testid="ai-core-mission-console"] [data-mission-console-component="MissionConsoleTile"] in rendered App output');
  assert.match(aiCoreWrapper[0], /data-panel-id="aiCoreMissionConsolePanel"/);
  assert.match(aiCoreWrapper[0], /data-mission-console-panel-id="aiCoreMissionConsolePanel"/);
  assert.match(aiCoreWrapper[0], /data-mission-console-registration-effect-seen="yes"/);
  assert.match(aiCoreWrapper[0], /data-mission-console-registration-callback-prop-present="yes"/);
  assert.match(aiCoreWrapper[0], /data-mission-console-registration-drop-boundary="(none|effect-not-fired)"/);
});

test('rendered App DOM keeps MissionConsoleTile marker on dedicated mission console path', async () => {
  const { renderApp } = await importBundledModule(
    path.join(srcRoot, 'test/renderAppEntry.jsx'),
    {},
    'app-dedicated-mission-console-trace-attrs',
  );
  const html = renderApp();
  const dedicatedWrapper = html.match(/<div[^>]*data-testid="dedicated-mission-console"[^>]*>[\s\S]*?<section[^>]*data-mission-console-component="MissionConsoleTile"[^>]*>/);
  assert.ok(dedicatedWrapper, 'expected dedicated mission console wrapper to contain MissionConsoleTile marker');
  assert.match(dedicatedWrapper[0], /data-mission-console-panel-id="missionConsolePanel"/);
});


test('App operator relief projection handler records source surface and bridge diagnostics from MissionConsoleTile mounts', async () => {
  const appSource = await fs.readFile(appPath, 'utf8');
  assert.match(appSource, /const handleOperatorReliefProjectionUpdate = useCallback\(\(projection, options = \{\}\) => \{/);
  assert.match(appSource, /const sourceSurface = typeof options\?\.sourceSurface === 'string' && options\.sourceSurface \? options\.sourceSurface : 'unknown';/);
  assert.match(appSource, /const nextSignature = JSON\.stringify\(\{ sourceSurface, projection: nextProjection, instances: missionConsoleBridgeInstancesRef\.current \}\);/);
  assert.match(appSource, /sourceSurface,/);
  assert.match(appSource, /createMissionConsoleTileBridgeProps\(/);
});


test('createMissionConsoleTileBridgeProps does not register mission console instances during render', async () => {
  const appSource = await fs.readFile(appPath, 'utf8');
  const start = appSource.indexOf('const createMissionConsoleTileBridgeProps = useCallback((panelId, options = {}) => {');
  const end = appSource.indexOf('}, [handleOperatorReliefProjectionUpdate, publishOperatorReliefProjectionBridge, registerMissionConsoleBridgeInstance]);', start);
  const createBody = start >= 0 && end > start ? appSource.slice(start, end) : '';
  assert.equal(createBody.includes('onMissionConsoleInstanceRegistration'), true);
});

test('visible aiCore MissionConsoleTile path passes onMissionConsoleInstanceRegistration callback via bridge props', async () => {
  const appSource = await fs.readFile(appPath, 'utf8');
  assert.match(
    appSource,
    /id: 'aiCoreMissionConsolePanel'[\s\S]*?<MissionConsoleTile[\s\S]*?\{\.\.\.createMissionConsoleTileBridgeProps\('aiCoreMissionConsolePanel'[\s\S]*?visible: true/m,
  );
  assert.match(appSource, /onMissionConsoleInstanceRegistration: \(metadata = \{\}\) => \{/);
  assert.match(appSource, /registrationTrace/);
  assert.match(appSource, /setOperatorReliefProjectionBridge\(\{/);
});


test('App bridge registration publishes diagnostics even before Operator Relief projection exists', async () => {
  const appSource = await fs.readFile(appPath, 'utf8');
  assert.match(appSource, /const nextProjection = projection \|\| null;/);
  assert.match(appSource, /runtimeDiagnosticsPresent: 'yes'/);
  assert.match(appSource, /published: nextProjection \? 'yes' : 'no'/);
  assert.match(appSource, /missionConsoleInstanceCount: instanceIds\.length/);
  assert.match(appSource, /missionConsoleBridgeInstancesRefOwnerId: bridgeRegistryOwnerId/);
  assert.match(appSource, /publishOperatorReliefProjectionBridgeOwnerId: bridgeRegistryOwnerId/);
  assert.match(appSource, /operatorReliefBridgeDiagnosticsStoreOwnerId: bridgeRegistryOwnerId/);
  assert.match(appSource, /publisherRegistryInstanceCount: instanceIds\.length/);
  assert.match(appSource, /publisherRegistryInstanceIds: instanceIds/);
  assert.match(appSource, /publisherSource: options\?\.publisherSource \|\| 'unknown'/);
  assert.match(appSource, /appHandlerEntered: missionConsoleRegistrationTraceRef\.current\.appHandlerEntered \|\| missionConsoleRegistrationTraceRef\.current\.appHandlerSeen \|\| 'no'/);
  assert.match(appSource, /registrationAppHandlerSeen: missionConsoleRegistrationTraceRef\.current\.appHandlerSeen \|\| missionConsoleRegistrationTraceRef\.current\.appHandlerEntered \|\| 'no'/);
  assert.match(appSource, /registrationStoreWriteAttempted: missionConsoleRegistrationTraceRef\.current\.storeWriteAttempted \|\| 'yes'/);
  assert.match(appSource, /registrationStoreWriteAccepted: missionConsoleRegistrationTraceRef\.current\.storeWriteAccepted \|\| 'yes'/);
  assert.match(appSource, /registrationDiagnosticsStamp: missionConsoleRegistrationDiagnosticsStampRef\.current/);
  assert.match(appSource, /missionConsoleRegistrationDiagnosticsStampRef\.current \+= 1/);
  assert.match(appSource, /missionConsoleBridgeParityBlocker: missingBridgeCallbackIds\.length > 0 \? 'missing-bridge-callback' : \(instanceIds\.length <= 0 \? 'instance-not-registered' : \(nextProjection \? 'none' : 'projection-not-published'\)\)/);
  assert.match(appSource, /const publisherRegistryRead = missionConsoleBridgeInstancesRef\.current \|\| \{\}/);
  assert.match(appSource, /publishOperatorReliefProjectionBridge\(operatorReliefProjectionRef\.current, \{/);
  assert.match(appSource, /publisherRegistry: publisherRegistryRead/);
  assert.match(appSource, /publisherRegistryOwnerId: missionConsoleBridgeOwnerIdRef\.current/);
  assert.match(appSource, /publisherSource: 'app-bridge-registration'/);
  assert.match(appSource, /const registrationCommitted = missionConsoleBridgeInstancesRef\.current\?\.\[panelId\]\?\.instanceId === receivedInstanceId/);
  assert.match(appSource, /sideEffectStatus: registrationCommitted \? 'committed' : 'pending'/);
  assert.match(appSource, /registeredInstanceCount: receiptRegistryKeys\.length/);
  assert.match(appSource, /registryOwnerId: missionConsoleBridgeOwnerIdRef\.current/);
  const aiStoreSource = await fs.readFile(aiStorePath, 'utf8');
  assert.match(aiStoreSource, /operatorReliefBridgeDiagnostics: \{/);
  assert.match(aiStoreSource, /\.\.\.\(operatorReliefProjectionBridge\?\.diagnostics \|\| \{\}\)/);
  assert.match(aiStoreSource, /runtimeContextSeen: operatorReliefProjectionBridge\?\.diagnostics \? 'yes' : 'no'/);
  assert.match(aiStoreSource, /previousDiagnostics\.publisherRegistryInstanceCount \?\? previousDiagnostics\.missionConsoleInstanceCount/);
  assert.match(aiStoreSource, /previousHasRegisteredInstances && !nextHasRegisteredInstances && previousStamp >= nextStamp/);
});

test('MissionConsoleTile mount telemetry remains mount scoped and registration is emitted from separate effect', async () => {
  const missionConsoleSource = await fs.readFile(missionConsolePath, 'utf8');
  assert.match(missionConsoleSource, /setPerfIdentityField\('component\.MissionConsoleTile\.mounted', true\)/);
  assert.match(missionConsoleSource, /recordPerfCounter\('surface_mount', 'MissionConsoleTile\.mount'\)/);
  assert.match(missionConsoleSource, /\}, \[\]\);/);
  assert.match(missionConsoleSource, /onMissionConsoleInstanceRegistration\(\{/);
  assert.match(missionConsoleSource, /data-mission-console-registration-callback-return-side-effect-status/);
  assert.match(missionConsoleSource, /data-mission-console-registration-callback-return-registered-instance-count/);
  assert.match(missionConsoleSource, /data-mission-console-registration-callback-return-diagnostics-stamp/);
  assert.match(missionConsoleSource, /callbackPropPresent: 'yes'/);
  assert.match(missionConsoleSource, /dropBoundary: 'none'/);
});

test('App UI reality no longer treats canonical Mission Console sections as deferred nested operational panes', async () => {
  const source = await fs.readFile(appPath, 'utf8');
  assert.equal(source.includes('const operationalPaneIds = [];'), true);
  assert.equal(source.includes('missionConsoleCanonicalSectionPaneIds'), true);
  assert.equal(source.includes('missionConsoleSectionOrder: safePaneLayout.missionConsoleSectionOrder || []'), true);
});
