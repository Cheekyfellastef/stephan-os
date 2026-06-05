import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, cpSync, existsSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readLocalBuildState, probeExistingLocalServer } from './stephanos-ignition-preflight.mjs';
import { runIgnitionPlan } from './ignite-stephanos-local-lib.mjs';
import {
  OPENCLAW_WORKSPACE_DIRT_PATHS,
  buildOpenClawWorkspaceHygieneProjection,
  isOpenClawWorkspaceDirtPath,
  isSanctionedOpenClawWorkspacePath,
  resolveOpenClawWorkspaceRepairPath,
} from '../shared/agents/openClawWorkspaceHygiene.mjs';

const args = new Set(process.argv.slice(2));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function formatStep(label, command, commandArgs) {
  return `[IGNITION PREFLIGHT] ${label}: ${command} ${commandArgs.join(' ')}`;
}

function isWindowsNpmCommand(command, platform = process.platform) {
  if (platform !== 'win32') {
    return false;
  }

  return /(^|[\\/])npm(?:\.cmd)?$/i.test(command);
}

function quoteWindowsCmdArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function escapeWindowsCmdToken(value) {
  const token = String(value);
  const escapedMeta = token.replace(/([&|<>()^])/g, '^$1');

  if (/\s/.test(escapedMeta) || escapedMeta.includes('"')) {
    return quoteWindowsCmdArg(escapedMeta);
  }

  return escapedMeta;
}

export function resolveStepExecution(command, commandArgs, platform = process.platform) {
  if (isWindowsNpmCommand(command, platform)) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    const npmInvocation = command.toLowerCase().endsWith('.cmd') ? command.slice(0, -4) : command;
    const commandLine = [npmInvocation, ...commandArgs].map(escapeWindowsCmdToken).join(' ');
    return {
      command: comspec,
      commandArgs: ['/d', '/s', '/c', commandLine],
      mode: 'windows-cmd-wrapper',
    };
  }

  return {
    command,
    commandArgs,
    mode: 'direct',
  };
}

function runStep(label, command, commandArgs) {
  console.log(formatStep(label, command, commandArgs));
  const execution = resolveStepExecution(command, commandArgs);
  const result = spawnSync(execution.command, execution.commandArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    const details = [
      `executionMode=${execution.mode}`,
      `command=${execution.command}`,
      `args=${JSON.stringify(execution.commandArgs)}`,
      `status=${result.status ?? 'null'}`,
      `signal=${result.signal ?? 'null'}`,
      `error=${result.error ? result.error.message : 'null'}`,
    ].join(', ');
    throw new Error(`${label} failed (${details})`);
  }
}

