function normalizeInput(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function sanitizeClipboardText(rawValue) {
  const original = normalizeInput(rawValue);
  let text = original;

  const diagnostics = {
    normalizedLineEndings: false,
    normalizedNbsp: 0,
    removedInvisibleChars: 0,
    convertedTabs: 0,
    trimmedLines: 0,
    collapsedBlankLineRuns: 0,
  };

  const normalizedLineEndings = text.replace(/\r\n?/g, '\n');
  if (normalizedLineEndings !== text) {
    diagnostics.normalizedLineEndings = true;
    text = normalizedLineEndings;
  }

  const nbspMatches = text.match(/\u00A0/g);
  if (nbspMatches?.length) {
    diagnostics.normalizedNbsp = nbspMatches.length;
    text = text.replace(/\u00A0/g, ' ');
  }

  const invisiblePattern = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
  const invisibleMatches = text.match(invisiblePattern);
  if (invisibleMatches?.length) {
    diagnostics.removedInvisibleChars = invisibleMatches.length;
    text = text.replace(invisiblePattern, '');
  }

  const tabMatches = text.match(/\t/g);
  if (tabMatches?.length) {
    diagnostics.convertedTabs = tabMatches.length;
    text = text.replace(/\t/g, '  ');
  }

  const lines = text.split('\n');
  const normalizedLines = lines.map((line) => {
    const trimmed = line.replace(/[ \f\v]+$/g, '');
    if (trimmed !== line) {
      diagnostics.trimmedLines += 1;
    }
    return trimmed;
  });
  text = normalizedLines.join('\n');

  const blankRuns = text.match(/\n{3,}/g);
  if (blankRuns?.length) {
    diagnostics.collapsedBlankLineRuns = blankRuns.length;
    text = text.replace(/\n{3,}/g, '\n\n');
  }

  text = text.trim();

  return {
    text,
    diagnostics,
    rawCharacterCount: original.length,
    cleanedCharacterCount: text.length,
    rawLineCount: original.length === 0 ? 0 : original.replace(/\r\n?/g, '\n').split('\n').length,
    cleanedLineCount: text.length === 0 ? 0 : text.split('\n').length,
  };
}
