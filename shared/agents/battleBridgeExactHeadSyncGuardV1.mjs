import { spawnSync } from 'node:child_process';

import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import {
  BATTLE_BRIDGE_CANONICAL_REMOTE_URL,
  BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
  createBattleBridgeMinimalChildEnvironment,
  validateBattleBridgeLocalGitConfiguration,
} from './battleBridgeExecutionBoundaryV1.mjs';
import { CODEX_DISPATCH_TEST_ARGS, syncCodexDispatchBridge } from './codexDispatchHostOps.mjs';
import { classifyUpdateDirt } from './stephanosUpdateDirt.mjs';

export const BATTLE_BRIDGE_EXACT_HEAD_SYNC_GUARD_SCHEMA = 'stephanos.battle-bridge-exact-head-sync-guard.v1';

const EXACT_HEAD = /^[0-9a-f]{40}$/;
function text(value) {
  return String(value ?? '').trim();
}

function canonicalWindowsExecutable(command, expected) {
  return text(command).replace(/\//g, '\\').toLowerCase() === expected.toLowerCase();
}

function blockedSpawnResult(blocker) {
  return Object.freeze({
    status: 86,
    signal: null,
    stdout: '',
    stderr: blocker,
    error: null,
  });
}

export function createBattleBridgeExactHeadSpawnGuard({
  expectedHead,
  spawnSyncFn = spawnSync,
  nodeCommand,
  environment = process.env,
} = {}) {
  const normalizedExpectedHead = text(expectedHead).toLowerCase();
  if (!EXACT_HEAD.test(normalizedExpectedHead)) {
    return Object.freeze({
      ok: false,
      blocker: 'EXPECTED_HEAD_INVALID',
      expectedHead: '',
      spawnSyncFn: null,
      state: null,
    });
  }
  if (nodeCommand !== undefined && !canonicalWindowsExecutable(nodeCommand, BATTLE_BRIDGE_WINDOWS_HOST.node)) {
    return Object.freeze({
      ok: false,
      blocker: 'NODE_EXECUTABLE_NOT_CANONICAL',
      expectedHead: normalizedExpectedHead,
      spawnSyncFn: null,
      state: null,
    });
  }

  const state = {
    mergeAttempted: false,
    mergeAllowed: false,
    mergeTarget: '',
    unlistedOperationObserved: false,
    blockedOperation: '',
    sourcePreflightObserved: false,
    sourcePreflightClean: false,
    sourcePreflightBlocker: '',
    sourceDirt: Object.freeze([]),
    sourceStatusGeneration: 0,
    lastMutationStatusGeneration: 0,
    gitConfigurationObserved: false,
    gitConfigurationValid: false,
    gitConfigurationBlocker: '',
    fetchAttempted: false,
    mergeExecutionAttempted: false,
    proofAttempted: false,
  };

  const gitEnvironment = createBattleBridgeMinimalChildEnvironment(environment, { git: true });
  const nodeEnvironment = createBattleBridgeMinimalChildEnvironment(environment);

  const proveGitConfiguration = (options = {}) => {
    if (state.gitConfigurationObserved) return state.gitConfigurationValid;
    state.gitConfigurationObserved = true;
    const fixedOptions = { ...options, env: gitEnvironment };
    const config = spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.git, [
      ...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
      'config', '--local', '--null', '--list',
    ], fixedOptions);
    if (config?.error || config?.status !== 0) {
      state.gitConfigurationBlocker = 'CANONICAL_GIT_CONFIGURATION_UNPROVEN';
      return false;
    }
    const validation = validateBattleBridgeLocalGitConfiguration(config.stdout);
    if (!validation.ok) {
      state.gitConfigurationBlocker = validation.blocker;
      return false;
    }
    const replacements = spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.git, [
      ...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
      'for-each-ref', '--format=%(refname)', 'refs/replace',
    ], fixedOptions);
    if (replacements?.error || replacements?.status !== 0) {
      state.gitConfigurationBlocker = 'GIT_REPLACE_REFS_UNPROVEN';
      return false;
    }
    if (String(replacements.stdout || '').trim()) {
      state.gitConfigurationBlocker = 'GIT_REPLACE_REFS_PRESENT';
      return false;
    }
    state.gitConfigurationValid = true;
    return true;
  };

  const guarded = (command, args = [], options = {}) => {
    const argv = Array.isArray(args) ? args.map((value) => String(value)) : [];
    const operation = argv[0]?.toLowerCase() || '';
    const logicalGit = command === 'git';
    const canonicalGit = canonicalWindowsExecutable(command, BATTLE_BRIDGE_WINDOWS_HOST.git);
    const isGitCommand = logicalGit || canonicalGit;
    const canonicalNode = canonicalWindowsExecutable(command, BATTLE_BRIDGE_WINDOWS_HOST.node);
    const allowedGitRead = isGitCommand && (
      (argv.length === 2 && argv[0] === 'branch' && argv[1] === '--show-current')
      || (argv.length === 2 && argv[0] === 'rev-parse' && ['HEAD', 'origin/main'].includes(argv[1]))
      || (argv.length === 4 && argv[0] === 'status' && argv[1] === '--porcelain=v1'
        && argv[2] === '--untracked-files=all' && argv[3] === '--ignored=matching')
      || (argv.length === 4 && argv[0] === 'fetch' && argv[1] === '--prune' && argv[2] === 'origin'
        && argv[3] === 'main:refs/remotes/origin/main')
      || (argv.length === 4 && argv[0] === 'rev-list' && argv[1] === '--left-right' && argv[2] === '--count'
        && argv[3] === `HEAD...${normalizedExpectedHead}`)
      || (argv.length === 3 && argv[0] === 'diff' && argv[1] === '--name-only'
        && new RegExp(`^[0-9a-f]{40}\\.\\.${normalizedExpectedHead}$`, 'i').test(argv[2]))
    );
    const allowedProof = canonicalNode
      && argv.length === CODEX_DISPATCH_TEST_ARGS.length
      && argv.every((value, index) => value === CODEX_DISPATCH_TEST_ARGS[index]);

    let allowedMerge = false;
    if (operation === 'merge' && isGitCommand) {
      state.mergeAttempted = true;
      const exactShape = argv.length === 3 && argv[1] === '--ff-only';
      const target = text(argv[2]).toLowerCase();
      state.mergeTarget = target;
      if (!exactShape || target !== normalizedExpectedHead) {
        state.blockedOperation = 'merge';
        return blockedSpawnResult('EXACT_HEAD_SYNC_TARGET_MISMATCH');
      }
      allowedMerge = true;
    }

    if (!allowedGitRead && !allowedMerge && !allowedProof) {
      state.unlistedOperationObserved = true;
      state.blockedOperation = isGitCommand ? operation : text(command);
      return blockedSpawnResult('EXACT_HEAD_SYNC_OPERATION_NOT_ALLOWED');
    }

    if (!proveGitConfiguration(options)) {
      state.blockedOperation = operation || 'node-proof';
      return blockedSpawnResult(state.gitConfigurationBlocker);
    }

    const sourceMutationBoundary = (isGitCommand && ['fetch', 'merge'].includes(operation)) || allowedProof;
    if (sourceMutationBoundary && (!state.sourcePreflightClean
        || state.sourceStatusGeneration <= state.lastMutationStatusGeneration)) {
      state.blockedOperation = operation || 'node-proof';
      const blocker = state.sourcePreflightBlocker
        || (state.sourcePreflightObserved ? 'CANONICAL_SOURCE_STATUS_STALE' : 'CANONICAL_SOURCE_STATUS_UNPROVEN');
      if (!state.sourcePreflightBlocker) state.sourcePreflightBlocker = blocker;
      return blockedSpawnResult(blocker);
    }
    if (allowedMerge) state.mergeAllowed = true;

    const executable = isGitCommand
      ? BATTLE_BRIDGE_WINDOWS_HOST.git
      : (canonicalNode ? BATTLE_BRIDGE_WINDOWS_HOST.node : command);
    const fixedArgs = isGitCommand
      ? [
        ...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
        ...(operation === 'fetch'
          ? ['fetch', '--prune', BATTLE_BRIDGE_CANONICAL_REMOTE_URL, argv[3]]
          : argv),
      ]
      : args;
    if (isGitCommand && operation === 'fetch') state.fetchAttempted = true;
    if (allowedMerge) state.mergeExecutionAttempted = true;
    if (allowedProof) state.proofAttempted = true;
    const result = spawnSyncFn(executable, fixedArgs, {
      ...options,
      env: isGitCommand ? gitEnvironment : nodeEnvironment,
    });
    if (isGitCommand && argv.length === 4 && argv[0] === 'status'
        && argv[1] === '--porcelain=v1' && argv[2] === '--untracked-files=all'
        && argv[3] === '--ignored=matching') {
      state.sourcePreflightObserved = true;
      state.sourceStatusGeneration += 1;
      if (result?.error || result?.status !== 0) {
        state.sourcePreflightClean = false;
        state.sourcePreflightBlocker = 'CANONICAL_SOURCE_STATUS_UNPROVEN';
      } else {
        const dirt = classifyUpdateDirt(result?.stdout);
        if (dirt.sourceEntries.length > 0) {
          state.sourceDirt = Object.freeze([...dirt.source]);
          state.sourcePreflightClean = false;
          state.sourcePreflightBlocker = 'CANONICAL_CHECKOUT_DIRTY';
        } else if (!state.sourcePreflightBlocker) {
          state.sourcePreflightClean = true;
        }
      }
    }
    if (sourceMutationBoundary) state.lastMutationStatusGeneration = state.sourceStatusGeneration;
    return result;
  };

  return Object.freeze({
    ok: true,
    blocker: '',
    expectedHead: normalizedExpectedHead,
    spawnSyncFn: guarded,
    state,
  });
}

