import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveUiRealityStatus } from './uiRealityStatus.js';

test('derives OK when reality facts are complete and healthy', () => {
  const result = deriveUiRealityStatus({ reality: {
    paneShells: [{}, {}],
    panesMissingCollapseControls: [],
    moveControlGroups: [{}, {}],
    totalFirstClassPanes: 2,
    panesMissingMoveControls: [],
    orphanMoveControlCount: 0,
    totalMoveControlsVisible: 2,
    metadata: { sourceDistAlignment: 'aligned', startupStatus: 'ok' },
    copyButtons: [{}, {}],
    layout: {},
    aiCoreMissionConsole: { configured: true, rendered: true, visible: true, panelId: 'aiCoreMissionConsolePanel', forceOpen: true },
    dedicatedMissionConsole: { rendered: true, visible: true, panelId: 'missionConsolePanel' },
  } });
  assert.equal(result.severity, 'OK');
});

test('missing diagnostics becomes WARN without crashing', () => {
  const result = deriveUiRealityStatus({ reality: null });
  assert.equal(result.severity, 'WARN');
  assert.equal(result.browserProof, 'needs operator proof');
});

test('orphan and duplicate move controls become FAIL', () => {
  const result = deriveUiRealityStatus({ reality: {
    paneShells: [{}],
    panesMissingCollapseControls: [],
    moveControlGroups: [{}, {}],
    totalFirstClassPanes: 1,
    panesMissingMoveControls: [],
    orphanMoveControlCount: 1,
    metadata: { sourceDistAlignment: 'aligned', startupStatus: 'ok' },
    copyButtons: [],
    layout: {},
    aiCoreMissionConsole: { configured: true, rendered: true, visible: true, panelId: 'aiCoreMissionConsolePanel', forceOpen: true },
    dedicatedMissionConsole: { rendered: true, visible: true, panelId: 'missionConsolePanel' },
  } });
  assert.equal(result.severity, 'FAIL');
});

test('missing collapse controls become FAIL', () => {
  const result = deriveUiRealityStatus({ reality: {
    paneShells: [{}],
    panesMissingCollapseControls: ['a'],
    moveControlGroups: [{}],
    totalFirstClassPanes: 1,
    panesMissingMoveControls: [],
    orphanMoveControlCount: 0,
    metadata: { sourceDistAlignment: 'aligned', startupStatus: 'ok' },
    copyButtons: [],
    layout: {},
    aiCoreMissionConsole: { configured: true, rendered: true, visible: true, panelId: 'aiCoreMissionConsolePanel', forceOpen: true },
    dedicatedMissionConsole: { rendered: true, visible: true, panelId: 'missionConsolePanel' },
  } });
  assert.equal(result.severity, 'FAIL');
});


test('missing collapse controls include named pane ids and titles', () => {
  const result = deriveUiRealityStatus({ reality: {
    paneShells: [{}],
    panesMissingCollapseControls: [{ paneId: 'worldWorkspacePanel', title: 'World Workspace' }],
    moveControlGroups: [{}],
    totalFirstClassPanes: 1,
    panesMissingMoveControls: [],
    orphanMoveControlCount: 0,
    totalMoveControlsVisible: 1,
    metadata: { sourceDistAlignment: 'aligned', startupStatus: 'ok' },
    copyButtons: [],
    layout: {},
    aiCoreMissionConsole: { configured: true, rendered: true, visible: true, panelId: 'aiCoreMissionConsolePanel', forceOpen: true },
    dedicatedMissionConsole: { rendered: true, visible: true, panelId: 'missionConsolePanel' },
  } });
  assert.deepEqual(result.missingCollapseControlIds, ['worldWorkspacePanel']);
  assert.deepEqual(result.missingCollapseControlTitles, ['World Workspace']);
});


