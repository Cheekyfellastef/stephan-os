import test from 'node:test';
import assert from 'node:assert/strict';
import { launchRepoPowerShell } from '../services/localShellService.js';

test('launchRepoPowerShell refuses non-windows runtime', () => {
  const result = launchRepoPowerShell({
    platform: 'linux',
    env: { STEPHANOS_REPO_ROOT: 'C:\\Repos\\stephan-os' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'windows-only-local-shell-launch');
  assert.equal(result.repoPath, 'C:\\Repos\\stephan-os');
});

test('launchRepoPowerShell uses constrained powershell launch command on windows', () => {
  const calls = [];
  const result = launchRepoPowerShell({
    platform: 'win32',
    env: { STEPHANOS_REPO_ROOT: "C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os" },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return { unref() {} };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.launched, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.deepEqual(calls[0].args.slice(0, 2), ['-NoExit', '-Command']);
  assert.match(calls[0].args[2], /Set-Location -LiteralPath/);
  assert.equal(calls[0].options.cwd, 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os');
});
