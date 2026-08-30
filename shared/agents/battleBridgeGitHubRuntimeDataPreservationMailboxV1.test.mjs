import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_GITHUB_COMMAND_MARKER,
  BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
  BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
  executeBattleBridgeGitHubCommand,
  isTerminalizableOwnerCommandBlocker,
  selectBattleBridgeGitHubCommandBatch,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';
import {
  BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
} from './battleBridgeDirtyDataPreservationV1.mjs';

const NOW = new Date('2026-08-30T07:45:00.000Z');
const HEAD = 'bdb98e525ccd62c0a9c460533b75594eda11cb0c';
const OTHER_HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function command(overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId: 'runtime-data-preservation-0001',
    operation: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    preservationProfile: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
    preservationApproval: 'operator-approved',
    expiresAt: '2026-08-30T08:45:00.000Z',
    ...overrides,
  };
}

function comment(payload = command(), overrides = {}) {
  return {
    id: 2055001,
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-2055001',
    created_at: NOW.toISOString(),
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`${BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(payload)}\n\`\`\``,
    ...overrides,
  };
}

test('accepts the exact #1983 preservation pair only on the dedicated sync operation', () => {
  const accepted = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.verdict, 'COMMAND_ACCEPTED');
  assert.equal(accepted.command.operation, BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION);
  assert.equal(accepted.command.preservationProfile, BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE);
  assert.equal(accepted.command.preservationApproval, 'operator-approved');

  assert.equal(validateBattleBridgeGitHubCommand(command({
    preservationProfile: 'other-profile',
  }), { authorLogin: 'Cheekyfellastef', now: NOW, authoredAt: NOW }).blocker, 'COMMAND_PRESERVATION_PROFILE_NOT_ALLOWED');

  assert.equal(validateBattleBridgeGitHubCommand(command({
    preservationApproval: 'not-approved',
  }), { authorLogin: 'Cheekyfellastef', now: NOW, authoredAt: NOW }).blocker, 'COMMAND_PRESERVATION_APPROVAL_REQUIRED');

  const missingApproval = command();
  delete missingApproval.preservationApproval;
  assert.equal(validateBattleBridgeGitHubCommand(missingApproval, {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  }).blocker, 'COMMAND_PRESERVATION_FIELDS_INCOMPLETE');

  const missingPair = command();
  delete missingPair.preservationProfile;
  delete missingPair.preservationApproval;
  assert.equal(validateBattleBridgeGitHubCommand(missingPair, {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  }).blocker, 'COMMAND_PRESERVATION_FIELDS_INCOMPLETE');

  assert.equal(validateBattleBridgeGitHubCommand(command({
    operation: 'UPDATE_STEPHANOS_FROM_CHAT',
  }), { authorLogin: 'Cheekyfellastef', now: NOW, authoredAt: NOW }).blocker, 'COMMAND_PRESERVATION_FIELDS_NOT_ALLOWED');

  assert.equal(validateBattleBridgeGitHubCommand(command({
    operation: 'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
  }), { authorLogin: 'Cheekyfellastef', now: NOW, authoredAt: NOW }).blocker, 'COMMAND_PRESERVATION_FIELDS_NOT_ALLOWED');

  assert.equal(validateBattleBridgeGitHubCommand(command({ expectedHead: '' }), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  }).blocker, 'COMMAND_PRESERVATION_EXPECTED_HEAD_REQUIRED');

  for (const blocker of [
    'COMMAND_PRESERVATION_FIELDS_NOT_ALLOWED',
    'COMMAND_PRESERVATION_FIELDS_INCOMPLETE',
    'COMMAND_PRESERVATION_PROFILE_NOT_ALLOWED',
    'COMMAND_PRESERVATION_APPROVAL_REQUIRED',
    'COMMAND_PRESERVATION_EXPECTED_HEAD_REQUIRED',
  ]) assert.equal(isTerminalizableOwnerCommandBlocker(blocker), true);
});

