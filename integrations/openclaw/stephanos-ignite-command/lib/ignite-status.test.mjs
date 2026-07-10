import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AUTHORIZED_SUBCOMMANDS,
  PLUGIN_ID,
  renderIgniteCommand,
  resolveIgniteCommand,
} from './ignite-status.mjs';

const root = new URL('../', import.meta.url);

test('exposes only the authorized command surface', () => {
  assert.equal(PLUGIN_ID, 'stephanos-ignite-command');
  assert.deepEqual(AUTHORIZED_SUBCOMMANDS, ['help', 'openclaw-status', 'status']);
});

test('renders deterministic help, openclaw-status, and status outputs', () => {
  assert.equal(renderIgniteCommand('help'), renderIgniteCommand(''));
  assert.match(renderIgniteCommand('help'), /\/stephanos-ignite openclaw-status/);
  assert.match(renderIgniteCommand('openclaw-status'), /OPENCLAW_STATUS=operator-verification-required/);
  assert.match(renderIgniteCommand('status'), /STEPHANOS_IGNITE_STATUS=source-plugin-restored/);
  assert.equal(renderIgniteCommand('status'), renderIgniteCommand(' STATUS '));
});

test('rejects unsupported mutation and dispatch commands', () => {
  for (const command of ['fix', 'repair', 'merge', 'push', 'install', 'codex', 'run', 'openclaw-task']) {
    const resolved = resolveIgniteCommand(command);
    assert.equal(resolved.ok, false);
    assert.match(resolved.text, /Unsupported/);
  }
});

test('source exposes no mutation, shell, Codex, merge, push, install, or task capabilities', async () => {
  const files = [
    await readFile(new URL('index.js', root), 'utf8'),
    await readFile(new URL('lib/ignite-status.mjs', root), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(files, /node:child_process|execFile|spawn\s*\(|createRequire/);
  assert.doesNotMatch(files, /registerTool\s*\(|continueAgent:\s*true/);
  assert.doesNotMatch(files, /git\s+(?:merge|push|commit)|openclaw\s+doctor|codex\s+/);
});
