import test from 'node:test';
import assert from 'node:assert/strict';
import React from '../stephanos-ui/node_modules/react/index.js';
import { renderToStaticMarkup } from '../stephanos-ui/node_modules/react-dom/server.node.js';
import { createServer } from '../stephanos-ui/node_modules/vite/dist/node/index.js';

function installBrowserStubs() {
  globalThis.window = globalThis.window || {
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    location: { hostname: 'localhost', protocol: 'http:', origin: 'http://localhost:5173' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  globalThis.document = globalThis.document || { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
}

test('CockpitPanel rendered Operator Proof Concierge shows build-proof primary packet instead of proof-state diagnostic', async () => {
  installBrowserStubs();
  const server = await createServer({ root: 'stephanos-ui', logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { default: CockpitPanel } = await server.ssrLoadModule('/src/components/CockpitPanel.jsx');
    const { AIStoreProvider } = await server.ssrLoadModule('/src/state/aiStore.js');
    const { buildCockpitProjection } = await server.ssrLoadModule('/src/state/cockpitProjection.js');
    const cockpitProjectionOverride = buildCockpitProjection({
      runtimeStatusModel: {
        mergeSafety: 'no / hold',
        missionProofReconciliation: {
          acceptedItems: ['mission-console-bridge'],
          remainingMissingItems: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'],
        },
      },
    });

    assert.equal(cockpitProjectionOverride.operatorProofConcierge.nextProof, 'build-proof');
    assert.equal(cockpitProjectionOverride.operatorProofConcierge.packetKind, 'build-proof');
    assert.equal(cockpitProjectionOverride.operatorProofConcierge.proofStateContradictionDetected, 'no');
    assert.equal(cockpitProjectionOverride.operatorProofConcierge.visiblePrimaryButtonLabel, 'Copy build-proof packet');
    assert.equal(cockpitProjectionOverride.operatorProofConcierge.visiblePrimaryButtonSource, 'OperatorProofConcierge.copyPacket');

    const html = renderToStaticMarkup(React.createElement(
      AIStoreProvider,
      null,
      React.createElement(CockpitPanel, { forceOpen: true, standalone: true, cockpitProjectionOverride }),
    ));

    const cardStart = html.indexOf('data-testid="operator-proof-concierge"');
    assert.notEqual(cardStart, -1);
    const card = html.slice(cardStart, html.indexOf('cockpit-route-topology', cardStart));
    assert.match(card, /Next proof[\s\S]*build-proof/);
    assert.match(card, /Copy build-proof packet/);
    assert.match(card, /data-concierge-visible-primary-button-label="Copy build-proof packet"/);
    assert.match(card, /data-concierge-visible-primary-button-source="OperatorProofConcierge.copyPacket"/);
    assert.doesNotMatch(card, /Copy proof-state diagnostic packet/);
    assert.doesNotMatch(card, /proof-state-reconciliation/);
    assert.doesNotMatch(card, /Diagnostics\/details — diagnostic packet/);
  } finally {
    await server.close();
  }
});
