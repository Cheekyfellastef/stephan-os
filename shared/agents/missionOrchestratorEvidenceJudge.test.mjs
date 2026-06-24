import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeMissionEvidence } from './missionOrchestratorEvidenceJudge.mjs';

function action(receipts = []) {
  return {
    actionKind: 'evidence-judgment',
    requiredEvidence: ['focused tests', 'build verification'],
    receipts,
  };
}

test('passes only when every exact requirement has deterministic verified proof', () => {
  const result = judgeMissionEvidence(action([
    {
      requirement: 'focused tests',
      source: 'codex-cli',
      evidenceType: 'command-output',
      verified: true,
      commandOutputHash: 'a'.repeat(64),
    },
    {
      requirement: 'build verification',
      source: 'openclaw-readonly-cli',
      evidenceType: 'readonly-inspection',
      verified: true,
      receiptPath: 'proof/build/verification.json',
    },
  ]));

  assert.equal(result.success, true);
  assert.deepEqual(result.missingRequirements, []);
  assert.equal(result.acceptedReceipts.length, 2);
});

test('blocks missing, unverified, fabricated, and substring evidence', () => {
  const result = judgeMissionEvidence(action([
    {
      requirement: 'focused',
      source: 'codex-cli',
      evidenceType: 'command-output',
      verified: true,
      commandOutputHash: 'b'.repeat(64),
    },
    {
      requirement: 'build verification',
      source: 'claim',
      evidenceType: 'text',
      verified: false,
      exitCode: 0,
    },
  ]));

  assert.equal(result.success, false);
  assert.deepEqual(result.missingRequirements, ['focused tests', 'build verification']);
  assert.equal(result.acceptedReceipts.length, 1);
  assert.match(result.error, /Missing deterministic evidence/);
});

test('rejects unsupported actions', () => {
  const result = judgeMissionEvidence({ actionKind: 'agent-handoff' });
  assert.equal(result.success, false);
  assert.match(result.error, /Unsupported/);
});
