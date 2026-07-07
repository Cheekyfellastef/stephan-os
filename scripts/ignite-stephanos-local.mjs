import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, cpSync, existsSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readLocalBuildState, probeExistingLocalServer } from './stephanos-ignition-preflight.mjs';
import { projectIgnitionCockpit } from './ignition-cockpit-model.mjs';
import { runIgnitionPlan } from './ignite-stephanos-local-lib.mjs';
import {
  OPENCLAW_WORKSPACE_DIRT_PATHS,
  buildOpenClawWorkspaceHygieneProjection,
  isOpenClawWorkspaceDirtPath,
  isSanctionedOpenClawWorkspacePath,
  resolveOpenClawWorkspaceRepairPath,
} from '../shared/agents/openClawWorkspaceHygiene.mjs';
import {
  DEFAULT_OPENCLAW_ENDPOINTS,
  DEFAULT_OPENCLAW_IDENTITY_ENDPOINT,
  DEFAULT_OPENCLAW_SERVICE_NAME,
  buildOpenClawStartupRecoveryPacket,
  classifyOpenClawReadiness,
  createOpenClawStandaloneDiscoveryPacket,
  findVerifiedOpenClawStandaloneGatewayCandidate,
} from '../shared/agents/openClawStartupRecovery.mjs';
import {
  OPENCLAW_GATEWAY_APPROVED_ENDPOINT,
  OPENCLAW_GATEWAY_STARTUP_SOURCE,
  OPENCLAW_GATEWAY_STARTUP_GUARDRAILS,
  buildOpenClawGatewayStartupTarget,
  hasForbiddenOpenClawGatewayStartupToken,
  splitOpenClawGatewayStartupCommand,
} from '../shared/agents/openClawGatewayStartup.mjs';

const args = new Set(process.argv.slice(2));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const OPENCLAW_STARTUP_RESTART_FLAG = '--approve-openclaw-service-restart';

const OPENCLAW_AUTOSTART_SURFACES = Object.freeze([
  { id: 'gateway', envKey: 'STEPHANOS_OPENCLAW_GATEWAY_COMMAND', required: true },
  { id: 'chat', envKey: 'STEPHANOS_OPENCLAW_CHAT_COMMAND', required: false },
  { id: 'dashboard', envKey: 'STEPHANOS_OPENCLAW_DASHBOARD_COMMAND', required: false },
]);


export function resolveApprovedOpenClawAutostartTargets({ env = process.env } = {}) {
  return OPENCLAW_AUTOSTART_SURFACES.map((surface) => {
    const commandText = String(env[surface.envKey] || '').trim();
    if (surface.id === 'gateway') {
      const target = buildOpenClawGatewayStartupTarget({ commandText: commandText || undefined, source: commandText ? `env:${surface.envKey}` : OPENCLAW_GATEWAY_STARTUP_SOURCE });
      const reason = target.reason === 'startup-command-violates-guardrails' ? 'approved-launch-command-violates-guardrails' : target.reason;
      return { ...surface, ...target, reason, blocked: target.blocked, required: surface.required };
    }
    if (!commandText) return { ...surface, available: false, blocked: surface.required, reason: 'approved-launch-command-missing' };
    const argv = splitOpenClawGatewayStartupCommand(commandText);
    if (argv.length === 0) return { ...surface, available: false, blocked: surface.required, reason: 'approved-launch-command-empty' };
    if (hasForbiddenOpenClawGatewayStartupToken(commandText)) return { ...surface, available: false, blocked: true, reason: 'approved-launch-command-violates-guardrails', commandText };
    return { ...surface, available: true, blocked: false, command: argv[0], commandArgs: argv.slice(1), commandText, source: `env:${surface.envKey}` };
  });
}

function startApprovedOpenClawSurface({ target, spawnFn = spawn, log = (message) => console.log(message) } = {}) {
  if (!target?.available) return { surface: target?.id || 'unknown', started: false, reason: target?.reason || 'not-available' };
  const child = spawnFn(target.command, target.commandArgs || [], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    shell: false,
    env: { ...process.env, STEPHANOS_OPENCLAW_AUTOSTART: 'runtime-surfaces-only' },
  });
  if (typeof child?.unref === 'function') child.unref();
  const pid = Number(child?.pid || 0) || null;
  log(`[IGNITION] openclaw-autostart-surface=${JSON.stringify({ surface: target.id, started: true, pid, guardrails: OPENCLAW_GATEWAY_STARTUP_GUARDRAILS })}`);
  return { surface: target.id, started: true, pid };
}

