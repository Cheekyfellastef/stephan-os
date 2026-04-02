import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readLocalBuildState, probeExistingLocalServer } from './stephanos-ignition-preflight.mjs';
import { runIgnitionPlan } from './ignite-stephanos-local-lib.mjs';

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

const APPROVED_LOCAL_DIR_PREFIXES = [
  'node_modules/',
  'stephanos-server/node_modules/',
  'stephanos-ui/node_modules/',
  'apps/stephanos/dist/',
];

const APPROVED_TRACKED_GENERATED_DIR_PREFIXES = [
  'apps/stephanos/dist/',
];

const APPROVED_LOCAL_FILE_PATHS = new Set([
  'package-lock.json',
  'stephanos-server/package-lock.json',
  'stephanos-ui/package-lock.json',
]);

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

  const entries = lines.map(parsePorcelainStatusLine);
  const approvedEntries = [];
  const meaningfulEntries = [];

  for (const entry of entries) {
    const approved = entry.paths.every((path) => isApprovedLocalDirtPath(path));
    if (approved) {
      approvedEntries.push(entry);
    }
    else {
      meaningfulEntries.push(entry);
    }
  }

  return {
    entries,
    approvedEntries,
    meaningfulEntries,
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

    const approvedGeneratedOnly = entry.paths.every((path) => isApprovedTrackedGeneratedPath(path));
    if (!approvedGeneratedOnly) {
      continue;
    }

    for (const path of entry.paths) {
      restorePaths.add(path);
    }
  }

  return Array.from(restorePaths).sort();
}

export function runGitPullPreflightWithDeps({
  captureStep = runStepCapture,
  runStepFn = runStep,
  argvArgs = args,
} = {}) {
  console.log('[IGNITION] git status check starting');
  const statusResult = captureStep('git-status', 'git', ['status', '--porcelain']);
  const statusAssessment = evaluateGitStatusForIgnition(statusResult.stdout);
  const approvedTrackedGeneratedRestorePaths = collectApprovedTrackedGeneratedRestorePaths(statusAssessment);

  if (statusAssessment.approvedEntries.length > 0) {
    console.log(`[IGNITION] approved local dirt ignored (${statusAssessment.approvedEntries.length} entries)`);
    for (const entry of statusAssessment.approvedEntries) {
      console.log(`[IGNITION] approved local dirt: ${entry.status} ${entry.paths.join(' -> ')}`);
    }
  }

  if (statusAssessment.meaningfulEntries.length > 0) {
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

  console.log('[IGNITION] git pull passed');
  const postPullPublicationTruth = evaluateGitPublicationTruthWithDeps({ captureStep, statusAssessment });
  reportPublicationParity(postPullPublicationTruth, { label: 'publication parity (post-pull)' });
  return postPullPublicationTruth;
}

function runGitPullPreflight() {
  return runGitPullPreflightWithDeps();
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

export async function run() {
  const preflightState = readLocalBuildState();
  const autoPullEnabled = shouldAutoPull();
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
    runServe: async () => {
      console.log('[IGNITION] launch continuing');
      const refreshedState = readLocalBuildState();
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
