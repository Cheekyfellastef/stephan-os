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
      taskId: 'provider-neutral-task-1',
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
  assert.equal(result.transport, 'battle-bridge-native');
  assert.equal(result.mcpSessionRequired, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.sourceMutationAuthority, false);
});
