import test from 'node:test';
import assert from 'node:assert/strict';
import React from '../stephanos-ui/node_modules/react/index.js';
import { renderToStaticMarkup } from '../stephanos-ui/node_modules/react-dom/server.node.js';
import { createServer } from '../stephanos-ui/node_modules/vite/dist/node/index.js';
import { chromium } from '../node_modules/playwright/index.mjs';

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
    assert.match(card, /data-proof-concierge-render-owner="CockpitPanel\.OperatorProofConcierge"/);
    assert.match(card, /data-proof-concierge-render-source-file="stephanos-ui\/src\/components\/CockpitPanel\.jsx"/);
    assert.match(card, /data-proof-concierge-render-branch="canonical-copy-packet"/);
    assert.match(card, /data-proof-concierge-next-proof-rendered="build-proof"/);
    assert.match(card, /data-proof-concierge-copy-label-rendered="Copy build-proof packet"/);
    assert.match(card, /data-proof-concierge-render-source="cockpit-canonical-copy-packet"/);
    assert.match(card, /data-proof-concierge-primary-source="OperatorProofConcierge.copyPacket"/);
    assert.doesNotMatch(card, /Copy proof-state diagnostic packet/);
    assert.doesNotMatch(card, /proof-state-reconciliation/);
    assert.doesNotMatch(card, /Diagnostics\/details — diagnostic packet/);
  } finally {
    await server.close();
  }
});


test('CockpitPanel Operator Proof Concierge ignores stale diagnostic projection fields in a mixed input', async () => {
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
          remainingMissingItems: ['build-proof', 'verify-proof'],
        },
      },
    });

    cockpitProjectionOverride.operatorProofConcierge = {
      ...cockpitProjectionOverride.operatorProofConcierge,
      nextProof: 'build-proof',
      packetText: 'Proof-state diagnostic packet.\nPacket Kind: proof-state-reconciliation',
      renderedNextProof: 'proof-state-reconciliation',
      renderedCopyLabel: 'Copy proof-state diagnostic packet',
      visiblePrimaryButtonLabel: 'Copy proof-state diagnostic packet',
      visiblePrimaryButtonSource: 'OperatorProofConcierge.copyDiagnosticPacket',
      copyDiagnosticPacket: {
        available: 'yes',
        label: 'Copy proof-state diagnostic packet',
        packetKind: 'proof-state-diagnostic',
        payload: 'Proof-state diagnostic packet.\nPacket Kind: proof-state-reconciliation',
        packetText: 'Proof-state diagnostic packet.\nPacket Kind: proof-state-reconciliation',
        source: 'OperatorProofConcierge.copyDiagnosticPacket',
      },
      copyPacket: {
        ...cockpitProjectionOverride.operatorProofConcierge.copyPacket,
        label: 'Copy build-proof packet',
        source: 'OperatorProofConcierge.copyPacket',
        payload: cockpitProjectionOverride.operatorProofConcierge.copyPacket.payload,
      },
    };

    const html = renderToStaticMarkup(React.createElement(
      AIStoreProvider,
      null,
      React.createElement(CockpitPanel, { forceOpen: true, standalone: true, cockpitProjectionOverride }),
    ));

    const cardStart = html.indexOf('data-proof-concierge-instance-id="cockpit-panel-proof-concierge"');
    assert.notEqual(cardStart, -1);
    const card = html.slice(cardStart, html.indexOf('cockpit-route-topology', cardStart));
    assert.match(card, /Next proof[\s\S]*build-proof/);
    assert.match(card, /Copy build-proof packet/);
    assert.match(card, /data-concierge-visible-primary-button-source="OperatorProofConcierge.copyPacket"/);
    assert.doesNotMatch(card, /proof-state-reconciliation/);
    assert.doesNotMatch(card, /Copy proof-state diagnostic packet/);
    assert.doesNotMatch(card, /OperatorProofConcierge\.copyDiagnosticPacket/);
  } finally {
    await server.close();
  }
});

