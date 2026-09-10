import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
  executeBattleBridgeGitHubCommand,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';
import {
  createSanitizedMailboxReceiptProjection,
  serializeBoundedReceiptJson,
} from '../../scripts/battle-bridge-github-command-mailbox.mjs';

const now = new Date('2026-07-17T19:20:00.000Z');
const expectedHead = '3bad66398a2d507010d804951e06a1fb7872c159';

function command(overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId: 'req-monitor-multiplexer-acceptance-20260717T1920Z',
    operation: 'RUN_MONITOR_MULTIPLEXER_ACCEPTANCE',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead,
    expiresAt: '2026-07-17T20:20:00.000Z',
    ...overrides,
  };
}

function receiptResult(overrides = {}) {
  return {
    ok: true,
    finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_PASS',
    sourceHead: expectedHead,
    expectedHeadMatch: true,
    monitorCount: 13,
    executedCount: 13,
    unaffectedMonitorCount: 12,
    expectedFailureCount: 1,
    notificationBatchCount: 2,
    notificationCount: 13,
    notificationSurface: 'chatgpt-task-outbox',
    externalTaskSlotsRequired: 1,
    maxConcurrencyObserved: 3,
    receiptCount: 3,
    proofWrittenToSharedWorkspace: true,
    proofRefs: [
      'proof/monitor-multiplexer-canary-proof.json',
      'C:\\Users\\Stephan Callear\\secret.json',
      '../escape.json',
    ],
    rawPayload: 'must-not-survive',
    machinePath: 'C:\\Users\\Stephan Callear\\Documents',
    ...overrides,
  };
}

test('monitor multiplexer acceptance is a first-class bounded mailbox operation', () => {
  assert.ok(BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes('RUN_MONITOR_MULTIPLEXER_ACCEPTANCE'));
  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now,
  });
  assert.equal(validated.ok, true);
  assert.equal(validated.verdict, 'COMMAND_ACCEPTED');
  assert.equal(validated.command.operation, 'RUN_MONITOR_MULTIPLEXER_ACCEPTANCE');
  assert.equal(validated.command.expectedHead, expectedHead);
});

test('monitor multiplexer acceptance dispatches only through its named handler', async () => {
  const calls = [];
  const result = await executeBattleBridgeGitHubCommand(command(), {
    runMonitorMultiplexerAcceptance: async (input) => {
      calls.push({ expectedHead: input.expectedHead, requestId: input.requestId });
      return receiptResult();
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{
    expectedHead,
    requestId: 'req-monitor-multiplexer-acceptance-20260717T1920Z',
  }]);
  assert.equal(result.result.finalVerdict, 'MONITOR_MULTIPLEXER_CANARY_PASS');

  const missing = await executeBattleBridgeGitHubCommand(command(), {});
  assert.equal(missing.ok, false);
  assert.equal(missing.blocker, 'COMMAND_HANDLER_NOT_CONFIGURED');
});

test('Windows mailbox runner forwards only exact head and request ID to the fixed canary', async () => {
  const runner = await readFile(new URL('../../scripts/battle-bridge-github-command-mailbox.mjs', import.meta.url), 'utf8');
  assert.match(runner, /import \{ runBattleBridgeMonitorMultiplexerCanary \} from '\.\/battle-bridge-monitor-multiplexer-canary\.mjs';/);
  assert.match(runner, /runMonitorMultiplexerAcceptance:\s*\(command\)\s*=>\s*runBattleBridgeMonitorMultiplexerCanary\(\{ expectedHead: command\.expectedHead, requestId: command\.requestId \}\)/);
  assert.doesNotMatch(runner, /runMonitorMultiplexerAcceptance[\s\S]{0,240}command\.(?:path|url|command|shell|powershell|taskName|target)/i);
  assert.doesNotMatch(runner, /Invoke-Expression|cmd\.exe|git\.exe', \['(?:reset|clean|checkout|push|rebase)/i);
});

test('sanitized mailbox receipt preserves bounded canary evidence and removes raw fields', () => {
  const projection = createSanitizedMailboxReceiptProjection({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: command().requestId,
    operation: command().operation,
    state: 'DONE',
    proofRefs: ['receipts/github-command-mailbox/canary.json'],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: command().operation,
      requestId: command().requestId,
      result: receiptResult(),
    },
  });

  assert.equal(projection.operationResult.finalVerdict, 'MONITOR_MULTIPLEXER_CANARY_PASS');
  assert.equal(projection.operationResult.monitorCount, 13);
  assert.equal(projection.operationResult.executedCount, 13);
  assert.equal(projection.operationResult.unaffectedMonitorCount, 12);
  assert.equal(projection.operationResult.expectedFailureCount, 1);
  assert.equal(projection.operationResult.notificationBatchCount, 2);
  assert.equal(projection.operationResult.notificationCount, 13);
  assert.equal(projection.operationResult.notificationSurface, 'chatgpt-task-outbox');
  assert.equal(projection.operationResult.externalTaskSlotsRequired, 1);
  assert.equal(projection.operationResult.maxConcurrencyObserved, 3);
  assert.equal(projection.operationResult.receiptCount, 3);
  assert.equal(projection.operationResult.proofWrittenToSharedWorkspace, true);
  assert.deepEqual(projection.operationResult.proofRefs, ['proof/monitor-multiplexer-canary-proof.json']);
  assert.equal('rawPayload' in projection.operationResult, false);
  assert.equal('machinePath' in projection.operationResult, false);
  assert.doesNotMatch(JSON.stringify(projection), /C:\\Users|\.\.\//i);
});

test('compact GitHub receipt preserves canary proof when the full receipt is oversized', () => {
  const json = serializeBoundedReceiptJson({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: command().requestId,
    operation: command().operation,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    state: 'DONE',
    proofRefs: ['receipts/github-command-mailbox/canary.json'],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: command().operation,
      requestId: command().requestId,
      result: receiptResult({ payload: 'x'.repeat(20_000) }),
    },
  }, 4096);
  const parsed = JSON.parse(json);
  assert.equal(parsed.githubProjectionTruncated, true);
  assert.equal(parsed.result.result.finalVerdict, 'MONITOR_MULTIPLEXER_CANARY_PASS');
  assert.equal(parsed.result.result.monitorCount, 13);
  assert.equal(parsed.result.result.unaffectedMonitorCount, 12);
  assert.equal(parsed.result.result.notificationSurface, 'chatgpt-task-outbox');
  assert.equal(parsed.result.result.proofWrittenToSharedWorkspace, true);
  assert.deepEqual(parsed.result.result.proofRefs, ['proof/monitor-multiplexer-canary-proof.json']);
  assert.ok(Buffer.byteLength(json, 'utf8') <= 4096);
});

test('receipt projections derive exact-head equality when the operation omits the redundant boolean', () => {
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: command().requestId,
    operation: command().operation,
    expectedHead,
    state: 'DONE',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: command().operation,
      requestId: command().requestId,
      result: receiptResult({ expectedHeadMatch: undefined, payload: 'x'.repeat(20_000) }),
    },
  };
  assert.equal(createSanitizedMailboxReceiptProjection(receipt).operationResult.expectedHeadMatch, true);
  assert.equal(JSON.parse(serializeBoundedReceiptJson(receipt, 4096)).result.result.expectedHeadMatch, true);
});
