import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  aggregateVerificationResults,
  runVerificationHarness,
  runVerifier,
  validateVerifierResult,
  writeVerificationPacketToSharedWorkspace,
} from './verificationHarness.mjs';
import {
  createAgentCapabilityRecord,
  createSharedWorkspaceProofRecord,
} from './sharedAgentWorkspaceStore.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

async function tempWorkspace() {
  return mkdtemp(join(tmpdir(), 'stephanos-verification-workspace-test-'));
}

test('workspace record verifier accepts valid Shared Agent Workspace proof records', () => {
  const record = createSharedWorkspaceProofRecord({
    proofId: 'proof-1287',
    timestampUtc: '2026-07-07T00:00:00Z',
    status: 'PASS',
    summary: '#1287 deterministic verification proof',
    refs: ['proof/verification/proof-1287.json'],
  });

  const result = runVerifier('WorkspaceRecordVerifier', { record }, { timestampUtc: '2026-07-07T00:00:01Z' });

  assert.equal(result.status, 'PASS');
  assert.equal(result.finalVerdict, 'WORKSPACE_RECORD_VERIFIER_PASS');
  assert.equal(validateVerifierResult(result).valid, true);
});

test('proof reference verifier blocks unsafe or missing proof refs', () => {
  const pass = runVerifier('ProofReferenceVerifier', { proofRefs: ['proof/verification/receipt.json'] });
  const blocked = runVerifier('ProofReferenceVerifier', { proofRefs: ['../secret.json'] });

  assert.equal(pass.status, 'PASS');
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.finalVerdict, 'PROOF_REFERENCE_VERIFIER_BLOCKED');
});

test('command receipt verifier requires deterministic receipt hash without arbitrary shell approval', () => {
  const pass = runVerifier('CommandReceiptVerifier', {
    receiptId: 'receipt-node-test',
    commandId: 'node-test-shared-agents',
    exitCode: 0,
    commandOutputHash: 'b'.repeat(64),
    arbitraryShellAllowed: false,
    proofRefs: ['receipts/node-test-shared-agents.json'],
  });
  const blocked = runVerifier('CommandReceiptVerifier', {
    receiptId: 'receipt-shell',
    exitCode: 0,
    commandOutputHash: 'c'.repeat(64),
    arbitraryShellAllowed: true,
  });

  assert.equal(pass.status, 'PASS');
  assert.equal(pass.finalVerdict, 'COMMAND_RECEIPT_VERIFIER_PASS');
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.finalVerdict, 'COMMAND_RECEIPT_VERIFIER_BLOCKED');
});

test('agent capability verifier preserves OpenClaw default non-executable capability posture', () => {
  const openClaw = createAgentCapabilityRecord({ agentId: 'openclaw', timestampUtc: '2026-07-07T00:00:00Z' });
  const result = runVerifier('AgentCapabilityVerifier', { record: openClaw }, { nowMs: Date.parse('2026-07-07T00:10:00Z') });

  assert.equal(result.status, 'PASS');
  assert.equal(result.finalVerdict, 'AGENT_CAPABILITY_VERIFIER_PASS');
  assert.equal(result.evidence.includes('mergeAuthority=false'), true);
  assert.equal(result.evidence.includes('arbitraryShellAllowed=false'), true);
});

test('stale capability verifier observes stale records without claiming pass', () => {
  const openClaw = createAgentCapabilityRecord({ agentId: 'openclaw', timestampUtc: '2026-07-07T00:00:00Z' });
  const result = runVerifier('StaleCapabilityVerifier', { record: openClaw }, {
    nowMs: Date.parse('2026-07-07T02:00:01Z'),
    staleAfterMs: 60 * 60 * 1000,
  });

  assert.equal(result.status, 'OBSERVED');
  assert.equal(result.finalVerdict, 'CAPABILITY_RECORD_STALE_OBSERVED');
  assert.equal(validateVerifierResult(result).valid, true);
});

test('aggregate verification packet carries OBSERVED status when only stale capability is observed', () => {
  const aggregate = aggregateVerificationResults({
    aggregateId: 'workspace-stale-observed',
    checks: [
      { checkId: 'workspace-record', verifierType: 'WorkspaceRecordVerifier', status: 'PASS', evidence: ['valid=true'] },
      { checkId: 'stale-capability', verifierType: 'StaleCapabilityVerifier', status: 'OBSERVED', evidence: ['stale=true'] },
    ],
  });

  assert.equal(aggregate.status, 'OBSERVED');
  assert.equal(aggregate.overall, 'OBSERVED');
  assert.equal(aggregate.operatorNeeded, false);
  assert.equal(aggregate.finalVerdict, 'VERIFICATION_HARNESS_OBSERVED');
});

test('runner binds verifier results to Shared Agent Workspace records', () => {
  const capability = createAgentCapabilityRecord({ agentId: 'openclaw', timestampUtc: '2026-07-07T00:00:00Z' });
  const aggregate = runVerificationHarness({
    aggregateId: 'issue-1287-shared-workspace-bind',
    timestampUtc: '2026-07-07T00:00:10Z',
    verifiers: ['AgentCapabilityVerifier', 'ProofReferenceVerifier', 'CommandReceiptVerifier'],
    packets: {
      AgentCapabilityVerifier: { record: capability },
      ProofReferenceVerifier: { proofRefs: ['proof/verification/issue-1287.json'] },
      CommandReceiptVerifier: { receiptId: 'receipt-1287', commandId: 'node-test-shared-agents', exitCode: 0, commandOutputHash: 'd'.repeat(64), arbitraryShellAllowed: false },
    },
  });

  assert.equal(aggregate.status, 'PASS');
  assert.equal(aggregate.workspaceMessage.eventKind, 'verification-result');
  assert.equal(aggregate.workspaceMessage.status, 'VERIFIED');
});

test('optional writer emits proof status and event into a bounded Shared Workspace temp path', async () => {
  const root = await tempWorkspace();
  try {
    const aggregate = aggregateVerificationResults({
      aggregateId: 'issue-1287-write-proof',
      timestampUtc: '2026-07-07T00:00:00Z',
      checks: [{ checkId: 'proof-ref', verifierType: 'ProofReferenceVerifier', status: 'PASS', evidence: ['refCount=1'], proofRefs: ['proof/verification/issue-1287.json'] }],
    });

    const write = await writeVerificationPacketToSharedWorkspace(root, aggregate, { repoRoot: REPO_ROOT, timestampUtc: '2026-07-07T00:00:00Z' });

    assert.equal(write.ok, true);
    assert.equal(write.reason, 'VERIFICATION_PACKET_WRITTEN');
    const proof = JSON.parse(await readFile(join(root, 'proof', 'issue-1287-write-proof-verification.json'), 'utf8'));
    const status = JSON.parse(await readFile(join(root, 'status', 'issue-1287-write-proof-status.json'), 'utf8'));
    const events = await readFile(join(root, 'events', 'verification-results.jsonl'), 'utf8');
    assert.equal(proof.status, 'PASS');
    assert.equal(status.status, 'VERIFIED');
    assert.equal(events.includes('verification-result'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
