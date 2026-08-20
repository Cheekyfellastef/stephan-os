import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runApprovedBackend8787Start } from './battle-bridge-ignition-supervisor.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';

function captureBackendStart(workspace, platform) {
  const calls = [];
  const expectedHead = 'a'.repeat(40);
  return runApprovedBackend8787Start({
    sharedWorkspace: workspace,
    platform,
    expectedHead,
    currentHeadFn: () => expectedHead,
    spawnFn: (command, args, options) => {
      calls.push({ command, args, options });
      return null;
    },
  }).then((result) => ({ calls, result }));
}

test('Battle Bridge backend repair uses fixed cmd.exe npm.cmd execution on Windows without Node shell mode', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-backend-win-npm-'));
  const { calls, result } = await captureBackendStart(workspace, 'win32');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, BATTLE_BRIDGE_WINDOWS_HOST.cmd);
  assert.deepEqual(calls[0].args, ['/d', '/s', '/c', `""${BATTLE_BRIDGE_WINDOWS_HOST.npm}" run stephanos:battle-bridge:repair"`]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.STEPHANOS_EXPECTED_HEAD, 'a'.repeat(40));
  assert.equal(result.started, true);
  assert.equal(result.exitCode, 0);
});

test('Battle Bridge backend repair keeps direct npm executable on non-Windows hosts', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-backend-posix-npm-'));
  const { calls } = await captureBackendStart(workspace, 'linux');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'npm');
  assert.deepEqual(calls[0].args, ['run', 'stephanos:battle-bridge:repair']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.STEPHANOS_EXPECTED_HEAD, 'a'.repeat(40));
});

test('backend repair child source requires fixed exact-head proof immediately before mutation', async () => {
  const source = fs.readFileSync(new URL('./battle-bridge-repair.mjs', import.meta.url), 'utf8');
  assert.match(source, /STEPHANOS_EXPECTED_HEAD/);
  assert.match(source, /collectCanonicalIgnitionSourceTruth/);
  assert.match(source, /evaluateCanonicalIgnitionSourceTruth/);
  assert.match(source, /if \(!expectedHead\) \{[\s\S]*canonicalSourceTruth[\s\S]*BATTLE_BRIDGE_BACKEND_CANONICAL_HEAD_UNPROVEN/);
  assert.match(source, /assertExpectedHeadImmediatelyBeforeMutation\(\);\s*const result = spawnSync\(ps/);
  assert.match(source, /assertExpectedHeadImmediatelyBeforeMutation\(\);\s*const child = spawn\('node'/);
});