test('hostedIdeaStagingPanel is absent from missing collapse list when canonical control exists', () => {
  const result = deriveUiRealityStatus({ reality: {
    paneShells: [{ paneId: 'hostedIdeaStagingPanel' }],
    panesMissingCollapseControls: [],
    moveControlGroups: [{ ownerPanelId: 'hostedIdeaStagingPanel' }],
    totalFirstClassPanes: 1,
    panesMissingMoveControls: [],
    orphanMoveControlCount: 0,
    totalMoveControlsVisible: 1,
    metadata: { sourceDistAlignment: 'aligned', startupStatus: 'ok' },
    copyButtons: [],
    layout: {},
    aiCoreMissionConsole: { configured: true, rendered: true, visible: true, panelId: 'aiCoreMissionConsolePanel', forceOpen: true },
    dedicatedMissionConsole: { rendered: true, visible: true, panelId: 'missionConsolePanel' },
  } });
  assert.equal(result.severity, 'OK');
  assert.deepEqual(result.missingCollapseControlIds, []);
});


test('fails when AI Core Mission Console is missing even if dedicated surface exists', () => {
  const result = deriveUiRealityStatus({ reality: {
    paneShells: [{}],
    panesMissingCollapseControls: [],
    moveControlGroups: [{}],
    totalFirstClassPanes: 1,
    panesMissingMoveControls: [],
    orphanMoveControlCount: 0,
    metadata: { sourceDistAlignment: 'aligned', startupStatus: 'ok' },
    copyButtons: [],
    layout: {},
    aiCoreMissionConsole: { configured: true, rendered: false, visible: false, panelId: 'aiCoreMissionConsolePanel', forceOpen: true },
    dedicatedMissionConsole: { rendered: true, visible: true, panelId: 'missionConsolePanel' },
  } });
  assert.equal(result.severity, 'FAIL');
  assert.equal(result.uiRealityMissionConsoleMultiSurfaceStatus, 'FAIL');
  assert.match(result.failReasons.join(','), /ai-core-mission-console-missing/);
});

test('UI Reality FAILs when AI Core Mission Console closest parent pane is missionConsolePanel', () => {
  const result = deriveUiRealityStatus({ reality: {
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
      configured: true, rendered: true, visible: true, panelId: 'aiCoreMissionConsolePanel', forceOpen: false,
      domParentPaneId: 'missionConsolePanel', domParentPaneTitle: 'Mission Console', insideAgentMissionConsole: true, domAncestryPath: 'testid:ai-core-mission-console <- pane:missionConsolePanel', placementReason: 'nested-inside-agent-mission-console',
    },
    dedicatedMissionConsole: { rendered: true, visible: true, panelId: 'missionConsolePanel' },
  } });
  assert.equal(result.severity, 'FAIL');
  assert.equal(result.uiRealityAiCoreMissionConsoleInsideAgentMissionConsole, 'yes');
  assert.equal(result.uiRealityAiCoreMissionConsoleNesting, 'nested-in-agent-mission-console');
});

test('UI Reality OKs AI Core Mission Console placement when closest parent pane is aiCoreMissionConsolePanel', () => {
  const result = deriveUiRealityStatus({ reality: {
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
      configured: true, rendered: true, visible: true, panelId: 'aiCoreMissionConsolePanel', forceOpen: false,
      domParentPaneId: 'aiCoreMissionConsolePanel', domParentPaneTitle: 'AI Core Mission Console', insideAgentMissionConsole: false, domAncestryPath: 'testid:ai-core-mission-console <- pane:aiCoreMissionConsolePanel', placementReason: 'first-class-pane-shell',
    },
    dedicatedMissionConsole: { rendered: true, visible: true, panelId: 'missionConsolePanel' },
  } });
  assert.equal(result.severity, 'OK');
  assert.equal(result.uiRealityAiCoreMissionConsoleInsideAgentMissionConsole, 'no');
  assert.equal(result.uiRealityAiCoreMissionConsoleNesting, 'first-class-pane');
  assert.equal(result.uiRealityOperationalPanePlacementStatus, 'OK');
});
