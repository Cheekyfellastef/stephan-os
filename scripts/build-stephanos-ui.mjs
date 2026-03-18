import { spawnSync } from 'node:child_process';
import {
  cleanStephanosDist,
  createStephanosBuildMetadata,
  prependDistBannerIfNeeded,
  repoRoot,
  stephanosUiRoot,
  writeStephanosDistMetadata,
} from './stephanos-build-utils.mjs';

const buildMetadata = createStephanosBuildMetadata();
const env = {
  ...process.env,
  STEPHANOS_BUILD_VERSION: buildMetadata.version,
  STEPHANOS_BUILD_SOURCE_IDENTIFIER: buildMetadata.sourceIdentifier,
  STEPHANOS_BUILD_SOURCE_FINGERPRINT: buildMetadata.sourceFingerprint,
  STEPHANOS_BUILD_TARGET: buildMetadata.buildTarget,
  STEPHANOS_BUILD_TARGET_IDENTIFIER: buildMetadata.buildTargetIdentifier,
  STEPHANOS_BUILD_RUNTIME_ID: buildMetadata.runtimeId,
  STEPHANOS_BUILD_RUNTIME_MARKER: buildMetadata.runtimeMarker,
  STEPHANOS_BUILD_GIT_COMMIT: buildMetadata.gitCommit,
  STEPHANOS_BUILD_TIMESTAMP: buildMetadata.buildTimestamp,
};

cleanStephanosDist();

const viteCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const buildResult = spawnSync(viteCommand, ['vite', 'build'], {
  cwd: stephanosUiRoot,
  env,
  stdio: 'inherit',
});

if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

prependDistBannerIfNeeded();
writeStephanosDistMetadata(buildMetadata);

console.log(`Stephanos UI built from ${buildMetadata.sourceIdentifier} into ${buildMetadata.buildTarget}.`);
console.log(`Runtime proof written to apps/stephanos/dist/stephanos-build.json from repo ${repoRoot}.`);
console.log(`Build metadata: ${JSON.stringify(buildMetadata)}`);
