import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BATTLE_BRIDGE_CANONICAL_REMOTE_URL,
  BATTLE_BRIDGE_GITHUB_HOST,
  BATTLE_BRIDGE_POSIX_GIT_EXECUTABLE,
  BATTLE_BRIDGE_POSIX_GITHUB_CLI_EXECUTABLE,
  battleBridgeGitFixedConfigArgs,
  createBattleBridgeMinimalChildEnvironment,
  inspectBattleBridgeGitTopology,
  resolveBattleBridgeGitExecution,
  resolveBattleBridgeGitExecutable,
  resolveBattleBridgeGitHubCliExecutable,
  validateBattleBridgeLocalGitConfiguration,
} from './battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';

test('fixed Git executable is absolute and platform-canonical', () => {
  assert.equal(resolveBattleBridgeGitExecutable('win32'), BATTLE_BRIDGE_WINDOWS_HOST.git);
  assert.equal(resolveBattleBridgeGitExecutable('linux'), BATTLE_BRIDGE_POSIX_GIT_EXECUTABLE);
  assert.equal(resolveBattleBridgeGitExecutable('darwin'), BATTLE_BRIDGE_POSIX_GIT_EXECUTABLE);
  assert.equal(path.isAbsolute(resolveBattleBridgeGitExecutable('linux')), true);
  assert.throws(
    () => resolveBattleBridgeGitExecutable('freebsd'),
    /BATTLE_BRIDGE_GIT_PLATFORM_UNSUPPORTED:freebsd/,
  );
  const posix = resolveBattleBridgeGitExecution({
    platform: 'linux',
    environment: { PATH: '/attacker', NODE_OPTIONS: '--require=/attacker/inject.cjs' },
  });
  assert.equal(posix.executable, BATTLE_BRIDGE_POSIX_GIT_EXECUTABLE);
  assert.equal(posix.fixedConfigArgs.includes('core.hooksPath=/dev/null'), true);
  assert.equal(posix.fixedConfigArgs.includes('core.attributesFile=/dev/null'), true);
  assert.equal(posix.environment.PATH, '/usr/bin:/bin');
  assert.equal(posix.environment.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(posix.environment.GIT_GRAFT_FILE, '/dev/null');
  assert.equal(posix.environment.NODE_OPTIONS, undefined);
  assert.deepEqual(battleBridgeGitFixedConfigArgs('win32').slice(0, 2), ['-c', 'core.hooksPath=NUL']);
});

test('fixed GitHub CLI executable and host are platform-canonical', () => {
  assert.equal(BATTLE_BRIDGE_GITHUB_HOST, 'github.com');
  assert.equal(resolveBattleBridgeGitHubCliExecutable('win32'), BATTLE_BRIDGE_WINDOWS_HOST.githubCli);
  assert.equal(resolveBattleBridgeGitHubCliExecutable('linux'), BATTLE_BRIDGE_POSIX_GITHUB_CLI_EXECUTABLE);
  assert.equal(resolveBattleBridgeGitHubCliExecutable('darwin'), BATTLE_BRIDGE_POSIX_GITHUB_CLI_EXECUTABLE);
  assert.equal(path.isAbsolute(resolveBattleBridgeGitHubCliExecutable('linux')), true);
  assert.throws(
    () => resolveBattleBridgeGitHubCliExecutable('freebsd'),
    /BATTLE_BRIDGE_GITHUB_CLI_PLATFORM_UNSUPPORTED:freebsd/,
  );
});

test('minimal child environment removes Node/Git/shell injection variables', () => {
  const result = createBattleBridgeMinimalChildEnvironment({
    USERPROFILE: 'C:\\Users\\Stephan',
    SystemRoot: 'C:\\Windows',
    NODE_OPTIONS: '--require C:\\attacker.js',
    NODE_PATH: 'C:\\attacker',
    GIT_CONFIG_COUNT: '2',
    GIT_SSH_COMMAND: 'attacker.exe',
    GIT_REPLACE_REF_BASE: 'refs/evil/',
    COMSPEC: 'C:\\attacker\\cmd.exe',
    PATH: 'C:\\attacker',
  }, { git: true, platform: 'win32' });
  assert.equal(result.USERPROFILE, 'C:\\Users\\Stephan');
  assert.equal(result.NODE_OPTIONS, undefined);
  assert.equal(result.NODE_PATH, undefined);
  assert.equal(result.GIT_SSH_COMMAND, undefined);
  assert.equal(result.GIT_REPLACE_REF_BASE, undefined);
  assert.equal(result.COMSPEC, undefined);
  assert.equal(Number(result.GIT_CONFIG_COUNT) > 0, true);
  const fixedKeys = Array.from({ length: Number(result.GIT_CONFIG_COUNT) }, (_, index) => result[`GIT_CONFIG_KEY_${index}`]);
  const fixedValues = Array.from({ length: Number(result.GIT_CONFIG_COUNT) }, (_, index) => result[`GIT_CONFIG_VALUE_${index}`]);
  assert.equal(fixedKeys.includes('core.hooksPath'), true);
  assert.equal(fixedValues[fixedKeys.indexOf('core.hooksPath')], 'NUL');
  assert.equal(fixedValues[fixedKeys.indexOf('core.trustctime')], 'true');
  assert.equal(fixedValues[fixedKeys.indexOf('core.checkStat')], 'default');
  assert.equal(fixedValues[fixedKeys.indexOf('core.ignoreStat')], 'false');
  assert.equal(fixedValues[fixedKeys.indexOf('core.untrackedCache')], 'false');
  assert.equal(fixedValues.includes('attacker.exe'), false);
  assert.equal(result.GIT_NO_REPLACE_OBJECTS, '1');
  assert.equal(result.GIT_GRAFT_FILE, 'NUL');
  assert.equal(result.PATH.includes('attacker'), false);
  assert.equal(result.PATH.includes('C:\\Windows\\System32\\WindowsPowerShell\\v1.0'), true);
});

test('Git topology rejects graft, common-dir, and object-alternate redirects', () => {
  for (const [relative, blocker] of [
    [path.join('info', 'grafts'), 'GIT_GRAFTS_PRESENT'],
    ['commondir', 'GIT_COMMON_DIRECTORY_REDIRECT_PRESENT'],
    [path.join('objects', 'info', 'alternates'), 'GIT_OBJECT_ALTERNATES_PRESENT'],
  ]) {
    const root = mkdtempSync(path.join(tmpdir(), 'battle-bridge-git-topology-'));
    mkdirSync(path.join(root, '.git', 'objects'), { recursive: true });
    mkdirSync(path.join(root, '.git', 'refs'), { recursive: true });
    writeFileSync(path.join(root, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
    writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const target = path.join(root, '.git', relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '..\\attacker\n');
    assert.equal(inspectBattleBridgeGitTopology(root).blocker, blocker);
  }
});

test('Git topology rejects linked critical metadata descendants', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'battle-bridge-git-reparse-'));
  const target = mkdtempSync(path.join(tmpdir(), 'battle-bridge-git-objects-target-'));
  mkdirSync(path.join(root, '.git', 'refs'), { recursive: true });
  mkdirSync(path.join(root, '.git'), { recursive: true });
  writeFileSync(path.join(root, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
  writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  symlinkSync(target, path.join(root, '.git', 'objects'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(inspectBattleBridgeGitTopology(root).blocker, 'CANONICAL_GIT_REPARSE_POINT_PRESENT');
});

test('Git topology can bind the canonical index identity for read-only source proofs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'battle-bridge-git-index-'));
  mkdirSync(path.join(root, '.git', 'objects'), { recursive: true });
  mkdirSync(path.join(root, '.git', 'refs'), { recursive: true });
  writeFileSync(path.join(root, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
  writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(path.join(root, '.git', 'index'), 'index-v1');
  const ordinary = inspectBattleBridgeGitTopology(root);
  const first = inspectBattleBridgeGitTopology(root, { stabilizeIndex: true });
  assert.equal(ordinary.ok, true);
  assert.equal(ordinary.stableIdentities.index, undefined);
  assert.equal(typeof first.stableIdentities.index, 'string');
  writeFileSync(path.join(root, '.git', 'index'), 'index-v2');
  const second = inspectBattleBridgeGitTopology(root, { stabilizeIndex: true });
  assert.notEqual(second.stableIdentities.index, first.stableIdentities.index);
});

test('local Git configuration admits only the fixed origin and blocks executable helpers', () => {
  const baseline = `core.repositoryformatversion\n0\0remote.origin.url\n${BATTLE_BRIDGE_CANONICAL_REMOTE_URL}\0remote.origin.fetch\n+refs/heads/main:refs/remotes/origin/main\0`;
  assert.equal(validateBattleBridgeLocalGitConfiguration(baseline).ok, true);
  for (const injected of [
    'core.hooksPath\nC:\\attacker\0',
    'core.fsmonitor\nC:\\attacker.exe\0',
    'core.trustctime\nfalse\0',
    'core.checkStat\nminimal\0',
    'core.ignoreStat\ntrue\0',
    'core.untrackedCache\ntrue\0',
    'filter.evil.clean\nC:\\attacker.exe\0',
    'credential.helper\n!C:\\attacker.exe\0',
    'protocol.ext.allow\nalways\0',
    'url.ext::evil.insteadOf\nhttps://github.com/\0',
    'extensions.worktreeConfig\ntrue\0',
    'core.worktree\nC:\\attacker\0',
    'gc.recentObjectsHook\nC:\\attacker.exe\0',
    'core.alternateRefsCommand\nC:\\attacker.exe\0',
    'core.sparseCheckout\ntrue\0',
    'index.sparse\ntrue\0',
    'branch.main.mergeOptions\n-s attacker\0',
    'http.https://github.com/.proxy\nhttp://attacker\0',
    'diff.external\nC:\\attacker.exe\0',
  ]) {
    assert.equal(validateBattleBridgeLocalGitConfiguration(`${baseline}${injected}`).ok, false, injected);
  }
  assert.equal(validateBattleBridgeLocalGitConfiguration('remote.origin.url\nhttps://evil.invalid/repo.git\0').ok, false);
});
