import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const distIndexPath = resolve(repoRoot, 'apps/stephanos/dist/index.html');
const uiPackagePath = resolve(repoRoot, 'stephanos-ui/package.json');
const uiPackage = JSON.parse(readFileSync(uiPackagePath, 'utf8'));

function getGitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'git-unavailable';
  }
}

function fail(message) {
  console.error(`\n[stephanos verify] ${message}`);
  process.exit(1);
}

if (!existsSync(distIndexPath)) {
  fail('Missing apps/stephanos/dist/index.html. Rebuild with: npm run build');
}

const html = readFileSync(distIndexPath, 'utf8');
const requiredBannerLines = [
  'GENERATED FILE: apps/stephanos/dist/index.html',
  'Do not edit manually. Source lives in stephanos-ui/src/**',
];
for (const line of requiredBannerLines) {
  if (!html.includes(line)) {
    fail(`dist/index.html is missing the generated-file warning banner (${line}). Rebuild with: npm run build`);
  }
}

const assetMatches = [
  ...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+)["'][^>]*>/g),
].map((match) => match[1]).filter((assetPath) => /^\.?\//.test(assetPath));

if (assetMatches.length === 0) {
  fail('No relative dist assets were referenced by apps/stephanos/dist/index.html. Rebuild with: npm run build');
}

const distDir = dirname(distIndexPath);
for (const assetPath of assetMatches) {
  const resolvedPath = resolve(distDir, assetPath);
  if (!existsSync(resolvedPath)) {
    fail(`dist/index.html references missing asset ${assetPath}. Dist looks stale; run: npm run build`);
  }
}

const metadataMatch = html.match(/<script id="stephanos-build-metadata" type="application\/json">([\s\S]*?)<\/script>/);
if (!metadataMatch) {
  fail('Missing embedded build metadata in dist/index.html. Dist looks stale; run: npm run build');
}

let distMetadata;
try {
  distMetadata = JSON.parse(metadataMatch[1]);
} catch {
  fail('Embedded build metadata in dist/index.html is invalid JSON. Rebuild with: npm run build');
}

const expectedMetadata = {
  version: uiPackage.version,
  sourceIdentifier: 'stephanos-ui/src',
  buildTarget: 'apps/stephanos/dist',
  runtimeMarker: 'stephanos-ui/runtime::dist-synced-v1',
  gitCommit: getGitCommit(),
};

for (const [field, expectedValue] of Object.entries(expectedMetadata)) {
  const actualValue = distMetadata?.[field];
  if (actualValue !== expectedValue) {
    fail(`Dist metadata mismatch for ${field}: expected "${expectedValue}", found "${actualValue}". Dist looks stale; run: npm run build`);
  }
}

if (!distMetadata?.buildTimestamp || Number.isNaN(Date.parse(distMetadata.buildTimestamp))) {
  fail('Dist metadata is missing a valid buildTimestamp. Dist looks stale; run: npm run build');
}

console.log('[stephanos verify] Dist metadata and referenced assets match the current source build expectations.');
console.log(`[stephanos verify] Verified assets: ${assetMatches.join(', ')}`);
console.log(`[stephanos verify] Build metadata: ${JSON.stringify(distMetadata)}`);
