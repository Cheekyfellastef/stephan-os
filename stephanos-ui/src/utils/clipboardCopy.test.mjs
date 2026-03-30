import test from 'node:test';
import assert from 'node:assert/strict';
import { writeTextToClipboard } from './clipboardCopy.js';

test('writeTextToClipboard returns clipboard-unavailable when api is missing', async () => {
  const result = await writeTextToClipboard('hello', { navigatorObject: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'clipboard-unavailable');
});

test('writeTextToClipboard writes text when clipboard api exists', async () => {
  let copied = '';
  const result = await writeTextToClipboard('hello', {
    navigatorObject: {
      clipboard: {
        writeText: async (value) => {
          copied = value;
        },
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'copied');
  assert.equal(copied, 'hello');
});

test('writeTextToClipboard reports write failures for manual fallback paths', async () => {
  const result = await writeTextToClipboard('hello', {
    navigatorObject: {
      clipboard: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'clipboard-write-failed');
});
