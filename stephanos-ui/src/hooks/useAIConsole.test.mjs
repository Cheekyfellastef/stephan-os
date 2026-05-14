import test from 'node:test';
import assert from 'node:assert/strict';
import { appendCommandHistory, MAX_COMMAND_HISTORY } from './commandHistory.js';

test('appendCommandHistory keeps command history bounded', () => {
  let history = [];
  for (let index = 0; index < MAX_COMMAND_HISTORY + 5; index += 1) {
    history = appendCommandHistory(history, { id: `cmd_${index}` });
  }

  assert.equal(history.length, MAX_COMMAND_HISTORY);
  assert.equal(history[0].id, 'cmd_5');
  assert.equal(history.at(-1).id, `cmd_${MAX_COMMAND_HISTORY + 4}`);
});

import fs from 'node:fs/promises';
import path from 'node:path';

test('useAIConsole request path includes chat context pack metadata', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /buildChatContextPack/);
  assert.match(source, /chatContextPack/);
  assert.match(source, /chat_context_response_mode/);
});


test('useAIConsole stores compact chat context metadata in latest execution metadata', async () => {
  const source = await fs.readFile(path.join(new URL('.', import.meta.url).pathname, 'useAIConsole.js'), 'utf8');
  assert.match(source, /function buildChatContextExecutionMetadata/);
  assert.match(source, /submissionSource = 'stephanos-mission-console'/);
  assert.match(source, /submissionRoute = 'assistant-router'/);
  assert.match(source, /chat_context_pack_status/);
  assert.match(source, /setLastExecutionMetadata\(\(prev\) => \(\{/);
  assert.match(source, /\.\.\.buildChatContextExecutionMetadata\(chatContextPack\)/);
  assert.match(source, /\.\.\.buildChatContextAttachmentMetadata\(\{/);
  assert.match(source, /submission_console: executionMetadata\.submission_console \|\| requestTrace\.submission_console \|\| requestPayload\.submissionSource \|\| 'stephanos-mission-console'/);
  assert.match(source, /submission_route: executionMetadata\.submission_route \|\| requestTrace\.submission_route \|\| requestPayload\.submissionRoute \|\| 'assistant-router'/);
  assert.match(source, /chat_context_pack_status/);
  assert.match(source, /chat_context_version/);
  assert.match(source, /chat_context_response_mode/);
  assert.match(source, /chat_context_relevant_canon_count/);
  assert.match(source, /chat_context_sources_used/);
  assert.match(source, /chat_context_warning_count/);
  assert.match(source, /request_payload_chat_context_present:\s*Boolean\(\(effectiveRequestPayload\?\.chatContextPack\) \|\|/);
});