test('mailbox selection preserves the dedicated sync operation and exact preservation pair', () => {
  const batch = selectBattleBridgeGitHubCommandBatch([comment()], { now: NOW });
  assert.equal(batch.ok, true);
  assert.equal(batch.verdict, 'COMMAND_BATCH_READY');
  assert.equal(batch.commands.length, 1);
  assert.equal(batch.commands[0].command.operation, BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION);
  assert.equal(batch.commands[0].command.preservationProfile, BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE);
  assert.equal(batch.commands[0].command.preservationApproval, 'operator-approved');

  const rejected = selectBattleBridgeGitHubCommandBatch([
    comment(command({ preservationProfile: 'other-profile' }), { id: 2055002 }),
  ], { now: NOW });
  assert.equal(rejected.verdict, 'NO_COMMAND_READY');
  assert.equal(rejected.terminalRejections.length, 1);
  assert.equal(rejected.terminalRejections[0].blocker, 'COMMAND_PRESERVATION_PROFILE_NOT_ALLOWED');
});

test('dedicated preservation sync runs #1983 and terminates without the update/runtime handler', async () => {
  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  assert.equal(validated.ok, true);

  let syncInput = null;
  let updateCalls = 0;
  const result = await executeBattleBridgeGitHubCommand(validated.command, {
    syncCodexDispatchBridgeFn: async (input = {}) => {
      syncInput = input;
      return {
        ok: true,
        status: 'DONE',
        verdict: 'PASS',
        branch: 'main',
        afterHead: HEAD,
        preservation: { ok: true, profile: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE },
      };
    },
    updateStephanos: async () => {
      updateCalls += 1;
      return { ok: true, status: 'DONE', finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_EXECUTION_COMPLETE');
  assert.equal(result.operation, BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION);
  assert.equal(result.runtimeRefreshAttempted, false);
  assert.equal(updateCalls, 0);
  assert.equal(syncInput.expectedBranch, 'main');
  assert.equal(syncInput.operatorApproval, 'operator-approved');
  assert.equal(syncInput.preservationProfile, BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE);
  assert.equal(syncInput.preservationApproval, 'operator-approved');
  assert.equal(typeof syncInput.spawnSyncFn, 'function');
  assert.equal(result.preservationSync.afterHead, HEAD);
});

test('moving origin/main is rejected before #1983 can preserve against a superseding head', async () => {
  let updateCalls = 0;
  let remoteReadStatus = null;
  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });

  const result = await executeBattleBridgeGitHubCommand(validated.command, {
    spawnSyncFn: () => ({ status: 0, stdout: `${OTHER_HEAD}\n`, stderr: '', error: null }),
    syncCodexDispatchBridgeFn: async (input = {}) => {
      const guarded = input.spawnSyncFn('git', ['rev-parse', 'origin/main'], { cwd: '/canonical/repo' });
      remoteReadStatus = guarded.status;
      return {
        ok: false,
        status: 'FAILED',
        verdict: 'FAIL',
        blocker: guarded.status === 0 ? 'UNEXPECTED_GUARD_PASS' : 'REMOTE_STATE_READ_FAILED',
      };
    },
    updateStephanos: async () => {
      updateCalls += 1;
      return { ok: true };
    },
  });

  assert.equal(remoteReadStatus, 1);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'REMOTE_STATE_READ_FAILED');
  assert.equal(updateCalls, 0);
});

test('a preservation sync whose final head differs from the approved head blocks without runtime refresh', async () => {
  let updateCalls = 0;
  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  const result = await executeBattleBridgeGitHubCommand(validated.command, {
    syncCodexDispatchBridgeFn: async () => ({ ok: true, status: 'DONE', afterHead: OTHER_HEAD }),
    updateStephanos: async () => {
      updateCalls += 1;
      return { ok: true };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'COMMAND_PRESERVATION_TARGET_HEAD_MISMATCH');
  assert.equal(updateCalls, 0);
});

test('ordinary updates remain on the existing path with no preservation pre-sync', async () => {
  const ordinary = command({ operation: 'UPDATE_STEPHANOS_FROM_CHAT' });
  delete ordinary.preservationProfile;
  delete ordinary.preservationApproval;
  const validated = validateBattleBridgeGitHubCommand(ordinary, {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  assert.equal(validated.ok, true);

  let syncCalls = 0;
  let updateCalls = 0;
  const result = await executeBattleBridgeGitHubCommand(validated.command, {
    syncCodexDispatchBridgeFn: async () => {
      syncCalls += 1;
      return { ok: true, afterHead: HEAD };
    },
    updateStephanos: async () => {
      updateCalls += 1;
      return { ok: true, status: 'DONE', finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(syncCalls, 0);
  assert.equal(updateCalls, 1);
});
