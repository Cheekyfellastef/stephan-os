import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeClipboardText } from './clipboardSanitizer.js';

test('sanitizeClipboardText normalizes whitespace and preserves readable structure', () => {
  const result = sanitizeClipboardText('  alpha\r\n\tbeta\u00A0\r\n\r\n\r\n gamma  ');

  assert.equal(result.text, 'alpha\n  beta\n\n gamma');
  assert.equal(result.diagnostics.normalizedLineEndings, true);
  assert.equal(result.diagnostics.normalizedNbsp, 1);
  assert.equal(result.diagnostics.convertedTabs, 1);
  assert.equal(result.cleanedLineCount, 4);
});

test('sanitizeClipboardText removes invisible characters safely', () => {
  const result = sanitizeClipboardText(`a\u200Bb\u200Cc\u2060d\uFEFFe`);

  assert.equal(result.text, 'abcde');
  assert.equal(result.diagnostics.removedInvisibleChars, 4);
});

test('sanitizeClipboardText handles nullish input without undefined leakage', () => {
  const result = sanitizeClipboardText(undefined);

  assert.equal(result.text, '');
  assert.equal(result.rawCharacterCount, 0);
  assert.equal(result.cleanedCharacterCount, 0);
});
