import assert from 'node:assert/strict';
import test from 'node:test';

import * as core from './battleBridgeGitHubCommandMailboxCoreV1.mjs';
import {
  BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  executeBattleBridgeGitHubCommand,
  selectBattleBridgeGitHubCommandBatch,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';
import {
  GUARDED_CODEX_TASK_READBACK_OPERATION,
  executeGuardedCodexTaskReadbackOnBattleBridge,
} from './battleBridgeCodexTaskReadbackV1.mjs';
import {
  createSanitizedMailboxReceiptProjection,
  serializeBoundedReceiptJson,
} from '../../scripts/battle-bridge-github-command-mailbox.mjs';

const HEAD = '160716eb5a506621abf18902e4f1a1e07d8f9768';
const TASK_ID = 'codex-job-e7a8b1396d4fc45fa44b';
const NOW = new Date('2026-09-25T05:12:00.000Z');

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'octopus-final-link-codex-readback-v1',
    operation: GUARDED_CODEX_TASK_READBACK_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    taskId: TASK_ID,
    expiresAt: '2026-09-25T06:00:00.000Z',
    ...overrides,
  };
}

function comment(value = command()) {
  return {
    id: 88771,
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/2158#issuecomment-88771',
    created_at: NOW.toISOString(),
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`${core.BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(value)}\n\`\`\``,
  };
}

test('mailbox admits only the exact bounded Codex readback command', () => {
  assert.equal(BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(GUARDED_CODEX_TASK_READBACK_OPERATION), true);
  const validation = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.command.operation, GUARDED_CODEX_TASK_READBACK_OPERATION);
  assert.equal(validation.command.taskId, TASK_ID);

  const hostile = validateBattleBridgeGitHubCommand(command({ url: 'https://example.test' }), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  assert.equal(hostile.ok, false);
  assert.equal(hostile.blocker, 'GUARDED_CODEX_READBACK_FIELD_NOT_ALLOWED');
});

test('readback remains serialized and survives canonical mailbox selection', () => {
  const selected = selectBattleBridgeGitHubCommandBatch([comment()], {
    now: NOW,
    maxBatch: 1,
    consumedRequestIds: new Set(),
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.commands.length, 1);
  assert.equal(selected.commands[0].command.operation, GUARDED_CODEX_TASK_READBACK_OPERATION);
  assert.equal(selected.commands[0].command.taskId, TASK_ID);
  assert.equal(selected.commands[0].partition, core.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL);
});

test('readback projects only bounded result evidence and no mutation authority', async () => {
  const result = await executeGuardedCodexTaskReadbackOnBattleBridge(command(), {
    repoRoot: 'C:\\repo',
    sharedWorkspaceRoot: 'C:\\workspace',
    readCanonicalHeadFn: async () => HEAD,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'GUARDED_CODEX_TASK_NOT_FOUND');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.sourceMutationAuthority, false);
});

test('wrapper normalizes guarded Codex custom results into the standard mailbox execution envelope', async () => {
  const result = await executeBattleBridgeGitHubCommand(command(), {
    executeGuardedCodexTaskReadbackOnBattleBridgeFn: async () => ({
      ok: true,
      finalVerdict: 'GUARDED_CODEX_TASK_RESULT_PASS',
      taskId: TASK_ID,
      codexTaskStatus: 'DONE',
      codexResultVerdict: 'PASS',
      codexLastMessage: 'The final link is healthy.',
      codexNextOperatorAction: 'Advance the owning goal.',
      codexSourceHeadBefore: HEAD,
      codexSourceHeadAfter: HEAD,
      codexSourceHeadUnchanged: true,
      codexSourceMutationDetected: false,
      codexGeneratedRuntimeMutationDetected: false,
      codexEventCount: 14,
      mergeAuthority: false,
      sourceMutationAuthority: false,
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_EXECUTION_COMPLETE');
  assert.equal(result.operation, GUARDED_CODEX_TASK_READBACK_OPERATION);
  assert.equal(result.result.taskId, TASK_ID);
  assert.equal(result.result.mergeAuthority, false);
});

test('sanitized GitHub receipt preserves bounded Codex task visibility', () => {
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'octopus-final-link-codex-readback-v1',
    operation: GUARDED_CODEX_TASK_READBACK_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    state: 'DONE',
    expectedHead: HEAD,
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: GUARDED_CODEX_TASK_READBACK_OPERATION,
      requestId: 'octopus-final-link-codex-readback-v1',
      result: {
        ok: true,
        finalVerdict: 'GUARDED_CODEX_TASK_RESULT_PASS',
        taskId: TASK_ID,
        codexTaskStatus: 'DONE',
        codexResultVerdict: 'PASS',
        codexLastMessage: 'Codex found the final link healthy.',
        codexNextOperatorAction: 'Advance the owning goal.',
        codexSourceHeadBefore: HEAD,
        codexSourceHeadAfter: HEAD,
        codexSourceHeadUnchanged: true,
        codexSourceMutationDetected: false,
        codexGeneratedRuntimeMutationDetected: false,
        codexEventCount: 9,
      },
    },
  };
  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.operationResult.taskId, TASK_ID);
  assert.equal(projected.operationResult.codexTaskStatus, 'DONE');
  assert.equal(projected.operationResult.codexResultVerdict, 'PASS');
  assert.equal(projected.operationResult.codexLastMessage, 'Codex found the final link healthy.');
  const serialized = JSON.parse(serializeBoundedReceiptJson(receipt));
  assert.equal(serialized.result.result.codexNextOperatorAction, 'Advance the owning goal.');
  assert.equal(serialized.result.result.codexSourceHeadUnchanged, true);
});
