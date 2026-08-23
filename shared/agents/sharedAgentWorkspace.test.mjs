import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARED_AGENT_WORKSPACE_SCHEMA_VERSION,
  SHARED_WORKSPACE_DIRECTORIES,
  SHARED_WORKSPACE_PARTICIPANTS,
  buildSharedAgentWorkspaceContract,
  createSharedWorkspaceMessage,
  normalizeSharedWorkspaceParticipant,
  validateSharedWorkspaceMessage,
} from './sharedAgentWorkspace.mjs';

test('shared workspace contract includes required directories and participants', () => {
  const contract = buildSharedAgentWorkspaceContract();

  assert.equal(contract.schemaVersion, SHARED_AGENT_WORKSPACE_SCHEMA_VERSION);
  for (const directory of ['inbox', 'outbox', 'events', 'status', 'proof', 'logs', 'commands', 'receipts', 'archive']) {
    assert.equal(contract.directories.includes(directory), true);
    assert.equal(SHARED_WORKSPACE_DIRECTORIES.includes(directory), true);
  }

  for (const participant of ['operator', 'stephanos', 'openclaw', 'chatgpt', 'codex', 'powershell', 'mission-orchestrator', 'future-agent']) {
    assert.equal(contract.participants.includes(participant), true);
    assert.equal(SHARED_WORKSPACE_PARTICIPANTS.includes(participant), true);
  }

  assert.equal(contract.writePolicy.sourceRepositoryWritesAllowed, false);
  assert.equal(contract.writePolicy.arbitraryShellAllowed, false);
  assert.equal(contract.writePolicy.arbitraryPowerShellAllowed, false);
  assert.equal(contract.writePolicy.approvalSpoofingAllowed, false);
  assert.equal(contract.finalVerdict, 'SHARED_AGENT_WORKSPACE_CONTRACT_READY');
});

test('participant aliases normalize to canonical workspace participants', () => {
  assert.equal(normalizeSharedWorkspaceParticipant('human'), 'operator');
  assert.equal(normalizeSharedWorkspaceParticipant('standalone'), 'openclaw');
  assert.equal(normalizeSharedWorkspaceParticipant('worker'), 'mission-orchestrator');
  assert.equal(normalizeSharedWorkspaceParticipant('codex'), 'codex');
  assert.equal(normalizeSharedWorkspaceParticipant('unknown-new-agent'), 'future-agent');
});

test('valid Codex dispatch message preserves bounded proof and changed file refs', () => {
  const message = createSharedWorkspaceMessage({
    messageId: 'codex-job-1282-ready',
    timestampUtc: '2026-06-28T18:00:00Z',
    sender: 'codex',
    recipient: 'operator',
    channel: 'codex-dispatch-queue',
    kind: 'codex-job-ready',
    severity: 'info',
    correlationId: 'goal-1282',
    relatedGoal: '#1282',
    summary: 'Goal Dashboard Tile job is ready for Codex dispatch.',
    status: 'READY_TO_DISPATCH',
    changedFiles: ['shared/agents/sharedAgentWorkspace.mjs'],
    proofRefs: ['proof/codex/job-1282-ready.json', 'receipts/codex/job-1282.json'],
  });

  assert.equal(message.sender, 'codex');
  assert.equal(message.recipient, 'operator');
  assert.equal(message.eventKind, 'codex-job-ready');
  assert.deepEqual(message.changedFiles, ['shared/agents/sharedAgentWorkspace.mjs']);
  assert.deepEqual(message.proofRefs, ['proof/codex/job-1282-ready.json', 'receipts/codex/job-1282.json']);
  assert.equal(validateSharedWorkspaceMessage(message).finalVerdict, 'SHARED_WORKSPACE_MESSAGE_PASS');
});

test('unsafe refs are removed from sanitized messages', () => {
  const message = createSharedWorkspaceMessage({
    sender: 'openclaw',
    recipient: 'stephanos',
    kind: 'proof',
    messageId: 'openclaw-proof-1',
    changedFiles: ['apps/stephanos/dist/index.html', 'shared/runtime/runtimeStatusModel.mjs', '../secret.txt'],
    proofRefs: ['proof/openclaw/check.json', 'C:/Users/Stephan/.env', 'node_modules/cache/file.json'],
  });

  assert.deepEqual(message.changedFiles, ['shared/runtime/runtimeStatusModel.mjs']);
  assert.deepEqual(message.proofRefs, ['proof/openclaw/check.json']);
  assert.equal(validateSharedWorkspaceMessage(message).valid, true);
});

test('validator blocks unsanitized invalid participants and unsafe refs', () => {
  const result = validateSharedWorkspaceMessage({
    schemaVersion: SHARED_AGENT_WORKSPACE_SCHEMA_VERSION,
    kind: 'stephanos.shared_workspace.message',
    messageId: 'bad-message',
    sender: 'intruder',
    recipient: 'operator',
    eventKind: 'proof',
    proofRefs: ['../outside.json'],
    changedFiles: ['runtime/session.log'],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('invalid-sender'), true);
  assert.equal(result.errors.includes('unsafe-proof-ref'), true);
  assert.equal(result.errors.includes('unsafe-changed-file-ref'), true);
  assert.equal(result.finalVerdict, 'SHARED_WORKSPACE_MESSAGE_BLOCKED');
});

test('bootstrap and verification messages are first-class event kinds', () => {
  const bootstrap = createSharedWorkspaceMessage({
    sender: 'powershell',
    recipient: 'mission-orchestrator',
    kind: 'service-start-result',
    messageId: 'backend-start-result',
    summary: 'Backend scheduled task start returned health 200.',
    status: 'VERIFIED',
    proofRefs: ['proof/bootstrap/backend-health.json'],
  });

  const verification = createSharedWorkspaceMessage({
    sender: 'mission-orchestrator',
    recipient: 'operator',
    kind: 'verification-result',
    messageId: 'battle-bridge-health',
    summary: 'Backend, OpenClaw gateway, UI, and worker passed.',
    status: 'VERIFIED',
    proofRefs: ['proof/verification/battle-bridge-health.json'],
  });

  assert.equal(bootstrap.eventKind, 'service-start-result');
  assert.equal(verification.eventKind, 'verification-result');
  assert.equal(validateSharedWorkspaceMessage(bootstrap).valid, true);
  assert.equal(validateSharedWorkspaceMessage(verification).valid, true);
});
