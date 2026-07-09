import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIgniteReply, parseIgniteCommand, STEPHANOS_IGNITE_COMMAND_DEFAULTS } from './ignite-command.mjs';

test('accepts help forms for Battle Bridge proof', () => {
  assert.deepEqual(parseIgniteCommand(''), { ok: true, action: 'help' });
  assert.deepEqual(parseIgniteCommand('help'), { ok: true, action: 'help' });
  assert.deepEqual(parseIgniteCommand('--help'), { ok: true, action: 'help' });
});

test('rejects unsupported ignite actions with safe usage guidance', () => {
  assert.deepEqual(parseIgniteCommand('run'), {
    ok: false,
    text: 'Usage: /stephanos-ignite help',
  });
});

test('returns the command help reply through the plugin handler surface', () => {
  const reply = buildIgniteReply('help');
  assert.match(reply.text, /Stephanos Ignite command help/);
  assert.match(reply.text, /\/stephanos-ignite help/);
  assert.equal(STEPHANOS_IGNITE_COMMAND_DEFAULTS.command, 'stephanos-ignite');
});