export async function evaluateOpenClawRuntimeAutostartWithDeps({
  captureStep = runStepCapture,
  fetchFn = globalThis.fetch,
  spawnFn = spawn,
  platform = process.platform,
  env = process.env,
  log = (message) => console.log(message),
  waitMs = 1200,
  readinessTimeoutMs = 10000,
  retryIntervalMs = 500,
} = {}) {
  const discovery = discoverOpenClawStandaloneIdentityWithDeps({ captureStep, platform, env });
  const { endpoints, gatewayCandidate, selectedGatewayEndpoint, selectedGatewayEndpointSource } = buildOpenClawReadinessEndpoints({ discovery, env });
  const expectedIdentity = resolveExpectedOpenClawIdentity({ env, endpoint: endpoints[0] || DEFAULT_OPENCLAW_IDENTITY_ENDPOINT, endpointSource: selectedGatewayEndpointSource });
  const base = probeOpenClawProcessWithDeps({ captureStep, platform });
  const beforeEndpoint = await probeOpenClawEndpoint({ endpoints, fetchFn, expectedIdentity, timeoutMs: 0, retryIntervalMs });
  const beforeReadiness = { ...base, endpoint: beforeEndpoint, standaloneGatewayCandidate: gatewayCandidate };
  const beforeClassification = classifyOpenClawReadiness(beforeReadiness);
  const endpointAlreadyVerified = beforeEndpoint.reachable === true && beforeEndpoint.identityVerified === true && /^(healthy|ready|live|connected)$/i.test(String(beforeEndpoint.connectionStatus || ''));
  if (beforeClassification.healthy || endpointAlreadyVerified) {
    const status = { state: 'openclaw-reused-existing-runtime', ignitionPhase: 'openclaw-gateway-startup', healthy: true, autostartAttempted: false, duplicateStartAvoided: true, startupSource: OPENCLAW_GATEWAY_STARTUP_SOURCE, selectedReadinessEndpoint: beforeEndpoint.url || null, selectedGatewayEndpoint, selectedGatewayEndpointSource };
    log(`[IGNITION] openclaw-autostart-status=${JSON.stringify(status)}`);
    return status;
  }

  const targets = resolveApprovedOpenClawAutostartTargets({ env });
  const blockingTarget = targets.find((target) => target.blocked && target.required);
  if (blockingTarget) {
    const status = { state: 'openclaw-autostart-blocked', healthy: false, autostartAttempted: false, reason: blockingTarget.reason, surface: blockingTarget.id, guardrails: OPENCLAW_GATEWAY_STARTUP_GUARDRAILS };
    log(`[IGNITION] openclaw-autostart-status=${JSON.stringify(status)}`);
    throw new Error(`blocked for safety: OpenClaw ${blockingTarget.id} autostart cannot proceed (${blockingTarget.reason}). Configure ${blockingTarget.envKey} with an approved local runtime-surface launch command; no OpenClaw task execution or mutation is allowed.`);
  }

  const started = targets.filter((target) => target.available).map((target) => startApprovedOpenClawSurface({ target, spawnFn, log }));
  if (waitMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
  const afterEndpoint = await probeOpenClawEndpoint({ endpoints, fetchFn, expectedIdentity, timeoutMs: readinessTimeoutMs, retryIntervalMs });
  const afterReadiness = { ...probeOpenClawProcessWithDeps({ captureStep, platform }), endpoint: afterEndpoint, standaloneGatewayCandidate: gatewayCandidate };
  const afterClassification = classifyOpenClawReadiness(afterReadiness);
  const identityVerified = afterClassification.healthy === true || afterClassification.endpointIdentityVerified === true || afterEndpoint.identityVerified === true;
  const diagnostics = { selectedGatewayEndpoint, selectedGatewayEndpointSource, startupSource: OPENCLAW_GATEWAY_STARTUP_SOURCE, startupCommand: (targets.find((target) => target.id === 'gateway') || {}).commandText || '', processStartResult: started.find((entry) => entry.surface === 'gateway') || null, probeAttempts: afterEndpoint.probeAttempts || null, expectedEndpoint: afterEndpoint.expectedEndpoint || expectedIdentity.endpoint, expectedEndpointSource: expectedIdentity.endpointSource || selectedGatewayEndpointSource, actualEndpoint: afterEndpoint.actualEndpoint || afterEndpoint.url || null, identityPayload: afterEndpoint.identityPayload || null, mismatchReason: afterEndpoint.identityMismatchReason || (identityVerified ? '' : 'identity-unverified') };
  const status = { state: identityVerified ? 'openclaw-autostart-identity-verified' : 'openclaw-autostart-identity-unverified', ignitionPhase: 'openclaw-gateway-startup', healthy: identityVerified, autostartAttempted: true, startupSource: OPENCLAW_GATEWAY_STARTUP_SOURCE, started, selectedReadinessEndpoint: afterEndpoint.url || null, identityDiagnostics: diagnostics, guardrails: OPENCLAW_GATEWAY_STARTUP_GUARDRAILS };
  log(`[IGNITION] openclaw-autostart-status=${JSON.stringify(status)}`);
  if (!identityVerified) {
    throw new Error(`blocked for safety: OpenClaw local runtime surface started or was probed, but endpoint identity could not be verified. Diagnostics: ${JSON.stringify(diagnostics)}. Operator action: confirm the gateway endpoint is the approved local OpenClaw runtime before retrying.`);
  }
  return status;
}



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

export function createIgnitionRepairPacket({
  reason,
  currentCommit = 'unknown',
  originMainCommit = 'unknown',
  servedCommit = 'unknown',
  expectedSourceCommit = 'unknown',
  sourceFingerprint = 'unknown',
  buildTimestamp = 'unknown',
  localOnlyCommits = [],
  remoteOnlyCommits = [],
  localOnlyPaths = [],
  localOnlyDistOnly = false,
  nextSafeAction = 'Stop ignition and ask the operator to approve the next source-control action.',
} = {}) {
  return {
    ignitionStatus: 'BLOCKED',
    statusPanel: 'source-update-safety',
    reason,
    currentCommit,
    originMainCommit,
    servedCommit,
    expectedSourceCommit,
    sourceFingerprint,
    buildTimestamp,
    localOnlyCommits,
    remoteOnlyCommits,
    localOnlyPaths,
    localOnlyDistOnly,
    safetyLocks: {
      autoMerge: false,
      autoPush: false,
      codexAutoDispatch: false,
      openClawUnlock: false,
      mergeReadyFlip: false,
    },
    nextSafeAction,
  };
}

export function classifySourceUpdateTruth({
  currentCommit = '',
  originMainCommit = '',
  localOnlyCommits = [],
  remoteOnlyCommits = [],
  localOnlyPaths = [],
  aheadCount = 0,
  behindCount = 0,
  detachedHead = false,
  hasUpstream = true,
  upstreamBranch = 'origin/main',
} = {}) {
  if (detachedHead) {
    return createIgnitionRepairPacket({
      reason: 'detached-head',
      currentCommit,
      originMainCommit,
      nextSafeAction: 'Checkout a tracking branch before ignition updates source or rebuilds dist.',
    });
  }

  if (!hasUpstream) {
    return createIgnitionRepairPacket({
      reason: 'missing-upstream',
      currentCommit,
      originMainCommit,
      nextSafeAction: 'Current branch has no upstream tracking branch. Configure an upstream tracking branch before ignition updates source or rebuilds dist.',
    });
  }

  if (aheadCount > 0 && behindCount > 0) {
    return createIgnitionRepairPacket({
      reason: 'ff-only-divergence',
      currentCommit,
      originMainCommit,
      localOnlyCommits,
      remoteOnlyCommits,
      localOnlyPaths,
      localOnlyDistOnly: localOnlyPaths.length > 0 && localOnlyPaths.every((path) => isApprovedGeneratedDistPath(path)),
      nextSafeAction: `Review the recovery packet. If local-only commits are generated dist only, rerun npm run stephanos:ignite -- --approve-local-merge to merge ${upstreamBranch || 'origin/main'}, regenerate dist, verify, and commit generated output.`,
    });
  }

  if (behindCount > 0) {
    return {
      ignitionStatus: 'READY',
      statusPanel: 'source-update-safety',
      reason: 'safe-fast-forward-required',
      currentCommit,
      originMainCommit,
      nextSafeAction: 'Run git pull --ff-only, then rebuild and verify before serving.',
    };
  }

  return {
    ignitionStatus: 'READY',
    statusPanel: 'source-update-safety',
    reason: aheadCount > 0 ? 'local-ahead-origin' : 'source-current',
    currentCommit,
    originMainCommit,
    nextSafeAction: aheadCount > 0
      ? 'Local commits are ahead of origin/main; do not silently treat them as remote truth.'
      : 'Source commit matches tracked remote truth; build and verify may continue.',
  };
}

export function evaluateDistFreshnessAgainstOrigin({ distMetadata = {}, currentCommit = '', originMainCommit = '' } = {}) {
  const servedCommit = String(distMetadata?.gitCommit || '').trim();
  const expectedSourceCommit = String(originMainCommit || currentCommit || '').trim();
  if (!servedCommit) {
    return createIgnitionRepairPacket({
      reason: 'dist-metadata-missing-served-commit',
      currentCommit,
      originMainCommit,
      servedCommit: 'missing',
      expectedSourceCommit,
      sourceFingerprint: distMetadata?.sourceFingerprint || 'unknown',
      buildTimestamp: distMetadata?.buildTimestamp || 'unknown',
      nextSafeAction: 'Run npm run stephanos:build && npm run stephanos:verify before serving localhost.',
    });
  }
  if (originMainCommit && servedCommit !== originMainCommit) {
    return createIgnitionRepairPacket({
      reason: 'dist-built-from-commit-older-than-origin-main',
      currentCommit,
      originMainCommit,
      servedCommit,
      expectedSourceCommit,
      sourceFingerprint: distMetadata?.sourceFingerprint || 'unknown',
      buildTimestamp: distMetadata?.buildTimestamp || 'unknown',
      nextSafeAction: 'Fast-forward to origin/main, rebuild with npm run stephanos:build, verify with npm run stephanos:verify, then restart the 4173 server.',
    });
  }
  return {
    ignitionStatus: 'READY',
    statusPanel: 'source-update-safety',
    reason: 'dist-source-commit-current',
    currentCommit,
    originMainCommit,
    servedCommit,
    expectedSourceCommit,
    sourceFingerprint: distMetadata?.sourceFingerprint || 'unknown',
    buildTimestamp: distMetadata?.buildTimestamp || 'unknown',
    nextSafeAction: 'Dist commit matches expected source commit; serve may continue after verify.',
  };
}

function splitLines(value = '') {
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
}

export function buildDivergenceRecoveryPacket({
  currentCommit = 'unknown',
  originMainCommit = 'unknown',
  localOnlyCommits = [],
  remoteOnlyCommits = [],
  localOnlyPaths = [],
} = {}) {
  return createIgnitionRepairPacket({
    reason: 'ff-only-divergence',
    currentCommit,
    originMainCommit,
    localOnlyCommits,
    remoteOnlyCommits,
    localOnlyPaths,
    localOnlyDistOnly: localOnlyPaths.length > 0 && localOnlyPaths.every((path) => isApprovedGeneratedDistPath(path)),
    nextSafeAction: 'If local-only commits touch only apps/stephanos/dist/**, rerun npm run stephanos:ignite -- --approve-local-merge. Otherwise, stop and request an operator-approved source merge/rebase plan.',
  });
}

export function captureDivergenceRecoveryPacket({ captureStep = runStepCapture, currentCommit = 'unknown', originMainCommit = 'unknown' } = {}) {
  const localOnlyCommits = splitLines(captureStep('git-local-only-commits', 'git', ['log', '--oneline', 'origin/main..HEAD']).stdout);
  const remoteOnlyCommits = splitLines(captureStep('git-remote-only-commits', 'git', ['log', '--oneline', 'HEAD..origin/main']).stdout);
  const localOnlyPaths = splitLines(captureStep('git-local-only-paths', 'git', ['diff', '--name-only', 'origin/main..HEAD']).stdout);
  return buildDivergenceRecoveryPacket({
    currentCommit,
    originMainCommit,
    localOnlyCommits,
    remoteOnlyCommits,
    localOnlyPaths,
  });
}

export function shouldApproveLocalMerge(argvArgs = args) {
  return argvArgs.has('--approve-local-merge');
}

export function runApprovedLocalMergeRecoveryWithDeps({
  captureStep = runStepCapture,
  runStepFn = runStep,
  removePath = (targetPath) => rmSync(targetPath, { recursive: true, force: true }),
  currentCommit = 'unknown',
  originMainCommit = 'unknown',
} = {}) {
  const recoveryPacket = captureDivergenceRecoveryPacket({ captureStep, currentCommit, originMainCommit });
  console.log(`[IGNITION] approved-local-merge-recovery=${JSON.stringify(recoveryPacket)}`);
  if (!recoveryPacket.localOnlyDistOnly) {
    throw new Error(`blocked for safety: approved local merge requires local-only commits to touch only ${APPROVED_GENERATED_DIST_PREFIX} (${recoveryPacket.localOnlyPaths.join(',') || 'no local-only paths'}).`);
  }

  runStepFn('git-fetch-approved-local-merge', 'git', ['fetch', '--prune', '--tags', 'origin']);
  try {
    runStepFn('git-merge-origin-main-approved', 'git', ['merge', '--no-edit', 'origin/main']);
  } catch (error) {
    const conflictPaths = splitLines(captureStep('git-unmerged-conflict-paths', 'git', ['diff', '--name-only', '--diff-filter=U']).stdout);
    const nonDistConflicts = conflictPaths.filter((path) => !isApprovedGeneratedDistPath(path));
    if (conflictPaths.length === 0 || nonDistConflicts.length > 0) {
      throw new Error(`blocked for safety: approved local merge encountered non-dist conflicts (${nonDistConflicts.join(',') || 'unknown conflict set'}). Resolve manually; original merge error: ${error.message}`);
    }
    console.log(`[IGNITION] generated dist conflicts detected; resolving by deleting and regenerating ${APPROVED_GENERATED_DIST_PREFIX}`);
    removePath(APPROVED_GENERATED_DIST_PREFIX.slice(0, -1));
    runStepFn('git-add-dist-conflict-removal', 'git', ['add', '--all', '--', APPROVED_GENERATED_DIST_PREFIX]);
  }

  runStepFn('build-approved-local-merge', npmCommand, ['run', 'stephanos:build']);
  runStepFn('verify-approved-local-merge', npmCommand, ['run', 'stephanos:verify']);
  runStepFn('git-add-regenerated-dist', 'git', ['add', '--all', '--', APPROVED_GENERATED_DIST_PREFIX]);
  const stagedPaths = splitLines(captureStep('git-staged-after-regenerated-dist', 'git', ['diff', '--cached', '--name-only']).stdout);
  const unsafeStagedPaths = stagedPaths.filter((path) => !isApprovedGeneratedDistPath(path));
  if (unsafeStagedPaths.length > 0) {
    throw new Error(`blocked for safety: approved local merge staged non-dist paths (${unsafeStagedPaths.join(',')}).`);
  }
  if (stagedPaths.length > 0) {
    runStepFn('git-commit-regenerated-dist', 'git', ['commit', '-m', 'Regenerate Stephanos dist after approved local merge']);
  }
  console.log('[IGNITION] approved local merge recovery complete; 4173 server restart/hard refresh is required for served runtime convergence.');
  return {
    ...recoveryPacket,
    ignitionStatus: 'READY',
    recoveryApplied: true,
    restartRequired: true,
    nextSafeAction: 'Restart or let ignition restart the 4173 static server, then hard-refresh the browser and compare footer commit/build timestamp against source truth.',
  };
}


async function probeIgnitionJavaScriptMime(fetchFn, url) {
  try {
    const response = await fetchFn(url, {
      headers: {
        'Cache-Control': 'no-cache',
        Connection: 'close',
      },
    });
    const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
    return {
      ok: Boolean(response?.ok) && contentType === 'text/javascript; charset=utf-8',
      status: response?.status ?? null,
      contentType,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      contentType: null,
      error: String(error?.message || error || 'mime-probe-failed'),
    };
  }
}

async function probeIgnitionModuleMimeChecks(fetchFn, servedUrl) {
  const baseUrl = servedUrl.replace(/\/$/, '');
  const [runtimeStatusModel, stephanosLocalUrls] = await Promise.all([
    probeIgnitionJavaScriptMime(fetchFn, `${baseUrl}/shared/runtime/runtimeStatusModel.mjs`),
    probeIgnitionJavaScriptMime(fetchFn, `${baseUrl}/shared/runtime/stephanosLocalUrls.mjs?v=ignition-mime-probe`),
  ]);
  return {
    ok: runtimeStatusModel.ok && stephanosLocalUrls.ok,
    runtimeStatusModel,
    stephanosLocalUrls,
  };
}

export async function ensureLocalStaticServerRestartWithDeps({
  expectedMetadata,
  port = 4173,
  fetchFn = globalThis.fetch,
  log = (message) => console.log(message),
  verifyServedAfterStart = false,
} = {}) {
  const servedUrl = `http://127.0.0.1:${port}/`;
  const healthUrl = `${servedUrl}__stephanos/health`;
  const restartUrl = `${servedUrl}__stephanos/restart`;
  const expectedRuntimeMarker = expectedMetadata?.runtimeMarker || '';
  const expectedCommit = expectedMetadata?.gitCommit || '';
  const expectedBuildTimestamp = expectedMetadata?.buildTimestamp || '';
  const expectedSourceFingerprint = expectedMetadata?.sourceFingerprint || '';
  const report = {
    previousServerStatus: 'not-running',
    serverStopped: false,
    serverStarted: false,
    servedUrl,
    servedCommit: null,
    servedBuildTimestamp: null,
    servedSourceFingerprint: null,
    servedRuntimeMatchesExpectedDistMetadata: false,
    moduleMimeChecksPass: false,
    moduleMimeChecks: null,
    restartRequired: false,
    operatorBrowserAction: 'Hard-refresh browser after the 4173 server restart completes.',
  };

  let previousHealth = null;
  try {
    const healthResponse = await fetchFn(healthUrl, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    if (healthResponse?.ok) {
      previousHealth = await healthResponse.json();
      report.previousServerStatus = 'running';
      report.servedCommit = previousHealth?.gitCommit || null;
      report.servedBuildTimestamp = previousHealth?.buildTimestamp || null;
      report.servedSourceFingerprint = previousHealth?.sourceFingerprint || null;
      // Metadata parity alone is not sufficient evidence that the static server is reusable.
      // Keep the public success field false until post-start MIME probes pass.
      report.servedRuntimeMatchesExpectedDistMetadata = false;
    } else {
      report.previousServerStatus = `unhealthy:${healthResponse?.status || 'unknown'}`;
    }
  } catch {
    report.previousServerStatus = 'not-running';
  }

  if (report.previousServerStatus === 'running') {
    try {
      const restartResponse = await fetchFn(restartUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'ignition',
          reason: 'post-build-static-server-restart',
          expectedRuntimeMarker,
          expectedCommit,
          expectedBuildTimestamp,
          expectedSourceFingerprint,
        }),
      });
      if (!restartResponse?.ok && restartResponse?.status !== 202) {
        throw new Error(`restart endpoint returned ${restartResponse?.status || 'unknown'}`);
      }
      report.serverStopped = true;
    } catch (error) {
      const packet = createIgnitionRepairPacket({
        reason: 'static-server-restart-failed',
        servedCommit: report.servedCommit || 'unknown',
        expectedSourceCommit: expectedCommit || 'unknown',
        sourceFingerprint: expectedSourceFingerprint || 'unknown',
        buildTimestamp: expectedBuildTimestamp || 'unknown',
        nextSafeAction: `Stop the existing 4173 server manually, then rerun npm run stephanos:ignite. Restart failure: ${error.message}`,
      });
      log(`[IGNITION] static-server-restart=${JSON.stringify({ ...report, repairPacket: packet })}`);
      throw new Error(`blocked for safety: ${packet.reason}. ${packet.nextSafeAction}`);
    }
  }

  report.serverStarted = true;
  report.restartRequired = true;
  if (verifyServedAfterStart && report.previousServerStatus === 'running') {
    let servedHealth = null;
    try {
      const servedResponse = await fetchFn(healthUrl, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
      if (!servedResponse?.ok) {
        throw new Error(`health endpoint returned ${servedResponse?.status || 'unknown'}`);
      }
      servedHealth = await servedResponse.json();
    } catch (error) {
      const packet = createIgnitionRepairPacket({
        reason: 'static-server-start-verification-failed',
        expectedSourceCommit: expectedCommit || 'unknown',
        sourceFingerprint: expectedSourceFingerprint || 'unknown',
        buildTimestamp: expectedBuildTimestamp || 'unknown',
        nextSafeAction: `Restart the 4173 server manually and rerun the localhost health/source-truth probes. Verification failure: ${error.message}`,
      });
      log(`[IGNITION] static-server-restart=${JSON.stringify({ ...report, repairPacket: packet })}`);
      throw new Error(`blocked for safety: ${packet.reason}. ${packet.nextSafeAction}`);
    }
    report.servedCommit = servedHealth?.gitCommit || null;
    report.servedBuildTimestamp = servedHealth?.buildTimestamp || null;
    report.servedSourceFingerprint = servedHealth?.sourceFingerprint || null;
    const metadataMatchesExpected = Boolean(expectedRuntimeMarker) && servedHealth?.runtimeMarker === expectedRuntimeMarker;
    report.moduleMimeChecks = await probeIgnitionModuleMimeChecks(fetchFn, servedUrl);
    report.moduleMimeChecksPass = report.moduleMimeChecks.ok;
    report.servedRuntimeMatchesExpectedDistMetadata = metadataMatchesExpected && report.moduleMimeChecksPass;
    if (!metadataMatchesExpected) {
      const packet = createIgnitionRepairPacket({
        reason: 'served-runtime-metadata-mismatch',
        servedCommit: report.servedCommit || 'unknown',
        expectedSourceCommit: expectedCommit || 'unknown',
        sourceFingerprint: expectedSourceFingerprint || 'unknown',
        buildTimestamp: expectedBuildTimestamp || 'unknown',
        nextSafeAction: 'Stop the stale 4173 server, restart ignition, and hard-refresh the browser only after served metadata matches dist.',
      });
      log(`[IGNITION] static-server-restart=${JSON.stringify({ ...report, repairPacket: packet })}`);
      throw new Error(`blocked for safety: ${packet.reason}. ${packet.nextSafeAction}`);
    }
    if (!report.moduleMimeChecksPass) {
      const packet = createIgnitionRepairPacket({
        reason: 'served-runtime-module-mime-mismatch',
        servedCommit: report.servedCommit || 'unknown',
        expectedSourceCommit: expectedCommit || 'unknown',
        sourceFingerprint: expectedSourceFingerprint || 'unknown',
        buildTimestamp: expectedBuildTimestamp || 'unknown',
        nextSafeAction: 'Stop the stale 4173 server, restart ignition, and hard-refresh the browser only after served module MIME checks pass.',
      });
      log(`[IGNITION] static-server-restart=${JSON.stringify({ ...report, repairPacket: packet })}`);
      throw new Error(`blocked for safety: ${packet.reason}. ${packet.nextSafeAction}`);
    }
  }
  log(`[IGNITION] static-server-restart=${JSON.stringify(report)}`);
  return report;
}

