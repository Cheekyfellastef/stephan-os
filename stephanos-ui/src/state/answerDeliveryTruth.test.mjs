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


test('provider unknown is diagnostic-failure and cannot claim generated/rendered', () => {
  const truth = buildAnswerDeliveryTruth({
    providerExecutionStatus: 'unknown',
    executionSuccess: true,
    finalAssistantMessageId: 'msg-2',
    finalAssistantText: 'Answer exists but provider status is unknown',
    answerPaneRendered: true,
  });
  assert.equal(truth.answerDeliveryStatus, 'diagnostic-failure');
  assert.equal(truth.answerDeliveryFailureReason, 'provider-execution-status-unknown');
  assert.equal(truth.answerDeliveryGenerated, 'no');
  assert.equal(truth.answerDeliveryRendered, 'no');
});

test('structured empty-state payload satisfies final assistant content presence', () => {
  const truth = buildAnswerDeliveryTruth({
    providerExecutionStatus: 'ok',
    executionSuccess: false,
    finalAssistantMessageId: 'msg-3',
    finalAssistantText: '',
    finalAssistantPayload: { type: 'empty-state', code: 'NO_DATA' },
    answerPaneRendered: true,
  });
  assert.equal(truth.answerDeliveryStatus, 'delivered');
  assert.equal(truth.finalAssistantPayloadPresent, 'yes');
  assert.equal(truth.answerDeliveryGenerated, 'yes');
});


test('final assistant text and render proof override stale provider pending metadata', () => {
  const truth = buildAnswerDeliveryTruth({
    providerExecutionStatus: 'provider-execution-pending',
    executionSuccess: true,
    finalAssistantMessageId: 'cmd_final',
    finalAssistantText: 'Visible final answer',
    answerPaneRendered: true,
  });
  assert.equal(truth.answerDeliveryStatus, 'delivered');
  assert.equal(truth.answerDeliveryFailureReason, 'none');
  assert.equal(truth.answerDeliveryGenerated, 'yes');
  assert.equal(truth.answerDeliveryRendered, 'yes');
});
