import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
} from '../shared/agents/battleBridgeGitHubCommandMailbox.mjs';
import {
  BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
} from '../shared/agents/battleBridgeDirtyDataPreservationV1.mjs';
import {
  executeExactHeadBattleBridgePreservationSync,
} from './battle-bridge-exact-head-preservation-sync.mjs';

const HEAD = 'a'.repeat(40);

function successfulSync(afterHead = HEAD) {
  return {
    ok: true,
    preservationSync: {
      ok: true,
      afterHead,
      preservation: {
        ok: true,
        receipt: {
          itemCount: 6,
          allHashesVerified: true,
        },
        destructiveCleanupPerformed: false,
      },
      destructiveCleanupPerformed: false,
    },
  };
}

test('exact-head adapter binds canonical preservation command before execution', async () => {
  let observed = null;
  const result = await executeExactHeadBattleBridgePreservationSync(HEAD, {
    executeCommand: async (command) => {
      observed = command;
      return successfulSync();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.afterHead, HEAD);
  assert.equal(result.expectedHead, HEAD);
  assert.equal(result.exactHeadBound, true);
  assert.deepEqual(observed, {
    operation: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
    requestId: `tailscale-bootstrap-${HEAD.slice(0, 12)}`,
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    preservationProfile: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
    preservationApproval: 'operator-approved',
  });
});

test('invalid expected head fails before canonical executor invocation', async () => {
  let called = false;
  const result = await executeExactHeadBattleBridgePreservationSync('latest', {
    executeCommand: async () => {
      called = true;
      return successfulSync();
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'EXACT_HEAD_PRESERVATION_EXPECTED_HEAD_INVALID');
  assert.equal(result.fileMovePerformed, false);
  assert.equal(called, false);
});

test('mismatched post-sync head cannot produce an accepted bootstrap proof', async () => {
  const result = await executeExactHeadBattleBridgePreservationSync(HEAD, {
    executeCommand: async () => successfulSync('b'.repeat(40)),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'EXACT_HEAD_PRESERVATION_SYNC_INVALID');
  assert.equal(result.fileMovePerformed, false);
  assert.equal(result.destructiveCleanupPerformed, false);
});

test('canonical executor blocker remains terminal and cannot be painted green', async () => {
  const result = await executeExactHeadBattleBridgePreservationSync(HEAD, {
    executeCommand: async () => ({
      ok: false,
      blocker: 'REMOTE_STATE_READ_FAILED',
      result: {
        fileMovePerformed: false,
        destructiveCleanupPerformed: false,
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'REMOTE_STATE_READ_FAILED');
  assert.equal(result.fileMovePerformed, false);
  assert.equal(result.destructiveCleanupPerformed, false);
});
