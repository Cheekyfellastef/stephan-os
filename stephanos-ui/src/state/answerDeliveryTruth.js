function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function hasStructuredFinalPayload(payload) {
  if (payload == null) return false;
  if (Array.isArray(payload)) return payload.length > 0;
  if (typeof payload === 'object') return Object.keys(payload).length > 0;
  return normalizeText(payload).length > 0;
}

export function buildAnswerDeliveryTruth(input = {}) {
  const finalAssistantMessageId = normalizeText(input.finalAssistantMessageId);
  const finalAssistantText = normalizeText(input.finalAssistantText);
  const finalAssistantTextLength = finalAssistantText.length;
  const finalAssistantPayloadPresent = hasStructuredFinalPayload(input.finalAssistantPayload);
  const finalAssistantContentPresent = finalAssistantTextLength > 0 || finalAssistantPayloadPresent;
  const finalAssistantMessagePresent = finalAssistantMessageId.length > 0;
  const providerExecutionStatus = normalizeText(input.providerExecutionStatus || 'unknown').toLowerCase();
  const providerPending = ['pending', 'queued', 'in-progress'].some((token) => providerExecutionStatus.includes(token));
  const providerUnknown = providerExecutionStatus === 'unknown' || providerExecutionStatus === 'none' || providerExecutionStatus.length === 0;
  const answerPaneRendered = input.answerPaneRendered === true;
  const responseMode = normalizeText(input.responseMode || 'direct-answer').toLowerCase();
  const operatorExplanationIntentDetected = input.operatorExplanationIntentDetected === true;
  const operatorExplanationProjectionUsed = input.operatorExplanationProjectionUsed === true;
  const operatorExplanationAnswerGenerated = input.operatorExplanationAnswerGenerated === true;
  const executionSuccess = input.executionSuccess === true;

  let answerDeliveryStatus = 'failed';
  let answerDeliveryFailureReason = 'final-assistant-message-missing';
  let answerDeliveryNextAction = 'Create a final assistant message and append it to history.';

  if (providerUnknown) {
    answerDeliveryStatus = 'diagnostic-failure';
    answerDeliveryFailureReason = 'provider-execution-status-unknown';
    answerDeliveryNextAction = 'Inspect provider execution status plumbing before claiming generated/rendered.';
  } else if (providerPending && !(executionSuccess && finalAssistantMessagePresent && finalAssistantContentPresent)) {
    answerDeliveryStatus = 'pending';
    answerDeliveryFailureReason = 'provider-execution-pending';
    answerDeliveryNextAction = 'Wait for provider finalization before claiming generated/rendered.';
  } else if (executionSuccess && finalAssistantMessagePresent && !finalAssistantContentPresent) {
    answerDeliveryStatus = 'failed';
    answerDeliveryFailureReason = 'provider-returned-empty-text';
    answerDeliveryNextAction = 'Emit explicit structured failure/empty-state assistant answer.';
  } else if (finalAssistantMessagePresent && finalAssistantContentPresent) {
    answerDeliveryStatus = answerPaneRendered ? 'delivered' : 'diagnostic-failure';
    answerDeliveryFailureReason = answerPaneRendered ? 'none' : 'final-message-present-pane-not-rendered';
    answerDeliveryNextAction = answerPaneRendered ? 'none' : 'Inspect answer pane render diagnostics and canonical data attributes.';
  }


  if (responseMode === 'operator-explanation' && !operatorExplanationProjectionUsed) {
    answerDeliveryStatus = 'failed';
    answerDeliveryFailureReason = operatorExplanationIntentDetected
      ? 'operator-explanation-projection-skipped'
      : 'operator-explanation-intent-not-detected';
    answerDeliveryNextAction = 'Use deterministic operator explanation projection or return explicit failure reason.';
  }

  const answerDeliveryGenerated = answerDeliveryStatus === 'delivered' ? 'yes' : 'no';
  const answerDeliveryRendered = answerDeliveryStatus === 'delivered' ? 'yes' : 'no';
  const contradiction = (answerDeliveryGenerated === 'yes' || answerDeliveryRendered === 'yes')
    && (!finalAssistantMessagePresent || !finalAssistantContentPresent || !answerPaneRendered);

  return {
    answerDeliveryStatus,
    answerDeliveryGenerated,
    answerDeliveryRendered,
    finalAssistantMessagePresent: finalAssistantMessagePresent ? 'yes' : 'no',
    finalAssistantMessageId: finalAssistantMessageId || 'none',
    finalAssistantTextLength,
    finalAssistantPayloadPresent: finalAssistantPayloadPresent ? 'yes' : 'no',
    answerDeliveryFailureReason,
    answerDeliveryContradictionDetected: contradiction ? 'yes' : 'no',
    answerDeliveryNextAction,
    operatorExplanationIntentDetected: operatorExplanationIntentDetected ? 'yes' : 'no',
    operatorExplanationProjectionUsed: operatorExplanationProjectionUsed ? 'yes' : 'no',
    operatorExplanationAnswerGenerated: operatorExplanationAnswerGenerated ? 'yes' : 'no',
  };
}
