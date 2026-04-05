import test from 'node:test';
import assert from 'node:assert/strict';
import { focusRepoPowerShell, launchRepoPowerShell, resetLocalShellSession } from '../services/localShellService.js';

test('launchRepoPowerShell refuses non-windows runtime', () => {
  resetLocalShellSession();
  const result = launchRepoPowerShell({
    platform: 'linux',
    env: { STEPHANOS_REPO_ROOT: 'C:\\Repos\\stephan-os' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'windows-only-local-shell-launch');
  assert.equal(result.repoPath, 'C:\\Repos\\stephan-os');
});

test('launchRepoPowerShell runs helper and captures pid/focus/topmost state on windows', () => {
  resetLocalShellSession();
  const calls = [];
  const result = launchRepoPowerShell({
    platform: 'win32',
    env: { STEPHANOS_REPO_ROOT: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os' },
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout: JSON.stringify({ ok: true, launched: true, pid: 4242, focusApplied: true, topmostApplied: true }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.launched, true);
  assert.equal(result.pid, 4242);
  assert.equal(result.focusApplied, true);
  assert.equal(result.topmostApplied, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.equal(calls[0].args[0], '-NoLogo');
  assert.equal(calls[0].options.windowsHide, true);
  assert.match(calls[0].args[4], /Start-Process -FilePath 'powershell\.exe'/);
  assert.match(calls[0].args[4], /Set-Location -LiteralPath/);
});

test('launchRepoPowerShell reports helper failure payload details', () => {
  resetLocalShellSession();
  const result = launchRepoPowerShell({
    platform: 'win32',
    env: { STEPHANOS_REPO_ROOT: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os' },
    spawnSyncImpl() {
      return {
        status: 1,
        stdout: '',
        stderr: 'Start-Process failed',
      };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.launched, false);
  assert.match(result.reason, /powershell-launch-helper-failed/);
  assert.match(result.reason, /Start-Process failed/);
});

test('focusRepoPowerShell reports missing session when launch has not succeeded', () => {
  resetLocalShellSession();
  const result = focusRepoPowerShell({
    platform: 'win32',
    env: { STEPHANOS_REPO_ROOT: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.focused, false);
  assert.equal(result.reason, 'no-known-powershell-session');
});

test('focusRepoPowerShell re-focuses last launched powershell process', () => {
  resetLocalShellSession();
  launchRepoPowerShell({
    platform: 'win32',
    env: { STEPHANOS_REPO_ROOT: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os' },
    spawnSyncImpl() {
      return {
        status: 0,
        stdout: JSON.stringify({ ok: true, launched: true, pid: 4242, focusApplied: true, topmostApplied: false }),
        stderr: '',
      };
    },
  });

  const result = focusRepoPowerShell({
    platform: 'win32',
    env: { STEPHANOS_REPO_ROOT: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os' },
    spawnSyncImpl(command, args) {
      assert.equal(command, 'powershell.exe');
      assert.match(args[4], /\$targetPid = 4242/);
      return {
        status: 0,
        stdout: JSON.stringify({ ok: true, focused: true, pid: 4242, focusApplied: true, topmostApplied: true }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.focused, true);
  assert.equal(result.pid, 4242);
  assert.equal(result.topmostApplied, true);
});
