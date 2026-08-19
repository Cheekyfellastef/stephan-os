import { spawnSync } from 'node:child_process';

import { syncCodexDispatchBridge } from './codexDispatchHostOps.mjs';

export const BATTLE_BRIDGE_EXACT_HEAD_SYNC_GUARD_SCHEMA = 'stephanos.battle-bridge-exact-head-sync-guard.v1';

const EXACT_HEAD = /^[0-9a-f]{40}$/;
const FORBIDDEN_GIT_WRITES = new Set([
  'reset',
  'clean',
  'stash',
  'rebase',
  'checkout',
  'switch',
  'push',
  'commit',
  'cherry-pick',
]);

function text(value) {
  return String(value ?? '').trim();
}

function commandLeaf(command) {
  return text(command).replace(/\\/g, '/').split('/').at(-1)?.toLowerCase() || '';
}

function isGitCommand(command) {
  return ['git', 'git.exe'].includes(commandLeaf(command));
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
    forbiddenGitWriteObserved: false,
    blockedOperation: '',
  };

  const guarded = (command, args = [], options = {}) => {
    const argv = Array.isArray(args) ? args.map((value) => String(value)) : [];
    if (!isGitCommand(command) || argv.length === 0) return spawnSyncFn(command, args, options);

    const operation = argv[0].toLowerCase();
    if (FORBIDDEN_GIT_WRITES.has(operation)) {
      state.forbiddenGitWriteObserved = true;
      state.blockedOperation = operation;
      return blockedSpawnResult('EXACT_HEAD_SYNC_FORBIDDEN_GIT_WRITE');
    }

    if (operation === 'merge') {
      state.mergeAttempted = true;
      const exactShape = argv.length === 3 && argv[1] === '--ff-only';
      const target = text(argv[2]).toLowerCase();
      state.mergeTarget = target;
      if (!exactShape || target !== normalizedExpectedHead) {
        state.blockedOperation = 'merge';
        return blockedSpawnResult('EXACT_HEAD_SYNC_TARGET_MISMATCH');
      }
      state.mergeAllowed = true;
    }

    return spawnSyncFn(command, args, options);
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
    ...(nodeCommand ? { nodeCommand } : {}),
  });
  const remoteHead = text(result?.remoteHead).toLowerCase();
  const afterHead = text(result?.afterHead).toLowerCase();
  const exactRemote = remoteHead === guard.expectedHead;
  const exactAfter = afterHead === guard.expectedHead;
  const targetMismatchBlocked = guard.state.mergeAttempted && !guard.state.mergeAllowed;

  if (guard.state.forbiddenGitWriteObserved) {
    return Object.freeze({
      ...result,
      ok: false,
      schemaVersion: BATTLE_BRIDGE_EXACT_HEAD_SYNC_GUARD_SCHEMA,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: 'FORBIDDEN_GIT_WRITE_ATTEMPTED',
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
