import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createStephanosBuildMetadata,
  DIST_WARNING_BANNER,
  extractEmbeddedHtmlMetadata,
  formatDurationMs,
  getDistAgeMs,
  getDistAssetReferences,
  readDistMetadataJson,
  resolveDistAssetPath,
  stephanosDistIndexPath,
  stephanosDistMetadataPath,
} from './stephanos-build-utils.mjs';
import { STEPHANOS_DIST_ROUTE_MARKERS } from '../shared/runtime/stephanosRouteMarkers.mjs';

function fail(message) {
  console.error(`\n[stephanos verify] ${message}`);
  process.exit(1);
}

const expectedMetadata = createStephanosBuildMetadata();

const importGuardResult = spawnSync(process.execPath, ['scripts/guard-import-structure.mjs'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

if (importGuardResult.error || importGuardResult.status !== 0) {
  fail('Import structure guard failed. Resolve import guard violations before dist verification.');
}


const launcherScriptGuardResult = spawnSync(process.execPath, ['scripts/guard-launcher-scripts.mjs'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

if (launcherScriptGuardResult.error || launcherScriptGuardResult.status !== 0) {
  fail('Launcher script guard failed. Resolve parser-hazard script violations before dist verification.');
}


const stephanosAppManifestPath = resolve('apps/stephanos/app.json');

let stephanosAppManifest;
try {
  stephanosAppManifest = JSON.parse(readFileSync(stephanosAppManifestPath, 'utf8'));
} catch {
  fail('Stephanos app manifest is missing or invalid: apps/stephanos/app.json.');
}

if (stephanosAppManifest.entry !== 'dist/index.html') {
  fail(`Stephanos launcher entry must target dist/index.html, found "${stephanosAppManifest.entry}".`);
}

if (stephanosAppManifest.packaging !== 'vite') {
  fail(`Stephanos app packaging must be "vite", found "${stephanosAppManifest.packaging}".`);
}

if (!existsSync(stephanosDistIndexPath)) {
  fail('Stephanos dist is missing: apps/stephanos/dist/index.html. Rebuild with: npm run stephanos:build');
}

const indexHtml = readFileSync(stephanosDistIndexPath, 'utf8');
for (const requiredLine of DIST_WARNING_BANNER.split('\n')) {
  if (!indexHtml.includes(requiredLine)) {
    fail(`Stephanos dist is missing its generated-file warning banner (${requiredLine}). Rebuild with: npm run stephanos:build`);
  }
}

const assetReferences = getDistAssetReferences(indexHtml);
if (assetReferences.length === 0) {
  fail('Stephanos dist is incomplete: dist/index.html does not reference any relative runtime assets. Rebuild with: npm run stephanos:build');
}


const absoluteAssetReferences = assetReferences.filter((assetPath) => assetPath.startsWith('/'));
if (absoluteAssetReferences.length > 0) {
  fail(`Stephanos dist contains absolute asset references (${absoluteAssetReferences.join(', ')}). Rebuild with a relative Vite base (./).`);
}

const nonDotRelativeAssetReferences = assetReferences.filter((assetPath) => !assetPath.startsWith('./'));
if (nonDotRelativeAssetReferences.length > 0) {
  fail(`Stephanos dist asset references must be dot-relative (./...), found: ${nonDotRelativeAssetReferences.join(', ')}.`);
}

const entryScriptMatches = [...indexHtml.matchAll(/<script\b[^>]+src=["']([^"']+)["'][^>]*><\/script>/g)];
if (entryScriptMatches.length === 0) {
  fail('Stephanos dist is missing its script entry tag in dist/index.html. Rebuild with: npm run stephanos:build');
}

const missingTypeModule = entryScriptMatches.some((match) => !/\btype=["']module["']/.test(match[0]));
if (missingTypeModule) {
  fail('Stephanos dist entry scripts must be type="module" for Vite runtime execution. Rebuild with: npm run stephanos:build');
}

const missingAssets = assetReferences.filter((assetPath) => !existsSync(resolveDistAssetPath(assetPath)));
if (missingAssets.length > 0) {
  fail(`Stephanos dist references missing assets: ${missingAssets.join(', ')}. Dist looks stale; run: npm run stephanos:build`);
}

const jsAssets = assetReferences.filter((assetPath) => assetPath.endsWith('.js'));
const jsAssetContents = jsAssets.map((assetPath) => readFileSync(resolveDistAssetPath(assetPath), 'utf8'));
for (const marker of STEPHANOS_DIST_ROUTE_MARKERS) {
  const markerPresent = jsAssetContents.some((content) => content.includes(marker));
  if (!markerPresent) {
    fail(`Stephanos dist is stale: route adoption marker "${marker}" is missing from built JS assets. Rebuild with: npm run stephanos:build`);
  }
}

if (!existsSync(stephanosDistMetadataPath)) {
  fail('Stephanos dist metadata is missing: apps/stephanos/dist/stephanos-build.json was not generated. Rebuild with: npm run stephanos:build');
}

let fileMetadata;
let htmlMetadata;
try {
  fileMetadata = readDistMetadataJson();
} catch {
  fail('Stephanos dist metadata file is invalid JSON. Rebuild with: npm run stephanos:build');
}

try {
  htmlMetadata = extractEmbeddedHtmlMetadata(indexHtml);
} catch {
  fail('Embedded Stephanos dist metadata in dist/index.html is invalid JSON. Rebuild with: npm run stephanos:build');
}

if (!htmlMetadata) {
  fail('Stephanos dist metadata is missing from dist/index.html. Dist looks stale; run: npm run stephanos:build');
}

const metadataSources = [
  ['dist metadata file', fileMetadata],
  ['dist index.html metadata', htmlMetadata],
];

const expectedFields = [
  'appName',
  'version',
  'sourceIdentifier',
  'sourceFingerprint',
  'buildTarget',
  'buildTargetIdentifier',
  'runtimeId',
  'runtimeMarker',
  'gitCommit',
  'sourceTruth',
];

for (const [label, metadata] of metadataSources) {
  for (const field of expectedFields) {
    if (metadata?.[field] !== expectedMetadata[field]) {
      const message = field === 'sourceIdentifier'
        ? 'Stephanos dist was not generated from the live Vite source'
        : field === 'sourceFingerprint'
          ? 'Stephanos dist metadata is stale'
          : field === 'gitCommit'
            ? 'Stephanos dist metadata commit marker is stale (served dist appears behind current repository commit)'
          : `Stephanos dist metadata mismatch for ${field}`;
      fail(`${message}: expected "${expectedMetadata[field]}", found "${metadata?.[field]}" in ${label}. Rebuild with: npm run stephanos:build`);
    }
  }

  if (!metadata?.buildTimestamp || Number.isNaN(Date.parse(metadata.buildTimestamp))) {
    fail(`Stephanos dist metadata is stale: ${label} is missing a valid buildTimestamp. Rebuild with: npm run stephanos:build`);
  }
}

if (htmlMetadata.runtimeMarker !== fileMetadata.runtimeMarker || htmlMetadata.sourceIdentifier !== fileMetadata.sourceIdentifier) {
  fail('Stephanos dist metadata is inconsistent between dist/index.html and stephanos-build.json. Rebuild with: npm run stephanos:build');
}

if (!indexHtml.includes(expectedMetadata.runtimeMarker)) {
  fail('Stephanos dist runtime marker is missing from dist/index.html. Dist was not generated from the live Vite source. Rebuild with: npm run stephanos:build');
}

if (!indexHtml.includes(expectedMetadata.sourceIdentifier)) {
  fail('Stephanos dist source identifier is missing from dist/index.html. Dist was not generated from the live Vite source. Rebuild with: npm run stephanos:build');
}

const distAgeMs = getDistAgeMs();
console.log('[stephanos verify] Dist metadata and referenced assets match the current live Stephanos source.');
console.log(`[stephanos verify] Verified assets: ${assetReferences.join(', ')}`);
console.log(`[stephanos verify] Build metadata age: ${formatDurationMs(distAgeMs)}`);
console.log(`[stephanos verify] Build metadata: ${JSON.stringify(fileMetadata)}`);
