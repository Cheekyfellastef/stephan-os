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
const HEAD = 'a'.repeat(40);

test('exposes only the authorized command surface', () => {
  assert.equal(PLUGIN_ID, 'stephanos-ignite-command');
  assert.deepEqual(AUTHORIZED_SUBCOMMANDS, ['help', 'openclaw-status', 'status', 'wake', 'update']);
});

test('renders deterministic help, openclaw-status, status and fixed recovery outputs', () => {
  assert.equal(renderIgniteCommand('help'), renderIgniteCommand(''));
  assert.match(renderIgniteCommand('help'), /\/stephanos-ignite openclaw-status/);
  assert.match(renderIgniteCommand('help'), /\/stephanos-ignite update <exact-40-character-main-sha>/);
  assert.match(renderIgniteCommand('openclaw-status'), /OPENCLAW_STATUS=operator-verification-required/);
  assert.match(renderIgniteCommand('status'), /STEPHANOS_IGNITE_STATUS=source-plugin-restored/);
  assert.match(renderIgniteCommand('status'), /PLUGIN_CAPABILITY_MUTATES_REPO=OWNER_GATED_EXACT_HEAD_ONLY/);
  assert.doesNotMatch(renderIgniteCommand('status'), /MUTATES_REPO=false|RUNS_SHELL=false/);
  assert.match(renderIgniteCommand('wake'), /AUTHENTICATED_FIXED_ADAPTER/);
  assert.match(renderIgniteCommand(`update ${HEAD}`), new RegExp(`EXPECTED_HEAD=${HEAD}`));
  assert.equal(renderIgniteCommand('status'), renderIgniteCommand(' STATUS '));
});

test('accepts update only with one exact 40-character SHA', () => {
  assert.deepEqual(resolveIgniteCommand(`update ${HEAD.toUpperCase()}`), {
    ok: true,
    command: 'update',
    expectedHead: HEAD,
  });
  for (const command of [
    'update',
    'update main',
    `update ${HEAD} extra`,
    `update ../${HEAD}`,
    `update ${'a'.repeat(39)}`,
    `update ${'a'.repeat(41)}`,
  ]) {
    const resolved = resolveIgniteCommand(command);
    assert.equal(resolved.ok, false, command);
    assert.match(resolved.text, /exact 40-character main SHA/i, command);
  }
});

test('rejects unsupported mutation and dispatch commands', () => {
  for (const command of ['fix', 'repair', 'merge', 'push', 'install', 'codex', 'run', 'openclaw-task']) {
    const resolved = resolveIgniteCommand(command);
    assert.equal(resolved.ok, false);
    assert.match(resolved.text, /Unsupported/);
  }
});

test('command surface exposes no arbitrary mutation, Codex, merge, push, install, or free-form task capabilities', async () => {
  const files = [
    await readFile(new URL('index.js', root), 'utf8'),
    await readFile(new URL('lib/ignite-status.mjs', root), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(files, /registerTool\s*\(|continueAgent:\s*true/);
  assert.doesNotMatch(files, /git\s+(?:merge|push|commit)|openclaw\s+doctor|codex\s+/);
  assert.match(files, /exposeSenderIsOwner:\s*true/);
  assert.match(files, /senderIsOwner:\s*ctx\?\.senderIsOwner === true/);
});
