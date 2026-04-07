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
    return {
      ok: false,
      reason: 'clipboard-unavailable',
    };
  }

  const textarea = documentObject.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = false;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.whiteSpace = 'pre';
  textarea.style.userSelect = 'text';

  try {
    documentObject.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    if (typeof textarea.setSelectionRange === 'function') {
      textarea.setSelectionRange(0, textarea.value.length);
    }
  } catch (error) {
    return {
      ok: false,
      reason: 'clipboard-write-failed',
      error,
    };
  }

  let copied = false;
  let copyError = null;
  try {
    copied = Boolean(documentObject.execCommand('copy'));
  } catch (error) {
    copied = false;
    copyError = error;
  }

  try {
    if (typeof textarea.remove === 'function') {
      textarea.remove();
    } else if (textarea.parentNode && typeof textarea.parentNode.removeChild === 'function') {
      textarea.parentNode.removeChild(textarea);
    }
  } catch {
    // Ignore cleanup failures.
  }
  if (copied) {
    return {
      ok: true,
      reason: 'copied-legacy-fallback',
    };
  }
  return {
    ok: false,
    reason: resolveClipboardFailureReason(copyError),
    error: copyError,
  };
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
        method: 'navigator-clipboard',
        text: normalizedText,
      };
    } catch (error) {
      const legacyResult = tryLegacyClipboardCopy(normalizedText, { documentObject });
      if (legacyResult.ok) {
        return {
          ok: true,
          reason: legacyResult.reason,
          method: 'legacy-exec-command',
          text: normalizedText,
        };
      }
      return {
        ok: false,
        reason: resolveClipboardFailureReason(error),
        method: 'navigator-clipboard',
        text: normalizedText,
        error: legacyResult.error || error,
      };
    }
  }

  const legacyResult = tryLegacyClipboardCopy(normalizedText, { documentObject });
  if (legacyResult.ok) {
    return {
      ok: true,
      reason: legacyResult.reason,
      method: 'legacy-exec-command',
      text: normalizedText,
    };
  }

  return {
    ok: false,
    reason: legacyResult.reason || 'clipboard-unavailable',
    method: 'legacy-exec-command',
    text: normalizedText,
    error: legacyResult.error,
  };
}
