import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_GITHUB_COMMAND_MARKER,
  BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
  executeBattleBridgeGitHubCommand,
  selectBattleBridgeGitHubCommandBatch,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';
import {
  BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
} from './battleBridgeDirtyDataPreservationV1.mjs';

const NOW = new Date('2026-08-30T07:30:00.000Z');
const HEAD = 'bdb98e525ccd62c0a9c460533b75594eda11cb0c';

function command(overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId: 'runtime-data-preservation-0001',
    operation: 'UPDATE_STEPHANOS_FROM_CHAT',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    preservationProfile: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
    preservationApproval: 'operator-approved',
    expiresAt: '2026-08-30T08:00:00.000Z',
    ...overrides,
  };
}

function comment(payload = command(), overrides = {}) {
  return {
    id: 2054001,
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-2054001',
    created_at: NOW.toISOString(),
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`${BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(payload)}\n\`\`\``,
    ...overrides,
  };
}

test('accepts only the exact #1983 runtime-data preservation pair on the existing update operation', () => {
  const accepted = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.verdict, 'COMMAND_ACCEPTED');
  assert.equal(accepted.command.operation, 'UPDATE_STEPHANOS_FROM_CHAT');
  assert.equal(accepted.command.preservationProfile, BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE);
  assert.equal(accepted.command.preservationApproval, 'operator-approved');

  assert.equal(validateBattleBridgeGitHubCommand(command({
    preservationProfile: 'other-profile',
  }), { authorLogin: 'Cheekyfellastef', now: NOW }).blocker, 'COMMAND_PRESERVATION_PROFILE_NOT_ALLOWED');

  assert.equal(validateBattleBridgeGitHubCommand(command({
    preservationApproval: 'not-approved',
  }), { authorLogin: 'Cheekyfellastef', now: NOW }).blocker, 'COMMAND_PRESERVATION_APPROVAL_REQUIRED');

  const missingApproval = command();
  delete missingApproval.preservationApproval;
  assert.equal(validateBattleBridgeGitHubCommand(missingApproval, {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
  }).blocker, 'COMMAND_PRESERVATION_FIELDS_INCOMPLETE');

  assert.equal(validateBattleBridgeGitHubCommand(command({
    operation: 'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
  }), { authorLogin: 'Cheekyfellastef', now: NOW }).blocker, 'COMMAND_PRESERVATION_FIELDS_NOT_ALLOWED');
});

test('mailbox selection preserves the exact preservation pair without creating another operation', () => {
  const batch = selectBattleBridgeGitHubCommandBatch([comment()], { now: NOW });
  assert.equal(batch.ok, true);
  assert.equal(batch.verdict, 'COMMAND_BATCH_READY');
  assert.equal(batch.commands.length, 1);
  assert.equal(batch.commands[0].command.operation, 'UPDATE_STEPHANOS_FROM_CHAT');
  assert.equal(batch.commands[0].command.preservationProfile, BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE);
  assert.equal(batch.commands[0].command.preservationApproval, 'operator-approved');

  const rejected = selectBattleBridgeGitHubCommandBatch([
    comment(command({ preservationProfile: 'other-profile' }), { id: 2054002 }),
  ], { now: NOW });
  assert.equal(rejected.verdict, 'NO_COMMAND_READY');
  assert.equal(rejected.terminalRejections.length, 1);
  assert.equal(rejected.terminalRejections[0].blocker, 'COMMAND_PRESERVATION_PROFILE_NOT_ALLOWED');
});

test('preservation-capable update injects #1983 only into the existing sync call', async () => {
  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
  });
  assert.equal(validated.ok, true);

  const syncCalls = [];
  let updateCalls = 0;
  const result = await executeBattleBridgeGitHubCommand(validated.command, {
    syncCodexDispatchBridgeFn: (input = {}) => {
      syncCalls.push(input);
      return {
        ok: true,
        status: 'DONE',
        verdict: 'PASS',
        branch: 'main',
        afterHead: HEAD,
        preservation: { ok: true, profile: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE },
      };
    },
    updateStephanos: async (payload = {}) => {
      updateCalls += 1;
      assert.equal(payload.operation, 'UPDATE_STEPHANOS_FROM_CHAT');
      assert.equal(typeof payload.syncFn, 'function');
      const sync = await payload.syncFn({
        repoRoot: 'C:/Users/test/Documents/GitHub/stephan-os',
        expectedBranch: 'main',
        expectedHead: HEAD,
        operatorApproval: 'operator-approved',
      });
      return {
        ok: true,
        status: 'DONE',
        verdict: 'PASS',
        finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD',
        sourceHead: HEAD,
        expectedHeadMatch: true,
        sync,
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(updateCalls, 1);
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0].expectedHead, HEAD);
  assert.equal(syncCalls[0].operatorApproval, 'operator-approved');
  assert.equal(syncCalls[0].preservationProfile, BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE);
  assert.equal(syncCalls[0].preservationApproval, 'operator-approved');
});

test('ordinary updates remain on the existing unmodified sync path', async () => {
  const ordinary = command();
  delete ordinary.preservationProfile;
  delete ordinary.preservationApproval;
  const validated = validateBattleBridgeGitHubCommand(ordinary, {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
  });
  assert.equal(validated.ok, true);

  let payloadSeen = null;
  const result = await executeBattleBridgeGitHubCommand(validated.command, {
    updateStephanos: async (payload = {}) => {
      payloadSeen = payload;
      return { ok: true, status: 'DONE', finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(typeof payloadSeen.syncFn, 'undefined');
  assert.equal(payloadSeen.preservationProfile, undefined);
  assert.equal(payloadSeen.preservationApproval, undefined);
});
