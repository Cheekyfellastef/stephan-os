import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BATTLE_BRIDGE_CANONICAL_REMOTE_URL,
  createBattleBridgeMinimalChildEnvironment,
  inspectBattleBridgeGitTopology,
  validateBattleBridgeLocalGitConfiguration,
} from './battleBridgeExecutionBoundaryV1.mjs';

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
  }, { git: true });
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
  assert.equal(fixedValues.includes('attacker.exe'), false);
  assert.equal(result.GIT_NO_REPLACE_OBJECTS, '1');
  assert.equal(result.GIT_GRAFT_FILE, 'NUL');
  assert.equal(result.PATH.includes('attacker'), false);
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
  symlinkSync(target, path.join(root, '.git', 'objects'), 'dir');
  assert.equal(inspectBattleBridgeGitTopology(root).blocker, 'CANONICAL_GIT_REPARSE_POINT_PRESENT');
});

test('local Git configuration admits only the fixed origin and blocks executable helpers', () => {
  const baseline = `core.repositoryformatversion\n0\0remote.origin.url\n${BATTLE_BRIDGE_CANONICAL_REMOTE_URL}\0remote.origin.fetch\n+refs/heads/main:refs/remotes/origin/main\0`;
  assert.equal(validateBattleBridgeLocalGitConfiguration(baseline).ok, true);
  for (const injected of [
    'core.hooksPath\nC:\\attacker\0',
    'core.fsmonitor\nC:\\attacker.exe\0',
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
