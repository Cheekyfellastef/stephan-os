export function resolveProviderSecretSaveFeedback(secretSave, providerKey, providerLabel = '') {
  const resolvedLabel = String(providerLabel || providerKey || '').trim() || String(providerKey || '');
  if (secretSave?.ok) {
    return {
      type: 'success',
      message: `${resolvedLabel} API key saved to backend local secret store.`,
    };
  }

  return {
    type: 'error',
    message: secretSave?.error || `Failed to store ${providerKey} API key in backend local secret store.`,
  };
}
