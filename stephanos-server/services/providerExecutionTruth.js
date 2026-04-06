function asText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

export function resolveProviderExecutionTruth({
  actualProviderUsed = '',
  executionStatus = '',
  executableProvider = '',
  selectedProvider = '',
  backendDefaultProvider = '',
  requestedProviderForRequest = '',
  fallbackUsed = false,
  fallbackProviderUsed = '',
  fallbackReason = '',
} = {}) {
  const providerUsed = asText(actualProviderUsed)
    || asText(executableProvider)
    || asText(selectedProvider)
    || asText(backendDefaultProvider, 'unknown');
  const status = asText(executionStatus, providerUsed === 'unknown' ? 'unknown' : `ok:${providerUsed}`);
  const answered = providerUsed === 'unknown'
    ? 'Provider execution unconfirmed'
    : `${providerUsed} answered`;
  const requested = asText(requestedProviderForRequest);
  const fallbackProvider = asText(fallbackProviderUsed);
  const fallbackNarration = fallbackUsed && fallbackProvider
    ? `Fallback via ${fallbackProvider}${requested ? ` after ${requested} failure` : ''}.`
    : '';
  const fallbackReasonNarration = fallbackUsed && fallbackReason
    ? ` Reason: ${fallbackReason}`
    : '';

  return {
    providerUsed,
    status,
    answered,
    narration: `Execution truth: ${answered}.${fallbackNarration}${fallbackReasonNarration}`.trim(),
  };
}
