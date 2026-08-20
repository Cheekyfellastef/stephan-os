import { spawnSync } from 'node:child_process';

import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import { CODEX_DISPATCH_TEST_ARGS, syncCodexDispatchBridge } from './codexDispatchHostOps.mjs';

export const BATTLE_BRIDGE_EXACT_HEAD_SYNC_GUARD_SCHEMA = 'stephanos.battle-bridge-exact-head-sync-guard.v1';

const EXACT_HEAD = /^[0-9a-f]{40}$/;
function text(value) {
  return String(value ?? '').trim();
}

function normalizeExecutable(command) {
  return text(command).replace(/\//g, '\\').toLowerCase();
}

function commandLeaf(command) {
  return normalizeExecutable(command).split('\\').at(-1) || '';
}

function isTrustedGitToken(command) {
  const normalized = normalizeExecutable(command);
  return normalized === 'git' || normalized === normalizeExecutable(BATTLE_BRIDGE_WINDOWS_HOST.git);
}

function isCanonicalNodeCommand(command) {
  return normalizeExecutable(command) === normalizeExecutable(BATTLE_BRIDGE_WINDOWS_HOST.node);
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

  const state = {
    mergeAttempted: false,
    mergeAllowed: false,
    mergeTarget: '',
    unlistedOperationObserved: false,
    blockedOperation: '',
  };

  const guarded = (command, args = [], options = {}) => {
    const argv = Array.isArray(args) ? args.map((value) => String(value)) : [];
    const operation = argv[0]?.toLowerCase() || '';
    const trustedGitToken = isTrustedGitToken(command);
    const allowedGitRead = trustedGitToken && (
      (argv.length === 2 && argv[0] === 'branch' && argv[1] === '--show-current')
      || (argv.length === 2 && argv[0] === 'rev-parse' && ['HEAD', 'origin/main'].includes(argv[1]))
      || (argv.length === 3 && argv[0] === 'status' && argv[1] === '--porcelain=v1' && argv[2] === '--untracked-files=all')
      || (argv.length === 3 && argv[0] === 'fetch' && argv[1] === 'origin' && argv[2] === 'main')
      || (argv.length === 4 && argv[0] === 'rev-list' && argv[1] === '--left-right' && argv[2] === '--count'
        && argv[3] === `HEAD...${normalizedExpectedHead}`)
      || (argv.length === 3 && argv[0] === 'diff' && argv[1] === '--name-only'
        && new RegExp(`^[0-9a-f]{40}\\.\\.${normalizedExpectedHead}$`, 'i').test(argv[2]))
    );
    const allowedProof = isCanonicalNodeCommand(command)
      && argv.length === CODEX_DISPATCH_TEST_ARGS.length
      && argv.every((value, index) => value === CODEX_DISPATCH_TEST_ARGS[index]);

    let allowedMerge = false;
    if (operation === 'merge' && trustedGitToken) {
      state.mergeAttempted = true;
      const exactShape = argv.length === 3 && argv[1] === '--ff-only';
      const target = text(argv[2]).toLowerCase();
      state.mergeTarget = target;
      if (!exactShape || target !== normalizedExpectedHead) {
        state.blockedOperation = 'merge';
        return blockedSpawnResult('EXACT_HEAD_SYNC_TARGET_MISMATCH');
      }
      state.mergeAllowed = true;
      allowedMerge = true;
    }

    if (!allowedGitRead && !allowedMerge && !allowedProof) {
      state.unlistedOperationObserved = true;
      state.blockedOperation = trustedGitToken ? operation : commandLeaf(command);
      return blockedSpawnResult('EXACT_HEAD_SYNC_OPERATION_NOT_ALLOWED');
    }

    const canonicalCommand = trustedGitToken
      ? BATTLE_BRIDGE_WINDOWS_HOST.git
      : BATTLE_BRIDGE_WINDOWS_HOST.node;
    return spawnSyncFn(canonicalCommand, args, options);
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
} = {}) {
  const guard = createBattleBridgeExactHeadSpawnGuard({ expectedHead, spawnSyncFn });
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
      mutationAttempted: false,
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
      mutationAttempted: false,
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
      mutationAttempted: guard.state.mergeAllowed,
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
    destructiveGitAllowed: false,
  });
}
