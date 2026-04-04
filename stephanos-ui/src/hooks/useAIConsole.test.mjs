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
