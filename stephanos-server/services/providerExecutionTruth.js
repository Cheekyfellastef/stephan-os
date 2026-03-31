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
} = {}) {
  const providerUsed = asText(actualProviderUsed)
    || asText(executableProvider)
    || asText(selectedProvider)
    || asText(backendDefaultProvider, 'unknown');
  const status = asText(executionStatus, providerUsed === 'unknown' ? 'unknown' : `ok:${providerUsed}`);
  const answered = providerUsed === 'unknown'
    ? 'Provider execution unconfirmed'
    : `${providerUsed} answered`;

  return {
    providerUsed,
    status,
    answered,
    narration: `Execution truth: ${answered}.`,
  };
}