test('CockpitPanel rendered Operator Proof Concierge advances visible card to verify-proof after build-proof accepted', async () => {
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
          acceptedItems: ['mission-console-bridge', 'build-proof'],
          remainingMissingItems: ['verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'],
        },
      },
    });

    assert.equal(cockpitProjectionOverride.operatorProofConcierge.nextProof, 'verify-proof');
    assert.equal(cockpitProjectionOverride.operatorProofConcierge.packetKind, 'verify-proof');
    assert.equal(cockpitProjectionOverride.operatorProofConcierge.visiblePrimaryButtonLabel, 'Copy verify-proof packet');

    const html = renderToStaticMarkup(React.createElement(
      AIStoreProvider,
      null,
      React.createElement(CockpitPanel, { forceOpen: true, standalone: true, cockpitProjectionOverride }),
    ));

    const cardStart = html.indexOf('data-proof-concierge-instance-id="cockpit-panel-proof-concierge"');
    assert.notEqual(cardStart, -1);
    const card = html.slice(cardStart, html.indexOf('cockpit-route-topology', cardStart));
    assert.match(card, /Next proof[\s\S]*verify-proof/);
    assert.match(card, /Copy verify-proof packet/);
    assert.match(card, /data-cockpit-action-packet-id="packet-verify-proof"/);
    assert.match(card, /data-proof-concierge-render-input-proof-signature="[^"]*mission-console-bridge\|build-proof :: verify-proof\|browser-proof-checklist\|pr-evidence\|source-pack-output :: verify-proof :: verify-proof :: OperatorProofConcierge\.copyPacket/);
    assert.doesNotMatch(card, /Copy build-proof packet/);
    assert.doesNotMatch(card, /data-cockpit-action-packet-id="packet-build-proof"/);
  } finally {
    await server.close();
  }
});

test('mounted CockpitPanel Proof Concierge advances from build-proof to verify-proof after live proof metadata update', async (t) => {
  const server = await createServer({ root: 'stephanos-ui', logLevel: 'silent', server: { host: '127.0.0.1', port: 0 }, appType: 'spa' });
  await server.listen();
  let browser = null;
  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      if (/Executable doesn't exist|browser executable/i.test(String(error?.message || error))) {
        t.skip('Playwright browser executable is not installed in this environment.');
        return;
      }
      throw error;
    }
    const address = server.httpServer.address();
    const port = typeof address === 'object' && address ? address.port : 5173;
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/src/test/cockpitLiveProofHarness.html`);
    await page.waitForSelector('[data-testid="operator-proof-concierge-primary-copy"][data-concierge-visible-primary-button-label="Copy build-proof packet"]');
    const firstCardHandle = await page.locator('[data-testid="operator-proof-concierge"]').elementHandle();
    assert.ok(firstCardHandle);
    assert.equal(await page.locator('[data-testid="operator-proof-concierge-next-proof"] strong').textContent(), 'build-proof');
    assert.equal(await page.locator('[data-testid="operator-proof-concierge-primary-copy"]').textContent(), 'Copy build-proof packet');

    await page.evaluate(() => window.__acceptBuildProof());
    await page.waitForSelector('[data-testid="operator-proof-concierge-primary-copy"][data-concierge-visible-primary-button-label="Copy verify-proof packet"]');

    const secondCardHandle = await page.locator('[data-testid="operator-proof-concierge"]').elementHandle();
    assert.strictEqual(await firstCardHandle.evaluate((node, second) => node === second, secondCardHandle), true);
    assert.equal(await page.locator('[data-testid="operator-proof-concierge-next-proof"] strong').textContent(), 'verify-proof');
    assert.equal(await page.locator('[data-testid="operator-proof-concierge-primary-copy"]').textContent(), 'Copy verify-proof packet');
    assert.equal(await page.locator('[data-testid="operator-proof-concierge-primary-copy"]').getAttribute('data-concierge-visible-primary-button-source'), 'OperatorProofConcierge.copyPacket');
    assert.equal(await page.locator('[data-testid="operator-proof-concierge"]').getAttribute('data-proof-concierge-render-input-next-proof'), 'verify-proof');
    assert.equal(await page.locator('[data-testid="operator-proof-concierge"]').getAttribute('data-proof-concierge-render-input-copy-packet-label'), 'Copy verify-proof packet');
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
