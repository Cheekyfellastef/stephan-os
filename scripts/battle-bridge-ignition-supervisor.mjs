#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { refreshBattleBridgeSharedWorkspacePublisher } from './battle-bridge-shared-workspace-publisher.mjs';
import { collectLauncherReadinessLiveFacts, defaultWindowsSharedWorkspacePath } from './launcher-readiness-live-facts.mjs';
import { planLauncherReadiness } from './launcher-readiness-planner.mjs';
import { runUi4173Repair, UI_4173_REPAIR_AUTHORITY } from './battle-bridge-ui-4173-repair.mjs';
import {
  collectIgnoredRuntimeAggregatePaths,
  evaluateGitStatusForIgnition,
  mergeIgnoredRuntimeChildrenIntoStatus,
  runIgnitionHousekeep,
  scanIgnoredRuntimeAggregatePathsForBlockers,
} from './ignite-stephanos-local.mjs';
import { buildOpenClawGatewayStartupTarget, OPENCLAW_GATEWAY_STARTUP_SOURCE, resolveOpenClawGatewayStartupExecution } from '../shared/agents/openClawGatewayStartup.mjs';
import {
  BATTLE_BRIDGE_CANONICAL_REMOTE_URL,
  battleBridgeCanonicalRepositoryArgs,
  createBattleBridgeMinimalChildEnvironment,
  inspectBattleBridgeGitTopology,
  resolveBattleBridgeGitExecution,
  validateBattleBridgeLocalGitConfiguration,
} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';

export const BATTLE_BRIDGE_IGNITION_SUPERVISOR_SCHEMA = 'stephanos.battle-bridge-ignition-supervisor.v1';
export const BATTLE_BRIDGE_IGNITION_PHASES = Object.freeze([
  'source truth',
  'housekeeping',
  'shared workspace publisher',
  'backend 8787',
  'OpenClaw gateway 18789',
  'Stephanos UI 4173',
  'browser/runtime proof',
  'ready',
]);
export const BATTLE_BRIDGE_IGNITION_PHASE_STATES = Object.freeze(['pending', 'running', 'ready', 'degraded', 'blocked', 'failed']);
export const BACKEND_8787_START_COMMAND_IDENTITY = Object.freeze({
  id: 'npm-script:stephanos:battle-bridge:repair',
  commandText: 'npm run stephanos:battle-bridge:repair',
  source: 'package.json#scripts.stephanos:battle-bridge:repair',
  purpose: 'repair/start the Battle Bridge backend listener on 8787 through the existing source-controlled backend repair path',
});
export const BATTLE_BRIDGE_IGNITION_AUTHORITY = Object.freeze({
  executesArbitraryShell: false,
  killsProcesses: true,
  mutatesOpenClaw: true,
  mergesOrPushes: false,
  installsDependencies: false,
  switchesBranches: false,
  deletesRuntimeData: false,
  uiRepairAuthority: UI_4173_REPAIR_AUTHORITY,
  backendStartCommandIdentity: BACKEND_8787_START_COMMAND_IDENTITY,
  openClawGatewayStartupSource: OPENCLAW_GATEWAY_STARTUP_SOURCE,
});

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SHA40 = /^[0-9a-f]{40}$/;
const SOURCE_STATUS_ARGS = Object.freeze(['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']);

export function evaluateBattleBridgeMutationHeadBinding({ expectedHead = '', observedHead = '' } = {}) {
  const expected = String(expectedHead || '').trim().toLowerCase();
  const observed = String(observedHead || '').trim().toLowerCase();
  return Object.freeze({
    ok: SHA40.test(expected) && SHA40.test(observed) && observed === expected,
    expectedHead: expected,
    observedHead: observed,
  });
}

function structuredSourceTruthBlocker({
  id = 'source-truth-unproven',
  code = 'CANONICAL_SOURCE_TRUTH_UNPROVEN',
  detail = 'Canonical source truth could not be proven through the fixed Git boundary.',
  publicationState = 'source-truth-unproven',
  branch = '',
  upstreamBranch = '',
  head = '',
  originHead = '',
  aheadCount = 0,
  behindCount = 0,
  workingTreeDirty = false,
  statusAssessment = null,
  extra = {},
} = {}) {
  return Object.freeze({
    ok: false,
    branch,
    detachedHead: branch === '',
    hasUpstream: Boolean(upstreamBranch),
    upstreamBranch,
    workingTreeDirty,
    aheadCount,
    behindCount,
    headPublished: false,
    blockedForRemoteTruth: true,
    publicationState,
    head,
    originHead,
    statusAssessment,
    blocker: Object.freeze({
      id,
      code,
      detail,
      nextOperatorAction: 'Use the bounded Battle Bridge source-recovery route to restore a clean canonical main checkout, then retry Ignition.',
    }),
    ...extra,
  });
}

function sameStableGitTopology(left = {}, right = {}) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function evaluateTrackedVisibility(output = '') {
  const hidden = String(output || '').split(/\r?\n/).filter((line) => (
    /^S\s/.test(line) || /^[a-z]\s/.test(line)
  ));
  return Object.freeze({
    ok: hidden.length === 0,
    blocker: hidden.length === 0 ? '' : 'HIDDEN_TRACKED_PATHS_PRESENT',
    hiddenCount: hidden.length,
  });
}

