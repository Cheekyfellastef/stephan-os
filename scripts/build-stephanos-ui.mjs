import { spawnSync } from 'node:child_process';
import {
  cleanStephanosDist,
  createStephanosBuildMetadata,
  prependDistBannerIfNeeded,
  stephanosDistIndexPath,
  repoRoot,
  stephanosUiRoot,
  writeStephanosDistMetadata,
} from './stephanos-build-utils.mjs';
import { existsSync } from 'node:fs';

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
  STEPHANOS_BUILD_SOURCE_TRUTH: buildMetadata.sourceTruth,
};

try {
  console.log('[BUILD LIVE] Starting Stephanos UI build');
  console.log(`[BUILD LIVE] Source truth: ${buildMetadata.sourceIdentifier}`);
  console.log(`[BUILD LIVE] Build target: ${buildMetadata.buildTarget}`);
  console.log(`[BUILD LIVE] Runtime marker: ${buildMetadata.runtimeMarker}`);
  console.log(`[BUILD LIVE] Git commit: ${buildMetadata.gitCommit}`);
  console.log(`[BUILD LIVE] Build timestamp: ${buildMetadata.buildTimestamp}`);

  cleanStephanosDist();

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const buildResult = spawnSync(npmCommand, ['--prefix', stephanosUiRoot, 'run', 'build'], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });

  if (buildResult.error) {
    throw buildResult.error;
  }

  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }

  if (!existsSync(stephanosDistIndexPath)) {
    throw new Error(`Stephanos build completed without creating ${buildMetadata.buildTarget}/index.html`);
  }

  console.log('[BUILD LIVE] Vite build completed');

  prependDistBannerIfNeeded();
  writeStephanosDistMetadata(buildMetadata);

  console.log('[BUILD LIVE] Stephanos dist written to apps/stephanos/dist');
  console.log(`[BUILD LIVE] Stephanos UI built from ${buildMetadata.sourceIdentifier} into ${buildMetadata.buildTarget}.`);
  console.log(`[BUILD LIVE] Runtime proof written to apps/stephanos/dist/stephanos-build.json from repo ${repoRoot}.`);
  console.log(`[BUILD LIVE] Build metadata: ${JSON.stringify(buildMetadata)}`);
} catch (error) {
  console.error('[BUILD LIVE] Stephanos UI build failed.');
  console.error(error);
  process.exit(1);
}
