import test from 'node:test';
import assert from 'node:assert/strict';

import { renderTruthPanel } from '../shared/runtime/renderTruthPanel.mjs';

function createDocumentFixture() {
  const mount = {
    id: 'launcher-truth-panel-mount',
    innerHTML: '',
    style: { display: 'none' },
  };

  return {
    getElementById(id) {
      return id === 'launcher-truth-panel-mount' ? mount : null;
    },
    mount,
  };
}

test('truth panel renderer outputs compact operational summary and contradictions', () => {
  const documentRef = createDocumentFixture();
  const rendered = renderTruthPanel({
    status: 'critical',
    launcher: {
      mode: 'launcher-root',
      shellStatus: 'degraded',
      tileRegistryCount: 2,
      tileDomCount: 0,
      launcherCriticalModuleFailureCount: 1,
      buildProofPresent: false,
    },
    sourceBuildServed: {
      buildMarker: 'build-a',
      buildTimestamp: '2026-03-27T00:00:00.000Z',
      servedSourceTruthAvailable: true,
      servedDistTruthAvailable: false,
      sourceDistParityOk: false,
    },
    runtime: {
      runtimeDiagnosticsEnabled: true,
      launcherRuntimeFingerprintVisible: true,
      truthPanelVisible: true,
      backendReachable: false,
      finalRoute: '/',
      routeKind: 'launcher',
    },
    contradictions: [
      {
        id: 'tiles-discovered-but-not-rendered',
        severity: 'critical',
        message: 'Tiles missing.',
        relatedLawId: 'law-universal-entry-not-system-brain',
      },
    ],
  }, documentRef, { visible: true });

  assert.equal(rendered, true);
  assert.equal(documentRef.mount.style.display, 'block');
  assert.match(documentRef.mount.innerHTML, /Truth Panel/);
  assert.match(documentRef.mount.innerHTML, /Operational self-audit/);
  assert.match(documentRef.mount.innerHTML, /Contradictions \(1\)/);
  assert.match(documentRef.mount.innerHTML, /law-universal-entry-not-system-brain/);
});

test('truth panel renderer clears content when hidden', () => {
  const documentRef = createDocumentFixture();
  renderTruthPanel({ status: 'healthy', contradictions: [] }, documentRef, { visible: false });

  assert.equal(documentRef.mount.style.display, 'none');
  assert.equal(documentRef.mount.innerHTML, '');
});
