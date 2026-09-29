import assert from 'node:assert/strict';
import test from 'node:test';

import * as core from './battleBridgeGitHubCommandMailboxCoreV1.mjs';
import {
  BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  classifyBattleBridgeMailboxOperation,
  executeBattleBridgeGitHubCommand,
  selectBattleBridgeGitHubCommandBatch,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';
import { OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION } from './operatorEnvironmentApprovalBattleBridgeV1.mjs';

const NOW = new Date('2026-09-20T19:20:00.000Z');
const MAIN = '87cebc8f00bdd55935caaa1ab556d0f2a9be2497';
const PR_HEAD = '0d2bf004b0e5ff962579f599cb83e793bcb9b8e5';

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'approve-env-2306-0d2bf004',
    operation: OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: MAIN,
    prNumber: 2306,
    expectedPullRequestBranch: 'fix/mailbox-receipt-index-convergence-v1',
    expectedPullRequestHead: PR_HEAD,
    workflowRunId: 35526640020,
    expiresAt: '2026-09-20T23:59:00.000Z',
    ...overrides,
  };
}

function comment(commandValue = command()) {
  return {
    id: 990001,
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/2158#issuecomment-990001',
    created_at: '2026-09-20T19:20:00.000Z',
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`${core.BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(commandValue)}\n\`\`\``,
  };
}

test('canonical mailbox exposes the bounded environment-approval operation without changing legacy classification', () => {
  assert.equal(BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION), true);
  assert.equal(classifyBattleBridgeMailboxOperation(OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION), core.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL);
  assert.equal(classifyBattleBridgeMailboxOperation('READ_DEPLOYMENT_STATUS'), core.classifyBattleBridgeMailboxOperation('READ_DEPLOYMENT_STATUS'));
});

test('owner-authored exact environment approval survives canonical mailbox validation and selection', () => {
  const validation = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.command.operation, OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION);
  assert.equal(validation.command.prNumber, 2306);

  const selected = selectBattleBridgeGitHubCommandBatch([comment()], {
    now: NOW,
    maxBatch: 1,
    consumedRequestIds: new Set(),
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.commands.length, 1);
  assert.equal(selected.commands[0].command.operation, OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION);
  assert.equal(selected.commands[0].command.workflowRunId, 35526640020);
});

test('invalid environment-approval shape terminalizes instead of falling through to another operation', () => {
  const selected = selectBattleBridgeGitHubCommandBatch([comment(command({ url: 'https://example.test' }))], {
    now: NOW,
    maxBatch: 1,
    consumedRequestIds: new Set(),
  });
  assert.equal(selected.commands.length, 0);
  assert.equal(selected.terminalRejections.length, 1);
  assert.equal(selected.terminalRejections[0].blocker, 'OPERATOR_ENVIRONMENT_APPROVAL_FIELD_NOT_ALLOWED');
  assert.equal(selected.terminalRejections[0].command.operation, OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION);
});

test('execution routes only the bounded operation to its dedicated executor', async () => {
  let seen = null;
  const result = await executeBattleBridgeGitHubCommand(command(), {
    executeOperatorEnvironmentApprovalOnBattleBridgeFn: async (input) => {
      seen = input;
      return Object.freeze({
        ok: true,
        verdict: 'COMMAND_EXECUTION_COMPLETE',
        operation: OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION,
        requestId: input.requestId,
        responseStatus: 204,
        mergeAuthority: false,
      });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.mergeAuthority, false);
  assert.equal(seen.workflowRunId, 35526640020);
  assert.equal(seen.expectedHead, MAIN);
});
