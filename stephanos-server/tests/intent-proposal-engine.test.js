import test from 'node:test';
import assert from 'node:assert/strict';

import { detectIntent } from '../services/intent-proposal/intentDetector.js';
import { buildProposal } from '../services/intent-proposal/proposalBuilder.js';
import { buildExecutionTruth } from '../services/intent-proposal/executionController.js';
import { buildIntentProposalEnvelope } from '../services/intent-proposal/proposalEngine.js';

test('intent detection maps known query to bounded intent', () => {
  const detected = detectIntent('Please build the intent proposal engine with tests.');
  assert.equal(detected.intentDetected, true);
  assert.equal(detected.intentType, 'build');
  assert.match(detected.intentConfidence, /medium|high/);
});

test('intent detection falls back to unknown safely', () => {
  const detected = detectIntent('...');
  assert.equal(detected.intentDetected, false);
  assert.equal(detected.intentType, 'unknown');
  assert.equal(detected.intentConfidence, 'low');
});

test('proposal creation is structured and bounded', () => {
  const proposal = buildProposal({
    requestText: 'retrieve runtime diagnostics',
    intent: { intentType: 'retrieve' },
    context: { target: 'runtime' },
  });

  assert.equal(proposal.proposalCreated, true);
  assert.equal(proposal.proposalStatus, 'ready');
  assert.ok(Array.isArray(proposal.steps));
  assert.equal(proposal.steps.length, 2);
  assert.equal(proposal.steps[0].stepType, 'retrieve');
});

test('execution rules block write auto-execution', () => {
  const proposal = buildProposal({
    requestText: 'build a new subsystem',
    intent: { intentType: 'build' },
  });
  const execution = buildExecutionTruth({ proposal, approvalGranted: false, simulateOnly: true });

  assert.equal(execution.executionEligible, false);
  assert.equal(execution.executionStarted, false);
  assert.match(execution.executionBlockedReason, /require explicit approval/i);
});

test('intent/proposal/execution truth fields are included in envelope', () => {
  const envelope = buildIntentProposalEnvelope({ requestText: 'summarize recent activity' });

  assert.equal(typeof envelope.intent.intentDetected, 'boolean');
  assert.equal(typeof envelope.intent.intentType, 'string');
  assert.equal(typeof envelope.intent.intentConfidence, 'string');
  assert.equal(typeof envelope.proposal.proposalCreated, 'boolean');
  assert.equal(typeof envelope.proposal.proposalStatus, 'string');
  assert.equal(typeof envelope.proposal.proposalStepCount, 'number');
  assert.equal(typeof envelope.execution.executionEligible, 'boolean');
  assert.equal(typeof envelope.execution.executionStarted, 'boolean');
  assert.equal(typeof envelope.execution.executionCompleted, 'boolean');
});

test('determinism: same input yields same proposal structure', () => {
  const first = buildProposal({ requestText: 'retrieve provider health', intent: { intentType: 'retrieve' } });
  const second = buildProposal({ requestText: 'retrieve provider health', intent: { intentType: 'retrieve' } });

  assert.equal(first.proposalId, second.proposalId);
  assert.deepEqual(first.steps, second.steps);
});

test('proposal build is read/analyze only for summarize intent and does not imply memory mutation', () => {
  const proposal = buildProposal({ requestText: 'summarize build status', intent: { intentType: 'summarize' } });
  assert.equal(proposal.steps.some((step) => step.stepType === 'memory' || step.stepType === 'write'), false);
});
