import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runApprovedBackend8787Start } from './battle-bridge-ignition-supervisor.mjs';

function captureBackendStart(workspace, platform) {
  const calls = [];
  return runApprovedBackend8787Start({
    sharedWorkspace: workspace,
    platform,
    spawnFn: (command, args, options) => {
      calls.push({ command, args, options });
      return null;
    },
  }).then((result) => ({ calls, result }));
}

test('Battle Bridge backend repair uses npm.cmd on Windows without shell fallback', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-backend-win-npm-'));
  const { calls, result } = await captureBackendStart(workspace, 'win32');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'npm.cmd');
  assert.deepEqual(calls[0].args, ['run', 'stephanos:battle-bridge:repair']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(result.started, true);
  assert.equal(result.exitCode, 0);
});

test('Battle Bridge backend repair keeps npm executable on non-Windows hosts', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-backend-posix-npm-'));
  const { calls } = await captureBackendStart(workspace, 'linux');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'npm');
  assert.equal(calls[0].options.shell, false);
});