const APPROVED_GENERATED_DIST_PREFIX = 'apps/stephanos/dist/';
const RUNTIME_MEMORY_PATH = 'stephanos-server/data/memory/durable-memory.json';
const ROOT_TRANSIENT_DATA_PREFIX = 'data/';
const ROOT_TRANSIENT_TMP_PATH = 'tmp/';
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

function isTransientRootTmpDirectoryStatusPath(path) {
  return path === 'tmp' || path === ROOT_TRANSIENT_TMP_PATH;
}

function isAllowlistedRootRuntimePath(path) {
  return ROOT_RUNTIME_ALLOWLIST_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function classifyStatusEntry(entry) {
  if (entry.paths.some((path) => SECRETS_PATTERN.test(path))) return 'forbidden-or-unknown';
  if (entry.paths.every((path) => isSanctionedOpenClawWorkspacePath(path))) return 'openclaw-runtime-workspace';
  if (entry.paths.some((path) => KNOWN_SOURCE_FILES.has(path) || KNOWN_SOURCE_PREFIXES.some((prefix) => path.startsWith(prefix)))) return 'meaningful-source-dirt';
  if (entry.paths.every((path) => path === RUNTIME_MEMORY_PATH)) return 'runtime-state';
  if (entry.status.includes('?') && entry.paths.every((path) => isTransientRootTmpDirectoryStatusPath(path))) return 'runtime-state';
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
  if (isTransientRootTmpDirectoryStatusPath(normalized)) return 'RUNTIME_CHECKPOINT_CLEAN';
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


function normalizeRootCandidatePath(path = '') {
  return normalizeGitPath(path).replace(/\\/g, '/').replace(/\/+$/g, '');
}

function isRootOpenClawWorkspaceDirtPath(path = '') {
  const normalized = normalizeRootCandidatePath(path);
  return normalized.length > 0 && !normalized.includes('/') && isOpenClawWorkspaceDirtPath(normalized);
}

function collectMovableRootOpenClawWorkspaceDirt(assessment) {
  const paths = new Set();
  for (const entry of assessment.entries || []) {
    if (!entry.status.includes('?')) continue;
    for (const path of entry.paths) {
      if (isRootOpenClawWorkspaceDirtPath(path)) paths.add(normalizeRootCandidatePath(path));
    }
  }
  return OPENCLAW_WORKSPACE_DIRT_PATHS.filter((path) => paths.has(path));
}

function formatMigrationStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function uniqueMigrationDirectory(destinationRoot, pathExists, now = () => new Date()) {
  const stamp = formatMigrationStamp(now());
  const basePath = resolve(destinationRoot, `root-migration-${stamp}`);
  if (!pathExists(basePath)) return basePath;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${basePath}-${index}`;
    if (!pathExists(candidate)) return candidate;
  }
  throw new Error(`unable to allocate unique OpenClaw workspace migration directory under ${destinationRoot}`);
}

export function moveRootOpenClawWorkspaceDirt({
  paths = [],
  destinationRoot = resolveOpenClawWorkspaceRepairPath(),
  pathExists = existsSync,
  makeDir = mkdirSync,
  movePath = renameSync,
  now = () => new Date(),
} = {}) {
  const moved = [];
  const skipped = [];
  const normalizedPaths = [...new Set(paths.map((path) => normalizeRootCandidatePath(path)).filter(isRootOpenClawWorkspaceDirtPath))];
  if (normalizedPaths.length === 0) return { destinationRoot, migrationDirectory: null, moved, skipped };
  makeDir(destinationRoot, { recursive: true });
  const migrationDirectory = uniqueMigrationDirectory(destinationRoot, pathExists, now);
  makeDir(migrationDirectory, { recursive: true });
  for (const path of normalizedPaths) {
    if (!pathExists(path)) {
      skipped.push({ path, reason: 'missing-at-repair-time' });
      continue;
    }
    const destinationPath = resolve(migrationDirectory, basename(path));
    movePath(path, destinationPath);
    moved.push({ path, destinationPath });
  }
  return { destinationRoot: migrationDirectory, workspaceRoot: destinationRoot, migrationDirectory, moved, skipped };
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
      if (isTransientRootTmpDirectoryStatusPath(path)) {
        continue;
      }
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
  let currentCommit = 'unknown';
  try {
    currentCommit = normalizeCaptureStdout(captureStep('git-current-commit', 'git', ['rev-parse', '--short', 'HEAD']));
  } catch {
    currentCommit = 'unknown';
  }
  let originMainCommit = 'unknown';
  try {
    originMainCommit = normalizeCaptureStdout(captureStep('git-origin-main-commit', 'git', ['rev-parse', '--short', 'origin/main']));
  } catch {
    try {
      originMainCommit = normalizeCaptureStdout(captureStep('git-upstream-commit', 'git', ['rev-parse', '--short', '@{u}']));
    } catch {
      originMainCommit = 'unknown';
    }
  }
  const divergencePacket = prePullPublicationTruth.aheadCount > 0 && prePullPublicationTruth.behindCount > 0
    ? captureDivergenceRecoveryPacket({ captureStep, currentCommit, originMainCommit })
    : null;
  const sourceUpdateTruth = classifySourceUpdateTruth({
    currentCommit,
    originMainCommit,
    localOnlyCommits: divergencePacket?.localOnlyCommits || [],
    remoteOnlyCommits: divergencePacket?.remoteOnlyCommits || [],
    localOnlyPaths: divergencePacket?.localOnlyPaths || [],
    aheadCount: prePullPublicationTruth.aheadCount,
    behindCount: prePullPublicationTruth.behindCount,
    detachedHead: prePullPublicationTruth.detachedHead,
    hasUpstream: prePullPublicationTruth.hasUpstream,
    upstreamBranch: prePullPublicationTruth.upstreamBranch,
  });
  console.log(`[IGNITION] source-update-status=${JSON.stringify(sourceUpdateTruth)}`);
  if (sourceUpdateTruth.ignitionStatus === 'BLOCKED') {
    if (sourceUpdateTruth.reason === 'ff-only-divergence') {
      console.error(`[IGNITION] recovery-packet=${JSON.stringify(sourceUpdateTruth)}`);
      if (shouldApproveLocalMerge(argvArgs)) {
        const recoveryResult = runApprovedLocalMergeRecoveryWithDeps({
          captureStep,
          runStepFn,
          currentCommit,
          originMainCommit,
        });
        console.log(`[IGNITION] recovery-result=${JSON.stringify(recoveryResult)}`);
        return evaluateGitPublicationTruthWithDeps({ captureStep, statusAssessment });
      }
    }
    console.error('[IGNITION] source update blocked before build');
    console.error(`[IGNITION] repair-packet=${JSON.stringify(sourceUpdateTruth)}`);
    throw new Error(`blocked for safety: ${sourceUpdateTruth.reason}. ${sourceUpdateTruth.nextSafeAction}`);
  }

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
  let afterCommit = currentCommit;
  try {
    afterCommit = normalizeCaptureStdout(captureStep('git-current-commit-post-pull', 'git', ['rev-parse', '--short', 'HEAD']));
  } catch {
    afterCommit = currentCommit;
  }
  const enrichedPublicationTruth = { ...postPullPublicationTruth, beforeCommit: currentCommit, afterCommit, pulledFromCommit: originMainCommit };
  reportPublicationParity(enrichedPublicationTruth, { label: 'publication parity (post-pull)' });
  return enrichedPublicationTruth;
}

function runGitPullPreflight() {
  return runGitPullPreflightWithDeps();
}

function parseJsonLine(value = '') {
  try { return JSON.parse(String(value || '').trim()); } catch { return null; }
}


function normalizeOpenClawEndpointUrl(value = '') {
  try {
    const url = new URL(String(value || '').trim());
    url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return String(value || '').trim().replace(/\/$/, '');
  }
}

function resolveExpectedOpenClawIdentity({ env = process.env, endpoint = DEFAULT_OPENCLAW_IDENTITY_ENDPOINT, endpointSource = 'default-fallback' } = {}) {
  const explicitIdentityEndpoint = String(env.STEPHANOS_OPENCLAW_IDENTITY_ENDPOINT || '').trim();
  return {
    product: String(env.STEPHANOS_OPENCLAW_EXPECTED_PRODUCT || 'OpenClaw').trim(),
    runtimeId: String(env.STEPHANOS_OPENCLAW_EXPECTED_RUNTIME_ID || 'openclaw-local-runtime').trim(),
    endpoint: normalizeOpenClawEndpointUrl(explicitIdentityEndpoint || endpoint),
    endpointSource: explicitIdentityEndpoint ? 'env:STEPHANOS_OPENCLAW_IDENTITY_ENDPOINT' : endpointSource,
  };
}

function extractOpenClawIdentityPayload(json = {}, body = '') {
  const identity = json?.identity && typeof json.identity === 'object' ? json.identity : json;
  return {
    product: String(identity?.product || identity?.service || identity?.name || identity?.app || '').trim(),
    runtimeId: String(identity?.runtimeId || identity?.runtimeID || identity?.id || identity?.runtime || '').trim(),
    version: String(identity?.version || identity?.runtimeVersion || '').trim(),
    endpoint: normalizeOpenClawEndpointUrl(identity?.endpoint || identity?.expectedEndpoint || identity?.url || ''),
    raw: json && Object.keys(json).length > 0 ? json : body.slice(0, 500),
  };
}

function verifyOpenClawIdentityPayload({ payload, expected, actualEndpoint }) {
  const normalizedActualEndpoint = normalizeOpenClawEndpointUrl(actualEndpoint);
  const actualProduct = String(payload?.product || '').trim();
  const actualRuntimeId = String(payload?.runtimeId || '').trim();
  const actualVersion = String(payload?.version || '').trim();
  const actualDeclaredEndpoint = normalizeOpenClawEndpointUrl(payload?.endpoint || normalizedActualEndpoint);
  const expectedEndpoint = normalizeOpenClawEndpointUrl(expected?.endpoint || actualEndpoint);
  const productOk = actualProduct.toLowerCase() === String(expected?.product || '').trim().toLowerCase() || /^openclaw(?:\b|\s)/i.test(actualProduct);
  const runtimeOk = actualRuntimeId === expected?.runtimeId;
  const versionOk = actualVersion.length > 0;
  const endpointOk = actualDeclaredEndpoint === expectedEndpoint && normalizedActualEndpoint === expectedEndpoint;
  const mismatchReasons = [];
  if (!productOk) mismatchReasons.push('product-mismatch');
  if (!runtimeOk) mismatchReasons.push('runtime-id-mismatch');
  if (!versionOk) mismatchReasons.push('version-missing');
  if (!endpointOk) mismatchReasons.push('endpoint-mismatch');
  return {
    verified: mismatchReasons.length === 0,
    mismatchReason: mismatchReasons.join(',') || '',
    expected: { ...expected, endpoint: expectedEndpoint },
    actual: { product: actualProduct, runtimeId: actualRuntimeId, version: actualVersion, endpoint: actualDeclaredEndpoint || normalizedActualEndpoint },
  };
}

async function probeOpenClawEndpointOnce({ endpoints = DEFAULT_OPENCLAW_ENDPOINTS, fetchFn = globalThis.fetch, expectedIdentity = resolveExpectedOpenClawIdentity() } = {}) {
  let lastReachable = null;
  for (const url of endpoints) {
    try {
      const response = await fetchFn(url, { headers: { Accept: 'application/json,text/plain', 'Cache-Control': 'no-cache' } });
      const body = await response.text();
      const json = parseJsonLine(body);
      const identityPayload = extractOpenClawIdentityPayload(json || {}, body);
      const verification = verifyOpenClawIdentityPayload({ payload: identityPayload, expected: expectedIdentity, actualEndpoint: url });
      const identity = identityPayload.product || json?.service || json?.name || json?.app || body.slice(0, 200);
      const connectionStatus = json?.connectionStatus || json?.status || json?.health || (response.ok ? 'unknown' : 'unhealthy');
      const standaloneGatewayHealthVerified = response?.ok === true && json?.ok === true && json?.status === 'live' && /\/health$/i.test(String(url));
      const result = {
        url,
        reachable: Boolean(response?.ok),
        httpStatus: response?.status ?? null,
        identity,
        identityPayload,
        expectedEndpoint: verification.expected.endpoint,
        actualEndpoint: normalizeOpenClawEndpointUrl(url),
        body: body.slice(0, 500),
        identityVerified: response?.ok === true && (verification.verified || standaloneGatewayHealthVerified),
        identityMismatchReason: standaloneGatewayHealthVerified ? '' : verification.mismatchReason,
        identityVerification: verification,
        connectionStatus: /^(healthy|connected|ready|live)$/i.test(String(connectionStatus).trim()) ? 'healthy' : String(connectionStatus || 'unknown'),
      };
      if (result.identityVerified) return result;
      if (result.reachable && !lastReachable) lastReachable = result;
    } catch (error) {
      // Try the next known local endpoint before reporting unreachable.
    }
  }
  return lastReachable || { reachable: false, status: 'unreachable-or-unknown', identityVerified: false, connectionStatus: 'unknown', expectedEndpoint: expectedIdentity.endpoint, actualEndpoint: null, identityPayload: null, identityMismatchReason: 'endpoint-unreachable' };
}

export async function probeOpenClawEndpoint({ endpoints = DEFAULT_OPENCLAW_ENDPOINTS, fetchFn = globalThis.fetch, expectedIdentity = resolveExpectedOpenClawIdentity(), timeoutMs = 0, retryIntervalMs = 500 } = {}) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0));
  let last = null;
  do {
    last = await probeOpenClawEndpointOnce({ endpoints, fetchFn, expectedIdentity });
    if (last.identityVerified === true) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.max(0, Number(retryIntervalMs || 0))));
  } while (Date.now() <= deadline);
  return last;
}

function parseJsonArrayLine(value = '') {
  const parsed = parseJsonLine(value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return [parsed];
  return [];
}

export function discoverOpenClawStandaloneIdentityWithDeps({ captureStep = runStepCapture, platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') {
    return createOpenClawStandaloneDiscoveryPacket();
  }
  let candidateServices = [];
  let candidateProcesses = [];
  let candidatePorts = [];
  try {
    const result = captureStep('openclaw-standalone-service-discovery', 'powershell.exe', ['-NoProfile', '-Command', "Get-Service | Where-Object { $_.Name -match 'OpenClaw|openclaw' -or $_.DisplayName -match 'OpenClaw|openclaw' } | Select-Object Name,DisplayName,Status,ServiceType | ConvertTo-Json -Compress"]);
    candidateServices = parseJsonArrayLine(result.stdout).map((service) => ({ name: service.Name || service.name || '', displayName: service.DisplayName || service.displayName || '', status: String(service.Status || service.status || 'unknown'), serviceType: String(service.ServiceType || service.serviceType || 'unknown') }));
  } catch {}
  try {
    const result = captureStep('openclaw-standalone-process-discovery', 'powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'OpenClaw|openclaw' -or $_.CommandLine -match 'OpenClaw|openclaw' } | Select-Object ProcessId,Name,CommandLine,ExecutablePath | ConvertTo-Json -Compress"]);
    candidateProcesses = parseJsonArrayLine(result.stdout).map((processEntry) => ({ pid: processEntry.ProcessId || processEntry.pid || null, name: processEntry.Name || processEntry.name || '', commandLine: processEntry.CommandLine || processEntry.commandLine || '', executablePath: processEntry.ExecutablePath || processEntry.executablePath || '' }));
  } catch {}
  try {
    const result = captureStep('openclaw-standalone-port-discovery', 'powershell.exe', ['-NoProfile', '-Command', "$pids=(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'OpenClaw|openclaw' -or $_.CommandLine -match 'OpenClaw|openclaw' }).ProcessId; Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $pids -contains $_.OwningProcess } | Select-Object LocalAddress,LocalPort,OwningProcess,State | ConvertTo-Json -Compress"]);
    candidatePorts = parseJsonArrayLine(result.stdout).map((port) => ({ localAddress: port.LocalAddress || port.localAddress || '', localPort: port.LocalPort || port.localPort || null, owningProcess: port.OwningProcess || port.owningProcess || null, state: String(port.State || port.state || 'unknown') }));
  } catch {}
  const configuredLaunchTargets = ['OPENCLAW_PATH', 'OPENCLAW_COMMAND', 'OPENCLAW_LAUNCH_COMMAND', 'STEPHANOS_OPENCLAW_PATH', 'STEPHANOS_OPENCLAW_COMMAND']
    .filter((key) => typeof env[key] === 'string' && env[key].trim())
    .map((key) => ({ source: `env:${key}`, value: env[key].trim() }));
  return createOpenClawStandaloneDiscoveryPacket({ candidateServices, candidateProcesses, candidatePorts, configuredLaunchTargets });
}

export function probeOpenClawProcessWithDeps({ captureStep = runStepCapture, platform = process.platform, serviceName = DEFAULT_OPENCLAW_SERVICE_NAME } = {}) {
  if (platform !== 'win32') {
    return { process: { running: false, name: 'unsupported-platform' }, service: { running: false, name: serviceName, state: 'unsupported-platform' }, portOwner: { present: false, verified: false } };
  }
  let service = { running: false, name: serviceName, state: 'unknown', exists: false, verified: false };
  try {
    const result = captureStep('openclaw-service-query', 'sc.exe', ['query', serviceName]);
    const serviceExists = !/OpenService\s+FAILED\s+1060|does not exist as an installed service/i.test(`${result.stdout || ''} ${result.stderr || ''}`);
    const running = serviceExists && /STATE\s*:\s*\d+\s+RUNNING/i.test(result.stdout);
    service = { running, name: serviceName, displayName: serviceName, state: running ? 'running' : (serviceExists ? 'not-running' : 'missing'), exists: serviceExists, verified: serviceExists && serviceName === DEFAULT_OPENCLAW_SERVICE_NAME };
  } catch {
    service = { running: false, name: serviceName, state: 'missing', exists: false, verified: false };
  }
  let process = { running: service.running, name: serviceName, commandLine: '' };
  try {
    const result = captureStep('openclaw-process-query', 'powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'OpenClaw|openclaw' -or $_.CommandLine -match 'OpenClaw|openclaw' } | Select-Object -First 1 Name,CommandLine | ConvertTo-Json -Compress"]);
    const parsed = parseJsonLine(result.stdout);
    if (parsed?.Name || parsed?.CommandLine) process = { running: true, name: parsed.Name || serviceName, commandLine: parsed.CommandLine || '' };
  } catch {
    process = { running: service.running, name: serviceName, commandLine: '' };
  }
  const serviceIdentityOwnsProcess = service.exists === true && service.verified === true && process.running === true && /openclaw/i.test(`${process.name || ''} ${process.commandLine || ''}`) && !/openclaw-readonly-adapter-stub\.mjs/i.test(String(process.commandLine || ''));
  return { process, service, portOwner: { present: serviceIdentityOwnsProcess, verified: serviceIdentityOwnsProcess } };
}

function normalizeOpenClawGatewayBaseEndpoint(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/(?:identity|health|status)\/?$/i, '') || '/';
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/\/(?:identity|health|status)\/?$/i, '').replace(/\/$/, '');
  }
}

function buildOpenClawGatewayEndpointSet(baseEndpoint) {
  const base = normalizeOpenClawGatewayBaseEndpoint(baseEndpoint);
  if (!base) return [];
  return [`${base}/identity`, `${base}/health`, `${base}/status`];
}

function resolveConfiguredOpenClawGatewayEndpoint({ env = process.env } = {}) {
  const explicit = String(env.STEPHANOS_OPENCLAW_GATEWAY_ENDPOINT || '').trim();
  if (explicit) return { endpoint: normalizeOpenClawGatewayBaseEndpoint(explicit), source: 'env:STEPHANOS_OPENCLAW_GATEWAY_ENDPOINT' };
  const commandText = String(env.STEPHANOS_OPENCLAW_GATEWAY_COMMAND || '').trim();
  const portMatch = commandText.match(/(?:^|\s)--port(?:=|\s+)(\d{2,5})(?:\s|$)/i);
  if (portMatch) return { endpoint: `http://127.0.0.1:${portMatch[1]}`, source: 'env:STEPHANOS_OPENCLAW_GATEWAY_COMMAND:--port' };
  return { endpoint: OPENCLAW_GATEWAY_APPROVED_ENDPOINT, source: OPENCLAW_GATEWAY_STARTUP_SOURCE };
}

export function buildOpenClawReadinessEndpoints({ discovery = {}, defaultEndpoints = DEFAULT_OPENCLAW_ENDPOINTS, env = process.env } = {}) {
  const gatewayCandidate = findVerifiedOpenClawStandaloneGatewayCandidate(discovery);
  const configuredGateway = resolveConfiguredOpenClawGatewayEndpoint({ env });
  const endpointGroups = [];
  let selectedGatewayEndpoint = '';
  let selectedGatewayEndpointSource = '';
  if (configuredGateway.endpoint) {
    endpointGroups.push(...buildOpenClawGatewayEndpointSet(configuredGateway.endpoint));
    selectedGatewayEndpoint = configuredGateway.endpoint;
    selectedGatewayEndpointSource = configuredGateway.source;
  }
  if (gatewayCandidate?.candidatePort) {
    const discoveredEndpoint = `http://127.0.0.1:${gatewayCandidate.candidatePort}`;
    endpointGroups.push(...buildOpenClawGatewayEndpointSet(discoveredEndpoint));
    if (!selectedGatewayEndpoint) {
      selectedGatewayEndpoint = discoveredEndpoint;
      selectedGatewayEndpointSource = 'discovery:standalone-gateway-port';
    }
  }
  endpointGroups.push(...defaultEndpoints);
  const endpoints = [...new Set(endpointGroups.map((endpoint) => normalizeOpenClawEndpointUrl(endpoint)).filter(Boolean))];
  if (!selectedGatewayEndpoint) {
    selectedGatewayEndpoint = normalizeOpenClawGatewayBaseEndpoint(defaultEndpoints[0] || DEFAULT_OPENCLAW_IDENTITY_ENDPOINT);
    selectedGatewayEndpointSource = 'default-fallback';
  }
  return { endpoints, gatewayCandidate, selectedGatewayEndpoint, selectedGatewayEndpointSource };
}

export async function evaluateOpenClawStartupConnectRecoveryWithDeps({ captureStep = runStepCapture, runStepFn = runStep, fetchFn = globalThis.fetch, argvArgs = args, platform = process.platform, env = process.env, log = (message) => console.log(message) } = {}) {
  const discovery = discoverOpenClawStandaloneIdentityWithDeps({ captureStep, platform });
  log(`[IGNITION] openclaw-standalone-discovery=${JSON.stringify(discovery)}`);
  const { endpoints, gatewayCandidate, selectedGatewayEndpoint, selectedGatewayEndpointSource } = buildOpenClawReadinessEndpoints({ discovery, env });
  const expectedIdentity = resolveExpectedOpenClawIdentity({ env, endpoint: endpoints[0] || DEFAULT_OPENCLAW_IDENTITY_ENDPOINT, endpointSource: selectedGatewayEndpointSource });
  const base = probeOpenClawProcessWithDeps({ captureStep, platform });
  const endpoint = await probeOpenClawEndpoint({ endpoints, fetchFn, expectedIdentity });
  let readiness = { ...base, endpoint, standaloneGatewayCandidate: gatewayCandidate, candidatePort: gatewayCandidate?.candidatePort || null, selectedReadinessEndpoint: endpoint.url || null, selectedGatewayEndpoint, selectedGatewayEndpointSource, adapterOnly: gatewayCandidate?.verified === true ? 'no' : undefined, restartCommandAllowed: false, safeRestartTarget: 'none' };
  let packet = buildOpenClawStartupRecoveryPacket(readiness);
  const classification = classifyOpenClawReadiness(readiness);
  const readinessIdentity = classification.state === 'openclaw-standalone-gateway-live' || classification.state === 'openclaw-standalone-gateway'
    ? 'standalone-gateway'
    : classification.state === 'openclaw-standalone-gateway-candidate'
      ? 'standalone-gateway-candidate'
      : readiness.endpoint?.identity || null;
  readiness = { ...readiness, identity: readinessIdentity, endpointIdentityVerified: classification.endpointIdentityVerified === true || readiness.endpoint?.identityVerified === true, connectionVerdict: classification.connectionVerdict || classification.state, openClawExecutionAllowed: false, mutationAllowed: false, restartCommandAllowed: false, safeRestartTarget: classification.safeRestartTarget || 'none' };
  log(`[IGNITION] openclaw-startup-readiness=${JSON.stringify({ state: classification.state, healthy: classification.healthy, candidatePort: readiness.candidatePort, selectedReadinessEndpoint: readiness.selectedReadinessEndpoint, identity: readiness.identity, endpointIdentity: readiness.endpoint?.identity || null, connectionVerdict: classification.connectionVerdict || classification.state, openClawExecutionAllowed: false, mutationAllowed: false, safeRestartTarget: readiness.safeRestartTarget, adapterOnly: readiness.adapterOnly || (classification.state === 'openclaw-adapter-only' ? 'yes' : 'no'), restartCommandAllowed: false, readiness })}`);
  if (!packet) return { healthy: true, state: classification.state, readiness };
  log(`[IGNITION] openclaw-recovery-packet=${JSON.stringify(packet)}`);

  const argSet = argvArgs instanceof Set ? argvArgs : new Set(Array.from(argvArgs || []));
  if (!packet.desktopApproval || !argSet.has(OPENCLAW_STARTUP_RESTART_FLAG)) {
    throw new Error(`blocked for safety: ${packet.reason}. ${packet.recommendedRestartAction} CLI approval path: npm run stephanos:ignite -- ${OPENCLAW_STARTUP_RESTART_FLAG}`);
  }
  const approvedClassification = classifyOpenClawReadiness(readiness);
  if (approvedClassification.state !== 'openclaw-service-running-not-connected' || packet.desktopApproval?.buttonLabel !== 'Restart OpenClaw service') {
    throw new Error(`blocked for safety: OpenClaw service identity is not verified for approved restart (${packet.reason}).`);
  }
  runStepFn('openclaw-service-stop-approved', 'sc.exe', ['stop', DEFAULT_OPENCLAW_SERVICE_NAME]);
  runStepFn('openclaw-service-start-approved', 'sc.exe', ['start', DEFAULT_OPENCLAW_SERVICE_NAME]);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 2500));
  const recoveryEndpoint = await probeOpenClawEndpoint({ endpoints, fetchFn });
  readiness = { ...probeOpenClawProcessWithDeps({ captureStep, platform }), endpoint: recoveryEndpoint, standaloneGatewayCandidate: gatewayCandidate, candidatePort: gatewayCandidate?.candidatePort || null, selectedReadinessEndpoint: recoveryEndpoint.url || null, adapterOnly: gatewayCandidate?.verified === true ? 'no' : undefined, restartCommandAllowed: false, safeRestartTarget: 'none' };
  packet = buildOpenClawStartupRecoveryPacket(readiness);
  if (packet) {
    log(`[IGNITION] openclaw-recovery-result=${JSON.stringify(packet)}`);
    throw new Error(`blocked for safety: health remains unhealthy after approved OpenClaw restart (${packet.reason}).`);
  }
  log(`[IGNITION] openclaw-recovery-result=${JSON.stringify({ ignitionStatus: 'READY', connectionVerdict: 'connected-healthy' })}`);
  return { healthy: true, state: 'connected-healthy', recoveryApplied: true, readiness };
}

