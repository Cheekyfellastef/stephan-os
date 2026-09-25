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
import {
  GUARDED_CODEX_TASK_DISPATCH_OPERATION,
  executeGuardedCodexTaskOnBattleBridge,
  validateGuardedCodexTaskDispatchCommandShape,
} from './battleBridgeCodexTaskDispatchV1.mjs';
import { createRemoteCodexOperatorApprovalReceipt } from './remoteCodexBattleBridgeHandoffV1.mjs';
import { createSanitizedMailboxReceiptProjection } from '../../scripts/battle-bridge-github-command-mailbox.mjs';

const NOW = new Date('2026-09-25T05:40:00.000Z');
const HEAD = '98c3be75f8409c9362fbf4f188da44a83d387673';
const PR_HEAD = 'f'.repeat(40);
const TASK = 'Diagnose the final Stephanos automatic goal-building connection without weakening any exact-head or operator-approval guard.';
const PROOF_COMMANDS = [
  'git rev-parse HEAD',
  'node --test shared/agents/autonomyBuildTrackV1.test.mjs',
];
const PROOF = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 2373,
  expectedHead: HEAD,
  proofTarget: 'MERGED_MAIN',
  pullRequestHead: PR_HEAD,
  mergeCommitHead: HEAD,
  githubMainHead: HEAD,
  mergeCommitIncluded: true,
  proofScenario: 'stephanos-final-goal-build-connection-diagnosis',
});

function approvalReceipt() {
  const result = createRemoteCodexOperatorApprovalReceipt({
    approvalId: 'approval-final-link-codex-2373',
    requestId: 'final-link-codex-2373-v1',
    owningIssue: 2158,
    expectedHead: HEAD,
    task: TASK,
    requestedProofCommands: PROOF_COMMANDS,
    exactHeadProof: PROOF,
    approvedAt: '2026-09-25T05:39:00.000Z',
    expiresAt: '2026-09-25T06:30:00.000Z',
  });
  assert.equal(result.ok, true);
  return result.receipt;
}

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'final-link-codex-2373-v1',
    operation: GUARDED_CODEX_TASK_DISPATCH_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    task: TASK,
    requestedProofCommands: PROOF_COMMANDS,
    exactHeadProof: PROOF,
    operatorApprovalReceipt: approvalReceipt(),
    createdAt: '2026-09-25T05:40:00.000Z',
    expiresAt: '2026-09-25T06:30:00.000Z',
    ...overrides,
  };
}

function comment(value = command()) {
  return {
    id: 12345,
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/2158#issuecomment-12345',
    created_at: '2026-09-25T05:40:00.000Z',
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`${core.BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(value)}\n\`\`\``,
  };
}

test('mailbox exposes guarded Codex dispatch as exact-head serialized control work', () => {
  assert.equal(BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(GUARDED_CODEX_TASK_DISPATCH_OPERATION), true);
  assert.equal(classifyBattleBridgeMailboxOperation(GUARDED_CODEX_TASK_DISPATCH_OPERATION), core.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL);
  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  assert.equal(validated.ok, true);
  assert.equal(validated.command.operation, GUARDED_CODEX_TASK_DISPATCH_OPERATION);
  assert.equal(validated.command.expectedHead, HEAD);
});