export function syncBattleBridgeExactHeadV1({
  repoRoot,
  expectedBranch = 'main',
  expectedHead = '',
  operatorApproval = '',
  spawnSyncFn = spawnSync,
  syncFn = syncCodexDispatchBridge,
  nodeCommand,
  environment = process.env,
} = {}) {
  const guard = createBattleBridgeExactHeadSpawnGuard({ expectedHead, spawnSyncFn, nodeCommand, environment });
  if (!guard.ok) {
    return Object.freeze({
      ok: false,
      schemaVersion: BATTLE_BRIDGE_EXACT_HEAD_SYNC_GUARD_SCHEMA,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: guard.blocker,
      expectedHead: '',
      mutationAttempted: false,
      destructiveGitAllowed: false,
    });
  }

  const result = syncFn({
    repoRoot,
    expectedBranch,
    operatorApproval,
    spawnSyncFn: guard.spawnSyncFn,
    nodeCommand: BATTLE_BRIDGE_WINDOWS_HOST.node,
  });
  const remoteHead = text(result?.remoteHead).toLowerCase();
  const afterHead = text(result?.afterHead).toLowerCase();
  const exactRemote = remoteHead === guard.expectedHead;
  const exactAfter = afterHead === guard.expectedHead;
  const targetMismatchBlocked = guard.state.mergeAttempted && !guard.state.mergeAllowed;

  if (guard.state.gitConfigurationBlocker) {
    return Object.freeze({
      ...result,
      ok: false,
      schemaVersion: BATTLE_BRIDGE_EXACT_HEAD_SYNC_GUARD_SCHEMA,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: guard.state.gitConfigurationBlocker,
      expectedHead: guard.expectedHead,
      expectedHeadMatch: false,
      mutationAttempted: guard.state.fetchAttempted || guard.state.mergeExecutionAttempted,
      destructiveGitAllowed: false,
    });
  }

  if (guard.state.sourcePreflightBlocker) {
    return Object.freeze({
      ...result,
      ok: false,
      schemaVersion: BATTLE_BRIDGE_EXACT_HEAD_SYNC_GUARD_SCHEMA,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: guard.state.sourcePreflightBlocker,
      expectedHead: guard.expectedHead,
      expectedHeadMatch: false,
      sourceDirt: guard.state.sourceDirt,
      mutationAttempted: guard.state.fetchAttempted || guard.state.mergeExecutionAttempted,
      destructiveGitAllowed: false,
    });
  }

  if (guard.state.unlistedOperationObserved) {
    return Object.freeze({
      ...result,
      ok: false,
      schemaVersion: BATTLE_BRIDGE_EXACT_HEAD_SYNC_GUARD_SCHEMA,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: 'UNLISTED_SYNC_OPERATION_ATTEMPTED',
      expectedHead: guard.expectedHead,
      expectedHeadMatch: false,
      mutationAttempted: guard.state.fetchAttempted || guard.state.mergeExecutionAttempted,
      destructiveGitAllowed: false,
    });
  }

  if (!exactRemote || targetMismatchBlocked) {
    return Object.freeze({
      ...result,
      ok: false,
      schemaVersion: BATTLE_BRIDGE_EXACT_HEAD_SYNC_GUARD_SCHEMA,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: 'REMOTE_HEAD_NOT_APPROVED',
      expectedHead: guard.expectedHead,
      expectedHeadMatch: false,
      mutationAttempted: guard.state.fetchAttempted || guard.state.mergeExecutionAttempted,
      mergeAttempted: guard.state.mergeAttempted,
      mergeAllowed: guard.state.mergeAllowed,
      destructiveGitAllowed: false,
    });
  }

  if (!result?.ok || !exactAfter) {
    return Object.freeze({
      ...result,
      ok: false,
      schemaVersion: BATTLE_BRIDGE_EXACT_HEAD_SYNC_GUARD_SCHEMA,
      status: result?.status || 'BLOCKED',
      verdict: 'FAIL',
      blocker: result?.blocker || 'POST_SYNC_HEAD_MISMATCH',
      expectedHead: guard.expectedHead,
      expectedHeadMatch: exactAfter,
      mutationAttempted: guard.state.fetchAttempted || guard.state.mergeExecutionAttempted,
      destructiveGitAllowed: false,
    });
  }

  return Object.freeze({
    ...result,
    schemaVersion: BATTLE_BRIDGE_EXACT_HEAD_SYNC_GUARD_SCHEMA,
    expectedHead: guard.expectedHead,
    expectedHeadMatch: true,
    mergeAttempted: guard.state.mergeAttempted,
    mergeAllowed: guard.state.mergeAllowed,
    mutationAttempted: guard.state.fetchAttempted || guard.state.mergeExecutionAttempted,
    proofAttempted: guard.state.proofAttempted,
    destructiveGitAllowed: false,
  });
}