export function collectCanonicalIgnitionSourceTruth({
  cwd = defaultRepoRoot,
  environment = process.env,
  platform = process.platform,
  spawnSyncFn = spawnSync,
  inspectTopologyFn = inspectBattleBridgeGitTopology,
  validateConfigurationFn = validateBattleBridgeLocalGitConfiguration,
  evaluateStatusFn = evaluateGitStatusForIgnition,
  scanIgnoredRuntimeAggregatePathsFn = scanIgnoredRuntimeAggregatePathsForBlockers,
} = {}) {
  const topologyBefore = inspectTopologyFn(cwd, { stabilizeIndex: true });
  if (!topologyBefore?.ok) {
    return structuredSourceTruthBlocker({
      code: topologyBefore?.blocker || 'CANONICAL_GIT_TOPOLOGY_UNPROVEN',
      detail: 'Canonical repository topology could not be proven before source inspection.',
      extra: { topology: topologyBefore || null },
    });
  }

  let gitExecution = null;
  const capture = (label, args, { allowFailure = false } = {}) => {
    gitExecution ||= resolveBattleBridgeGitExecution({ platform, environment });
    const fixedArgs = [
      ...gitExecution.fixedConfigArgs,
      ...battleBridgeCanonicalRepositoryArgs(cwd),
      ...args,
    ];
    const result = spawnSyncFn(gitExecution.executable, fixedArgs, {
      cwd,
      env: gitExecution.environment,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 120_000,
    });
    if (result?.error || result?.status !== 0) {
      if (allowFailure) return null;
      const error = new Error(`${label}:${result?.error?.message || result?.status || 'UNKNOWN_FIXED_GIT_FAILURE'}`);
      error.code = 'FIXED_AUTHORITY_GIT_FAILED';
      throw error;
    }
    return String(result?.stdout || '');
  };
  const captureSourceStatus = (label) => {
    const statusOutput = capture(label, [...SOURCE_STATUS_ARGS]);
    const ignoredRuntimeAggregates = collectIgnoredRuntimeAggregatePaths(statusOutput);
    if (ignoredRuntimeAggregates.length === 0) return statusOutput;
    const ignoredRuntimeBlockers = scanIgnoredRuntimeAggregatePathsFn({
      repoRoot: cwd,
      aggregatePaths: ignoredRuntimeAggregates,
    });
    return mergeIgnoredRuntimeChildrenIntoStatus(statusOutput, ignoredRuntimeBlockers);
  };

  try {
    const configurationBefore = capture('source-config-before-fetch', ['config', '--local', '--null', '--list']);
    const configurationProof = validateConfigurationFn(configurationBefore);
    if (!configurationProof?.ok) {
      return structuredSourceTruthBlocker({
        code: configurationProof?.blocker || 'CANONICAL_GIT_CONFIGURATION_INVALID',
        detail: 'Local Git configuration or origin identity is outside the canonical closed-world policy.',
        extra: { configurationProof: configurationProof || null },
      });
    }

    const trackedVisibilityBeforeOutput = capture('source-tracked-visibility-before-fetch', ['ls-files', '--stage', '-v', '--']);
    const trackedVisibilityBefore = evaluateTrackedVisibility(trackedVisibilityBeforeOutput);
    if (!trackedVisibilityBefore.ok) {
      return structuredSourceTruthBlocker({
        id: 'hidden-tracked-source-truth',
        code: trackedVisibilityBefore.blocker,
        detail: 'Skip-worktree or assume-unchanged flags hide tracked paths before canonical source proof.',
        extra: { trackedVisibilityProof: trackedVisibilityBefore },
      });
    }

    const statusBeforeOutput = captureSourceStatus('source-status-before-fetch');
    const statusBefore = evaluateStatusFn(statusBeforeOutput);
    if (!statusBefore || !Array.isArray(statusBefore.meaningfulEntries)) {
      return structuredSourceTruthBlocker({
        code: 'CANONICAL_SOURCE_STATUS_INVALID',
        detail: 'Canonical source status could not be classified before fetch.',
      });
    }
    if (statusBefore.meaningfulEntries.length > 0) {
      return structuredSourceTruthBlocker({
        id: 'dirty-source-truth',
        code: 'CANONICAL_CHECKOUT_DIRTY',
        detail: 'Source-owned checkout dirt blocks the canonical fetch before any Git mutation.',
        publicationState: 'local-uncommitted',
        workingTreeDirty: true,
        statusAssessment: statusBefore,
      });
    }

    const branchBefore = capture('source-branch-before-fetch', ['branch', '--show-current']).trim();
    const upstreamBefore = String(capture(
      'source-upstream-before-fetch',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      { allowFailure: true },
    ) || '').trim();
    const headBefore = capture('source-head-before-fetch', ['rev-parse', 'HEAD']).trim().toLowerCase();
    if (branchBefore !== 'main' || !SHA40.test(headBefore)) {
      return structuredSourceTruthBlocker({
        id: branchBefore ? 'non-main-source-truth' : 'detached-source-truth',
        code: 'CANONICAL_MAIN_SOURCE_UNPROVEN',
        detail: 'The checkout is not canonical main at a full lowercase Git head.',
        branch: branchBefore,
        upstreamBranch: upstreamBefore,
        head: headBefore,
      });
    }
    if (upstreamBefore !== 'origin/main') {
      return structuredSourceTruthBlocker({
        id: 'noncanonical-upstream-source-truth',
        code: 'CANONICAL_UPSTREAM_UNPROVEN',
        detail: 'Canonical main does not track exactly origin/main.',
        branch: branchBefore,
        upstreamBranch: upstreamBefore,
        head: headBefore,
      });
    }

    // Repeat-safe authority invariant: pruning an explicit URL refspec can delete
    // the destination tracking ref on the next proof instead of refreshing it.
    capture('source-fetch', [
      'fetch',
      BATTLE_BRIDGE_CANONICAL_REMOTE_URL,
      'refs/heads/main:refs/remotes/origin/main',
    ]);
    const originHead = capture('source-origin-head', ['rev-parse', 'origin/main']).trim().toLowerCase();
    const divergence = capture('source-divergence', ['rev-list', '--left-right', '--count', `HEAD...${originHead}`]).trim();
    const divergenceParts = divergence.split(/\s+/);
    const aheadCount = Number.parseInt(divergenceParts[0], 10);
    const behindCount = Number.parseInt(divergenceParts[1], 10);
    if (!SHA40.test(originHead)
        || divergenceParts.length !== 2
        || !Number.isSafeInteger(aheadCount) || aheadCount < 0
        || !Number.isSafeInteger(behindCount) || behindCount < 0) {
      return structuredSourceTruthBlocker({
        code: 'CANONICAL_REMOTE_TRUTH_INVALID',
        detail: 'The fixed canonical fetch did not yield a valid origin/main and divergence proof.',
        branch: branchBefore,
        head: headBefore,
        originHead,
      });
    }

    const statusAfterOutput = captureSourceStatus('source-status-after-fetch');
    const statusAfter = evaluateStatusFn(statusAfterOutput);
    const configurationAfter = capture('source-config-after-fetch', ['config', '--local', '--null', '--list']);
    const configurationAfterProof = validateConfigurationFn(configurationAfter);
    const branchAfter = capture('source-branch-after-fetch', ['branch', '--show-current']).trim();
    const upstreamAfter = String(capture(
      'source-upstream-after-fetch',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      { allowFailure: true },
    ) || '').trim();
    const headAfter = capture('source-head-after-fetch', ['rev-parse', 'HEAD']).trim().toLowerCase();
    const originHeadAfter = capture('source-origin-head-after-fetch', ['rev-parse', 'origin/main']).trim().toLowerCase();
    const trackedVisibilityAfterOutput = capture('source-tracked-visibility-after-fetch', ['ls-files', '--stage', '-v', '--']);
    const trackedVisibilityAfter = evaluateTrackedVisibility(trackedVisibilityAfterOutput);
    const topologyAfter = inspectTopologyFn(cwd, { stabilizeIndex: true });

    if (!topologyAfter?.ok || !sameStableGitTopology(topologyAfter.stableIdentities, topologyBefore.stableIdentities)) {
      return structuredSourceTruthBlocker({
        code: topologyAfter?.blocker || 'CANONICAL_GIT_TOPOLOGY_CHANGED',
        detail: 'Canonical Git metadata topology changed during source proof.',
        branch: branchAfter,
        upstreamBranch: upstreamAfter,
        head: headAfter,
        originHead: originHeadAfter,
      });
    }
    if (!configurationAfterProof?.ok || configurationAfter !== configurationBefore) {
      return structuredSourceTruthBlocker({
        code: configurationAfterProof?.blocker || 'CANONICAL_GIT_CONFIGURATION_CHANGED',
        detail: 'Canonical Git configuration changed during source proof.',
        branch: branchAfter,
        upstreamBranch: upstreamAfter,
        head: headAfter,
        originHead: originHeadAfter,
        extra: { configurationProof: configurationAfterProof || null },
      });
    }
    if (!trackedVisibilityAfter.ok || trackedVisibilityAfterOutput !== trackedVisibilityBeforeOutput) {
      return structuredSourceTruthBlocker({
        id: 'hidden-tracked-source-truth',
        code: trackedVisibilityAfter.blocker || 'CANONICAL_TRACKED_VISIBILITY_CHANGED',
        detail: trackedVisibilityAfter.ok
          ? 'The canonical tracked-file visibility set changed during source proof.'
          : 'Skip-worktree or assume-unchanged flags appeared during canonical source proof.',
        branch: branchAfter,
        upstreamBranch: upstreamAfter,
        head: headAfter,
        originHead: originHeadAfter,
        extra: { trackedVisibilityProof: trackedVisibilityAfter },
      });
    }
    if (!statusAfter || !Array.isArray(statusAfter.meaningfulEntries) || statusAfter.meaningfulEntries.length > 0) {
      return structuredSourceTruthBlocker({
        id: 'dirty-source-truth',
        code: 'CANONICAL_CHECKOUT_DIRTY',
        detail: 'Source-owned checkout dirt appeared during the canonical fetch proof.',
        publicationState: 'local-uncommitted',
        branch: branchAfter,
        upstreamBranch: upstreamAfter,
        head: headAfter,
        originHead: originHeadAfter,
        workingTreeDirty: true,
        statusAssessment: statusAfter || null,
      });
    }
    if (branchAfter !== branchBefore
        || upstreamAfter !== upstreamBefore
        || upstreamAfter !== 'origin/main'
        || headAfter !== headBefore
        || originHeadAfter !== originHead) {
      return structuredSourceTruthBlocker({
        code: 'CANONICAL_SOURCE_TRUTH_CHANGED',
        detail: 'Branch or head truth changed during the canonical source proof.',
        branch: branchAfter,
        upstreamBranch: upstreamAfter,
        head: headAfter,
        originHead: originHeadAfter,
        aheadCount,
        behindCount,
      });
    }

    if (originHead !== headBefore || aheadCount !== 0 || behindCount !== 0) {
      const publicationState = aheadCount > 0 && behindCount > 0
        ? 'diverged'
        : (aheadCount > 0 ? 'unpublished-local-only' : 'stale-behind');
      return structuredSourceTruthBlocker({
        id: behindCount > 0 && aheadCount === 0 ? 'stale-source-truth' : 'unpublished-source-truth',
        code: 'CANONICAL_MAIN_NOT_CURRENT',
        detail: 'Canonical main is not exactly synchronized with the freshly fetched origin/main.',
        publicationState,
        branch: branchAfter,
        upstreamBranch: upstreamAfter,
        head: headAfter,
        originHead: originHeadAfter,
        aheadCount,
        behindCount,
        statusAssessment: statusAfter,
      });
    }

    const statusFinalOutput = captureSourceStatus('source-status-final');
    const statusFinal = evaluateStatusFn(statusFinalOutput);
    const trackedVisibilityFinalOutput = capture('source-tracked-visibility-final', ['ls-files', '--stage', '-v', '--']);
    const trackedVisibilityFinal = evaluateTrackedVisibility(trackedVisibilityFinalOutput);
    const topologyFinal = inspectTopologyFn(cwd, { stabilizeIndex: true });
    if (!topologyFinal?.ok || !sameStableGitTopology(topologyFinal.stableIdentities, topologyBefore.stableIdentities)) {
      return structuredSourceTruthBlocker({
        code: topologyFinal?.blocker || 'CANONICAL_GIT_TOPOLOGY_CHANGED',
        detail: 'Canonical Git metadata topology changed at the final source boundary.',
        branch: branchAfter,
        upstreamBranch: upstreamAfter,
        head: headAfter,
        originHead: originHeadAfter,
      });
    }
    if (!statusFinal || !Array.isArray(statusFinal.meaningfulEntries) || statusFinal.meaningfulEntries.length > 0) {
      return structuredSourceTruthBlocker({
        id: 'dirty-source-truth',
        code: 'CANONICAL_CHECKOUT_DIRTY',
        detail: 'Source-owned checkout dirt appeared during the final canonical source boundary.',
        publicationState: 'local-uncommitted',
        branch: branchAfter,
        upstreamBranch: upstreamAfter,
        head: headAfter,
        originHead: originHeadAfter,
        workingTreeDirty: true,
        statusAssessment: statusFinal || null,
      });
    }
    if (!trackedVisibilityFinal.ok
        || trackedVisibilityFinalOutput !== trackedVisibilityBeforeOutput
        || trackedVisibilityFinalOutput !== trackedVisibilityAfterOutput) {
      return structuredSourceTruthBlocker({
        id: 'hidden-tracked-source-truth',
        code: trackedVisibilityFinal.blocker || 'CANONICAL_TRACKED_VISIBILITY_CHANGED',
        detail: trackedVisibilityFinal.ok
          ? 'The canonical tracked-file visibility set changed at the final source boundary.'
          : 'Skip-worktree or assume-unchanged flags appeared at the final canonical source boundary.',
        branch: branchAfter,
        upstreamBranch: upstreamAfter,
        head: headAfter,
        originHead: originHeadAfter,
        extra: { trackedVisibilityProof: trackedVisibilityFinal },
      });
    }

    const finalHeadLines = capture(
      'source-heads-final',
      ['rev-parse', 'HEAD', 'origin/main'],
    ).trim().toLowerCase().split(/\r?\n/).map((value) => value.trim());
    const [headFinal = '', originHeadFinal = ''] = finalHeadLines;
    if (finalHeadLines.length !== 2
        || !SHA40.test(headFinal)
        || !SHA40.test(originHeadFinal)
        || headFinal !== headBefore
        || originHeadFinal !== originHead
        || headFinal !== originHeadFinal) {
      return structuredSourceTruthBlocker({
        code: 'CANONICAL_SOURCE_TRUTH_CHANGED',
        detail: 'Local main or fetched origin/main changed at the final canonical source boundary.',
        branch: branchAfter,
        upstreamBranch: upstreamAfter,
        head: headFinal,
        originHead: originHeadFinal,
        aheadCount,
        behindCount,
      });
    }

    return Object.freeze({
      ok: true,
      branch: 'main',
      detachedHead: false,
      hasUpstream: true,
      upstreamBranch: 'origin/main',
      workingTreeDirty: false,
      aheadCount: 0,
      behindCount: 0,
      headPublished: true,
      blockedForRemoteTruth: false,
      publicationState: 'healthy-synced',
      head: headFinal,
      originHead: originHeadFinal,
      statusAssessment: statusFinal,
      runtimeOnlyDirt: Object.freeze([
        ...(statusFinal.runtimeStateEntries || []),
        ...(statusFinal.transientRootDataEntries || []),
        ...(statusFinal.approvedEntries || []),
      ]),
    });
  } catch (error) {
    return structuredSourceTruthBlocker({
      code: error?.code || 'CANONICAL_SOURCE_TRUTH_UNPROVEN',
      detail: `Canonical source truth could not be proven through fixed Git (${error?.message || 'unknown failure'}).`,
      extra: { error: error?.message || String(error) },
    });
  }
}

