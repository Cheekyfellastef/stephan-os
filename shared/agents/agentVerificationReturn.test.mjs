import test from 'node:test';
import assert from 'node:assert/strict';

import { adjudicateVerificationReturn } from './agentVerificationReturn.mjs';

test('verification return waits for manual payload when packet is ready', () => {
  const result = adjudicateVerificationReturn({
    verificationReturn: { returnStatus: 'none' },
    fallbackChecks: ['npm run stephanos:build'],
    packetReady: true,
    lifecycleState: 'sent_to_agent',
  });

  assert.equal(result.verificationReturnStatus, 'waiting_for_return');
  assert.equal(result.verificationDecision, 'not_ready');
  assert.match(result.verificationReturnNextAction, /paste codex result/i);
});

test('verification return marks review required when checks are missing', () => {
  const result = adjudicateVerificationReturn({
    verificationReturn: {
      returnStatus: 'received',
      returnedSummary: 'Applied patch and ran one command.',
      verificationChecksRequired: ['npm run stephanos:build', 'npm run stephanos:verify'],
      verificationChecksPassed: ['npm run stephanos:build'],
    },
  });

  assert.equal(result.verificationDecision, 'needs_review');
  assert.equal(result.mergeReadiness, 'review_required');
  assert.equal(result.missingRequiredChecks.length, 1);
});

test('verification return marks safe_to_accept when checks pass without blockers', () => {
  const result = adjudicateVerificationReturn({
    verificationReturn: {
      returnStatus: 'received',
      returnedSummary: 'All checks passed.',
      verificationChecksRequired: ['npm run stephanos:build'],
      verificationChecksPassed: ['npm run stephanos:build'],
      returnedChecksRun: ['npm run stephanos:build'],
    },
  });

  assert.equal(result.verificationDecision, 'safe_to_accept');
  assert.equal(result.mergeReadiness, 'ready_for_operator_approval');
  assert.equal(result.verificationReturnStatus, 'verified');
});
