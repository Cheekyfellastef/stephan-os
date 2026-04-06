import test from 'node:test';
import assert from 'node:assert/strict';
import { writeTextToClipboard } from './clipboardCopy.js';

test('writeTextToClipboard returns clipboard-unavailable when modern and fallback apis are missing', async () => {
  const result = await writeTextToClipboard('hello', { navigatorObject: {}, documentObject: {} });
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
  assert.equal(result.method, 'navigator-clipboard');
  assert.equal(copied, 'hello');
});

test('writeTextToClipboard falls back to execCommand when clipboard api fails', async () => {
  let execCount = 0;
  const fakeTextarea = {
    value: '',
    setAttribute: () => {},
    style: {},
    focus: () => {},
    select: () => {},
    setSelectionRange: () => {},
    remove: () => {},
  };

  const result = await writeTextToClipboard('hello', {
    navigatorObject: {
      clipboard: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    },
    documentObject: {
      createElement: () => fakeTextarea,
      body: {
        appendChild: () => {},
      },
      execCommand: (cmd) => {
        execCount += 1;
        return cmd === 'copy';
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'copied-legacy-fallback');
  assert.equal(result.method, 'legacy-exec-command');
  assert.equal(execCount, 1);
});

test('writeTextToClipboard reports write failures when clipboard and fallback paths fail', async () => {
  const result = await writeTextToClipboard('hello', {
    navigatorObject: {
      clipboard: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    },
    documentObject: {
      createElement: () => ({
        setAttribute: () => {},
        style: {},
        focus: () => {},
        select: () => {},
        setSelectionRange: () => {},
        remove: () => {},
      }),
      body: {
        appendChild: () => {},
      },
      execCommand: () => false,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'clipboard-write-failed');
  assert.equal(result.method, 'navigator-clipboard');
});


test('writeTextToClipboard surfaces permission denied reason when modern and fallback copy fail', async () => {
  const result = await writeTextToClipboard('hello', {
    navigatorObject: {
      clipboard: {
        writeText: async () => {
          const denied = new Error('blocked');
          denied.name = 'NotAllowedError';
          throw denied;
        },
      },
    },
    documentObject: {
      createElement: () => ({
        setAttribute: () => {},
        style: {},
        focus: () => {},
        select: () => {},
        setSelectionRange: () => {},
        remove: () => {},
        value: '',
      }),
      body: {
        appendChild: () => {},
      },
      execCommand: () => false,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'clipboard-permission-denied');
  assert.equal(result.method, 'navigator-clipboard');
});

test('writeTextToClipboard does not throw when legacy textarea remove API is missing', async () => {
  const result = await writeTextToClipboard('hello', {
    navigatorObject: {},
    documentObject: {
      createElement: () => ({
        setAttribute: () => {},
        style: {},
        focus: () => {},
        select: () => {},
        setSelectionRange: () => {},
        parentNode: { removeChild: () => {} },
        value: '',
      }),
      body: {
        appendChild: () => {},
      },
      execCommand: () => true,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'copied-legacy-fallback');
  assert.equal(result.method, 'legacy-exec-command');
});
