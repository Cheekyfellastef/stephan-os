import assert from 'node:assert/strict';
import test from 'node:test';

import * as mailbox from './battleBridgeGitHubCommandMailbox.mjs';
import * as legacy from './battleBridgeGitHubCommandMailboxLegacyV1.mjs';
import { MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION } from '../../scripts/mission-worker-diagnostic-link.mjs';

const HEAD = 'f7a71effd7acb5fc4dd05a5a6891e050a6448d02';
const NOW = new Date('2026-09-01T18:10:00.000Z');
const AUTHORED = new Date('2026-09-01T18:09:00.000Z');
const EXPIRES = '2026-09-01T19:00:00.000Z';
const DIAGNOSTIC_FIELDS = [
  'branch',
  'expectedHead',
  'expiresAt',
  'issueNumber',
  'operation',
  'operatorApproval',
  'repository',
  'requestId',
  'schemaVersion',
];

function command(overrides = {}) {
  return {
    schemaVersion: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId: 'diagnostic-link-test-20260901',
    operation: MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION,
    repository: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
    issueNumber: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

function validationOptions() {
  return {
    authorLogin: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR,
    now: NOW,
    authoredAt: AUTHORED,
  };
}

function diagnosticComment(id = 1001) {
  return {
    id,
    html_url: `https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-${id}`,
    body: `\`\`\`${mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(command())}\n\`\`\``,
    user: { login: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR },
    created_at: AUTHORED.toISOString(),
  };
}

test('overlay preserves every legacy operation and adds only the diagnostic link operation', () => {
  for (const operation of legacy.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS) {
    assert.ok(mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(operation));
  }
  const added = mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS
    .filter((operation) => !legacy.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(operation));
  assert.deepEqual(added, [MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION]);
});

test('diagnostic link requires exact expected head', () => {
  const result = mailbox.validateBattleBridgeGitHubCommand(command({ expectedHead: '' }), validationOptions());
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MISSION_WORKER_DIAGNOSTIC_LINK_EXPECTED_HEAD_REQUIRED');
  assert.equal(mailbox.isTerminalizableOwnerCommandBlocker(result.blocker), true);
});

test('diagnostic link rejects every field outside the ordinary canonical envelope', () => {
  for (const field of ['taskName', 'pid', 'path', 'executable', 'args', 'arguments', 'command', 'script', 'targetRequestId']) {
    const result = mailbox.validateBattleBridgeGitHubCommand(command({ [field]: 'unsafe' }), validationOptions());
    assert.equal(result.ok, false, field);
    assert.equal(result.blocker, 'MISSION_WORKER_DIAGNOSTIC_LINK_FIELD_NOT_ALLOWED', field);
    assert.equal(result.field, field);
  }
});

test('valid diagnostic link is sanitized to only its closed-world envelope and remains CONTROL', () => {
  const result = mailbox.validateBattleBridgeGitHubCommand(command(), validationOptions());
  assert.equal(result.ok, true);
  assert.equal(result.command.operation, MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION);
  assert.equal(result.command.expectedHead, HEAD);
  assert.deepEqual(Object.keys(result.command).sort(), DIAGNOSTIC_FIELDS);
  assert.equal(result.command.targetRequestId, undefined);
  assert.equal(
    mailbox.classifyBattleBridgeMailboxOperation(MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION),
    mailbox.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL,
  );
});

test('batch selection removes legacy normalization fields before diagnostic execution', () => {
  const result = mailbox.selectBattleBridgeGitHubCommandBatch([diagnosticComment()], { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_BATCH_READY');
  assert.equal(result.commands.length, 1);
  assert.equal(result.commands[0].command.operation, MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION);
  assert.equal(result.commands[0].command.expectedHead, HEAD);
  assert.deepEqual(Object.keys(result.commands[0].command).sort(), DIAGNOSTIC_FIELDS);
  assert.equal(result.commands[0].command.targetRequestId, undefined);
  assert.equal(result.commands[0].command.prNumber, undefined);
  assert.equal(result.commands[0].command.proofScenario, undefined);
  assert.equal(result.commands[0].command.proofTarget, undefined);
  assert.equal(result.commands[0].command.pullRequestHead, undefined);
  assert.equal(result.commands[0].partition, mailbox.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL);
  assert.equal(result.controlCount, 1);
});

test('selected diagnostic command executes without rejecting legacy normalized metadata', async () => {
  const selected = mailbox.selectBattleBridgeGitHubCommandBatch([diagnosticComment(1003)], { now: NOW });
  assert.equal(selected.ok, true);
  assert.equal(selected.verdict, 'COMMAND_BATCH_READY');
  let observed = null;
  const result = await mailbox.executeBattleBridgeGitHubCommand(selected.commands[0].command, {
    runMissionWorkerDiagnosticLinkFn: async (input) => {
      observed = input;
      return {
        ok: true,
        blocker: '',
        finalVerdict: 'MISSION_WORKER_DIAGNOSTIC_LINK_PASS',
        expectedHead: input.expectedHead,
      };
    },
  });
  assert.deepEqual(observed, { expectedHead: HEAD });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_EXECUTION_COMPLETE');
});

test('empty rejected diagnostic head remains empty in the durable terminal projection', () => {
  const invalid = command({ expectedHead: '' });
  const body = `\`\`\`${mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(invalid)}\n\`\`\``;
  const result = mailbox.selectBattleBridgeGitHubCommandBatch([{
    id: 1004,
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-1004',
    body,
    user: { login: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR },
    created_at: AUTHORED.toISOString(),
  }], { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'NO_COMMAND_READY');
  assert.equal(result.terminalRejections.length, 1);
  assert.equal(result.terminalRejections[0].blocker, 'MISSION_WORKER_DIAGNOSTIC_LINK_EXPECTED_HEAD_REQUIRED');
  assert.equal(result.terminalRejections[0].command.operation, MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION);
  assert.equal(result.terminalRejections[0].command.expectedHead, '');
  assert.notEqual(result.terminalRejections[0].command.expectedHead, '0'.repeat(40));
  assert.deepEqual(Object.keys(result.terminalRejections[0].command).sort(), DIAGNOSTIC_FIELDS);
});

test('invalid diagnostic command terminalizes with diagnostic blocker rather than legacy translation blocker', () => {
  const invalid = command({ path: 'C:\\temp\\anything' });
  const body = `\`\`\`${mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(invalid)}\n\`\`\``;
  const result = mailbox.selectBattleBridgeGitHubCommandBatch([{
    id: 1002,
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-1002',
    body,
    user: { login: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR },
    created_at: AUTHORED.toISOString(),
  }], { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'NO_COMMAND_READY');
  assert.equal(result.rejected[0].blocker, 'MISSION_WORKER_DIAGNOSTIC_LINK_FIELD_NOT_ALLOWED');
  assert.equal(result.terminalRejections[0].blocker, 'MISSION_WORKER_DIAGNOSTIC_LINK_FIELD_NOT_ALLOWED');
  assert.equal(result.terminalRejections[0].command.operation, MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION);
  assert.deepEqual(Object.keys(result.terminalRejections[0].command).sort(), DIAGNOSTIC_FIELDS);
});

test('executor passes only expectedHead into diagnostic adapter', async () => {
  let observed = null;
  const result = await mailbox.executeBattleBridgeGitHubCommand(command(), {
    runMissionWorkerDiagnosticLinkFn: async (input) => {
      observed = input;
      return {
        ok: true,
        blocker: '',
        finalVerdict: 'MISSION_WORKER_DIAGNOSTIC_LINK_PASS',
        expectedHead: input.expectedHead,
      };
    },
  });
  assert.deepEqual(observed, { expectedHead: HEAD });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_EXECUTION_COMPLETE');
  assert.equal(result.operation, MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION);
});

test('executor preserves typed downstream diagnostic blocker', async () => {
  const result = await mailbox.executeBattleBridgeGitHubCommand(command(), {
    runMissionWorkerDiagnosticLinkFn: async () => ({
      ok: false,
      blocker: 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
      finalVerdict: 'MISSION_WORKER_DIAGNOSTIC_LINK_BLOCKED',
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.verdict, 'COMMAND_EXECUTION_BLOCKED');
  assert.equal(result.blocker, 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT');
  assert.equal(result.result.blocker, 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT');
});