function runStepCapture(label, command, commandArgs) {
  console.log(formatStep(label, command, commandArgs));
  const execution = resolveStepExecution(command, commandArgs);
  const result = spawnSync(execution.command, execution.commandArgs, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (result.error || result.status !== 0) {
    const details = [
      `executionMode=${execution.mode}`,
      `command=${execution.command}`,
      `args=${JSON.stringify(execution.commandArgs)}`,
      `status=${result.status ?? 'null'}`,
      `signal=${result.signal ?? 'null'}`,
      `error=${result.error ? result.error.message : 'null'}`,
      `stderr=${JSON.stringify(result.stderr || '')}`,
    ].join(', ');
    throw new Error(`${label} failed (${details})`);
  }

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

export function isGitWorkingTreeClean(statusOutput) {
  return evaluateGitStatusForIgnition(statusOutput).meaningfulEntries.length === 0;
}

export function shouldAutoPull(argvArgs = args) {
  return !argvArgs.has('--skip-auto-pull');
}

export function resolveIgnitionMode({
  argvArgs = process.argv.slice(2),
  envMode = process.env.STEPHANOS_IGNITION_MODE || '',
  autoPublishEnabled = shouldAutoPublishDist(),
} = {}) {
  const cliModeArg = argvArgs.find((arg) => /^--mode=/.test(arg));
  const cliMode = cliModeArg ? cliModeArg.split('=')[1] : '';
  const requestedMode = (cliMode || envMode || 'launcher-root').trim();

  if (requestedMode === 'pr-clean') return 'PR_CLEAN_ROOM';
  if (requestedMode === 'ignite') return 'NORMAL_IGNITION';
  if (requestedMode === 'housekeep') return 'HOUSEKEEP';
  if (requestedMode === 'housekeep-dry-run') return 'HOUSEKEEP_DRY_RUN';
  return autoPublishEnabled ? 'AUTO_PUBLISH' : 'NORMAL_IGNITION';
}

function parseGitCountPair(value = '') {
  const [aheadRaw = '0', behindRaw = '0'] = String(value || '').trim().split('\t');
  const aheadCount = Number.parseInt(aheadRaw, 10);
  const behindCount = Number.parseInt(behindRaw, 10);
  return {
    aheadCount: Number.isFinite(aheadCount) ? aheadCount : 0,
    behindCount: Number.isFinite(behindCount) ? behindCount : 0,
  };
}

function normalizeCaptureStdout(result) {
  return String(result?.stdout || '').trim();
}

export function classifyPublicationTruth({
  branch,
  detachedHead = false,
  hasUpstream = false,
  upstreamBranch = '',
  aheadCount = 0,
  behindCount = 0,
  workingTreeDirty = false,
} = {}) {
  const diverged = aheadCount > 0 && behindCount > 0;
  const headPublished = !detachedHead && hasUpstream && aheadCount === 0;

  if (detachedHead) {
    return {
      publicationState: 'detached-head',
      publicationSummary: 'HEAD is detached; local source truth is not mapped to a tracked publication branch.',
      operatorAction: 'Checkout a branch with upstream tracking before treating local build success as remote CI/PR truth.',
      blockedForRemoteTruth: true,
      diverged,
      headPublished: false,
    };
  }

  if (!hasUpstream) {
    return {
      publicationState: 'unknown-untracked',
      publicationSummary: 'Current branch has no upstream tracking branch.',
      operatorAction: `Set upstream for ${branch || 'current branch'} and push before assuming remote CI/PR truth includes local source fixes.`,
      blockedForRemoteTruth: true,
      diverged,
      headPublished: false,
    };
  }

  if (workingTreeDirty) {
    return {
      publicationState: 'local-uncommitted',
      publicationSummary: 'Working tree has meaningful local modifications that are not publish-backed.',
      operatorAction: 'Commit/stash/discard local source changes. Remote CI/PR truth cannot include uncommitted fixes.',
      blockedForRemoteTruth: true,
      diverged,
      headPublished,
    };
  }

  if (diverged) {
    return {
      publicationState: 'diverged',
      publicationSummary: `Local ${branch || 'branch'} and ${upstreamBranch || 'upstream'} have diverged.`,
      operatorAction: 'Rebase or merge to converge local and upstream history before treating local build success as publish-backed truth.',
      blockedForRemoteTruth: true,
      diverged,
      headPublished: false,
    };
  }

  if (aheadCount > 0) {
    return {
      publicationState: 'unpublished-local-only',
      publicationSummary: `Local ${branch || 'branch'} is ahead of ${upstreamBranch || 'upstream'} by ${aheadCount} commit(s).`,
      operatorAction: 'Local source fix exists but is not published to remote truth. Commit/push before treating local build success as CI/PR-authoritative.',
      blockedForRemoteTruth: true,
      diverged,
      headPublished: false,
    };
  }

  if (behindCount > 0) {
    return {
      publicationState: 'stale-behind',
      publicationSummary: `Local ${branch || 'branch'} is behind ${upstreamBranch || 'upstream'} by ${behindCount} commit(s).`,
      operatorAction: 'Pull/rebase to align local source truth with published upstream before relying on local diagnostics as current remote truth.',
      blockedForRemoteTruth: false,
      diverged,
      headPublished: true,
    };
  }

  return {
    publicationState: 'healthy-synced',
    publicationSummary: `Local ${branch || 'branch'} HEAD is published and synchronized with ${upstreamBranch || 'upstream'}.`,
    operatorAction: 'No publication action required.',
    blockedForRemoteTruth: false,
    diverged: false,
    headPublished: true,
  };
}

export function evaluateGitPublicationTruthWithDeps({
  captureStep = runStepCapture,
  statusAssessment = null,
} = {}) {
  const headBranch = normalizeCaptureStdout(captureStep('git-branch', 'git', ['rev-parse', '--abbrev-ref', 'HEAD']));
  const detachedHead = headBranch === 'HEAD';
  let upstreamBranch = '';
  let hasUpstream = false;
  try {
    const upstreamResult = captureStep('git-upstream', 'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    upstreamBranch = normalizeCaptureStdout(upstreamResult);
    hasUpstream = upstreamBranch.length > 0 && upstreamBranch !== '@{u}';
  } catch {
    upstreamBranch = '';
    hasUpstream = false;
  }
  const workingTreeDirty = Array.isArray(statusAssessment?.meaningfulEntries) && statusAssessment.meaningfulEntries.length > 0;

  let aheadCount = 0;
  let behindCount = 0;
  if (hasUpstream) {
    const countResult = captureStep('git-ahead-behind', 'git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    const parsedCounts = parseGitCountPair(normalizeCaptureStdout(countResult));
    aheadCount = parsedCounts.aheadCount;
    behindCount = parsedCounts.behindCount;
  }

  const classification = classifyPublicationTruth({
    branch: headBranch,
    detachedHead,
    hasUpstream,
    upstreamBranch,
    aheadCount,
    behindCount,
    workingTreeDirty,
  });

  return {
    branch: headBranch,
    detachedHead,
    hasUpstream,
    upstreamBranch,
    workingTreeDirty,
    aheadCount,
    behindCount,
    diverged: classification.diverged,
    headPublished: classification.headPublished,
    publicationState: classification.publicationState,
    publicationSummary: classification.publicationSummary,
    operatorAction: classification.operatorAction,
    blockedForRemoteTruth: classification.blockedForRemoteTruth,
  };
}

function formatPublicationParityLine(publicationTruth) {
  const upstreamLabel = publicationTruth.hasUpstream ? publicationTruth.upstreamBranch : 'none';
  const branchLabel = publicationTruth.detachedHead ? 'detached-HEAD' : publicationTruth.branch;
  return `branch=${branchLabel}, upstream=${upstreamLabel}, ahead=${publicationTruth.aheadCount}, behind=${publicationTruth.behindCount}, headPublished=${publicationTruth.headPublished ? 'yes' : 'no'}, state=${publicationTruth.publicationState}`;
}

function reportPublicationParity(publicationTruth, { label = 'publication parity', forceWarning = false } = {}) {
  const prefix = forceWarning || publicationTruth.blockedForRemoteTruth
    ? '[IGNITION] publication warning'
    : '[IGNITION] publication status';
  console.log(`[IGNITION] ${label}: ${formatPublicationParityLine(publicationTruth)}`);
  console.log(`${prefix}: ${publicationTruth.publicationSummary}`);
  console.log(`${prefix}: ${publicationTruth.operatorAction}`);
}

function shouldRequirePublishedHead(argvArgs = args) {
  return argvArgs.has('--require-published-head');
}

const APPROVED_GENERATED_DIST_PREFIX = 'apps/stephanos/dist/';
const RUNTIME_MEMORY_PATH = 'stephanos-server/data/memory/durable-memory.json';
const ROOT_TRANSIENT_DATA_PREFIX = 'data/';
const ROOT_RUNTIME_ALLOWLIST_PREFIXES = [
  'data/activity/',
  'data/knowledge-graph/',
  'data/proposals/',
  'data/roadmap/',
  'data/simulations/',
];
const DEPENDENCY_DIR_PREFIXES = ['node_modules/', 'stephanos-server/node_modules/', 'stephanos-ui/node_modules/'];
const SECRETS_PATTERN = /(^|\/)(\.env($|\.)|.*(secret|token|credential|passwd|password|private[-_]?key).*)/i;
const ALLOWLIST_UNTRACKED_AUTOCLEAN_PREFIXES = [APPROVED_GENERATED_DIST_PREFIX];
const KNOWN_SOURCE_PREFIXES = ['stephanos-ui/src/', 'scripts/', 'tests/', 'shared/', 'docs/'];
const KNOWN_SOURCE_FILES = new Set(['package.json', 'package-lock.json']);

function normalizeGitPath(rawPath) {
  const trimmed = String(rawPath || '').trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isApprovedLocalDirtPath(path) {
  if (APPROVED_LOCAL_FILE_PATHS.has(path)) {
    return true;
  }

  return APPROVED_LOCAL_DIR_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isApprovedTrackedGeneratedPath(path) {
  return APPROVED_TRACKED_GENERATED_DIR_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isRuntimeStatePath(path) {
  return path.startsWith(RUNTIME_STATE_DIR_PREFIX);
}


function isApprovedGeneratedDistPath(path) {
  return path.startsWith(APPROVED_GENERATED_DIST_PREFIX);
}

function isDependencyDirtPath(path) {
  return DEPENDENCY_DIR_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isTransientRootDataPath(path) {
  return path === 'data' || path.startsWith(ROOT_TRANSIENT_DATA_PREFIX);
}

function isAllowlistedRootRuntimePath(path) {
  return ROOT_RUNTIME_ALLOWLIST_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function classifyStatusEntry(entry) {
  if (entry.paths.some((path) => SECRETS_PATTERN.test(path))) return 'forbidden-or-unknown';
  if (entry.paths.every((path) => isSanctionedOpenClawWorkspacePath(path))) return 'openclaw-runtime-workspace';
  if (entry.paths.some((path) => KNOWN_SOURCE_FILES.has(path) || KNOWN_SOURCE_PREFIXES.some((prefix) => path.startsWith(prefix)))) return 'meaningful-source-dirt';
  if (entry.paths.every((path) => path === RUNTIME_MEMORY_PATH)) return 'runtime-state';
  if (entry.paths.every((path) => isTransientRootDataPath(path))) return 'transient-root-data';
  if (entry.paths.every((path) => isDependencyDirtPath(path))) return 'dependency-dirt';
  if (entry.paths.every((path) => isApprovedGeneratedDistPath(path))) return 'approved-generated-dist';
  if (entry.status.includes('?') && entry.paths.some((path) => path.includes('.'))) {
    const ext = entry.paths[0].split('.').pop()?.toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'wasm', 'zip', '7z', 'tar', 'gz', 'pdf'].includes(ext)) {
      return 'forbidden-or-unknown';
    }
  }
  const tracked = !entry.status.includes('?');
  return tracked ? 'meaningful-source-dirt' : 'forbidden-or-unknown';
}

export function classifyIgnitionDirtPath(path) {
  const normalized = normalizeGitPath(path);
  if (SECRETS_PATTERN.test(normalized)) return 'HARD_BLOCK';
  if (normalized === RUNTIME_MEMORY_PATH || isAllowlistedRootRuntimePath(normalized)) return 'RUNTIME_CHECKPOINT_CLEAN';
  if (isSanctionedOpenClawWorkspacePath(normalized)) return 'OPENCLAW_RUNTIME_WORKSPACE_ALLOWED';
  if (isDependencyDirtPath(normalized)) return 'DEPENDENCY_WARNING';
  if (isApprovedGeneratedDistPath(normalized)) return 'AUTO_CLEAN_GENERATED';
  if (KNOWN_SOURCE_FILES.has(normalized) || KNOWN_SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return 'SOURCE_DIRT_APPROVAL_REQUIRED';
  const extension = normalized.includes('.') ? normalized.split('.').pop()?.toLowerCase() : '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'wasm', 'zip', '7z', 'tar', 'gz', 'pdf', 'bin', 'exe', 'dll'].includes(extension)) return 'HARD_BLOCK';
  return 'HARD_BLOCK';
}

function parsePorcelainStatusLine(line) {
  const status = line.slice(0, 2);
  const pathSegment = line.slice(3).trim();
  const rawPaths = pathSegment.includes(' -> ') ? pathSegment.split(' -> ') : [pathSegment];
  const paths = rawPaths.map(normalizeGitPath).filter(Boolean);
  return { status, paths, rawLine: line };
}

export function evaluateGitStatusForIgnition(statusOutput) {
  const lines = String(statusOutput || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  const entries = lines.map(parsePorcelainStatusLine).map((entry) => ({ ...entry, category: classifyStatusEntry(entry) }));
  const approvedEntries = entries.filter((entry) => entry.category === 'approved-generated-dist' || entry.category === 'dependency-dirt');
  const runtimeStateEntries = entries.filter((entry) => entry.category === 'runtime-state');
  const transientRootDataEntries = entries.filter((entry) => entry.category === 'transient-root-data');
  const dependencyEntries = entries.filter((entry) => entry.category === 'dependency-dirt');
  const forbiddenOrUnknownEntries = entries.filter((entry) => entry.category === 'forbidden-or-unknown');
  const meaningfulEntries = entries.filter((entry) => entry.category === 'meaningful-source-dirt' || entry.category === 'forbidden-or-unknown');

  return { entries, approvedEntries, runtimeStateEntries, transientRootDataEntries, dependencyEntries, forbiddenOrUnknownEntries, meaningfulEntries };
}


function isRootOpenClawWorkspaceDirtPath(path = '') {
  const normalized = normalizeGitPath(path);
  return !normalized.includes('/') && isOpenClawWorkspaceDirtPath(normalized);
}

function collectMovableRootOpenClawWorkspaceDirt(assessment) {
  const paths = new Set();
  for (const entry of assessment.entries || []) {
    if (!entry.status.includes('?')) continue;
    for (const path of entry.paths) {
      if (isRootOpenClawWorkspaceDirtPath(path)) paths.add(normalizeGitPath(path));
    }
  }
  return OPENCLAW_WORKSPACE_DIRT_PATHS.filter((path) => paths.has(path));
}

function uniqueDestinationPath(destinationRoot, path, pathExists) {
  const basePath = resolve(destinationRoot, basename(path));
  if (!pathExists(basePath)) return basePath;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(destinationRoot, `root-migration-${stamp}`, basename(path));
}

export function moveRootOpenClawWorkspaceDirt({
  paths = [],
  destinationRoot = resolveOpenClawWorkspaceRepairPath(),
  pathExists = existsSync,
  makeDir = mkdirSync,
  movePath = renameSync,
} = {}) {
  const moved = [];
  const skipped = [];
  const normalizedPaths = [...new Set(paths.map((path) => normalizeGitPath(path)).filter(isRootOpenClawWorkspaceDirtPath))];
  if (normalizedPaths.length === 0) return { destinationRoot, moved, skipped };
  makeDir(destinationRoot, { recursive: true });
  for (const path of normalizedPaths) {
    if (!pathExists(path)) {
      skipped.push({ path, reason: 'missing-at-repair-time' });
      continue;
    }
    const destinationPath = uniqueDestinationPath(destinationRoot, path, pathExists);
    makeDir(resolve(destinationPath, '..'), { recursive: true });
    movePath(path, destinationPath);
    moved.push({ path, destinationPath });
  }
  return { destinationRoot, moved, skipped };
}

function collectAllowlistedUntrackedPaths(statusAssessment) {
  return statusAssessment.entries
    .filter((entry) => entry.status.includes('?'))
    .flatMap((entry) => entry.paths)
    .filter((path) => ALLOWLIST_UNTRACKED_AUTOCLEAN_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .sort();
}

function runCleanlinessGovernor({ statusAssessment, runStepFn = runStep, mode = process.env.STEPHANOS_IGNITION_MODE || 'launcher-root', allowDirtySource = String(process.env.STEPHANOS_IGNITION_ALLOW_DIRTY_SOURCE || '') === '1' } = {}) {
  const autoCleanedFiles = [];
  const blockedFiles = allowDirtySource ? statusAssessment.forbiddenOrUnknownEntries.flatMap((entry) => entry.paths) : statusAssessment.meaningfulEntries.flatMap((entry) => entry.paths);
  const openClawWorkspaceHygiene = buildOpenClawWorkspaceHygieneProjection({ blockedFiles, blocksIgnition: blockedFiles.length > 0 });
  const sourceDirtFiles = statusAssessment.meaningfulEntries
    .filter((entry) => entry.category === 'meaningful-source-dirt')
    .flatMap((entry) => entry.paths);
  const dependencyWarnings = statusAssessment.dependencyEntries.flatMap((entry) => entry.paths);
  const untrackedDist = collectAllowlistedUntrackedPaths(statusAssessment);
  if (untrackedDist.length > 0 && mode !== 'auto-publish') {
    runStepFn('git-clean-preview-dist-untracked', 'git', ['clean', '-nd', '--', APPROVED_GENERATED_DIST_PREFIX]);
    runStepFn('git-clean-dist-untracked', 'git', ['clean', '-fd', '--', APPROVED_GENERATED_DIST_PREFIX]);
    autoCleanedFiles.push(...untrackedDist);
  }
  return {
    cleanlinessVerdict: blockedFiles.length > 0 ? 'blocked' : (sourceDirtFiles.length > 0 ? 'held-source-dirt' : 'clean-or-autocleaned'),
    autoCleanedFiles,
    checkpointedRuntimeFiles: collectRuntimeStatePaths(statusAssessment),
    blockedFiles,
    dependencyWarnings,
    nextOperatorAction: blockedFiles.length > 0 ? 'Remove/resolve hard-block dirt (secrets/unknown binaries/unclassified risky files). Ignition is blocked.' : (sourceDirtFiles.length > 0 ? 'Source dirt detected. Commit/stash/discard source dirt or rerun with STEPHANOS_IGNITION_ALLOW_DIRTY_SOURCE=1.' : 'Continue ignition.'),
    ignitionStatusModel: {
      ignitionStatus: blockedFiles.length > 0 ? 'BLOCKED' : (sourceDirtFiles.length > 0 ? 'HELD' : 'READY'),
      ignitionPhase: blockedFiles.length > 0 ? 'blocked' : (sourceDirtFiles.length > 0 ? 'held-source-dirt' : 'ready'),
      ignitionSteps: ['Inspect repo', 'Clean generated dirt', 'Checkpoint runtime memory', 'Validate PR cleanliness', 'Check backend route', 'Check provider route', 'Check Command Deck protected canon', blockedFiles.length > 0 ? 'Blocked' : (sourceDirtFiles.length > 0 ? 'Held' : 'Ready')],
      ignitionCleanlinessVerdict: blockedFiles.length > 0 ? 'blocked' : (sourceDirtFiles.length > 0 ? 'held' : 'ready'),
      ignitionBlockedReason: blockedFiles.length > 0 ? 'Hard-block dirt detected' : (sourceDirtFiles.length > 0 ? 'Source dirt detected' : ''),
      ignitionWarnings: dependencyWarnings,
      ignitionAutoCleaned: autoCleanedFiles.length,
      ignitionRuntimeCleaned: 0,
      ignitionSourceDirtCount: sourceDirtFiles.length,
      ignitionDependencyWarningCount: dependencyWarnings.length,
      ignitionHardBlockCount: blockedFiles.length,
      openClawWorkspaceHygieneStatus: openClawWorkspaceHygiene.workspaceHygieneStatus,
      openClawWorkspaceDirtDetected: openClawWorkspaceHygiene.workspaceDirtDetected,
      openClawWorkspaceDirtPaths: openClawWorkspaceHygiene.workspaceDirtPaths,
      openClawWorkspaceDirtCount: openClawWorkspaceHygiene.workspaceDirtCount,
      openClawWorkspaceBlocksIgnition: openClawWorkspaceHygiene.workspaceBlocksIgnition,
      openClawWorkspaceRecommendedCleanup: openClawWorkspaceHygiene.workspaceRecommendedCleanup,
      openClawWorkspaceMigrationCommand: openClawWorkspaceHygiene.workspaceRecommendedMigration,
      openClawWorkspaceSafeRuntimeDirectory: openClawWorkspaceHygiene.workspaceSafeRuntimeDirectory,
      openClawWorkspaceSanctionedAllowedPath: openClawWorkspaceHygiene.workspaceSafeRuntimeDirectory,
      openClawWorkspaceRootDirtDetected: openClawWorkspaceHygiene.workspaceDirtDetected,
      openClawWorkspaceRootFilesStillBlockIgnition: openClawWorkspaceHygiene.workspaceBlocksIgnition,
      openClawWorkspaceMutationAuthority: openClawWorkspaceHygiene.workspaceMutationAuthority,
      openClawWorkspaceNextOperatorAction: openClawWorkspaceHygiene.workspaceNextOperatorAction,
      ignitionNextOperatorAction: blockedFiles.length > 0 ? 'Remove hard-block files from working tree and PR range.' : (sourceDirtFiles.length > 0 ? 'Commit/stash/discard source dirt or set STEPHANOS_IGNITION_ALLOW_DIRTY_SOURCE=1.' : 'Continue ignition.'),
      ignitionReadyToEnterCommandDeck: blockedFiles.length === 0 && sourceDirtFiles.length === 0,
    },
  };
}

function isTrackedStatus(status) {
  return !status.includes('?');
}

export function collectApprovedTrackedGeneratedRestorePaths(statusAssessment) {
  const restorePaths = new Set();
  for (const entry of statusAssessment.approvedEntries) {
    if (!isTrackedStatus(entry.status)) {
      continue;
    }

    const approvedGeneratedOnly = entry.paths.every((path) => isApprovedGeneratedDistPath(path));
    if (!approvedGeneratedOnly) {
      continue;
    }

    for (const path of entry.paths) {
      restorePaths.add(path);
    }
  }

  return Array.from(restorePaths).sort();
}

export function collectRuntimeStatePaths(statusAssessment) {
  const runtimePaths = new Set();
  for (const entry of statusAssessment.runtimeStateEntries || []) {
    for (const path of entry.paths) {
      runtimePaths.add(path);
    }
  }
  return Array.from(runtimePaths).sort();
}

export function createRuntimeStateCheckpoint(runtimePaths, options = {}) {
  const {
    checkpointRoot = '.stephanos/local-state-checkpoints',
    now = () => new Date(),
    pathExists = (filePath) => existsSync(filePath),
    makeDir = (dirPath) => mkdirSync(dirPath, { recursive: true }),
    copyFile = (fromPath, toPath) => copyFileSync(fromPath, toPath),
    writeFile = (filePath, data) => writeFileSync(filePath, data, 'utf8'),
  } = options;

  if (!Array.isArray(runtimePaths) || runtimePaths.length === 0) {
    return null;
  }

  const isoStamp = now().toISOString().replace(/[:.]/g, '-');
  const checkpointDir = `${checkpointRoot}/${isoStamp}`;
  makeDir(checkpointDir);

  const manifest = {
    createdAt: now().toISOString(),
    checkpointDir,
    paths: [],
  };

  for (const runtimePath of runtimePaths) {
    const sourceExists = pathExists(runtimePath);
    const checkpointPath = `${checkpointDir}/${runtimePath}`;
    if (sourceExists) {
      makeDir(checkpointPath.slice(0, checkpointPath.lastIndexOf('/')));
      copyFile(runtimePath, checkpointPath);
    }
    manifest.paths.push({
      path: runtimePath,
      exists: sourceExists,
    });
  }

  writeFile(`${checkpointDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  const latestPointerContent = `${checkpointDir}\n`;
  writeFile(`${checkpointRoot}/latest.txt`, latestPointerContent);

  return {
    checkpointDir,
    manifest,
    checkpointRoot,
    latestPointer: `${checkpointRoot}/latest.txt`,
  };
}

export function restoreRuntimeStateCheckpoint(checkpointState, options = {}) {
  if (!checkpointState?.manifest?.paths?.length) {
    return;
  }

  const {
    pathExists = (filePath) => existsSync(filePath),
    makeDir = (dirPath) => mkdirSync(dirPath, { recursive: true }),
    copyFile = (fromPath, toPath) => copyFileSync(fromPath, toPath),
    removePath = (targetPath) => rmSync(targetPath, { force: true }),
  } = options;

  for (const entry of checkpointState.manifest.paths) {
    const sourcePath = `${checkpointState.checkpointDir}/${entry.path}`;
    if (entry.exists) {
      if (!pathExists(sourcePath)) {
        throw new Error(`runtime checkpoint missing file: ${entry.path}`);
      }
      makeDir(entry.path.slice(0, entry.path.lastIndexOf('/')));
      copyFile(sourcePath, entry.path);
      continue;
    }

    if (pathExists(entry.path)) {
      removePath(entry.path);
    }
  }
}


export function checkpointAndRemoveTransientRootData(options = {}) {
  const {
    timestamp = () => new Date().toISOString().replace(/[:.]/g, '-'),
    makeDir = (dirPath) => mkdirSync(dirPath, { recursive: true }),
    copyPath = (fromPath, toPath) => cpSync(fromPath, toPath, { recursive: true, force: true }),
    removePath = (targetPath) => rmSync(targetPath, { recursive: true, force: true }),
    log = (message) => console.log(message),
  } = options;

  const stamp = timestamp();
  const checkpointPath = `.stephanos/local-state-checkpoints/${stamp}/root-data/data`;
  log('[IGNITION] transient root data detected: data/');
  makeDir(checkpointPath.slice(0, checkpointPath.lastIndexOf('/')));
  copyPath('data', checkpointPath);
  log(`[IGNITION] transient root data checkpointed: ${checkpointPath}`);
  removePath('data');
  log('[IGNITION] transient root data removed');
  return checkpointPath;
}

export function runGitPullPreflightWithDeps({
  captureStep = runStepCapture,
  runStepFn = runStep,
  createCheckpoint = createRuntimeStateCheckpoint,
  restoreCheckpoint = restoreRuntimeStateCheckpoint,
  checkpointRootData = checkpointAndRemoveTransientRootData,
  argvArgs = args,
} = {}) {
  console.log('[IGNITION] git status check starting');
  const statusResult = captureStep('git-status', 'git', ['status', '--porcelain']);
  const statusAssessment = evaluateGitStatusForIgnition(statusResult.stdout);
  const cleanlinessReport = runCleanlinessGovernor({ statusAssessment, runStepFn });
  console.log(`[IGNITION] cleanlinessVerdict=${cleanlinessReport.cleanlinessVerdict}`);
  console.log(`[IGNITION] autoCleanedFiles=${cleanlinessReport.autoCleanedFiles.join(',') || 'none'}`);
  console.log(`[IGNITION] checkpointedRuntimeFiles=${cleanlinessReport.checkpointedRuntimeFiles.join(',') || 'none'}`);
  console.log(`[IGNITION] blockedFiles=${cleanlinessReport.blockedFiles.join(',') || 'none'}`);
  console.log(`[IGNITION] dependencyWarnings=${cleanlinessReport.dependencyWarnings.join(',') || 'none'}`);
  if (cleanlinessReport.ignitionStatusModel.openClawWorkspaceRootDirtDetected === 'yes') {
    console.log('[IGNITION] root OpenClaw workspace dirt detected');
    console.log('[IGNITION] root OpenClaw files still block ignition');
    console.log(`[IGNITION] sanctioned allowed path: ${cleanlinessReport.ignitionStatusModel.openClawWorkspaceSanctionedAllowedPath}`);
    console.log(`[IGNITION] copyable migration command: ${cleanlinessReport.ignitionStatusModel.openClawWorkspaceMigrationCommand}`);
  }
  console.log(`[IGNITION] nextOperatorAction=${cleanlinessReport.nextOperatorAction}`);
  console.log(`[IGNITION] ignitionStatus=${cleanlinessReport.ignitionStatusModel.ignitionStatus}`);
  console.log('[IGNITION] housekeeping enabled');
  const approvedTrackedGeneratedRestorePaths = collectApprovedTrackedGeneratedRestorePaths(statusAssessment);
  const runtimeStatePaths = collectRuntimeStatePaths(statusAssessment);
  let runtimeCheckpointState = null;

  if (statusAssessment.transientRootDataEntries.length > 0) {
    checkpointRootData();
    console.log('[IGNITION] git status rechecked after housekeeping');
  }

  if (statusAssessment.approvedEntries.length > 0) {
    console.log(`[IGNITION] approved local dirt ignored (${statusAssessment.approvedEntries.length} entries)`);
    for (const entry of statusAssessment.approvedEntries) {
      console.log(`[IGNITION] approved local dirt: ${entry.status} ${entry.paths.join(' -> ')}`);
    }
  }

  if (statusAssessment.runtimeStateEntries.length > 0) {
    console.log(`[IGNITION] runtime state dirt detected (${statusAssessment.runtimeStateEntries.length} entries)`);
    for (const entry of statusAssessment.runtimeStateEntries) {
      console.log(`[IGNITION] runtime state dirt: ${entry.status} ${entry.paths.join(' -> ')}`);
    }

    try {
      runtimeCheckpointState = createCheckpoint(runtimeStatePaths);
    }
    catch (error) {
      console.error('[IGNITION] checkpoint failure blocks launch');
      throw new Error(`blocked for safety: runtime state checkpoint failed (${error.message}).`);
    }

    if (runtimeCheckpointState?.checkpointDir) {
      console.log('[IGNITION] runtime memory checkpointed');
    }
    else {
      console.log('[IGNITION] runtime memory checkpointed');
    }
  }

  if (statusAssessment.meaningfulEntries.length > 0 && String(process.env.STEPHANOS_IGNITION_ALLOW_DIRTY_SOURCE || '') !== '1') {
    console.error('[IGNITION] meaningful local dirt detected');
    for (const entry of statusAssessment.meaningfulEntries) {
      console.error(`[IGNITION] meaningful local dirt: ${entry.status} ${entry.paths.join(' -> ')}`);
    }
    const publicationTruth = evaluateGitPublicationTruthWithDeps({ captureStep, statusAssessment });
    reportPublicationParity(publicationTruth, { label: 'publication parity (dirty working tree)', forceWarning: true });
    console.error('[IGNITION] git pull blocked');
    throw new Error('blocked for safety: local working tree is dirty. Commit/stash/discard local changes before ignition can pull latest remote changes.');
  }

  if (approvedTrackedGeneratedRestorePaths.length > 0) {
    console.log(`[IGNITION] approved tracked generated dirt detected (${approvedTrackedGeneratedRestorePaths.length} paths)`);
    console.log(`[IGNITION] restoring approved tracked generated dirt: ${approvedTrackedGeneratedRestorePaths.join(', ')}`);
    runStepFn('git-restore-approved-tracked-generated-dirt', 'git', ['restore', '--worktree', '--staged', '--', ...approvedTrackedGeneratedRestorePaths]);
    console.log('[IGNITION] approved tracked generated dirt restored');
  }

  const runtimeTrackedRestorePaths = runtimeStatePaths.filter((path) => {
    const matchingEntry = statusAssessment.runtimeStateEntries.find((entry) => entry.paths.includes(path));
    return matchingEntry ? isTrackedStatus(matchingEntry.status) : false;
  });

  if (runtimeTrackedRestorePaths.length > 0) {
    console.log('[IGNITION] runtime memory restored from source truth');
    runStepFn('git-restore-runtime-state-before-pull', 'git', ['restore', '--worktree', '--staged', '--', ...runtimeTrackedRestorePaths]);
  }

  console.log('[IGNITION] git status clean');
  console.log('[IGNITION] git fetch starting');
  runStepFn('git-fetch', 'git', ['fetch', '--prune', '--tags']);
  console.log('[IGNITION] git fetch passed');

  const prePullPublicationTruth = evaluateGitPublicationTruthWithDeps({ captureStep, statusAssessment });
  reportPublicationParity(prePullPublicationTruth, { label: 'publication parity (pre-pull)' });

  if (shouldRequirePublishedHead(argvArgs) && !prePullPublicationTruth.headPublished) {
    console.error('[IGNITION] publication parity blocked by --require-published-head');
    throw new Error(`blocked for safety: remote publication parity required but local HEAD is not publish-backed (${prePullPublicationTruth.publicationState}). ${prePullPublicationTruth.operatorAction}`);
  }

  if (prePullPublicationTruth.detachedHead) {
    console.error('[IGNITION] git pull blocked');
    throw new Error('blocked for safety: detached HEAD cannot be reconciled with tracked remote publication truth. Checkout a tracking branch before ignition pull.');
  }

  if (!prePullPublicationTruth.hasUpstream) {
    console.error('[IGNITION] git pull blocked');
    throw new Error('blocked for safety: current branch has no upstream tracking branch. Configure upstream before ignition pull.');
  }

  console.log('[IGNITION] git pull --ff-only starting');
  try {
    runStepFn('git-pull-ff-only', 'git', ['pull', '--ff-only']);
  }
  catch (error) {
    console.error('[IGNITION] git pull blocked');
    throw new Error(`blocked for safety: remote pull requires manual merge/rebase or has another fast-forward-only conflict (${error.message}).`);
  }

  if (runtimeCheckpointState) {
    try {
      restoreCheckpoint(runtimeCheckpointState);
    }
    catch (error) {
      console.error('[IGNITION] checkpoint failure blocks launch');
      throw new Error(`blocked for safety: runtime state restore failed (${error.message}).`);
    }
    console.log('[IGNITION] launch may continue');
  }

  console.log('[IGNITION] git pull passed');
  const postPullPublicationTruth = evaluateGitPublicationTruthWithDeps({ captureStep, statusAssessment });
  reportPublicationParity(postPullPublicationTruth, { label: 'publication parity (post-pull)' });
  return postPullPublicationTruth;
}

function runGitPullPreflight() {
  return runGitPullPreflightWithDeps();
}

export function runIgnitionHousekeep({ dryRun = false, compact = false, debug = false, captureStepFn = runStepCapture, runStepFn = runStep } = {}) {
  const capture = captureStepFn('git-status', 'git', ['status', '--porcelain']);
  const assessment = evaluateGitStatusForIgnition(capture.stdout);
  const runtimeDataListing = captureStepFn('git-untracked-data', 'git', ['ls-files', '--others', '--exclude-standard', '--', 'data']);
  const runtimeDataPaths = normalizeCaptureStdout(runtimeDataListing).split('\n').map((line) => normalizeGitPath(line)).filter((line) => line.startsWith('data/'));
  const plan = assessment.entries.map((entry) => ({
    status: entry.status,
    paths: entry.paths,
    category: classifyIgnitionDirtPath(entry.paths[0]),
  }));
  console.log(`[HOUSEKEEP] mode=${dryRun ? 'dry-run' : 'clean'}`);
  if (debug || !compact) {
    for (const row of plan) {
      console.log(`[HOUSEKEEP] ${row.category} ${row.status} ${row.paths.join(' -> ')}`);
    }
  }

  const entryPaths = assessment.entries.flatMap((entry) => entry.paths);
  const autoCleanTargets = entryPaths.filter((path) => isApprovedGeneratedDistPath(path));
  const runtimeTargets = [...entryPaths.filter((path) => path === RUNTIME_MEMORY_PATH || isAllowlistedRootRuntimePath(path)), ...runtimeDataPaths.filter((path) => isAllowlistedRootRuntimePath(path))];
  const sourceTargets = entryPaths.filter((path) => KNOWN_SOURCE_FILES.has(path) || KNOWN_SOURCE_PREFIXES.some((prefix) => path.startsWith(prefix)));
  const dependencyTargets = entryPaths.filter((path) => isDependencyDirtPath(path));
  let hardBlockTargets = [...entryPaths, ...runtimeDataPaths]
    .filter((path) => classifyIgnitionDirtPath(path) === 'HARD_BLOCK')
    .filter((path) => path !== 'data/' || runtimeDataPaths.some((candidate) => !isAllowlistedRootRuntimePath(candidate)));
  const movableRootOpenClawDirt = collectMovableRootOpenClawWorkspaceDirt(assessment);
  let openClawMoveResult = { destinationRoot: resolveOpenClawWorkspaceRepairPath(), moved: [], skipped: [] };
  if (!dryRun && movableRootOpenClawDirt.length > 0) {
    openClawMoveResult = moveRootOpenClawWorkspaceDirt({ paths: movableRootOpenClawDirt });
    const movedRootPaths = new Set(openClawMoveResult.moved.map((entry) => entry.path));
    hardBlockTargets = hardBlockTargets.filter((path) => !movedRootPaths.has(path));
  }

  const trackedAuto = collectApprovedTrackedGeneratedRestorePaths(assessment);
  const trackedRuntime = assessment.runtimeStateEntries
    .filter((entry) => !entry.status.includes('?'))
    .flatMap((entry) => entry.paths);
  const untrackedRuntime = [...assessment.entries
    .filter((entry) => entry.status.includes('?'))
    .flatMap((entry) => entry.paths)
    .filter((path) => path === RUNTIME_MEMORY_PATH || isAllowlistedRootRuntimePath(path)), ...runtimeDataPaths.filter((path) => isAllowlistedRootRuntimePath(path))];

  let runtimeCleaned = 0;
  if (!dryRun) {
    if (trackedAuto.length > 0) {
      runStepFn('git-restore-auto-generated', 'git', ['restore', '--worktree', '--staged', '--', ...trackedAuto]);
    }
    if (trackedRuntime.length > 0) {
      runStepFn('git-restore-runtime-tracked', 'git', ['restore', '--worktree', '--staged', '--', ...trackedRuntime]);
      runtimeCleaned += trackedRuntime.length;
    }
    if (untrackedRuntime.length > 0) {
      runStepFn('git-clean-runtime-untracked', 'git', ['clean', '-fd', '--', ...untrackedRuntime]);
      runtimeCleaned += untrackedRuntime.length;
    }
    runStepFn('git-clean-dist-untracked', 'git', ['clean', '-fd', '--', APPROVED_GENERATED_DIST_PREFIX]);
  }

  const uniqueRuntimeTargets = [...new Set(runtimeTargets)];
  const uniqueHardBlockTargets = [...new Set(hardBlockTargets)];
  const blocked = sourceTargets.length > 0 || uniqueHardBlockTargets.length > 0;
  const openClawWorkspaceHygiene = buildOpenClawWorkspaceHygieneProjection({ hardBlockPaths: uniqueHardBlockTargets, sourcePaths: sourceTargets, blocksIgnition: blocked });
  const status = {
    ignitionStatus: blocked ? 'BLOCKED' : 'READY',
    ignitionPhase: dryRun ? 'housekeep-dry-run' : 'housekeep',
    ignitionCleanlinessVerdict: blocked ? 'blocked' : 'ready',
    ignitionAutoCleaned: dryRun ? 0 : autoCleanTargets.length,
    ignitionRuntimeCleaned: dryRun ? 0 : runtimeCleaned,
    ignitionOpenClawWorkspaceMoved: dryRun ? 0 : openClawMoveResult.moved.length,
    ignitionOpenClawWorkspaceMoveDestination: openClawMoveResult.destinationRoot,
    ignitionOpenClawWorkspaceMovedPaths: dryRun ? [] : openClawMoveResult.moved.map((entry) => entry.path),
    ignitionRuntimeCleanedPaths: dryRun ? [] : uniqueRuntimeTargets.slice(0, 10),
    ignitionAutoCleanedPaths: dryRun ? [] : [...new Set(autoCleanTargets)].slice(0, 10),
    ignitionSourceDirtCount: sourceTargets.length,
    ignitionDependencyWarningCount: dependencyTargets.length,
    ignitionHardBlockCount: uniqueHardBlockTargets.length,
    ignitionHardBlockPaths: uniqueHardBlockTargets.slice(0, 10),
    openClawWorkspaceHygieneStatus: openClawWorkspaceHygiene.workspaceHygieneStatus,
    openClawWorkspaceDirtDetected: openClawWorkspaceHygiene.workspaceDirtDetected,
    openClawWorkspaceDirtPaths: openClawWorkspaceHygiene.workspaceDirtPaths,
    openClawWorkspaceDirtCount: openClawWorkspaceHygiene.workspaceDirtCount,
    openClawWorkspaceBlocksIgnition: openClawWorkspaceHygiene.workspaceBlocksIgnition,
    openClawWorkspaceRecommendedCleanup: openClawWorkspaceHygiene.workspaceRecommendedCleanup,
    openClawWorkspaceMigrationCommand: openClawWorkspaceHygiene.workspaceRecommendedMigration,
    openClawWorkspaceSafeRuntimeDirectory: openClawWorkspaceHygiene.workspaceSafeRuntimeDirectory,
    openClawWorkspaceSanctionedAllowedPath: openClawWorkspaceHygiene.workspaceSafeRuntimeDirectory,
    openClawWorkspaceRootDirtDetected: openClawWorkspaceHygiene.workspaceDirtDetected,
    openClawWorkspaceRootFilesStillBlockIgnition: openClawWorkspaceHygiene.workspaceBlocksIgnition,
    openClawWorkspaceAutoMovedPaths: dryRun ? [] : openClawMoveResult.moved.map((entry) => entry.path),
    openClawWorkspaceAutoMoveDestination: openClawMoveResult.destinationRoot,
    openClawWorkspaceMutationAuthority: openClawWorkspaceHygiene.workspaceMutationAuthority,
    openClawWorkspaceNextOperatorAction: openClawWorkspaceHygiene.workspaceNextOperatorAction,
    ignitionBlockedReason: uniqueHardBlockTargets.length > 0 ? 'Hard-block dirt detected' : (sourceTargets.length > 0 ? 'Source dirt detected' : ''),
    ignitionNextOperatorAction: blocked ? 'Resolve source dirt/hard-block files before ignition.' : 'Housekeeping complete.',
    ignitionReadyToEnterCommandDeck: !blocked,
  };
  console.log(`[HOUSEKEEP] status=${JSON.stringify(status)}`);
  if (openClawMoveResult.moved.length > 0) {
    console.log(`[HOUSEKEEP] root OpenClaw files safely moved: ${openClawMoveResult.moved.map((entry) => entry.path).join(',')}`);
    console.log(`[HOUSEKEEP] OpenClaw workspace destination: ${openClawMoveResult.destinationRoot}`);
    console.log('[HOUSEKEEP] no OpenClaw memory was deleted');
  }
  if (openClawWorkspaceHygiene.workspaceDirtDetected === 'yes') {
    console.log('[HOUSEKEEP] root OpenClaw workspace dirt detected');
    if (openClawMoveResult.moved.length > 0) {
      console.log(`[HOUSEKEEP] root OpenClaw files safely moved: ${openClawMoveResult.moved.map((entry) => entry.path).join(',')}`);
      console.log(`[HOUSEKEEP] OpenClaw workspace destination: ${openClawMoveResult.destinationRoot}`);
      console.log('[HOUSEKEEP] no OpenClaw memory was deleted');
    } else {
      console.log('[HOUSEKEEP] root OpenClaw files still block ignition');
    }
    console.log(`[HOUSEKEEP] sanctioned allowed path: ${openClawWorkspaceHygiene.workspaceSafeRuntimeDirectory}`);
    console.log(`[HOUSEKEEP] copyable migration command: ${openClawWorkspaceHygiene.workspaceRecommendedMigration}`);
  }
  if (blocked) {
    const hardBlockLine = uniqueHardBlockTargets.slice(0, 10).join(',') || 'none';
    console.log(`[HOUSEKEEP] hardBlockPaths=${hardBlockLine}`);
  }
  if (compact) {
    console.log(`[IGNITION] phase=${status.ignitionPhase}`);
    console.log(`[IGNITION] housekeeperVerdict=${status.ignitionCleanlinessVerdict}`);
    console.log(`[IGNITION] filesAutoCleaned=${status.ignitionAutoCleaned}`);
    console.log(`[IGNITION] runtimeCleaned=${status.ignitionRuntimeCleaned}`);
    console.log(`[IGNITION] sourceDirtCount=${status.ignitionSourceDirtCount}`);
    console.log(`[IGNITION] hardBlockCount=${status.ignitionHardBlockCount}`);
    if (status.ignitionHardBlockPaths?.length) console.log(`[IGNITION] hardBlockPaths=${status.ignitionHardBlockPaths.join(',')}`);
    console.log(`[IGNITION] readyToEnterCommandDeck=${status.ignitionReadyToEnterCommandDeck ? 'yes' : 'no'}`);
    console.log(`[IGNITION] nextOperatorAction=${status.ignitionNextOperatorAction}`);
  }
  if (!dryRun && blocked) {
    throw new Error('housekeep blocked: source dirt or hard-block files detected');
  }
}

function printPreflightSummary({
  decision,
  expectedMetadata,
  distMetadata,
  buildAction,
  verifyResult,
  processResult,
  finalResult,
  publicationTruth,
}) {
  console.log('[IGNITION PREFLIGHT] --- summary ---');
  console.log(`[IGNITION PREFLIGHT] source fingerprint: ${expectedMetadata.sourceFingerprint}`);
  console.log(`[IGNITION PREFLIGHT] source marker: ${expectedMetadata.runtimeMarker}`);
  console.log(`[IGNITION PREFLIGHT] dist marker: ${distMetadata?.runtimeMarker || 'missing'}`);
  console.log(`[IGNITION PREFLIGHT] parity state: ${decision.state} (${decision.reason})`);
  if (publicationTruth) {
    console.log(`[IGNITION PREFLIGHT] publication parity: ${formatPublicationParityLine(publicationTruth)}`);
    console.log(`[IGNITION PREFLIGHT] publication summary: ${publicationTruth.publicationSummary}`);
    console.log(`[IGNITION PREFLIGHT] publication operator action: ${publicationTruth.operatorAction}`);
  }
  console.log(`[IGNITION PREFLIGHT] build action: ${buildAction}`);
  console.log(`[IGNITION PREFLIGHT] verify result: ${verifyResult}`);
  console.log(`[IGNITION PREFLIGHT] process reuse: ${processResult}`);
  console.log(`[IGNITION PREFLIGHT] final launch: ${finalResult}`);
}


export function shouldAutoPublishDist(env = process.env) {
  return String(env.STEPHANOS_IGNITION_AUTOPUBLISH_DIST || '') === '1';
}

export function canAutoPublishDist({ statusAssessment, branch, upstream, stagedPaths = [] }) {
  if (branch !== 'main') return { ok: false, reason: 'branch-not-main' };
  if (upstream !== 'origin/main') return { ok: false, reason: 'upstream-not-origin-main' };
  if (statusAssessment.meaningfulEntries.length > 0) return { ok: false, reason: 'source-dirt' };
  if (stagedPaths.some((p) => p === RUNTIME_MEMORY_PATH || p === 'data' || p.startsWith('data/') || p.includes('node_modules') || p.includes('secrets') || p.includes('token'))) return { ok: false, reason: 'unsafe-staged-paths' };
  if (stagedPaths.some((p) => !isApprovedGeneratedDistPath(p))) return { ok: false, reason: 'staged-outside-dist' };
  return { ok: true, reason: 'ok' };
}

function captureBranchAndUpstream(captureStep = runStepCapture) {
  const branch = normalizeCaptureStdout(captureStep('git-branch', 'git', ['rev-parse', '--abbrev-ref', 'HEAD']));
  const upstream = normalizeCaptureStdout(captureStep('git-upstream', 'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']));
  return { branch, upstream };
}

export function autoPublishDistWithDeps({ statusAssessment, captureStep = runStepCapture, runStepFn = runStep, reuseVerifyResult = true } = {}) {
  const { branch, upstream } = captureBranchAndUpstream(captureStep);
  const gate = canAutoPublishDist({ statusAssessment, branch, upstream, stagedPaths: [] });
  if (!gate.ok) throw new Error(`blocked for safety: dist auto-publish denied (${gate.reason}).`);

  const hasOnlyDistDirt = statusAssessment.entries.length > 0 && statusAssessment.entries.every((entry) => entry.category === 'approved-generated-dist');
  if (!hasOnlyDistDirt) {
    throw new Error('blocked for safety: dist auto-publish requires generated dist-only local dirt.');
  }

  if (!reuseVerifyResult) {
    runStepFn('verify', npmCommand, ['run', 'stephanos:verify']);
  }

  runStepFn('git-add-dist-only', 'git', ['add', '--all', '--', 'apps/stephanos/dist']);
  const stagedPaths = normalizeCaptureStdout(captureStep('git-diff-staged-names', 'git', ['diff', '--cached', '--name-only']))
    .split('\n').map((line) => line.trim()).filter(Boolean);
  const stagedGate = canAutoPublishDist({ statusAssessment, branch, upstream, stagedPaths });
  if (!stagedGate.ok) throw new Error(`blocked for safety: dist auto-publish denied (${stagedGate.reason}).`);

  runStepFn('git-commit-dist', 'git', ['commit', '-m', 'Refresh Stephanos dist after ignition build']);
  try {
    runStepFn('git-push', 'git', ['push', 'origin', 'main']);
  } catch {
    runStepFn('git-pull-rebase-main', 'git', ['pull', '--rebase', 'origin', 'main']);
    runStepFn('build', npmCommand, ['run', 'stephanos:build']);
    runStepFn('verify', npmCommand, ['run', 'stephanos:verify']);
    runStepFn('git-add-dist-only-retry', 'git', ['add', '--all', '--', 'apps/stephanos/dist']);
    runStepFn('git-commit-dist-retry', 'git', ['commit', '--amend', '--no-edit']);
    runStepFn('git-push-retry', 'git', ['push', 'origin', 'main']);
  }
}

export async function run() {
  const preflightState = readLocalBuildState();
  const autoPullEnabled = shouldAutoPull();
  const ignitionMode = resolveIgnitionMode();
  const debugEnabled = args.has('--debug') || String(process.env.STEPHANOS_DEBUG || '') === '1';
  if (ignitionMode === 'HOUSEKEEP' || ignitionMode === 'HOUSEKEEP_DRY_RUN') {
    runIgnitionHousekeep({ dryRun: ignitionMode === 'HOUSEKEEP_DRY_RUN', compact: false, debug: debugEnabled });
    return;
  }
  if (ignitionMode === 'NORMAL_IGNITION') {
    runIgnitionHousekeep({ dryRun: false, compact: true, debug: debugEnabled });
  }
  let publicationTruth = null;

  if (args.has('--probe-existing-server')) {
    const probe = await probeExistingLocalServer({
      expectedRuntimeMarker: preflightState.expectedMetadata.runtimeMarker,
    });

    if (probe.reusable) {
      console.log('[IGNITION PREFLIGHT] Existing localhost dist server is current; safe to reuse.');
      process.exit(0);
      return;
    }

    console.error('[IGNITION PREFLIGHT] Existing localhost dist server is stale/untrusted; replacement required.');
    if (probe.observedMarkers) {
      console.error(`[IGNITION PREFLIGHT] expected marker=${probe.observedMarkers.expected || 'missing'}`);
      console.error(`[IGNITION PREFLIGHT] observed health marker=${probe.observedMarkers.health || 'missing'}`);
      console.error(`[IGNITION PREFLIGHT] observed served marker=${probe.observedMarkers.servedIndex || 'missing'}`);
    }
    if (probe.mismatches?.length) {
      console.error(`[IGNITION PREFLIGHT] launcher source mismatches=${probe.mismatches.join(', ')}`);
    }
    process.exit(1);
    return;
  }

  let buildAction = 'required pre-flight build (always-run policy)';
  let verifyResult = 'not-run';

  await runIgnitionPlan({
    preflightState,
    runPreflight: async () => {
      console.log(`[IGNITION] dist auto-publish ${shouldAutoPublishDist() ? 'enabled' : 'disabled'}`);
      if (autoPullEnabled) {
        publicationTruth = runGitPullPreflightWithDeps();
      }
      else {
        console.log('[IGNITION] git auto-pull skipped (--skip-auto-pull)');
        publicationTruth = evaluateGitPublicationTruthWithDeps();
        reportPublicationParity(publicationTruth, { label: 'publication parity (auto-pull skipped)' });
        if (shouldRequirePublishedHead(args) && !publicationTruth.headPublished) {
          throw new Error(`blocked for safety: remote publication parity required but local HEAD is not publish-backed (${publicationTruth.publicationState}). ${publicationTruth.operatorAction}`);
        }
      }

      console.log('[IGNITION] launcher guardrail starting');
      try {
        runStep('guard-launcher-scripts', npmCommand, ['run', 'stephanos:guard:scripts']);
      }
      catch (error) {
        throw new Error(`blocked for safety: guardrail failed (${error.message}).`);
      }
      console.log('[IGNITION] launcher guardrail passed');
    },
    runBuild: async () => {
      console.log('[IGNITION] build starting');
      try {
        runStep('build', npmCommand, ['run', 'stephanos:build']);
      }
      catch (error) {
        throw new Error(`blocked for safety: build failed (${error.message}).`);
      }
      buildAction = `passed (${preflightState.decision.state})`;
      console.log('[IGNITION] build passed');
    },
    runVerify: async () => {
      console.log('[IGNITION] verify starting');
      try {
        runStep('verify', npmCommand, ['run', 'stephanos:verify']);
      }
      catch (error) {
        throw new Error(`blocked for safety: verify failed (${error.message}).`);
      }
      verifyResult = 'passed';
      console.log('[IGNITION] verify passed');
    },
    runPostVerify: async () => {
      if (ignitionMode === 'PR_CLEAN_ROOM') {
        runStep('guard-pr-clean', npmCommand, ['run', 'stephanos:guard:pr-clean']);
        const status = runStepCapture('git-status-pr-clean-post-verify', 'git', ['status', '--porcelain']);
        const assessment = evaluateGitStatusForIgnition(status.stdout);
        const restorePaths = collectApprovedTrackedGeneratedRestorePaths(assessment);
        if (restorePaths.length > 0) {
          runStep('git-restore-pr-clean-dist', 'git', ['restore', '--worktree', '--staged', '--', ...restorePaths]);
        }
        runStep('git-clean-pr-clean-dist-preview', 'git', ['clean', '-nd', '--', APPROVED_GENERATED_DIST_PREFIX]);
        runStep('git-clean-pr-clean-dist', 'git', ['clean', '-fd', '--', APPROVED_GENERATED_DIST_PREFIX]);
        runStep('guard-pr-clean-final', npmCommand, ['run', 'stephanos:guard:pr-clean']);
      }
      if (!shouldAutoPublishDist()) {
        console.log('[IGNITION] dist auto-publish disabled');
        return;
      }

      console.log('[IGNITION] dist auto-publish phase starting');
      const statusResult = runStepCapture('git-status-post-verify', 'git', ['status', '--porcelain']);
      const statusAssessment = evaluateGitStatusForIgnition(statusResult.stdout);

      if (statusAssessment.transientRootDataEntries.length > 0) {
        throw new Error('blocked for safety: root data/ exists after housekeeping; dist auto-publish refused.');
      }
      if (statusAssessment.runtimeStateEntries.length > 0) {
        throw new Error('blocked for safety: runtime data changed after housekeeping; dist auto-publish refused.');
      }
      if (statusAssessment.meaningfulEntries.length > 0 && String(process.env.STEPHANOS_IGNITION_ALLOW_DIRTY_SOURCE || '') !== '1') {
        throw new Error(`blocked for safety: dist auto-publish refused due to non-dist dirt (${statusAssessment.meaningfulEntries.map((entry) => entry.rawLine).join(', ')}).`);
      }

      autoPublishDistWithDeps({ statusAssessment, reuseVerifyResult: true });
      console.log('[IGNITION] dist auto-publish phase passed');
    },
    runServe: async () => {
      console.log('[IGNITION] launch continuing');
      const refreshedState = readLocalBuildState();
      const finalStatus = {
        ignitionMode,
        IgnitionCleanlinessVerdict: verifyResult === 'passed' ? 'READY' : 'HELD',
        PRGuardStatus: ignitionMode === 'PR_CLEAN_ROOM' ? 'enforced' : 'not-applicable',
        StartupDecision: 'START',
      };
      console.log(`[IGNITION] status-report=${JSON.stringify(finalStatus)}`);
      printPreflightSummary({
        ...refreshedState,
        publicationTruth,
        buildAction,
        verifyResult,
        processResult: 'delegated to dist server launch handoff',
        finalResult: 'starting dist server',
      });
      runStep('serve', process.execPath, ['scripts/serve-stephanos-dist.mjs']);
    },
  });
}

export function isMainModule(argv = process.argv, metaUrl = import.meta.url) {
  if (!argv?.[1]) {
    return false;
  }

  return metaUrl === pathToFileURL(resolve(argv[1])).href;
}

if (isMainModule()) {
  run().catch((error) => {
    console.error('[IGNITION] launch blocked');
    console.error(`[IGNITION PREFLIGHT] failed: ${error.message}`);
    process.exit(1);
  });
}
