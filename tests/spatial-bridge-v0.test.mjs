import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const appIndexPath = new URL('../apps/index.json', import.meta.url);
const manifestPath = new URL('../apps/spatial-bridge/app.json', import.meta.url);
const projectionPath = new URL('../apps/spatial-bridge/bridge-state.v0.json', import.meta.url);
const htmlPath = new URL('../apps/spatial-bridge/index.html', import.meta.url);
const questEntryPath = new URL('../apps/spatial-bridge/quest-entry.html', import.meta.url);
const pwaManifestPath = new URL('../apps/spatial-bridge/manifest.webmanifest', import.meta.url);
const serviceWorkerPath = new URL('../apps/spatial-bridge/service-worker.js', import.meta.url);
const offlinePath = new URL('../apps/spatial-bridge/offline.html', import.meta.url);
const questContractPath = new URL('../apps/spatial-bridge/quest-entry-contract.v1.json', import.meta.url);
const assetLinksTemplatePath = new URL('../apps/spatial-bridge/assetlinks.template.json', import.meta.url);
const icon192Path = new URL('../apps/spatial-bridge/icons/icon-192.png', import.meta.url);
const icon512Path = new URL('../apps/spatial-bridge/icons/icon-512.png', import.meta.url);

test('spatial bridge is launcher discoverable and explicitly read-only', () => {
  const appIndex = readJson(appIndexPath);
  const manifest = readJson(manifestPath);

  assert.equal(appIndex.includes('spatial-bridge'), true);
  assert.equal(manifest.name, 'Stephanos Spatial Bridge');
  assert.equal(manifest.entry, 'index.html');
  assert.equal(manifest.authority, 'read-only');
  assert.equal(manifest.implementationStage, 'v0-flat-prototype-plus-quest-entry-scaffold');
  assert.equal(manifest.aiAddressable, false);
  assert.equal(manifest.questDistribution.preferredType, 'immersive-webxr-pwa');
  assert.equal(manifest.questDistribution.preferredChannel, 'private-alpha-release-channel');
  assert.equal(manifest.questDistribution.questLibraryIconAfterInstall, true);
  assert.equal(manifest.questDistribution.immersiveRendererReady, false);
  assert.deepEqual(manifest.eventsPublished, []);
});

test('spatial projection carries no execution authority and records Quest-local transport modes', () => {
  const projection = readJson(projectionPath);

  assert.equal(projection.version, 'stephanos.spatial-projection.v0.mock');
  assert.equal(projection.source, 'mock-projection');
  assert.equal(projection.readOnly, true);
  assert.equal(projection.authority, 'none');
  assert.equal(projection.modes.home.label, 'HOME · LOCAL QUEST');
  assert.match(projection.modes.home.transport, /Quest-local bridge/);
  assert.match(projection.modes.home.airLinkRole, /Optional separate PCVR/);
  assert.equal(projection.modes.caravan.label, 'CARAVAN · REMOTE STARLINK');
  assert.equal(projection.modes.caravan.rendering, 'Quest-local immersive renderer');
  assert.equal(projection.modes.degraded.label, 'REMOTE DEGRADED · READ ONLY');
  assert.match(projection.constraints.join('\n'), /No approvals/);
  assert.match(projection.constraints.join('\n'), /No execution/);
});

test('flat bridge prototype exposes simulation controls without mutation routes', () => {
  const html = readFileSync(htmlPath, 'utf8');

  assert.match(html, /Captain Bridge V0/);
  assert.match(html, /Read only · No execution authority/);
  assert.match(html, /data-mode="home" data-simulation-only/);
  assert.match(html, /data-mode="caravan" data-simulation-only/);
  assert.match(html, /data-mode="degraded" data-simulation-only/);
  assert.match(html, /bridge-state\.v0\.json/);
  assert.match(html, /projection\.readOnly !== true/);
  assert.match(html, /projection\.authority !== 'none'/);
  assert.doesNotMatch(html, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(html, /queryStephanosAI|requestStephanosBackend|openclaw|powershell/i);
});

test('Quest entry scaffold meets the source-level PWA contract', () => {
  const pwa = readJson(pwaManifestPath);
  const entry = readFileSync(questEntryPath, 'utf8');
  const serviceWorker = readFileSync(serviceWorkerPath, 'utf8');
  const offline = readFileSync(offlinePath, 'utf8');

  assert.equal(pwa.name, 'Stephanos Spatial Bridge');
  assert.equal(pwa.short_name, 'Stephanos');
  assert.equal(pwa.start_url, './quest-entry.html');
  assert.equal(pwa.scope, './');
  assert.equal(pwa.display, 'fullscreen');
  assert.equal(pwa.orientation, 'landscape');
  assert.equal(pwa.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'), true);
  assert.match(entry, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(entry, /navigator\.xr\.isSessionSupported\('immersive-vr'\)/);
  assert.match(entry, /serviceWorker\.register\('\.\/service-worker\.js'/);
  assert.match(entry, /flat staging surface/);
  assert.match(serviceWorker, /caches\.open\(CACHE_NAME\)/);
  assert.match(serviceWorker, /event\.request\.method !== 'GET'/);
  assert.match(serviceWorker, /offline\.html/);
  assert.match(offline, /Posture: read only/);
  assert.equal(existsSync(icon192Path), true);
  assert.equal(existsSync(icon512Path), true);
});

test('Quest entry contract selects Alpha release distribution and keeps Air Link optional', () => {
  const contract = readJson(questContractPath);
  const assetLinks = readJson(assetLinksTemplatePath);

  assert.equal(contract.version, 'stephanos.quest-entry-contract.v1');
  assert.equal(contract.preferredDelivery.type, 'immersive-webxr-pwa');
  assert.equal(contract.preferredDelivery.distribution, 'private ALPHA release channel');
  assert.equal(contract.preferredDelivery.questLibraryIcon, true);
  assert.equal(contract.preferredDelivery.sameAppHomeAndCaravan, true);
  assert.match(contract.transportProfiles.home.airLinkRole, /optional separate PCVR/);
  assert.equal(contract.pwaRequirements.httpsHostingRequired, true);
  assert.equal(contract.pwaRequirements.digitalAssetLinksRequired, true);
  assert.equal(contract.codexWindow.availableAfter, '2026-07-19T20:35:00+01:00');
  assert.match(contract.mergeGate, /Do not describe the package as a Quest VR app/);
  assert.equal(assetLinks[0].target.package_name, 'com.stephanos.spatialbridge');
  assert.match(assetLinks[0].target.sha256_cert_fingerprints[0], /REPLACE_WITH_SIGNING_KEY/);
});