export function evaluateCanonicalIgnitionSourceTruth(sourceTruth = {}) {
  if (sourceTruth?.blocker) return Object.freeze({ ok: false, blocker: sourceTruth.blocker, sourceTruth });

  const publicationState = String(sourceTruth?.publicationState || 'source-truth-unproven');
  const branch = String(sourceTruth?.branch || '');
  const upstreamBranch = String(sourceTruth?.upstreamBranch || '');
  const head = String(sourceTruth?.head || '').trim().toLowerCase();
  const originHead = String(sourceTruth?.originHead || '').trim().toLowerCase();
  const canonical = publicationState === 'healthy-synced'
    && branch === 'main'
    && sourceTruth?.detachedHead === false
    && sourceTruth?.hasUpstream === true
    && upstreamBranch === 'origin/main'
    && sourceTruth?.workingTreeDirty === false
    && Number(sourceTruth?.aheadCount) === 0
    && Number(sourceTruth?.behindCount) === 0
    && sourceTruth?.headPublished === true
    && sourceTruth?.blockedForRemoteTruth === false
    && SHA40.test(head)
    && originHead === head;

  if (canonical) return Object.freeze({ ok: true, publicationState, sourceTruth });

  let id = 'source-truth-unproven';
  if (publicationState === 'source-truth-unproven') id = 'source-truth-unproven';
  else if (sourceTruth?.detachedHead === true) id = 'detached-source-truth';
  else if (branch && branch !== 'main') id = 'non-main-source-truth';
  else if (sourceTruth?.hasUpstream !== true || upstreamBranch !== 'origin/main') id = 'noncanonical-upstream-source-truth';
  else if (sourceTruth?.workingTreeDirty === true || publicationState === 'local-uncommitted') id = 'dirty-source-truth';
  else if (!SHA40.test(head) || originHead !== head) id = 'source-head-truth-unproven';
  else if (publicationState === 'diverged' || Number(sourceTruth?.aheadCount) > 0 || sourceTruth?.blockedForRemoteTruth === true) id = 'unpublished-source-truth';
  else if (publicationState === 'stale-behind' || Number(sourceTruth?.behindCount) > 0) id = 'stale-source-truth';
  else if (publicationState !== 'healthy-synced') id = 'unpublished-source-truth';

  return Object.freeze({
    ok: false,
    sourceTruth,
    blocker: Object.freeze({
      id,
      detail: `Canonical Ignition source truth is not exact main tracking origin/main at one clean synchronized full head (state=${publicationState}).`,
      nextOperatorAction: sourceTruth?.operatorAction
        || 'Use the existing bounded Battle Bridge sync/recovery path to preserve local state and converge canonical main, then retry Ignition.',
    }),
  });
}

