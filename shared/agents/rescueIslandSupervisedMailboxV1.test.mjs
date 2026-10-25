import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESCUE_ISLAND_SUPERVISED_DOCUMENT_OPERATION,
  executeRescueIslandSupervisedDocumentOnBattleBridge,
  validateRescueIslandSupervisedDocumentCommandShape,
} from './rescueIslandSupervisedMailboxV1.mjs';
import {
  executeBattleBridgeGitHubCommand,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';
import { createSanitizedMailboxReceiptProjection } from '../../scripts/battle-bridge-github-command-mailbox.mjs';

const HEAD = 'a'.repeat(40);
const EXPIRES = '2026-10-25T18:00:00.000Z';
const CONTENT = '# Rescue Island pilot\n\nBounded Island02 documentation proof.\n';
const task = () => ({
  schemaVersion: 'stephanos.rescue-island-pilot-task.v1',
  repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 3103,
  issueTitle: 'Rescue Island: two independent proof-gated builders outside Goal Conveyor',
  taskId: 'island02-mailbox-proof-01',
  workerId: 'rescue-island-02',
  baseHead: HEAD,
  targetPath: 'docs/architecture/rescue-island-pilot-island02-mailbox-proof-01.md',
  content: CONTENT,
  testPath: 'shared/agents/rescueIslandPreflightV1.test.mjs',
  approvalSource: 'EXTERNAL_OWNER_ATTESTATION_REQUIRED',
  expiresAtUtc: EXPIRES,
});
const command = overrides => ({
  schemaVersion: 'stephanos.battle-bridge-github-command.v1',
  requestId: 'island02-mailbox-proof-01',
  operation: RESCUE_ISLAND_SUPERVISED_DOCUMENT_OPERATION,
  repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 3149,
  branch: 'main',
  operatorApproval: 'operator-approved',
  expectedHead: HEAD,
  expiresAt: EXPIRES,
  commentId: 6399501164,
  task: task(),
  ...overrides,
});
const success = () => ({
  ok: true,
  workerId: 'rescue-island-02',
  taskId: task().taskId,
  head: 'b'.repeat(40),
  parent: HEAD,
  changedPath: task().targetPath,
  testResultHash: 'c'.repeat(64),
  receipts: ['SELECTED', 'CLAIMED', 'BRANCH_RESERVED', 'PHYSICAL_PICKUP',
    'EDITED', 'TESTED', 'ISOLATED_COMMIT'].map(stage => ({ stage })),
  assuranceProfile: 'SUPERVISED_COOPERATIVE_V1',
  ownerCommentId: 6399501164,
  taskFingerprint: 'd'.repeat(64),
  hostileWriterContainmentProven: false,
  independentlyCommissionedWorker: false,
  unattendedRefillsProven: false,
  resourceScheduling: 'CPU_ONLY_SERIAL_EXISTING_OWNER_LOCK',
  reviewRequired: true,
  published: false,
  merged: false,
  deployed: false,
});

test('validates only the exact Island02 documentation envelope', () => {
  assert.equal(validateRescueIslandSupervisedDocumentCommandShape(command()).ok, true);
  assert.equal(validateRescueIslandSupervisedDocumentCommandShape(command({ path: 'C:\\private' })).blocker,
    'RESCUE_ISLAND_REMOTE_FIELD_NOT_ALLOWED');
  assert.equal(validateRescueIslandSupervisedDocumentCommandShape(command({
    task: { ...task(), workerId: 'rescue-island-01' },
  })).blocker, 'RESCUE_ISLAND_REMOTE_TASK_INVALID');
});

test('executes only the fixed native supervised ingress and projects all material stages', async () => {
  let observed;
  const result = await executeRescueIslandSupervisedDocumentOnBattleBridge(command(), {
    platform: 'win32',
    env: {},
    spawnSyncFn(executable, args, options) {
      observed = { executable, args, options };
      return { status: 0, stdout: JSON.stringify(success()) + '\n', stderr: '' };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(observed.args, ['--supervised-once']);
  assert.equal(observed.options.shell, false);
  assert.equal(JSON.parse(observed.options.input).commentId, 6399501164);
  assert.deepEqual(result.result.rescueIslandBuild.stages, [
    'SELECTED', 'CLAIMED', 'BRANCH_RESERVED', 'PHYSICAL_PICKUP',
    'EDITED', 'TESTED', 'ISOLATED_COMMIT',
  ]);
  assert.equal(result.result.rescueIslandBuild.commitHead, 'b'.repeat(40));
  assert.equal(result.result.mergeAuthority, false);
});

test('does not attest an observed source head when native execution fails', async () => {
  const result = await executeRescueIslandSupervisedDocumentOnBattleBridge(command(), {
    platform: 'win32',
    env: {},
    spawnSyncFn() {
      return {
        status: 1,
        stdout: JSON.stringify({ blocker: 'ISLAND_HOST_CANONICAL_SOURCE_CHANGED' }) + '\n',
        stderr: '',
      };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'ISLAND_HOST_CANONICAL_SOURCE_CHANGED');
  assert.equal(result.verdict, 'COMMAND_EXECUTION_BLOCKED');
  assert.equal(result.finalVerdict, 'RESCUE_ISLAND_02_SUPERVISED_DOCUMENT_BUILD_BLOCKED');
  assert.equal(result.result.ok, false);
  assert.equal(result.result.blocker, 'ISLAND_HOST_CANONICAL_SOURCE_CHANGED');
  assert.equal(result.result.publicReceiptSafe, true);
  assert.equal(result.result.secretMaterialReturned, false);
  assert.equal(Object.hasOwn(result, 'sourceHead'), false);
  assert.equal(Object.hasOwn(result, 'expectedHeadMatch'), false);
  assert.equal(Object.hasOwn(result.result, 'sourceHead'), false);
  assert.equal(Object.hasOwn(result.result, 'expectedHeadMatch'), false);
  assert.equal(result.proofCompleted, false);
  const publicReceipt = createSanitizedMailboxReceiptProjection({
    operation: RESCUE_ISLAND_SUPERVISED_DOCUMENT_OPERATION,
    requestId: command().requestId,
    state: 'BLOCKED',
    expectedHead: HEAD,
    blocker: result.blocker,
    result,
  });
  assert.equal(publicReceipt.state, 'BLOCKED');
  assert.equal(publicReceipt.blocker, 'ISLAND_HOST_CANONICAL_SOURCE_CHANGED');
  assert.equal(publicReceipt.operationResult.ok, false);
  assert.equal(publicReceipt.operationResult.blocker, 'ISLAND_HOST_CANONICAL_SOURCE_CHANGED');
  assert.equal(publicReceipt.operationResult.sourceHead, '');
  assert.equal(publicReceipt.operationResult.expectedHeadMatch, false);
});

test('maps only fixed native principal blockers to non-secret typed public aliases', async () => {
  const cases = new Map([
    ['ISLAND_HOST_NATIVE_TOKEN_UNAVAILABLE', 'RESCUE_ISLAND_REMOTE_NATIVE_PRINCIPAL_UNAVAILABLE'],
    ['ISLAND_HOST_NON_ADMINISTRATIVE_TOKEN_REQUIRED', 'RESCUE_ISLAND_REMOTE_NON_ADMINISTRATIVE_PRINCIPAL_REQUIRED'],
    ['ISLAND_HOST_PRIMARY_TOKEN_REQUIRED', 'RESCUE_ISLAND_REMOTE_PRIMARY_PRINCIPAL_REQUIRED'],
    ['ISLAND_HOST_PROCESS_TOKEN_UNAVAILABLE', 'RESCUE_ISLAND_REMOTE_PROCESS_PRINCIPAL_UNAVAILABLE'],
    ['ISLAND_HOST_THREAD_TOKEN_UNAVAILABLE', 'RESCUE_ISLAND_REMOTE_THREAD_PRINCIPAL_UNAVAILABLE'],
    ['ISLAND_HOST_TOKEN_GROUPS_INVALID', 'RESCUE_ISLAND_REMOTE_PRINCIPAL_GROUPS_INVALID'],
    ['ISLAND_HOST_TOKEN_INFORMATION_INVALID', 'RESCUE_ISLAND_REMOTE_PRINCIPAL_INFORMATION_INVALID'],
    ['ISLAND_HOST_TOKEN_PRIVILEGES_INVALID', 'RESCUE_ISLAND_REMOTE_PRINCIPAL_PRIVILEGES_INVALID'],
    ['ISLAND_HOST_TOKEN_READ_FAILED', 'RESCUE_ISLAND_REMOTE_PRINCIPAL_READ_FAILED'],
    ['ISLAND_HOST_TOKEN_SIZE_UNAVAILABLE', 'RESCUE_ISLAND_REMOTE_PRINCIPAL_SIZE_UNAVAILABLE'],
  ]);
  for (const [nativeBlocker, publicBlocker] of cases) {
    const result = await executeRescueIslandSupervisedDocumentOnBattleBridge(command(), {
      platform: 'win32',
      env: {},
      spawnSyncFn: () => ({
        status: 3,
        stdout: JSON.stringify({ blocker: nativeBlocker }) + '\n',
        stderr: '',
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, publicBlocker);
    assert.equal(result.result.blocker, publicBlocker);
    assert.doesNotMatch(result.blocker, /TOKEN|secret|credential/i);
    assert.equal(result.secretMaterialReturned, false);
  }
});

test('mailbox composition retains exact custom operation and executor', async () => {
  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: new Date('2026-10-25T17:55:00.000Z'),
    currentHead: HEAD,
  });
  assert.equal(validated.ok, true);
  let called = 0;
  const result = await executeBattleBridgeGitHubCommand(validated.command, {
    executeRescueIslandSupervisedDocumentOnBattleBridgeFn: async observed => {
      called += 1;
      assert.equal(observed.commentId, 6399501164);
      return { ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE', result: { ok: true } };
    },
  });
  assert.equal(called, 1);
  assert.equal(result.ok, true);
});
