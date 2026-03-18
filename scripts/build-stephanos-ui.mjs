import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const uiPackagePath = resolve(repoRoot, 'stephanos-ui/package.json');
const distIndexPath = resolve(repoRoot, 'apps/stephanos/dist/index.html');
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

const buildMetadata = {
  appName: 'Stephanos UI',
  version: uiPackage.version,
  sourceIdentifier: 'stephanos-ui/src',
  buildTarget: 'apps/stephanos/dist',
  runtimeMarker: 'stephanos-ui/runtime::dist-synced-v1',
  gitCommit: getGitCommit(),
  buildTimestamp: new Date().toISOString(),
};

const env = {
  ...process.env,
  STEPHANOS_BUILD_VERSION: buildMetadata.version,
  STEPHANOS_BUILD_SOURCE_IDENTIFIER: buildMetadata.sourceIdentifier,
  STEPHANOS_BUILD_TARGET: buildMetadata.buildTarget,
  STEPHANOS_BUILD_RUNTIME_MARKER: buildMetadata.runtimeMarker,
  STEPHANOS_BUILD_GIT_COMMIT: buildMetadata.gitCommit,
  STEPHANOS_BUILD_TIMESTAMP: buildMetadata.buildTimestamp,
};

const viteCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const buildResult = spawnSync(viteCommand, ['vite', 'build'], {
  cwd: resolve(repoRoot, 'stephanos-ui'),
  env,
  stdio: 'inherit',
});

if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const generatedBanner = [
  '<!-- GENERATED FILE: apps/stephanos/dist/index.html -->',
  '<!-- Do not edit manually. Source lives in stephanos-ui/src/** and must be rebuilt with npm run build. -->',
  '<!-- Dist runtime metadata is verified by npm run verify. -->',
].join('\n');

const indexHtml = readFileSync(distIndexPath, 'utf8');
if (!indexHtml.startsWith(generatedBanner)) {
  writeFileSync(distIndexPath, `${generatedBanner}\n${indexHtml}`);
}

console.log(`Stephanos UI built to ${buildMetadata.buildTarget}`);
console.log(`Build metadata: ${JSON.stringify(buildMetadata)}`);