export function captureCanonicalSupervisorHousekeepGitStep(label, command, args, {
  cwd = defaultRepoRoot,
  environment = process.env,
  platform = process.platform,
  spawnSyncFn = spawnSync,
} = {}) {
  const gitExecution = resolveBattleBridgeGitExecution({ platform, environment });
  const gitExecutable = gitExecution.executable;
  if (command !== 'git' && command !== gitExecutable && command !== BATTLE_BRIDGE_WINDOWS_HOST.git) {
    throw new Error('BATTLE_BRIDGE_HOUSEKEEP_COMMAND_NOT_ALLOWED');
  }
  const result = spawnSyncFn(gitExecutable, [
    ...gitExecution.fixedConfigArgs,
    ...battleBridgeCanonicalRepositoryArgs(cwd),
    ...args,
  ], {
    cwd,
    env: gitExecution.environment,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120_000,
  });
  if (result?.error || result?.status !== 0) {
    const error = new Error(`${label}:FIXED_AUTHORITY_GIT_FAILED`);
    error.code = 'FIXED_AUTHORITY_GIT_FAILED';
    throw error;
  }
  return Object.freeze({ stdout: String(result?.stdout || ''), stderr: String(result?.stderr || '') });
}

export function runCanonicalSupervisorHousekeep(
  options = {},
  {
    housekeepFn = runIgnitionHousekeep,
    cwd = defaultRepoRoot,
    environment = process.env,
    platform = process.platform,
    spawnSyncFn = spawnSync,
  } = {},
) {
  const captureStepFn = (label, command, args) => captureCanonicalSupervisorHousekeepGitStep(
    label,
    command,
    args,
    { cwd, environment, platform, spawnSyncFn },
  );
  return housekeepFn({
    ...options,
    repoRoot: cwd,
    captureStepFn,
    runStepFn: (label, command, args) => {
      captureStepFn(label, command, args);
      return true;
    },
  });
}

export function createCanonicalSupervisorGitExecFile({
  cwd = defaultRepoRoot,
  environment = process.env,
  platform = process.platform,
  spawnSyncFn = spawnSync,
} = {}) {
  return (command, args, options = {}) => captureCanonicalSupervisorHousekeepGitStep(
    'readiness-source-status',
    command,
    args,
    {
      cwd: path.resolve(options?.cwd || cwd),
      environment,
      platform,
      spawnSyncFn,
    },
  ).stdout;
}

function phaseRecord(id, overrides = {}) {
  return { id, state: 'pending', blockerId: '', nextOperatorAction: '', logPath: '', ...overrides };
}

export function createBattleBridgeSupervisorStatus(overrides = {}) {
  return {
    schema: BATTLE_BRIDGE_IGNITION_SUPERVISOR_SCHEMA,
    generatedAt: new Date().toISOString(),
    currentPhase: 'source truth',
    trafficLight: 'blue',
    blockerId: '',
    nextOperatorAction: 'Watch the Battle Bridge ignition supervisor surface.',
    logPath: '',
    services: {
      backend8787: { state: 'pending', ready: false, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY },
      openClaw18789: { state: 'pending', ready: false },
      stephanosUi4173: { state: 'pending', ready: false },
    },
    sharedWorkspaceFreshness: { state: 'pending', fresh: false, staleRecords: [] },
    sourceTruthVerdict: { state: 'pending', verdict: 'unknown' },
    runtimeOnlyDirtCaveat: null,
    phases: Object.fromEntries(BATTLE_BRIDGE_IGNITION_PHASES.map((id) => [id, phaseRecord(id)])),
    authority: BATTLE_BRIDGE_IGNITION_AUTHORITY,
    ...overrides,
  };
}

function trafficLightFor(status) {
  if (status.blockerId) return 'red';
  if (Object.values(status.phases).some((phase) => phase.state === 'failed' || phase.state === 'blocked')) return 'red';
  if (Object.values(status.phases).some((phase) => phase.state === 'degraded')) return 'amber';
  if (status.phases.ready?.state === 'ready') return 'green';
  return 'blue';
}

export function defaultBattleBridgeSharedWorkspace({ env = process.env, platform = process.platform } = {}) {
  return env.STEPHANOS_SHARED_WORKSPACE
    || env.STEPHANOS_OPENCLAW_WORKSPACE
    || defaultWindowsSharedWorkspacePath({ home: env.USERPROFILE || env.HOME || os.homedir(), platform })
    || path.join(os.homedir(), 'Documents', 'Stephanos-openclaw-workspace');
}

function applyReadinessToStatus(status, report = {}) {
  const services = report.observedServices || {};
  const backendRepair = status.services.backend8787?.repair || null;
  const openClawStart = status.services.openClaw18789?.start || null;
  const servedRuntimeProof = status.services.stephanosUi4173?.servedRuntimeProof || null;
  status.services.backend8787 = { state: services.backend?.ready ? 'ready' : 'blocked', ready: services.backend?.ready === true, evidence: services.backend?.evidence || null, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY, ...(backendRepair ? { repair: backendRepair } : {}) };
  status.services.openClaw18789 = { state: services['openclaw-gateway']?.ready ? 'ready' : 'blocked', ready: services['openclaw-gateway']?.ready === true, evidence: services['openclaw-gateway']?.evidence || null, ...(openClawStart ? { start: openClawStart } : {}) };
  status.services.stephanosUi4173 = { state: services['stephanos-ui']?.ready ? 'ready' : 'blocked', ready: services['stephanos-ui']?.ready === true, evidence: services['stephanos-ui']?.evidence || null, ...(servedRuntimeProof ? { servedRuntimeProof } : {}) };
  status.sharedWorkspaceFreshness = { state: (services['shared-workspace']?.ready && !(report.staleWorkspaceRecords || []).length) ? 'ready' : 'degraded', fresh: services['shared-workspace']?.ready === true && !(report.staleWorkspaceRecords || []).length, staleRecords: report.staleWorkspaceRecords || [] };
  status.runtimeOnlyDirtCaveat = (report.caveats || []).find((caveat) => caveat.id === 'runtime-only-dirt') || null;
  const sourceBlocker = (report.safetyBlockers || []).find((blocker) => /source|branch|dirty|tracked-runtime/.test(String(blocker.id || '')));
  if (sourceBlocker) {
    status.blockerId = sourceBlocker.id;
    status.nextOperatorAction = sourceBlocker.nextOperatorAction || sourceBlocker.detail || 'Resolve source truth blocker, then rerun npm run stephanos:ignite.';
    status.sourceTruthVerdict = { state: 'blocked', verdict: sourceBlocker.id, blocker: sourceBlocker };
  }
  return status;
}

export function projectBattleBridgeSupervisorStatus({ status = createBattleBridgeSupervisorStatus(), phase, phaseState = 'running', readinessReport = null, blocker = null, logPath = '' } = {}) {
  if (phase) {
    status.currentPhase = phase;
    status.phases[phase] = phaseRecord(phase, { ...(status.phases[phase] || {}), state: phaseState, blockerId: blocker?.id || '', nextOperatorAction: blocker?.nextOperatorAction || blocker?.detail || '', logPath });
  }
  if (readinessReport) applyReadinessToStatus(status, readinessReport);
  if (blocker) {
    status.blockerId = blocker.id;
    status.nextOperatorAction = blocker.nextOperatorAction || blocker.detail || 'Resolve blocker, then rerun npm run stephanos:ignite.';
  }
  if (logPath) status.logPath = logPath;
  status.trafficLight = trafficLightFor(status);
  return status;
}


export function resolveBackendRepairExecution(platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: BATTLE_BRIDGE_WINDOWS_HOST.cmd,
      args: ['/d', '/s', '/c', `""${BATTLE_BRIDGE_WINDOWS_HOST.npm}" run stephanos:battle-bridge:repair"`],
    };
  }
  return {
    command: 'npm',
    args: ['run', 'stephanos:battle-bridge:repair'],
  };
}

