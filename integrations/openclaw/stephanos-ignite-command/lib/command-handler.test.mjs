import assert from 'node:assert/strict';
import test from 'node:test';

import { handleStephanosIgniteCommand } from './command-handler.mjs';

const HEAD = 'a'.repeat(40);

test('registered command handler awaits bounded owner-lane admission and renders its executing receipt', async () => {
  let resolved = false;
  let captured;
  const responsePromise = handleStephanosIgniteCommand({ args: `update ${HEAD}`, senderIsOwner: true }, {
    queueUpdateFn: async (input) => {
      captured = input;
      await Promise.resolve();
      resolved = true;
      return {
        ok: true,
        status: 'EXECUTING',
        finalVerdict: 'UPDATE_EXECUTION_RUNNING',
        blocker: '',
        expectedHead: HEAD,
        receiptId: '1'.repeat(32),
        runtimeProofPassed: false,
        pluginReloadProofPending: false,
      };
    },
  });
  assert.equal(resolved, false);
  const response = await responsePromise;
  assert.equal(resolved, true);
  assert.equal(captured.expectedHead, HEAD);
  assert.equal(captured.authenticatedContext.senderIsOwner, true);
  assert.match(response.text, /BATTLE_BRIDGE_EXACT_HEAD_UPDATE=ACCEPTED/);
  assert.match(response.text, /VERDICT=UPDATE_EXECUTION_RUNNING/);
  assert.match(response.text, new RegExp(`RECEIPT_ID=${'1'.repeat(32)}`));
  assert.match(response.text, /PLUGIN_RELOAD_PROOF_PENDING=false/);
});

test('registered command handler preserves non-owner truth for the queue gate', async () => {
  const response = await handleStephanosIgniteCommand({ args: `update ${HEAD}`, senderIsOwner: false }, {
    queueUpdateFn: async (input) => {
      assert.equal(input.authenticatedContext.senderIsOwner, false);
      return { ok: false, expectedHead: HEAD, blocker: 'OWNER_AUTH_REQUIRED', finalVerdict: 'OWNER_AUTH_REQUIRED' };
    },
  });
  assert.match(response.text, /BATTLE_BRIDGE_EXACT_HEAD_UPDATE=BLOCKED/);
  assert.match(response.text, /REASON=OWNER_AUTH_REQUIRED/);
});

test('registered command handler exposes one owner-gated bounded receipt status point read', async () => {
  const receiptId = '2'.repeat(32);
  const response = await handleStephanosIgniteCommand({ args: `update-status ${receiptId}`, senderIsOwner: true }, {
    readUpdateStatusFn: async (input) => {
      assert.equal(input.receiptId, receiptId);
      assert.equal(input.authenticatedContext.senderIsOwner, true);
      return {
        ok: true,
        receiptId,
        status: 'FAILED',
        finalVerdict: 'SOURCE_SYNC_FAILED',
        blocker: 'SOURCE_SYNC_FAILED',
        expectedHead: HEAD,
        sourceHead: '',
        retrySafe: true,
      };
    },
  });
  assert.match(response.text, /BATTLE_BRIDGE_EXACT_HEAD_UPDATE_STATUS=OBSERVED/);
  assert.match(response.text, /EXECUTION_STATUS=FAILED/);
  assert.match(response.text, /RETRY_SAFE=true/);
  assert.match(response.text, /CURRENT_INVOCATION_READ_ONLY=true/);
});

test('receipt status point read preserves non-owner rejection', async () => {
  const receiptId = '3'.repeat(32);
  const response = await handleStephanosIgniteCommand({ args: `update-status ${receiptId}`, senderIsOwner: false }, {
    readUpdateStatusFn: async (input) => {
      assert.equal(input.authenticatedContext.senderIsOwner, false);
      return { ok: false, receiptId, blocker: 'OWNER_AUTH_REQUIRED', finalVerdict: 'OWNER_AUTH_REQUIRED' };
    },
  });
  assert.match(response.text, /BATTLE_BRIDGE_EXACT_HEAD_UPDATE_STATUS=BLOCKED/);
  assert.match(response.text, /REASON=OWNER_AUTH_REQUIRED/);
});
