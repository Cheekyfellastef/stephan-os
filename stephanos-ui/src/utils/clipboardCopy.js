function normalizeClipboardText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function tryLegacyClipboardCopy(text, { documentObject = globalThis.document } = {}) {
  if (!documentObject?.createElement || !documentObject?.body?.appendChild || !documentObject?.execCommand) {
    return false;
  }

  const textarea = documentObject.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.left = '-9999px';

  documentObject.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = Boolean(documentObject.execCommand('copy'));
  } catch {
    copied = false;
  }

  textarea.remove();
  return copied;
}

export async function writeTextToClipboard(
  text,
  { navigatorObject = globalThis.navigator, documentObject = globalThis.document } = {},
) {
  const normalizedText = normalizeClipboardText(text);

  if (navigatorObject?.clipboard?.writeText) {
    try {
      await navigatorObject.clipboard.writeText(normalizedText);
      return {
        ok: true,
        reason: 'copied',
        text: normalizedText,
      };
    } catch (error) {
      const legacyCopied = tryLegacyClipboardCopy(normalizedText, { documentObject });
      if (legacyCopied) {
        return {
          ok: true,
          reason: 'copied-legacy-fallback',
          text: normalizedText,
        };
      }
      return {
        ok: false,
        reason: 'clipboard-write-failed',
        text: normalizedText,
        error,
      };
    }
  }

  const legacyCopied = tryLegacyClipboardCopy(normalizedText, { documentObject });
  if (legacyCopied) {
    return {
      ok: true,
      reason: 'copied-legacy-fallback',
      text: normalizedText,
    };
  }

  return {
    ok: false,
    reason: 'clipboard-unavailable',
    text: normalizedText,
  };
}