test('owner-authored guarded Codex command survives canonical selection', () => {
  const selected = selectBattleBridgeGitHubCommandBatch([comment()], {
    now: NOW,
    maxBatch: 1,
    consumedRequestIds: new Set(),
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.commands.length, 1);
  assert.equal(selected.commands[0].command.operation, GUARDED_CODEX_TASK_DISPATCH_OPERATION);
  assert.equal(selected.commands[0].partition, core.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL);
});

test('unsafe extra fields terminalize before Codex execution', () => {
  const selected = selectBattleBridgeGitHubCommandBatch([comment(command({ command: 'pwsh.exe' }))], {
    now: NOW,
    maxBatch: 1,
    consumedRequestIds: new Set(),
  });
  assert.equal(selected.commands.length, 0);
  assert.equal(selected.terminalRejections.length, 1);
  assert.equal(selected.terminalRejections[0].blocker, 'GUARDED_CODEX_DISPATCH_FIELD_NOT_ALLOWED');
});

test('guarded executor uses native Battle Bridge dispatch without an MCP session', async () => {
  let seenHandoff = null;
  const result = await executeGuardedCodexTaskOnBattleBridge(command(), {
    now: NOW,
    repoRoot: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
    platform: 'win32',
    dispatchApprovedCodexHandoffOnBattleBridgeFn: async (handoff) => {
      seenHandoff = handoff;
      return {
        ok: true,
        taskId: 'final-link-codex-task-1',
        dispatcherState: 'DISPATCHED',
        decision: 'DISPATCHED',
        finalVerdict: 'CODEX_JOB_DISPATCHED',
        transport: 'battle-bridge-native',
        mcpSessionRequired: false,
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'CODEX_JOB_DISPATCHED');
  assert.equal(result.transport, 'battle-bridge-native');
  assert.equal(result.mcpSessionRequired, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.sourceMutationAuthority, false);
  assert.equal(seenHandoff.expectedHead, HEAD);
  assert.equal(seenHandoff.mergeAuthority, false);
  assert.equal(seenHandoff.sourceMutationAuthority, false);
});

test('wrapper delegates guarded Codex execution only through its dedicated executor', async () => {
  let calls = 0;
  const result = await executeBattleBridgeGitHubCommand(command(), {
    executeGuardedCodexTaskOnBattleBridgeFn: async (selected) => {
      calls += 1;
      assert.equal(selected.operation, GUARDED_CODEX_TASK_DISPATCH_OPERATION);
      return { ok: true, finalVerdict: 'GUARDED_CODEX_TASK_DISPATCHED', mergeAuthority: false };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.mergeAuthority, false);
});

test('shape validator rejects forged receipt binding instead of manufacturing authority', () => {
  const hostile = structuredClone(command());
  hostile.operatorApprovalReceipt.bindingSha256 = '0'.repeat(64);
  const result = validateGuardedCodexTaskDispatchCommandShape(hostile);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'REMOTE_CODEX_APPROVAL_RECEIPT_BINDING_INVALID');
});


test('blocked native guarded dispatch lifts the inner routing decision into mailbox-safe telemetry', async () => {
  const result = await executeGuardedCodexTaskOnBattleBridge(command(), {
    now: NOW,
    repoRoot: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
    platform: 'win32',
    dispatchApprovedCodexHandoffOnBattleBridgeFn: async () => ({
      ok: false,
      blocker: 'CODEX_CAPACITY_UNAVAILABLE',
      dispatcherState: 'WAITING_FOR_PROVIDER_NEUTRAL_CAPACITY',
      decision: 'CODEX_BLOCKED_BY_METER',
      selectedRoute: null,
      nextOperatorAction: 'Publish or recover one qualified provider-neutral capacity receipt.',
      transport: 'battle-bridge-native',
      mcpSessionRequired: false,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CODEX_CAPACITY_UNAVAILABLE');
  assert.equal(result.dispatcherState, 'WAITING_FOR_PROVIDER_NEUTRAL_CAPACITY');
  assert.equal(result.decision, 'CODEX_BLOCKED_BY_METER');
  assert.equal(result.finalVerdict, 'CODEX_BLOCKED_BY_METER');
  assert.equal(result.transport, 'battle-bridge-native');
  assert.equal(result.mcpSessionRequired, false);
  assert.equal(result.nextOperatorAction, 'Publish or recover one qualified provider-neutral capacity receipt.');
});

test('successful provider-neutral native dispatch preserves the selected route in mailbox-safe telemetry', async () => {
  const result = await executeGuardedCodexTaskOnBattleBridge(command(), {
    now: NOW,
    repoRoot: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
    platform: 'win32',
    dispatchApprovedCodexHandoffOnBattleBridgeFn: async () => ({
      ok: true,
      taskId: '',
      dispatchJobId: 'codex-job-11111111111111111111',
      providerTaskId: '',
      providerExecutionStarted: false,
      resultReadbackOperation: '',
      dispatcherState: 'ROUTED_PROVIDER_NEUTRAL',
      decision: 'CODEX_CAPACITY_REROUTE_READY',
      finalVerdict: 'CODEX_CAPACITY_REROUTE_READY',
      selectedRoute: {
        routeId: 'openclaw-capacity-current',
        adapterId: 'openclaw-local',
        providerFamily: 'OPENCLAW',
      },
      transport: 'battle-bridge-native',
      mcpSessionRequired: false,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'CODEX_CAPACITY_REROUTE_READY');
  assert.equal(result.selectedProvider, 'OPENCLAW');
  assert.equal(result.executionProvider, 'openclaw-local');
  assert.equal(result.taskId, '');
  assert.equal(result.dispatchJobId, 'codex-job-11111111111111111111');
  assert.equal(result.providerTaskId, '');
  assert.equal(result.providerExecutionStarted, false);
  assert.equal(result.resultReadbackOperation, '');
  assert.equal(result.transport, 'battle-bridge-native');
  assert.equal(result.mcpSessionRequired, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.sourceMutationAuthority, false);
});


test('provider-neutral mailbox receipt does not advertise a Codex task before provider acceptance', () => {
  const projected = createSanitizedMailboxReceiptProjection({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'provider-neutral-truth-v1',
    operation: GUARDED_CODEX_TASK_DISPATCH_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    state: 'DONE',
    expectedHead: HEAD,
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: GUARDED_CODEX_TASK_DISPATCH_OPERATION,
      requestId: 'provider-neutral-truth-v1',
      result: {
        ok: true,
        finalVerdict: 'CODEX_CAPACITY_REROUTE_READY',
        taskId: '',
        dispatchJobId: 'codex-job-22222222222222222222',
        providerTaskId: '',
        providerExecutionStarted: false,
        resultReadbackOperation: '',
        selectedProvider: 'OPENCLAW',
        executionProvider: 'openclaw-local',
      },
    },
  });
  assert.equal(projected.taskId, '');
  assert.equal(projected.dispatchJobId, 'codex-job-22222222222222222222');
  assert.equal(projected.providerTaskId, '');
  assert.equal(projected.providerExecutionStarted, false);
  assert.equal(projected.resultReadbackOperation, '');
  assert.equal(projected.operationResult.taskId, '');
  assert.equal(projected.operationResult.dispatchJobId, 'codex-job-22222222222222222222');
  assert.equal(projected.operationResult.providerExecutionStarted, false);
});


test('allowlisted deterministic proof bypasses Codex and MCP entirely', async () => {
  let dispatchCalls = 0;
  const result = await executeGuardedCodexTaskOnBattleBridge(command(), {
    now: NOW,
    repoRoot: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
    platform: 'win32',
    runApprovedBattleBridgeProofCommandsFn: async () => ({
      schemaVersion: 'stephanos.battle-bridge-direct-proof.v1',
      handled: true,
      ok: true,
      blocker: '',
      requestId: 'final-link-codex-2373-v1',
      providerTaskId: 'host-proof-final-link-codex-2373-v1',
      expectedHead: HEAD,
      observedHead: HEAD,
      executionStarted: true,
      completedAtUtc: NOW.toISOString(),
      proofResults: [],
      exactHeadStable: true,
      worktreeStable: true,
      sourceMutationDetected: false,
      arbitraryShellAllowed: false,
      mergePerformed: false,
      deploymentPerformed: false,
      finalVerdict: 'DIRECT_BATTLE_BRIDGE_PROOF_PASS',
    }),
    dispatchApprovedCodexHandoffOnBattleBridgeFn: async () => {
      dispatchCalls += 1;
      throw new Error('provider dispatch must not be reached');
    },
  });

  assert.equal(dispatchCalls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.taskId, '');
  assert.equal(result.dispatchJobId, '');
  assert.equal(result.providerTaskId, 'host-proof-final-link-codex-2373-v1');
  assert.equal(result.providerExecutionStarted, true);
  assert.equal(result.resultReadbackOperation, '');
  assert.equal(result.selectedProvider, 'BATTLE_BRIDGE_HOST');
  assert.equal(result.executionProvider, 'battle-bridge-deterministic-proof');
  assert.equal(result.transport, 'battle-bridge-direct');
  assert.equal(result.mcpSessionRequired, false);
  assert.equal(result.finalVerdict, 'DIRECT_BATTLE_BRIDGE_PROOF_PASS');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.sourceMutationAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
});

test('unsupported direct proof keeps the existing guarded provider dispatch path', async () => {
  let dispatchCalls = 0;
  const result = await executeGuardedCodexTaskOnBattleBridge(command(), {
    now: NOW,
    repoRoot: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
    platform: 'win32',
    runApprovedBattleBridgeProofCommandsFn: async () => ({
      handled: false,
      ok: false,
      blocker: 'DIRECT_BATTLE_BRIDGE_PROOF_COMMAND_NOT_ALLOWLISTED',
      executionStarted: false,
      providerTaskId: '',
      finalVerdict: 'DIRECT_BATTLE_BRIDGE_PROOF_NOT_APPLICABLE',
    }),
    dispatchApprovedCodexHandoffOnBattleBridgeFn: async () => {
      dispatchCalls += 1;
      return {
        ok: true,
        taskId: 'provider-task-1',
        dispatchJobId: 'provider-task-1',
        providerTaskId: 'provider-task-1',
        providerExecutionStarted: true,
        resultReadbackOperation: 'READ_GUARDED_CODEX_TASK_RESULT',
        dispatcherState: 'DISPATCHED',
        decision: 'DISPATCHED',
        finalVerdict: 'CODEX_JOB_DISPATCHED',
        transport: 'battle-bridge-native',
        mcpSessionRequired: false,
      };
    },
  });

  assert.equal(dispatchCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.providerTaskId, 'provider-task-1');
  assert.equal(result.providerExecutionStarted, true);
  assert.equal(result.finalVerdict, 'CODEX_JOB_DISPATCHED');
  assert.equal(result.transport, 'battle-bridge-native');
});

test('indeterminate direct proof never retries through a provider and risks duplicate execution', async () => {
  let dispatchCalls = 0;
  const result = await executeGuardedCodexTaskOnBattleBridge(command(), {
    now: NOW,
    repoRoot: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
    platform: 'win32',
    runApprovedBattleBridgeProofCommandsFn: async () => {
      throw new Error('host result channel interrupted after start');
    },
    dispatchApprovedCodexHandoffOnBattleBridgeFn: async () => {
      dispatchCalls += 1;
      return { ok: true };
    },
  });

  assert.equal(dispatchCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DIRECT_BATTLE_BRIDGE_PROOF_EXECUTION_INDETERMINATE');
  assert.equal(result.providerExecutionStarted, false);
  assert.equal(result.providerTaskId, '');
  assert.equal(result.transport, 'battle-bridge-direct');
  assert.equal(result.mcpSessionRequired, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.sourceMutationAuthority, false);
});
