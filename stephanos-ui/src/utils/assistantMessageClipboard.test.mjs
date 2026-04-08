import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantMessageClipboardPayload } from './assistantMessageClipboard.js';

test('buildAssistantMessageClipboardPayload copies assistant output text only when structured data is absent', () => {
  const payload = buildAssistantMessageClipboardPayload({
    output_text: 'Mission response complete.',
  });

  assert.equal(payload, 'Mission response complete.');
});

test('buildAssistantMessageClipboardPayload includes message-scoped structured data when present', () => {
  const payload = buildAssistantMessageClipboardPayload({
    output_text: 'Truth report ready.',
    data_payload: {
      timeout_truth: { source: 'per-message', value: 120 },
    },
    response: {
      debug: {
        selected_subsystem: 'assistant',
      },
    },
  });

  assert.match(payload, /^\[Assistant Answer\]\nTruth report ready\./);
  assert.match(payload, /\[Structured Data\]/);
  assert.match(payload, /"timeout_truth"/);
  assert.match(payload, /"selected_subsystem"/);
});

test('buildAssistantMessageClipboardPayload does not leak unrelated global state', () => {
  globalThis.__STEPHANOS_GLOBAL_TRUTH__ = { latest: 'should-not-appear' };
  const payload = buildAssistantMessageClipboardPayload({
    output_text: 'Historical answer snapshot.',
    data_payload: {
      retrieval_truth: { id: 'message-a' },
    },
  });

  assert.doesNotMatch(payload, /should-not-appear/);
  assert.match(payload, /message-a/);
  delete globalThis.__STEPHANOS_GLOBAL_TRUTH__;
});


test('buildAssistantMessageClipboardPayload keeps historical message metadata scoped to that message', () => {
  const olderMessage = {
    output_text: 'Older answer body.',
    data_payload: {
      memory_truth: { message_id: 'old-1', checkpoint: 'historical' },
    },
  };
  const newerMessage = {
    output_text: 'Newer answer body.',
    data_payload: {
      memory_truth: { message_id: 'new-2', checkpoint: 'latest' },
    },
  };

  const olderPayload = buildAssistantMessageClipboardPayload(olderMessage);
  const newerPayload = buildAssistantMessageClipboardPayload(newerMessage);

  assert.match(olderPayload, /old-1/);
  assert.doesNotMatch(olderPayload, /new-2/);
  assert.match(newerPayload, /new-2/);
});

test('buildAssistantMessageClipboardPayload reads camelCase response output when snake_case is absent', () => {
  const payload = buildAssistantMessageClipboardPayload({
    response: {
      outputText: 'Camel case response text.',
    },
  });

  assert.equal(payload, 'Camel case response text.');
});

test('buildAssistantMessageClipboardPayload returns empty payload when message has no answer text or structured data', () => {
  const payload = buildAssistantMessageClipboardPayload({});
  assert.equal(payload, '');
});
