import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerDeliveryTruth } from './answerDeliveryTruth.js';

test('fails contradiction when operator-explanation projection is skipped', () => {
  const truth = buildAnswerDeliveryTruth({
    responseMode: 'operator-explanation',
    operatorExplanationIntentDetected: true,
    operatorExplanationProjectionUsed: false,
    operatorExplanationAnswerGenerated: true,
    finalAssistantMessageId: '',
    finalAssistantText: '',
    answerPaneRendered: false,
    providerExecutionStatus: 'ok',
    executionSuccess: true,
  });
  assert.equal(truth.answerDeliveryStatus, 'failed');
  assert.equal(truth.answerDeliveryFailureReason, 'operator-explanation-projection-skipped');
  assert.equal(truth.answerDeliveryGenerated, 'no');
});

test('pending provider execution cannot claim generated/rendered', () => {
  const truth = buildAnswerDeliveryTruth({ providerExecutionStatus: 'pending', executionSuccess: false });
  assert.equal(truth.answerDeliveryStatus, 'pending');
  assert.equal(truth.answerDeliveryGenerated, 'no');
  assert.equal(truth.answerDeliveryRendered, 'no');
});

test('provider success with missing text reports explicit failure', () => {
  const truth = buildAnswerDeliveryTruth({
    providerExecutionStatus: 'ok',
    executionSuccess: true,
    finalAssistantMessageId: 'msg-1',
    finalAssistantText: '',
    answerPaneRendered: false,
  });
  assert.equal(truth.answerDeliveryStatus, 'failed');
  assert.equal(truth.answerDeliveryFailureReason, 'provider-returned-empty-text');
});

test('top 3 problems operator explanation delivers final rendered answer', () => {
  const truth = buildAnswerDeliveryTruth({
    responseMode: 'operator-explanation',
    operatorExplanationIntentDetected: true,
    operatorExplanationProjectionUsed: true,
    operatorExplanationAnswerGenerated: true,
    providerExecutionStatus: 'ok',
    executionSuccess: true,
    finalAssistantMessageId: 'a1',
    finalAssistantText: 'Top 3 Problems: 1) A 2) B 3) C',
    answerPaneRendered: true,
  });
  assert.equal(truth.answerDeliveryStatus, 'delivered');
  assert.equal(truth.answerDeliveryGenerated, 'yes');
  assert.equal(truth.answerDeliveryRendered, 'yes');
});