export async function runApprovedBackend8787Start({
  spawnFn = spawn,
  sharedWorkspace = defaultBattleBridgeSharedWorkspace(),
  platform = process.platform,
  expectedHead = '',
  currentHeadFn = getCurrentGitHead,
  cwd = defaultRepoRoot,
  environment = process.env,
  spawnSyncFn = spawnSync,
} = {}) {
  const expected = String(expectedHead || '').trim().toLowerCase();
  let sourceHeadProof = null;
  if (expected) {
    let observedHead = '';
    try {
      observedHead = String(currentHeadFn({ cwd, environment, platform, spawnSyncFn }) || '').trim().toLowerCase();
    } catch (error) {
      return Object.freeze({
        started: false,
        exitCode: null,
        reason: 'canonical-source-head-unproven',
        expectedHead: expected,
        observedHead: '',
        error: error?.message || String(error),
        commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY,
      });
    }
    sourceHeadProof = evaluateBattleBridgeMutationHeadBinding({ expectedHead: expected, observedHead });
    if (!sourceHeadProof.ok) {
      return Object.freeze({
        started: false,
        exitCode: null,
        reason: 'canonical-source-head-mismatch',
        expectedHead: expected,
        observedHead,
        sourceHeadProof,
        commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY,
      });
    }
  }
  const logRoot = path.resolve(sharedWorkspace, 'logs', 'battle-bridge-backend-8787-repair');
  await fs.mkdir(logRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(logRoot, stamp);
  await fs.mkdir(logPath, { recursive: true });
  const stdoutLogPath = path.join(logPath, 'stdout.log');
  const stderrLogPath = path.join(logPath, 'stderr.log');
  const execution = resolveBackendRepairExecution(platform);
  const childEnvironment = {
    ...(platform === 'win32'
      ? createBattleBridgeMinimalChildEnvironment(environment, { platform })
      : environment),
    STEPHANOS_EXPECTED_HEAD: expected,
  };
  const child = spawnFn(execution.command, execution.args, {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    env: childEnvironment,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (child?.stdout?.pipe) child.stdout.pipe(createWriteStream(stdoutLogPath, { flags: 'a' }));
  if (child?.stderr?.pipe) child.stderr.pipe(createWriteStream(stderrLogPath, { flags: 'a' }));
  const logs = { logPath, stdoutLogPath, stderrLogPath };
  if (!child || typeof child.on !== 'function') return { started: true, exitCode: 0, logs, logPath, sourceHeadProof, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY };
  return await new Promise((resolve) => {
    child.once('error', (error) => resolve({ started: false, exitCode: null, error: error?.message || String(error), logs, logPath, sourceHeadProof, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY }));
    child.once('exit', (code, signal) => resolve({ started: code === 0, exitCode: code, exit: { code, signal }, logs, logPath, sourceHeadProof, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY }));
  });
}


function openClawHealthReady(payload = {}) {
  const status = String(payload?.status || payload?.state || '').toLowerCase();
  return payload?.ok === true || status === 'ok' || status === 'live';
}

async function probeOpenClawGateway18789Health({ fetchFn = globalThis.fetch } = {}) {
  const healthUrl = 'http://127.0.0.1:18789/health';
  const identityUrl = 'http://127.0.0.1:18789/identity';
  const healthResponse = await fetchJson(healthUrl, { fetchFn });
  let identity = null;
  if (healthResponse.ok && openClawHealthReady(healthResponse.json || {})) {
    try { identity = await fetchJson(identityUrl, { fetchFn }); } catch (error) { identity = { ok: false, error: error?.message || String(error) }; }
  }
  return { ready: Boolean(healthResponse.ok && openClawHealthReady(healthResponse.json || {})), healthUrl, identityUrl, health: healthResponse, identity };
}

export async function runApprovedOpenClawGateway18789Start({ spawnFn = spawn, sharedWorkspace = defaultBattleBridgeSharedWorkspace(), fetchFn = globalThis.fetch, readyTimeoutMs = 60000, retryIntervalMs = 500, env = process.env, token = '', approved = false, platform = process.platform, existsSync, expectedHead = '', currentHeadFn = getCurrentGitHead, cwd = defaultRepoRoot, spawnSyncFn = spawnSync } = {}) {
  const target = buildOpenClawGatewayStartupTarget({ env, token, approved });
  const logRoot = path.resolve(sharedWorkspace, 'logs', 'openclaw-gateway-18789-start');
  await fs.mkdir(logRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(logRoot, stamp);
  await fs.mkdir(logPath, { recursive: true });
  const stdoutLogPath = path.join(logPath, 'stdout.log');
  const stderrLogPath = path.join(logPath, 'stderr.log');
  const exitLogPath = path.join(logPath, 'exit.json');
  const healthProofLogPath = path.join(logPath, 'health-proof.json');
  const logs = { logPath, stdoutLogPath, stderrLogPath, exitLogPath, healthProofLogPath };
  if (!target.available) {
    const unavailableExit = { code: null, signal: null, error: target.reason, reusedExistingRuntime: false };
    await fs.writeFile(stdoutLogPath, '');
    await fs.writeFile(stderrLogPath, '');
    await fs.writeFile(exitLogPath, `${JSON.stringify(unavailableExit, null, 2)}
`);
    await fs.writeFile(healthProofLogPath, `${JSON.stringify({ ready: false, skipped: true, reason: target.reason, healthUrl: 'http://127.0.0.1:18789/health' }, null, 2)}
`);
    return { started: false, exitCode: null, unavailable: true, reason: target.reason, target, logs, logPath, exit: unavailableExit, healthProof: { ready: false, skipped: true, reason: target.reason } };
  }
  let existingProof = null;
  try { existingProof = await probeOpenClawGateway18789Health({ fetchFn }); } catch (error) { existingProof = { ready: false, error: error?.message || String(error), healthUrl: 'http://127.0.0.1:18789/health' }; }
  await fs.writeFile(healthProofLogPath, `${JSON.stringify(existingProof, null, 2)}
`);
  if (existingProof.ready) {
    const exitState = { code: null, signal: null, error: null, reusedExistingRuntime: true };
    await fs.writeFile(exitLogPath, `${JSON.stringify(exitState, null, 2)}
`);
    return { started: false, reusedExistingRuntime: true, duplicateStartAvoided: true, ready: true, exitCode: null, exit: exitState, logs, logPath, target, healthProof: existingProof, pid: null };
  }
  let child = null;
  const childEnv = {
    ...process.env,
    ...env,
    STEPHANOS_OPENCLAW_AUTOSTART: 'battle-bridge-supervisor-gateway-only',
    ...(token || env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN || env.OPENCLAW_GATEWAY_TOKEN ? {
      STEPHANOS_OPENCLAW_GATEWAY_TOKEN: token || env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN || env.OPENCLAW_GATEWAY_TOKEN,
      OPENCLAW_GATEWAY_TOKEN: token || env.OPENCLAW_GATEWAY_TOKEN || env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN,
    } : {}),
  };
  const execution = resolveOpenClawGatewayStartupExecution({ target, env: childEnv, platform, ...(existsSync ? { existsSync } : {}) });
  const safeExecution = execution.ok ? {
    program: execution.command,
    args: execution.commandArgs,
    resolvedOpenClawPath: execution.resolvedOpenClawPath || execution.resolvedExecutable || '',
    strategy: execution.strategy || execution.source || '',
  } : {
    program: '',
    args: [],
    resolvedOpenClawPath: '',
    strategy: '',
  };
  const exitState = { code: null, signal: null, error: execution.ok ? null : execution.reason, execution: safeExecution, commandText: target.commandText };
  let sourceHeadProof = null;
  if (expectedHead && execution.ok) {
    let observedHead = '';
    try {
      observedHead = String(currentHeadFn({ cwd, environment: env, platform, spawnSyncFn }) || '').trim().toLowerCase();
    } catch (error) {
      exitState.error = error?.message || String(error);
    }
    sourceHeadProof = evaluateBattleBridgeMutationHeadBinding({ expectedHead, observedHead });
    if (!sourceHeadProof.ok) {
      exitState.error ||= 'canonical-source-head-mismatch';
      await fs.writeFile(stdoutLogPath, '');
      await fs.writeFile(stderrLogPath, '');
      await fs.writeFile(exitLogPath, `${JSON.stringify(exitState, null, 2)}\n`);
      return { started: false, ready: false, exitCode: null, error: exitState.error, reason: 'canonical-source-head-mismatch', sourceHeadProof, logs, logPath, target, execution: safeExecution, healthProof: existingProof, pid: null };
    }
  }
  try {
    if (execution.ok) child = spawnFn(execution.command, execution.commandArgs, { cwd: path.resolve(sharedWorkspace), detached: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false, env: childEnv });
  } catch (error) {
    exitState.error = error?.message || String(error);
  }
  if (child?.stdout?.pipe) child.stdout.pipe(createWriteStream(stdoutLogPath, { flags: 'a' })); else await fs.writeFile(stdoutLogPath, '', { flag: 'a' });
  if (child?.stderr?.pipe) child.stderr.pipe(createWriteStream(stderrLogPath, { flags: 'a' })); else await fs.writeFile(stderrLogPath, '', { flag: 'a' });
  if (child?.once) {
    child.once('error', (error) => { exitState.error = error?.message || String(error); });
    child.once('exit', (code, signal) => { exitState.code = code; exitState.signal = signal; });
  }
  const deadline = Date.now() + Math.max(0, readyTimeoutMs);
  let proof = null;
  do {
    try { proof = await probeOpenClawGateway18789Health({ fetchFn }); } catch (error) { proof = { ready: false, error: error?.message || String(error), healthUrl: 'http://127.0.0.1:18789/health' }; }
    await fs.writeFile(healthProofLogPath, `${JSON.stringify(proof, null, 2)}\n`);
    await fs.writeFile(exitLogPath, `${JSON.stringify(exitState, null, 2)}\n`);
    if (proof.ready) return { started: true, ready: true, exitCode: exitState.code, exit: exitState, sourceHeadProof, logs, logPath, target, execution: safeExecution, healthProof: proof, pid: Number(child?.pid || 0) || null };
    if (exitState.error || exitState.signal !== null || (exitState.code !== null && exitState.code !== 0)) break;
    if (Date.now() < deadline && retryIntervalMs > 0) await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
  } while (Date.now() <= deadline);
  await fs.writeFile(healthProofLogPath, `${JSON.stringify(proof, null, 2)}\n`);
  await fs.writeFile(exitLogPath, `${JSON.stringify(exitState, null, 2)}\n`);
  return { started: !exitState.error, ready: false, exitCode: exitState.code, exit: exitState, error: exitState.error, sourceHeadProof, logs, logPath, target, execution: safeExecution, healthProof: proof, pid: Number(child?.pid || 0) || null };
}

export function getCurrentGitHead({
  cwd = defaultRepoRoot,
  environment = process.env,
  platform = process.platform,
  spawnSyncFn = spawnSync,
} = {}) {
  const result = captureCanonicalSupervisorHousekeepGitStep(
    'current-source-head',
    'git',
    ['rev-parse', 'HEAD'],
    { cwd, environment, platform, spawnSyncFn },
  );
  const head = String(result.stdout || '').trim().toLowerCase();
  if (!SHA40.test(head)) {
    const error = new Error('current-source-head:FIXED_AUTHORITY_GIT_HEAD_INVALID');
    error.code = 'FIXED_AUTHORITY_GIT_HEAD_INVALID';
    throw error;
  }
  return head;
}

function commitMatchesHead(value, head) {
  const served = String(value || '').trim();
  const current = String(head || '').trim();
  if (!served || !current) return false;
  if (served === current) return true;
  return served.length >= 7 && current.startsWith(served);
}

function runtimeMarkerMatchesHead(marker, head) {
  const text = String(marker || '');
  const tokens = text.match(/[0-9a-f]{7,40}/gi) || [];
  return tokens.some((token) => commitMatchesHead(token, head));
}

export function evaluateServedRuntimeExactHeadProof({ health = null, dist = null, currentHead = '' } = {}) {
  const gitCommit = health?.gitCommit || health?.commit || '';
  const runtimeMarker = health?.runtimeMarker || health?.marker || '';
  const healthOk = health?.ok === true || health?.status === 'ok' || Boolean(gitCommit || runtimeMarker);
  const distOk = dist?.ok === true || (dist?.statusCode >= 200 && dist?.statusCode < 300);
  const gitCommitMatches = commitMatchesHead(gitCommit, currentHead);
  const runtimeMarkerMatches = runtimeMarkerMatchesHead(runtimeMarker, currentHead);
  return {
    ready: Boolean(healthOk && distOk && gitCommitMatches && runtimeMarkerMatches),
    currentHead,
    healthOk,
    distOk,
    gitCommit,
    runtimeMarker,
    gitCommitMatches,
    runtimeMarkerMatches,
    buildTimestamp: health?.buildTimestamp || null,
    health,
    dist,
  };
}

async function fetchJson(url, { fetchFn = globalThis.fetch } = {}) {
  const response = await fetchFn(url);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: response.ok, statusCode: response.status, json, text: text.slice(0, 500) };
}

export async function collectServedRuntimeExactHeadProof({ currentHead = getCurrentGitHead(), fetchFn = globalThis.fetch } = {}) {
  const healthResponse = await fetchJson('http://127.0.0.1:4173/__stephanos/health', { fetchFn });
  const distResponse = await fetchJson('http://127.0.0.1:4173/apps/stephanos/dist/index.html', { fetchFn });
  return evaluateServedRuntimeExactHeadProof({
    currentHead,
    health: healthResponse.json || { ok: healthResponse.ok, statusCode: healthResponse.statusCode },
    dist: { ok: distResponse.ok, statusCode: distResponse.statusCode },
  });
}

function requiredServiceBlocker(id, detail, nextOperatorAction, extra = {}) {
  return { id, detail, nextOperatorAction, ...extra };
}

function isReady(report, id) {
  return report?.observedServices?.[id]?.ready === true;
}

async function writeStatus(status, sharedWorkspace) {
  if (!sharedWorkspace) return null;
  const dir = path.resolve(sharedWorkspace, 'status');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'battle-bridge-ignition-supervisor-current.json');
  await fs.writeFile(file, `${JSON.stringify(status, null, 2)}\n`);
  return file;
}

export async function runBattleBridgeIgnitionSupervisor({ sharedWorkspace = defaultBattleBridgeSharedWorkspace(), housekeepFn = runCanonicalSupervisorHousekeep, publisherFn = refreshBattleBridgeSharedWorkspacePublisher, collectFactsFn = collectLauncherReadinessLiveFacts, plannerFn = planLauncherReadiness, repairFn = runUi4173Repair, backendStartFn = runApprovedBackend8787Start, openClawStartFn = runApprovedOpenClawGateway18789Start, sourceTruthFn = collectCanonicalIgnitionSourceTruth, runtimeProofFn = collectServedRuntimeExactHeadProof, cwd = defaultRepoRoot, environment = process.env, platform = process.platform, spawnSyncFn = spawnSync, stdout = process.stdout } = {}) {
  let status = createBattleBridgeSupervisorStatus();
  const writes = [];
  const persist = async () => { const file = await writeStatus(status, sharedWorkspace); if (file) writes.push(file); };
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'source truth', phaseState: 'running' }); await persist();
  const sourceTruth = sourceTruthFn();
  const canonicalSourceTruth = evaluateCanonicalIgnitionSourceTruth(sourceTruth);
  if (!canonicalSourceTruth.ok) {
    status = projectBattleBridgeSupervisorStatus({ status, phase: 'source truth', phaseState: 'blocked', blocker: canonicalSourceTruth.blocker }); await persist();
    status.sourceTruthVerdict = { state: 'blocked', verdict: sourceTruth?.publicationState || canonicalSourceTruth.blocker.id, blocker: canonicalSourceTruth.blocker };
    await persist();
    stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return { ok: false, status, writes };
  }
  const expectedHead = canonicalSourceTruth.sourceTruth.head;
  const reproveExpectedHead = (blockerId) => {
    const latestSourceTruth = sourceTruthFn({ cwd, environment, platform, spawnSyncFn });
    const latestCanonicalTruth = evaluateCanonicalIgnitionSourceTruth(latestSourceTruth);
    if (!latestCanonicalTruth.ok) return { ok: false, blocker: latestCanonicalTruth.blocker };
    const observedHead = String(latestCanonicalTruth.sourceTruth?.head || '').trim().toLowerCase();
    if (observedHead !== expectedHead) {
      return {
        ok: false,
        blocker: requiredServiceBlocker(
          blockerId,
          `Canonical source HEAD changed from ${expectedHead} to ${observedHead || 'unproven'} before runtime proof.`,
          'Restore a clean synchronized canonical main checkout, then rerun npm run stephanos:ignite.',
          { expectedHead, observedHead },
        ),
      };
    }
    return { ok: true, observedHead };
  };
  const blockForSourceReproof = async (proof, phase = 'source truth') => {
    status = projectBattleBridgeSupervisorStatus({ status, phase, phaseState: 'blocked', blocker: proof.blocker });
    status.sourceTruthVerdict = { state: 'blocked', verdict: proof.blocker?.id || 'source-truth-unproven', expectedHead, blocker: proof.blocker };
    await persist();
    stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return { ok: false, status, writes };
  };
  const runExactHeadBoundMutation = async ({ phase, blockerId, mutate }) => {
    const sourceProof = reproveExpectedHead(blockerId);
    if (!sourceProof.ok) {
      return { ok: false, blockedResult: await blockForSourceReproof(sourceProof, phase) };
    }
    return { ok: true, value: await mutate({ expectedHead, sourceProof }) };
  };
  const fixedGitExecFile = createCanonicalSupervisorGitExecFile({ cwd, environment, platform, spawnSyncFn });
  const collectFacts = (options = {}) => collectFactsFn({ ...options, execFile: fixedGitExecFile });
  status.sourceTruthVerdict = { state: 'ready', verdict: canonicalSourceTruth.publicationState, expectedHead };
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'source truth', phaseState: 'ready' }); await persist();

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'housekeeping', phaseState: 'running' }); await persist();
  housekeepFn({ dryRun: false, compact: true, preserveRuntimeDirt: true });
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'housekeeping', phaseState: 'ready' }); await persist();

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'shared workspace publisher', phaseState: 'running' }); await persist();
  await publisherFn({ sharedWorkspace });
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'shared workspace publisher', phaseState: 'ready' }); await persist();

  let facts = await collectFacts({ sharedWorkspace });
  let report = plannerFn(facts);
  status = projectBattleBridgeSupervisorStatus({ status, readinessReport: report }); await persist();

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'backend 8787', phaseState: isReady(report, 'backend') ? 'ready' : 'running' }); await persist();
  if (!isReady(report, 'backend')) {
    const mutation = await runExactHeadBoundMutation({
      phase: 'backend 8787',
      blockerId: 'ignition-exact-head-changed-before-backend-start',
      mutate: () => backendStartFn({ sharedWorkspace, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY, expectedHead, cwd, environment, platform, spawnSyncFn }),
    });
    if (!mutation.ok) return mutation.blockedResult;
    const startResult = mutation.value;
    status.services.backend8787.repair = { commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY, logPath: startResult?.logPath || startResult?.logs?.logPath || '', logs: startResult?.logs || null, exitCode: startResult?.exitCode ?? startResult?.exit?.code ?? null };
    status.phases['backend 8787'].logPath = startResult?.logPath || startResult?.logs?.logPath || '';
    await persist();
    facts = await collectFacts({ sharedWorkspace });
    report = plannerFn(facts);
    status = projectBattleBridgeSupervisorStatus({ status, readinessReport: report });
    if (!isReady(report, 'backend')) {
      const blockerId = startResult?.unavailable ? 'backend-8787-start-unavailable' : (startResult?.exitCode === 0 || startResult?.started ? 'backend-8787-repair-no-health-proof' : 'backend-8787-repair-failed');
      const blocker = requiredServiceBlocker(blockerId, 'Backend 8787 is required before browser/runtime proof and UI repair, and must be proved by HTTP health.', startResult?.unavailable ? 'Source needs a safe backend start adapter before Battle Bridge ignition can continue.' : `Inspect backend repair logs at ${startResult?.logPath || startResult?.logs?.logPath || 'canonical shared workspace logs'}; then rerun npm run stephanos:ignite.`, { commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY, startResult, logPath: startResult?.logPath || startResult?.logs?.logPath || '' });
      status = projectBattleBridgeSupervisorStatus({ status, phase: 'backend 8787', phaseState: startResult?.unavailable ? 'blocked' : 'failed', blocker, logPath: startResult?.logPath || startResult?.logs?.logPath || '' }); await persist();
      stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return { ok: false, status, writes };
    }
  }
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'backend 8787', phaseState: 'ready', readinessReport: report, logPath: status.services.backend8787.repair?.logPath || '' }); await persist();

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'OpenClaw gateway 18789', phaseState: isReady(report, 'openclaw-gateway') ? 'ready' : 'running' }); await persist();
  if (!isReady(report, 'openclaw-gateway')) {
    const mutation = await runExactHeadBoundMutation({
      phase: 'OpenClaw gateway 18789',
      blockerId: 'ignition-exact-head-changed-before-openclaw-start',
      mutate: () => openClawStartFn({ sharedWorkspace, expectedHead, cwd, env: environment, platform, spawnSyncFn }),
    });
    if (!mutation.ok) return mutation.blockedResult;
    const startResult = mutation.value;
    status.services.openClaw18789.start = { startupSource: OPENCLAW_GATEWAY_STARTUP_SOURCE, commandText: startResult?.target?.commandText || '', execution: startResult?.execution || startResult?.exit?.execution || null, logPath: startResult?.logPath || startResult?.logs?.logPath || '', logs: startResult?.logs || null, exitCode: startResult?.exitCode ?? startResult?.exit?.code ?? null, healthProof: startResult?.healthProof || null };
    status.phases['OpenClaw gateway 18789'].logPath = startResult?.logPath || startResult?.logs?.logPath || '';
    await persist();
    facts = await collectFacts({ sharedWorkspace });
    report = plannerFn(facts);
    status = projectBattleBridgeSupervisorStatus({ status, readinessReport: report });
    if (!isReady(report, 'openclaw-gateway') || startResult?.ready !== true) {
      const exitCode = startResult?.exitCode ?? startResult?.exit?.code ?? null;
      const failedExit = Boolean(startResult?.error || startResult?.exit?.signal || (exitCode !== null && exitCode !== 0));
      const blockerId = failedExit ? 'openclaw-gateway-18789-start-failed' : 'openclaw-gateway-18789-no-health-proof';
      const logPath = startResult?.logPath || startResult?.logs?.logPath || 'canonical shared workspace logs/openclaw-gateway-18789-start';
      const blocker = requiredServiceBlocker(blockerId, 'OpenClaw gateway 18789 startup must be proved by http://127.0.0.1:18789/health returning ok/status live; readonly adapter stubs are not accepted.', `Inspect OpenClaw gateway startup logs at ${logPath}; then rerun npm run stephanos:ignite.`, { startupSource: OPENCLAW_GATEWAY_STARTUP_SOURCE, startResult, logPath });
      status = projectBattleBridgeSupervisorStatus({ status, phase: 'OpenClaw gateway 18789', phaseState: failedExit ? 'failed' : 'blocked', blocker, logPath }); await persist();
      stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return { ok: false, status, writes };
    }
  }
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'OpenClaw gateway 18789', phaseState: 'ready', readinessReport: report, logPath: status.services.openClaw18789.start?.logPath || '' }); await persist();

  if (!isReady(report, 'shared-workspace') || (report.staleWorkspaceRecords || []).length) {
    status = projectBattleBridgeSupervisorStatus({ status, phase: 'shared workspace publisher', phaseState: 'running' }); await persist();
    await publisherFn({ sharedWorkspace });
    facts = await collectFacts({ sharedWorkspace });
    report = plannerFn(facts);
    status = projectBattleBridgeSupervisorStatus({ status, phase: 'shared workspace publisher', phaseState: isReady(report, 'shared-workspace') && !(report.staleWorkspaceRecords || []).length ? 'ready' : 'blocked', readinessReport: report }); await persist();
  }

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'Stephanos UI 4173', phaseState: isReady(report, 'stephanos-ui') ? 'ready' : 'running' }); await persist();
  if (report.finalVerdict === 'partial-ui-missing' || !isReady(report, 'stephanos-ui')) {
    status = projectBattleBridgeSupervisorStatus({ status, phase: 'Stephanos UI 4173', phaseState: 'running' }); await persist();
    const repairOutput = { chunks: '' };
    const mutation = await runExactHeadBoundMutation({
      phase: 'Stephanos UI 4173',
      blockerId: 'ignition-exact-head-changed-before-ui-repair',
      mutate: () => repairFn({ sharedWorkspace, dryRun: false, expectedHead, collectFactsFn: collectFacts, stdout: { write: (chunk) => { repairOutput.chunks += chunk; } } }),
    });
    if (!mutation.ok) return mutation.blockedResult;
    const code = mutation.value;
    let repairResult = null;
    try { repairResult = JSON.parse(repairOutput.chunks); } catch {}
    const uiBlocker = repairResult?.ready ? null : requiredServiceBlocker('stephanos-ui-4173-missing', 'Stephanos UI 4173 did not pass readiness proof after guarded repair.', repairResult?.nextOperatorAction || `Inspect UI repair logs, then rerun proof. Approved command: ${UI_4173_REPAIR_AUTHORITY ? 'npm run stephanos:ignite:launcher-root' : 'source adapter required'}`);
    status = projectBattleBridgeSupervisorStatus({ status, phase: 'Stephanos UI 4173', phaseState: repairResult?.ready ? 'ready' : (code === 0 ? 'blocked' : 'failed'), blocker: uiBlocker, logPath: repairResult?.logs?.logPath || '' }); await persist();
    await publisherFn({ sharedWorkspace });
  }
  const proofFacts = await collectFacts({ sharedWorkspace });
  const proofReport = plannerFn(proofFacts);
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'browser/runtime proof', phaseState: 'running', readinessReport: proofReport }); await persist();
  let servedRuntimeProof = null;
  if (isReady(proofReport, 'stephanos-ui')) {
    const runtimeSourceProof = reproveExpectedHead('ignition-exact-head-changed-before-runtime-proof');
    if (!runtimeSourceProof.ok) return blockForSourceReproof(runtimeSourceProof, 'browser/runtime proof');
    servedRuntimeProof = await runtimeProofFn({ currentHead: expectedHead, expectedHead, sharedWorkspace });
    status.services.stephanosUi4173.servedRuntimeProof = servedRuntimeProof;
    if (!servedRuntimeProof.ready) {
      status = projectBattleBridgeSupervisorStatus({ status, phase: 'Stephanos UI 4173', phaseState: 'running' }); await persist();
      const repairOutput = { chunks: '' };
      const mutation = await runExactHeadBoundMutation({
        phase: 'Stephanos UI 4173',
        blockerId: 'ignition-exact-head-changed-before-ui-repair',
        mutate: () => repairFn({ sharedWorkspace, dryRun: false, expectedHead, collectFactsFn: collectFacts, stdout: { write: (chunk) => { repairOutput.chunks += chunk; } } }),
      });
      if (!mutation.ok) return mutation.blockedResult;
      const code = mutation.value;
      let repairResult = null;
      try { repairResult = JSON.parse(repairOutput.chunks); } catch {}
      await publisherFn({ sharedWorkspace });
      const repairedFacts = await collectFacts({ sharedWorkspace });
      const repairedReport = plannerFn(repairedFacts);
      proofReport.observedServices = repairedReport.observedServices;
      proofReport.finalVerdict = repairedReport.finalVerdict;
      proofReport.staleWorkspaceRecords = repairedReport.staleWorkspaceRecords || [];
      if (isReady(repairedReport, 'stephanos-ui')) {
        const repairedRuntimeSourceProof = reproveExpectedHead('ignition-exact-head-changed-before-runtime-proof');
        if (!repairedRuntimeSourceProof.ok) return blockForSourceReproof(repairedRuntimeSourceProof, 'browser/runtime proof');
        servedRuntimeProof = await runtimeProofFn({ currentHead: expectedHead, expectedHead, sharedWorkspace });
      }
      status = projectBattleBridgeSupervisorStatus({ status, phase: 'Stephanos UI 4173', phaseState: servedRuntimeProof.ready ? 'ready' : (code === 0 ? 'blocked' : 'failed'), readinessReport: repairedReport, logPath: repairResult?.logs?.logPath || '' });
      status.services.stephanosUi4173.servedRuntimeProof = servedRuntimeProof;
      await persist();
    }
  }
  const readySourceProof = reproveExpectedHead('ignition-exact-head-changed-before-ready');
  if (!readySourceProof.ok) return blockForSourceReproof(readySourceProof, 'browser/runtime proof');
  const exactHeadReady = servedRuntimeProof?.ready === true;
  const proofReady = proofReport.finalVerdict === 'ready' && isReady(proofReport, 'backend') && isReady(proofReport, 'openclaw-gateway') && isReady(proofReport, 'stephanos-ui') && isReady(proofReport, 'shared-workspace') && exactHeadReady;
  if (!proofReady) {
    const missingPhase = !isReady(proofReport, 'backend') ? 'backend 8787' : (!isReady(proofReport, 'openclaw-gateway') ? 'OpenClaw gateway 18789' : (!isReady(proofReport, 'stephanos-ui') ? 'Stephanos UI 4173' : 'shared workspace publisher'));
    const staleRuntime = isReady(proofReport, 'stephanos-ui') && servedRuntimeProof && !servedRuntimeProof.ready;
    const blockerId = staleRuntime ? 'served-runtime-stale' : (status.blockerId || (missingPhase === 'backend 8787' ? 'backend-8787-missing' : (missingPhase === 'Stephanos UI 4173' ? 'stephanos-ui-4173-missing' : 'browser-runtime-proof-incomplete')));
    const detail = staleRuntime ? `Stephanos UI 4173 is alive but served runtime does not match current source HEAD ${servedRuntimeProof.currentHead}.` : 'Required Battle Bridge element is not ready; browser/runtime proof remains pending.';
    const action = staleRuntime ? 'Rebuild/restart 4173 through guarded UI repair, then rerun npm run stephanos:ignite.' : 'Resolve blocked required elements, then rerun npm run stephanos:ignite.';
    status = projectBattleBridgeSupervisorStatus({ status, phase: staleRuntime ? 'browser/runtime proof' : missingPhase, phaseState: 'blocked', readinessReport: proofReport, blocker: requiredServiceBlocker(blockerId, detail, action, { servedRuntimeProof }) });
    await persist();
    stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return { ok: false, status, writes };
  }
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'browser/runtime proof', phaseState: 'ready', readinessReport: proofReport });
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'ready', phaseState: 'ready' });
  await persist();
  stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  return { ok: true, status, writes };
}

