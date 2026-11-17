import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  battleBridgeCanonicalRepositoryArgs, resolveBattleBridgeGitExecution,
  createBattleBridgeMinimalChildEnvironment,
} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { inspectStephanosNativeCapacityGamingAdmissionV1 } from '../shared/agents/stephanosNativeCapacityGamingAdmissionV1.mjs';
import {
  SPATIAL_PREPARE_MARKER, SPATIAL_PREPARE_TIMEOUT_MS,
  parseSpatialPreparationArgumentsV1, runSpatialPreparationV1, spatialPrepareBlockedV1,
} from '../shared/agents/sovereignSpatialWorkspaceV1.mjs';

export const SPATIAL_PREPARATION_SOURCE_PATHS = Object.freeze([
  'scripts/sovereign-commander-spatial-workspace.mjs',
  'shared/agents/sovereignSpatialWorkspaceV1.mjs',
  'scripts/windows/prepare-spatial-workspace.ps1',
  'scripts/windows/spatial-window-install-lock.ps1',
  'scripts/windows/install-spatial-window.ps1',
  'scripts/windows/build-spatial-window.ps1',
  'scripts/windows/start-spatial-window-host.ps1',
  'scripts/windows/install-stephanos-spatial-workspace-shortcut.ps1',
  'scripts/windows/launch-stephanos-spatial-workspace.ps1',
  'scripts/spatial-window-host.mjs',
  'shared/vr/spatialDesktopSurfaceContractV1.mjs',
  'src/windows/Stephanos.SpatialWindow/SpatialWindow.cpp',
  'apps/spatial-bridge/quest-entry.html',
]);

export function spatialPreparationProductionAdaptersV1(repoRoot, { runner = spawnSync, platform = process.platform, env = process.env } = {}) {
  const root = resolve(repoRoot);
  const git = resolveBattleBridgeGitExecution({ platform, environment: env });
  const runGit = args => runner(git.executable,
    [...git.fixedConfigArgs, ...battleBridgeCanonicalRepositoryArgs(root), ...args],
    { cwd: root, shell: false, encoding: 'utf8', windowsHide: true, timeout: 5000,
      maxBuffer: 8192, env: git.environment });
  return {
    platform,
    observeSource() {
      const branch = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD']);
      const head = runGit(['rev-parse', '--verify', 'HEAD']);
      const tracked = runGit(['ls-files', '--error-unmatch', '--', ...SPATIAL_PREPARATION_SOURCE_PATHS]);
      const clean = runGit(['diff', '--quiet', '--no-ext-diff', '--no-textconv', 'HEAD', '--', ...SPATIAL_PREPARATION_SOURCE_PATHS]);
      return { ok: [branch, head, tracked, clean].every(row => row?.status === 0 && !row.error && !row.signal),
        branch: String(branch.stdout ?? '').trim(), head: String(head.stdout ?? '').trim() };
    },
    gamingAdmission() {
      return inspectStephanosNativeCapacityGamingAdmissionV1({
        repoRoot: root, workspaceRoot: join(env.USERPROFILE || '', 'Documents', 'Stephanos-openclaw-workspace'), env,
      });
    },
    runWindowsPreparation(expectedMain) {
      return runner('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
          join(root, 'scripts/windows/prepare-spatial-workspace.ps1'), '-ExpectedHead', expectedMain],
        { cwd: root, shell: false, encoding: 'utf8', windowsHide: true,
          timeout: SPATIAL_PREPARE_TIMEOUT_MS, maxBuffer: 32768,
          env: { ...createBattleBridgeMinimalChildEnvironment(env, { git: true, platform }),
            PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules' } });
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseSpatialPreparationArgumentsV1(process.argv.slice(2));
  let result;
  if (!args.ok) result = spatialPrepareBlockedV1('', args.blocker);
  else if (process.platform !== 'win32') result = spatialPrepareBlockedV1(args.expectedMain, 'SPATIAL_PREPARE_PLATFORM_UNSUPPORTED');
  else {
    try {
      const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
      result = await runSpatialPreparationV1({ expectedMain: args.expectedMain,
        ...spatialPreparationProductionAdaptersV1(root) });
    } catch { result = spatialPrepareBlockedV1(args.expectedMain, 'SPATIAL_PREPARE_FAILED'); }
  }
  process.stdout.write(`${SPATIAL_PREPARE_MARKER}${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
