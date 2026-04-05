function normalizeClipboardText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function resolveClipboardFailureReason(error) {
  const errorName = String(error?.name || '').toLowerCase();
  if (errorName === 'notallowederror' || errorName === 'securityerror') {
    return 'clipboard-permission-denied';
  }
  if (errorName === 'notsupportederror') {
    return 'clipboard-unavailable';
  }
  if (errorName === 'aborterror') {
    return 'clipboard-aborted';
  }
  return 'clipboard-write-failed';
}

function tryLegacyClipboardCopy(text, { documentObject = globalThis.document } = {}) {
  if (!documentObject?.createElement || !documentObject?.body?.appendChild || !documentObject?.execCommand) {
    return false;
  }

  const textarea = documentObject.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';

  documentObject.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  if (typeof textarea.setSelectionRange === 'function') {
    textarea.setSelectionRange(0, textarea.value.length);
  }

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
        reason: resolveClipboardFailureReason(error),
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