export function runIgnitionHousekeep({ dryRun = false, compact = false, debug = false, captureStepFn = runStepCapture, runStepFn = runStep, moveRootOpenClawWorkspaceDirtFn = moveRootOpenClawWorkspaceDirt } = {}) {
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
  let openClawMoveResult = { destinationRoot: resolveOpenClawWorkspaceRepairPath(), migrationDirectory: null, moved: [], skipped: [] };
  if (!dryRun && movableRootOpenClawDirt.length > 0) {
    openClawMoveResult = moveRootOpenClawWorkspaceDirtFn({ paths: movableRootOpenClawDirt });
    const movedRootPaths = new Set(openClawMoveResult.moved.map((entry) => normalizeRootCandidatePath(entry.path)));
    hardBlockTargets = hardBlockTargets.filter((path) => !movedRootPaths.has(normalizeRootCandidatePath(path)));
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
    try {
      const restartReport = await ensureLocalStaticServerRestartWithDeps({
        expectedMetadata: preflightState.expectedMetadata,
      });
      console.error(`[IGNITION PREFLIGHT] stale server restart requested=${JSON.stringify(restartReport)}`);
    } catch (error) {
      console.error(`[IGNITION PREFLIGHT] stale server restart failed: ${error.message}`);
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

      if (ignitionMode === 'NORMAL_IGNITION' && process.platform === 'win32') {
        await evaluateOpenClawRuntimeAutostartWithDeps();
      } else if (ignitionMode === 'NORMAL_IGNITION') {
        console.log('[IGNITION] OpenClaw startup connect recovery skipped (non-Windows desktop service probe unavailable).');
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
      const servedCommit = refreshedState.distMetadata?.gitCommit || 'missing';
      const sourceFingerprint = refreshedState.distMetadata?.sourceFingerprint || refreshedState.expectedMetadata?.sourceFingerprint || 'missing';
      const buildTimestamp = refreshedState.distMetadata?.buildTimestamp || 'missing';
      const currentCommit = normalizeCaptureStdout(runStepCapture('git-current-commit-pre-serve', 'git', ['rev-parse', '--short', 'HEAD']));
      let originMainCommit = currentCommit;
      try {
        originMainCommit = normalizeCaptureStdout(runStepCapture('git-origin-main-commit-pre-serve', 'git', ['rev-parse', '--short', 'origin/main']));
      } catch {
        originMainCommit = currentCommit;
      }
      const expectedSourceCommit = currentCommit;
      const distFreshness = evaluateDistFreshnessAgainstOrigin({
        distMetadata: refreshedState.distMetadata,
        currentCommit,
        originMainCommit: expectedSourceCommit,
      });
      console.log(`[IGNITION] runtime-footer-truth=${JSON.stringify({
        servedCommit,
        expectedSourceCommit,
        originMainCommit,
        buildTimestamp,
        sourceFingerprint,
      })}`);
      console.log(`[IGNITION] dist-freshness-status=${JSON.stringify(distFreshness)}`);
      if (distFreshness.ignitionStatus === 'BLOCKED') {
        console.error('[IGNITION] stale dist blocked before serve');
        console.error(`[IGNITION] repair-packet=${JSON.stringify(distFreshness)}`);
        throw new Error(`blocked for safety: ${distFreshness.reason}. ${distFreshness.nextSafeAction}`);
      }
      const restartReport = await ensureLocalStaticServerRestartWithDeps({
        expectedMetadata: refreshedState.distMetadata || refreshedState.expectedMetadata,
        verifyServedAfterStart: true,
      });
      const cockpit = projectIgnitionCockpit({
        buildPassed: buildAction.startsWith('passed'),
        verifyPassed: verifyResult === 'passed',
        serverStarted: restartReport.serverStarted === true,
        sourceProof: { beforeCommit: publicationTruth?.beforeCommit || null, afterCommit: publicationTruth?.afterCommit || expectedSourceCommit, originMainCommit, headPublished: publicationTruth?.headPublished ?? null, publicationState: publicationTruth?.publicationState || null, behindCount: publicationTruth?.behindCount ?? null },
        servedProof: {
          healthProbePass: restartReport.serverStarted === true,
          runtimeMarkerMatches: restartReport.servedRuntimeMatchesExpectedDistMetadata === true,
          moduleMimeChecksPass: restartReport.moduleMimeChecksPass === true,
          servedCommit: restartReport.servedCommit,
          expectedSourceCommit,
          servedBuildTimestamp: restartReport.servedBuildTimestamp,
          servedSourceFingerprint: restartReport.servedSourceFingerprint,
        },
        stages: [
          { id: 'source-update', label: 'Source update', status: 'complete', detail: `state=${publicationTruth?.publicationState || 'unknown'} behind=${publicationTruth?.behindCount ?? 'unknown'} before=${publicationTruth?.beforeCommit || 'unknown'} after=${publicationTruth?.afterCommit || expectedSourceCommit}` },
          { id: 'build', label: 'Build', status: buildAction.startsWith('passed') ? 'passed' : 'pending', detail: buildAction },
          { id: 'verify', label: 'Verify', status: verifyResult === 'passed' ? 'passed' : 'pending', detail: verifyResult },
          { id: 'restart', label: 'Restart 4173', status: restartReport.serverStarted ? 'complete' : 'pending', detail: `previous=${restartReport.previousServerStatus}; stopped=${restartReport.serverStopped}; started=${restartReport.serverStarted}` },
          { id: 'served-proof', label: 'Served runtime proof', status: restartReport.servedRuntimeMatchesExpectedDistMetadata ? 'passed' : 'pending', detail: `markerAndMime=${restartReport.servedRuntimeMatchesExpectedDistMetadata}; mime=${restartReport.moduleMimeChecksPass}` },
        ],
      });
      const finalStatus = {
        ignitionMode,
        IgnitionCleanlinessVerdict: verifyResult === 'passed' ? 'READY' : 'HELD',
        PRGuardStatus: ignitionMode === 'PR_CLEAN_ROOM' ? 'enforced' : 'not-applicable',
        servedCommit,
        expectedSourceCommit,
        originMainCommit,
        buildTimestamp,
        sourceFingerprint,
        staticServerRestart: restartReport,
        StartupDecision: cockpit.readyToEnterStephanos ? 'START_READY' : 'START_PROOF_PENDING',
        ignitionCockpit: cockpit,
      };
      if (!cockpit.readyToEnterStephanos) {
        console.log(`[IGNITION] cockpit-status=${JSON.stringify(cockpit)}`);
      }
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