export function runCanonicalIgnitionSourceTruthReport({
  cwd = defaultRepoRoot,
  environment = process.env,
  platform = process.platform,
  spawnSyncFn = spawnSync,
  sourceTruthFn = collectCanonicalIgnitionSourceTruth,
  stdout = process.stdout,
} = {}) {
  const sourceTruth = sourceTruthFn({ cwd, environment, platform, spawnSyncFn });
  const canonical = evaluateCanonicalIgnitionSourceTruth(sourceTruth);
  const report = canonical.ok
    ? { ok: true, head: canonical.sourceTruth.head, publicationState: canonical.publicationState }
    : { ok: false, head: '', publicationState: sourceTruth?.publicationState || 'source-truth-unproven', blocker: canonical.blocker };
  stdout.write(`${JSON.stringify(report)}\n`);
  return report.ok ? 0 : 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sharedWorkspaceIndex = process.argv.indexOf('--shared-workspace');
  const sharedWorkspace = sharedWorkspaceIndex >= 0 ? process.argv[sharedWorkspaceIndex + 1] : undefined;
  try {
    process.exitCode = process.argv.includes('--source-truth-json')
      ? runCanonicalIgnitionSourceTruthReport()
      : ((await runBattleBridgeIgnitionSupervisor({ sharedWorkspace })).ok ? 0 : 2);
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
