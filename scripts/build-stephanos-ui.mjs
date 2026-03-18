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
  console.log('Starting Stephanos UI build...');

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

  console.log('Vite build completed');

  prependDistBannerIfNeeded();
  writeStephanosDistMetadata(buildMetadata);

  console.log('Stephanos dist written to apps/stephanos/dist');
  console.log(`Stephanos UI built from ${buildMetadata.sourceIdentifier} into ${buildMetadata.buildTarget}.`);
  console.log(`Runtime proof written to apps/stephanos/dist/stephanos-build.json from repo ${repoRoot}.`);
  console.log(`Build metadata: ${JSON.stringify(buildMetadata)}`);
} catch (error) {
  console.error('Stephanos UI build failed.');
  console.error(error);
  process.exit(1);
}
