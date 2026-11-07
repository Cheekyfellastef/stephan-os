import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSpatialBridgeIcons } from '../apps/spatial-bridge/tools/build-icons.mjs';
import { discoverApps } from '../system/apps/app_discovery.js';
import { launchProject } from '../modules/command-deck/command-deck.js';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const appIndexPath = new URL('../apps/index.json', import.meta.url);
const manifestPath = new URL('../apps/spatial-bridge/app.json', import.meta.url);
const projectionPath = new URL('../apps/spatial-bridge/bridge-state.v0.json', import.meta.url);
const htmlPath = new URL('../apps/spatial-bridge/index.html', import.meta.url);
const questEntryPath = new URL('../apps/spatial-bridge/quest-entry.html', import.meta.url);
const holodeckModulePath = new URL('../apps/spatial-bridge/holodeck-baseline-v0.mjs', import.meta.url);
const pwaManifestPath = new URL('../apps/spatial-bridge/manifest.webmanifest', import.meta.url);
const serviceWorkerPath = new URL('../apps/spatial-bridge/service-worker.js', import.meta.url);
const offlinePath = new URL('../apps/spatial-bridge/offline.html', import.meta.url);
const questContractPath = new URL('../apps/spatial-bridge/quest-entry-contract.v1.json', import.meta.url);
const assetLinksTemplatePath = new URL('../apps/spatial-bridge/assetlinks.template.json', import.meta.url);
const iconSourcePath = new URL('../apps/spatial-bridge/icons/icon-source.json', import.meta.url);

