import assert from 'node:assert/strict';
import test from 'node:test';
import { handleIgniteCommand, parseIgniteCommand } from './ignite-command.mjs';

test('supports required WhatsApp subcommands', () => {
  assert.equal(parseIgniteCommand('help').ok, true);
  assert.equal(parseIgniteCommand('openclaw-status').ok, true);
  assert.equal(parseIgniteCommand('status').ok, true);
});

test('returns plugin loaded proof for openclaw-status', () => {
  assert.match(handleIgniteCommand('openclaw-status').text, /OPENCLAW_PLUGIN_LOADED/);
  assert.match(handleIgniteCommand('openclaw-status').text, /pluginId=stephanos-ignite-command/);
});

test('reports ignition posture without bypassing approval gates', () => {
  const result = handleIgniteCommand('status').text;
  assert.match(result, /canonicalCommand=npm run stephanos:ignite/);
  assert.match(result, /approvalGates=preserved/);
});
