import assert from 'node:assert/strict';
import test from 'node:test';

import * as mailbox from './battleBridgeGitHubCommandMailbox.mjs';
import * as legacy from './battleBridgeGitHubCommandMailboxLegacyV1.mjs';
import {
  STARFIELD_VR_DELIVERY_STATUS_OPERATION,
  STARFIELD_VR_SHORTCUT_INSTALL_OPERATION,
} from './starfieldVrBattleBridgeMailboxV1.mjs';
import {
  createSanitizedMailboxReceiptProjection,
  serializeBoundedReceiptJson,
} from '../../scripts/battle-bridge-github-command-mailbox.mjs';

const HEAD = 'a7c77126d301c955e349817a7937ce83eb19764c';
const NOW = new Date('2026-09-18T12:30:00.000Z');
const AUTHORED = new Date('2026-09-18T12:29:00.000Z');
const EXPIRES = '2026-09-18T13:30:00.000Z';
const FIELDS = [
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

function command(operation, overrides = {}) {
  return {
    schemaVersion: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId: `starfield-vr-mailbox-${operation === STARFIELD_VR_DELIVERY_STATUS_OPERATION ? 'read' : 'install'}-0001`,
    operation,
    repository: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
    issueNumber: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

function options() {
  return {
    authorLogin: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR,
    now: NOW,
    authoredAt: AUTHORED,
  };
}

function comment(id, operation, overrides = {}) {
  return {
    id,
    html_url: `https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-${id}`,
    body: `\`\`\`${mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(command(operation, overrides))}\n\`\`\``,
    user: { login: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR },
    created_at: AUTHORED.toISOString(),
  };
}

test('canonical mailbox preserves legacy operations and exposes both bounded Starfield VR operations', () => {
  for (const operation of legacy.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS) {
    assert.ok(mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(operation));
  }
  assert.ok(mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(STARFIELD_VR_DELIVERY_STATUS_OPERATION));
  assert.ok(mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(STARFIELD_VR_SHORTCUT_INSTALL_OPERATION));
});

test('Starfield VR commands retain the ordinary canonical envelope and exact-head binding', () => {
  for (const operation of [STARFIELD_VR_DELIVERY_STATUS_OPERATION, STARFIELD_VR_SHORTCUT_INSTALL_OPERATION]) {
    const result = mailbox.validateBattleBridgeGitHubCommand(command(operation), options());
    assert.equal(result.ok, true, operation);
    assert.equal(result.command.operation, operation);
    assert.equal(result.command.expectedHead, HEAD);
    assert.deepEqual(Object.keys(result.command).sort(), FIELDS);
  }
});

test('Starfield VR mailbox refuses arbitrary path or execution fields', () => {
  for (const field of ['path', 'executable', 'args', 'arguments', 'command', 'script', 'profilePath']) {
    const result = mailbox.validateBattleBridgeGitHubCommand(
      command(STARFIELD_VR_SHORTCUT_INSTALL_OPERATION, { [field]: 'unsafe' }),
      options(),
    );
    assert.equal(result.ok, false, field);
    assert.equal(result.blocker, 'STARFIELD_VR_FIELD_NOT_ALLOWED', field);
    assert.equal(mailbox.isTerminalizableOwnerCommandBlocker(result.blocker), true);
  }
});

test('Starfield VR read is observation and install is control', () => {
  assert.equal(
    mailbox.classifyBattleBridgeMailboxOperation(STARFIELD_VR_DELIVERY_STATUS_OPERATION),
    mailbox.BATTLE_BRIDGE_MAILBOX_PARTITION.OBSERVATION,
  );
  assert.equal(
    mailbox.classifyBattleBridgeMailboxOperation(STARFIELD_VR_SHORTCUT_INSTALL_OPERATION),
    mailbox.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL,
  );
});

test('batch selection restores exact Starfield VR operation after legacy envelope validation', () => {
  const result = mailbox.selectBattleBridgeGitHubCommandBatch([
    comment(2001, STARFIELD_VR_DELIVERY_STATUS_OPERATION),
    comment(2002, STARFIELD_VR_SHORTCUT_INSTALL_OPERATION),
  ], { now: NOW, maxBatch: 4 });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_BATCH_READY');
  assert.equal(result.commands.length, 2);
  const read = result.commands.find((entry) => entry.command.operation === STARFIELD_VR_DELIVERY_STATUS_OPERATION);
  const install = result.commands.find((entry) => entry.command.operation === STARFIELD_VR_SHORTCUT_INSTALL_OPERATION);
  assert.ok(read);
  assert.ok(install);
  assert.deepEqual(Object.keys(read.command).sort(), FIELDS);
  assert.deepEqual(Object.keys(install.command).sort(), FIELDS);
  assert.equal(read.partition, mailbox.BATTLE_BRIDGE_MAILBOX_PARTITION.OBSERVATION);
  assert.equal(install.partition, mailbox.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL);
});

test('invalid Starfield VR envelope terminalizes with Starfield blocker rather than translation blocker', () => {
  const result = mailbox.selectBattleBridgeGitHubCommandBatch([
    comment(2003, STARFIELD_VR_SHORTCUT_INSTALL_OPERATION, { path: 'C:\\temp\\anything' }),
  ], { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'NO_COMMAND_READY');
  assert.equal(result.rejected[0].blocker, 'STARFIELD_VR_FIELD_NOT_ALLOWED');
  assert.equal(result.terminalRejections[0].blocker, 'STARFIELD_VR_FIELD_NOT_ALLOWED');
  assert.equal(result.terminalRejections[0].command.operation, STARFIELD_VR_SHORTCUT_INSTALL_OPERATION);
  assert.deepEqual(Object.keys(result.terminalRejections[0].command).sort(), FIELDS);
});

test('selected Starfield VR install routes through the existing bounded adapter executor', async () => {
  const selected = mailbox.selectBattleBridgeGitHubCommandBatch([
    comment(2004, STARFIELD_VR_SHORTCUT_INSTALL_OPERATION),
  ], { now: NOW });
  assert.equal(selected.ok, true);
  assert.equal(selected.verdict, 'COMMAND_BATCH_READY');
  let observed = null;
  const result = await mailbox.executeBattleBridgeGitHubCommand(selected.commands[0].command, {
    executeStarfieldVrBattleBridgeCommandFn: async (input) => {
      observed = input;
      return {
        ok: true,
        finalVerdict: 'STARFIELD_VR_SHORTCUT_INSTALL_PROVEN',
        operation: input.operation,
        expectedHead: input.expectedHead,
      };
    },
  });
  assert.equal(observed.operation, STARFIELD_VR_SHORTCUT_INSTALL_OPERATION);
  assert.equal(observed.expectedHead, HEAD);
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_EXECUTION_COMPLETE');
  assert.equal(result.result.finalVerdict, 'STARFIELD_VR_SHORTCUT_INSTALL_PROVEN');
});

test('sanitized Starfield status receipt preserves installed truth in final verdict without leaking local paths', () => {
  const requestId = 'starfield-vr-mailbox-read-receipt-0001';
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId,
    operation: STARFIELD_VR_DELIVERY_STATUS_OPERATION,
    state: 'DONE',
    expectedHead: HEAD,
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: STARFIELD_VR_DELIVERY_STATUS_OPERATION,
      requestId,
      result: {
        ok: true,
        finalVerdict: 'STARFIELD_VR_DELIVERY_STATUS_INSTALLED',
        expectedHead: HEAD,
        sourceHead: HEAD,
        installed: true,
        observation: {
          desktopIconPresent: true,
          shortcutTargetPath: 'C:\\Users\\Stephan\\Desktop\\Starfield VR.lnk',
          shortcutArguments: '-File C:\\Users\\Stephan\\private\\launch.ps1',
        },
      },
    },
  };
  const projected = createSanitizedMailboxReceiptProjection(receipt);
  const serialized = serializeBoundedReceiptJson(receipt);
  assert.equal(projected.operationResult.finalVerdict, 'STARFIELD_VR_DELIVERY_STATUS_INSTALLED');
  assert.match(serialized, /STARFIELD_VR_DELIVERY_STATUS_INSTALLED/);
  assert.doesNotMatch(`${JSON.stringify(projected)}${serialized}`, /C:\\Users\\Stephan/i);
});
