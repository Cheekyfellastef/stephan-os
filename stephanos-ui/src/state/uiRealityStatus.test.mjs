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
