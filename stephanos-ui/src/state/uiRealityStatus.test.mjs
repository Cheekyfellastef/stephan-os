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
  } });
  assert.equal(result.severity, 'OK');
  assert.deepEqual(result.missingCollapseControlIds, []);
});
