function normalizeClipboardText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

export async function writeTextToClipboard(text, { navigatorObject = globalThis.navigator } = {}) {
  const normalizedText = normalizeClipboardText(text);

  if (!navigatorObject?.clipboard?.writeText) {
    return {
      ok: false,
      reason: 'clipboard-unavailable',
      text: normalizedText,
    };
  }

  try {
    await navigatorObject.clipboard.writeText(normalizedText);
    return {
      ok: true,
      reason: 'copied',
      text: normalizedText,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'clipboard-write-failed',
      text: normalizedText,
      error,
    };
  }
}
