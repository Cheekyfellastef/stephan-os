import { existsSync, readFileSync } from 'node:fs';
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

function fail(message) {
  console.error(`\n[stephanos verify] ${message}`);
  process.exit(1);
}

const expectedMetadata = createStephanosBuildMetadata();

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

const missingAssets = assetReferences.filter((assetPath) => !existsSync(resolveDistAssetPath(assetPath)));
if (missingAssets.length > 0) {
  fail(`Stephanos dist references missing assets: ${missingAssets.join(', ')}. Dist looks stale; run: npm run stephanos:build`);
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
];

for (const [label, metadata] of metadataSources) {
  for (const field of expectedFields) {
    if (metadata?.[field] !== expectedMetadata[field]) {
      const message = field === 'sourceIdentifier'
        ? 'Stephanos dist was not generated from the live Vite source'
        : field === 'sourceFingerprint'
          ? 'Stephanos dist metadata is stale'
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