test('spatial bridge is launcher discoverable and explicitly read-only', () => {
  const appIndex = readJson(appIndexPath);
  const manifest = readJson(manifestPath);
  assert.equal(appIndex.includes('spatial-bridge'), true);
  assert.equal(manifest.name, 'Stephanos Spatial Workspace');
  assert.equal(manifest.entry, 'quest-entry.html');
  assert.equal(manifest.spatialConsole.entry, manifest.entry);
  assert.equal(manifest.packaging, 'classic-static');
  assert.equal(manifest.launchStrategy, 'navigate');
  assert.equal(manifest.launcherActionLabel, 'Open Spatial Workspace');
  assert.match(manifest.description, /3D Holodeck preview.*PC.*iPad.*phone/i);
  assert.equal(appIndex.filter(id => id === 'spatial-bridge').length, 1);
  assert.equal(manifest.authority, 'read-only');
  assert.equal(manifest.implementationStage, 'v1-spatial-workspace-starting-chamber-source');
  assert.equal(manifest.aiAddressable, false);
  assert.equal(manifest.questDistribution.preferredType, 'immersive-webxr-pwa');
  assert.equal(manifest.questDistribution.preferredChannel, 'private-alpha-release-channel');
  assert.equal(manifest.questDistribution.questLibraryIconAfterInstall, true);
  assert.equal(manifest.questDistribution.immersiveRendererSourceReady, true);
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
  assert.match(html, /Home · Local Quest/);
  assert.match(html, /data-mode="home" data-simulation-only/);
  assert.match(html, /data-mode="caravan" data-simulation-only/);
  assert.match(html, /data-mode="degraded" data-simulation-only/);
  assert.match(html, /bridge-state\.v0\.json/);
  assert.match(html, /projection\.readOnly !== true/);
  assert.match(html, /projection\.authority !== 'none'/);
  assert.doesNotMatch(html, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(html, /queryStephanosAI|requestStephanosBackend|openclaw|powershell/i);
});

test('Quest entry meets the source-level PWA and Holodeck baseline contract', () => {
  const pwa = readJson(pwaManifestPath);
  const entry = readFileSync(questEntryPath, 'utf8');
  const holodeckModule = readFileSync(holodeckModulePath, 'utf8');
  const serviceWorker = readFileSync(serviceWorkerPath, 'utf8');
  const offline = readFileSync(offlinePath, 'utf8');
  assert.equal(pwa.name, 'Stephanos Spatial Workspace');
  assert.equal(pwa.short_name, 'Stephanos');
  assert.equal(pwa.start_url, './quest-entry.html');
  assert.equal(pwa.scope, './');
  assert.equal(pwa.display, 'fullscreen');
  assert.equal(pwa.orientation, 'landscape');
  assert.equal(pwa.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'), true);
  assert.match(entry, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(entry, /holodeck-baseline-v0\.mjs/);
  assert.match(holodeckModule, /isSessionSupported/);
  assert.match(entry, /serviceWorker\.register\('\.\/service-worker\.js'/);
  assert.match(serviceWorker, /holodeck-baseline-v0\.mjs/);
  assert.match(serviceWorker, /holodeck-room-v1\.mjs/);
  assert.match(serviceWorker, /caches\.open\(CACHE_NAME\)/);
  assert.match(serviceWorker, /event\.request\.method !== 'GET'/);
  assert.match(serviceWorker, /GENERATED_PACKAGING_ASSETS/);
  assert.match(serviceWorker, /offline\.html/);
  assert.match(offline, /Posture: read only/);
});

test('Quest icon generator produces valid deterministic PNG dimensions without committed binaries', () => {
  const source = readJson(iconSourcePath);
  const outputDir = mkdtempSync(join(tmpdir(), 'stephanos-spatial-icons-'));
  try {
    const outputs = writeSpatialBridgeIcons({ specPath: iconSourcePath, outputDir });
    assert.deepEqual(source.outputSizes, [192, 512]);
    assert.equal(outputs.length, 2);
    outputs.forEach((output, index) => {
      const png = readFileSync(output);
      const expectedSize = source.outputSizes[index];
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(png.readUInt32BE(16), expectedSize);
      assert.equal(png.readUInt32BE(20), expectedSize);
      assert.equal(png.includes(Buffer.from('IHDR')), true);
      assert.equal(png.includes(Buffer.from('IDAT')), true);
      assert.equal(png.includes(Buffer.from('IEND')), true);
    });
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('Quest entry contract selects Alpha release distribution and keeps source readiness separate from physical proof', () => {
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
  assert.equal(contract.sourceReadiness.holodeckBaselineModule, true);
  assert.equal(contract.sourceReadiness.immersiveWebxrSessionAdapter, true);
  assert.equal(contract.sourceReadiness.offlineEntryModuleGraphCached, true);
  assert.equal(contract.sourceReadiness.immersiveRendererSourceReady, true);
  assert.equal(contract.sourceReadiness.immersiveRendererObservedOnQuest3, false);
  assert.equal(contract.nextProofTasks.some((task) => /Quest 3/.test(task)), true);
  assert.equal(contract.nextProofTasks.some((task) => /Digital Asset Link/.test(task)), true);
  assert.match(contract.mergeGate, /do not describe the package as Quest-3 proven/i);
  assert.match(contract.mergeGate, /immersive WebXR headset proof/);
  assert.match(contract.mergeGate, /ALPHA-channel installation/);
  assert.equal(assetLinks[0].target.package_name, 'com.stephanos.spatialbridge');
  assert.match(assetLinks[0].target.sha256_cert_fingerprints[0], /REPLACE_WITH_SIGNING_KEY/);
});

test('landing discovers one valid Spatial Workspace preview tile instead of rejecting old packaging', async () => {
  const originalFetch=globalThis.fetch;
  const manifest=readJson(manifestPath);
  const requests=[];
  globalThis.fetch=async (url, options={})=>{
    requests.push({url:String(url),method:options.method||'GET'});
    if(url==='./apps/index.json') return new Response(JSON.stringify(['spatial-bridge']));
    if(url==='./apps/spatial-bridge/app.json') return new Response(JSON.stringify(manifest));
    if(url==='./apps/spatial-bridge/quest-entry.html') return new Response('Spatial Workspace');
    return new Response('',{status:404});
  };
  try {
    const {apps,validationReport}=await discoverApps();
    const spatial=apps.filter(project=>project.id==='spatial-bridge');
    assert.equal(spatial.length,1,'reuse the original tile, never inject a duplicate');
    assert.equal(validationReport.invalid,0);
    assert.equal(spatial[0].disabled,false);
    assert.equal(spatial[0].validationState,'unknown');
    assert.equal(spatial[0].entry,'apps/spatial-bridge/quest-entry.html');
    assert.equal(spatial[0].launchStrategy,'navigate');
    assert.equal(spatial[0].launcherActionLabel,'Open Spatial Workspace');
    assert.equal(spatial[0].launcherBadges.includes('3D Preview'),true);
    assert.ok(requests.some(req=>req.method==='HEAD'&&req.url==='./apps/spatial-bridge/quest-entry.html'));
  } finally {globalThis.fetch=originalFetch;}
});

test('Spatial Workspace tile opens same-site 3D preview on Battle Bridge, hosted mobile and remote Stephanos', () => {
  const originalWindow=globalThis.window;
  const manifest=readJson(manifestPath);
  const cases=[
    ['http://127.0.0.1:4173/', '/apps/spatial-bridge/quest-entry.html'],
    ['https://cheekyfellastef.github.io/stephan-os/', '/stephan-os/apps/spatial-bridge/quest-entry.html'],
    ['https://battle-bridge.example.ts.net/', '/apps/spatial-bridge/quest-entry.html'],
  ];
  try {
    for(const [home,pathname] of cases) {
      let assigned='';
      globalThis.window={location:{href:home,origin:new URL(home).origin,
        pathname:new URL(home).pathname,assign:url=>{assigned=url;}},document:{querySelector:()=>null}};
      launchProject({id:'spatial-bridge',folder:'spatial-bridge',
        name:manifest.name,entry:'apps/spatial-bridge/'+manifest.entry,
        launchStrategy:manifest.launchStrategy},
        {workspace:{open:()=>assert.fail('WebXR must open top-level, not a nested iframe')}},
        {type:'user-click'});
      assert.equal(new URL(assigned).origin,new URL(home).origin);
      assert.equal(new URL(assigned).pathname,pathname);
      if(!home.startsWith('http://127.0.0.1')) assert.doesNotMatch(assigned,/127\.0\.0\.1|localhost/i);
    }
  } finally {globalThis.window=originalWindow;}
});

test('flat preview remains available without WebXR; native ChatGPT desktop capture stays local',()=>{
  const entry=readFileSync(questEntryPath,'utf8');
  const capture=readFileSync(new URL('../apps/spatial-bridge/holodeck-window-client-v1.mjs',import.meta.url),'utf8');
  assert.match(entry,/playPreview/);
  assert.match(entry,/drawPreview/);
  assert.match(entry,/Enter Spatial Workspace/);
  assert.match(capture,/127\.0\.0\.1/);
  assert.doesNotMatch(readJson(manifestPath).entry,/^https?:/);
});
