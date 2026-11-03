import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BATTLE_BRIDGE_CANONICAL_REMOTE_URL,
  BATTLE_BRIDGE_POSIX_GIT_EXECUTABLE,
  battleBridgeGitFixedConfigArgs,
  createBattleBridgeMinimalChildEnvironment,
  inspectBattleBridgeGitTopology,
  resolveBattleBridgeGitExecution,
  resolveBattleBridgeGitExecutable,
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
  assert.equal(posix.fixedConfigArgs.includes('core.autocrlf=false'), true);
  assert.equal(posix.fixedConfigArgs.includes('core.hooksPath=/dev/null'), true);
  assert.equal(posix.fixedConfigArgs.includes('core.attributesFile=/dev/null'), true);
  assert.equal(posix.fixedConfigArgs.includes('core.excludesFile=/dev/null'), true);
  assert.equal(posix.environment.PATH, '/usr/bin:/bin');
  assert.equal(posix.environment.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(posix.environment.GIT_GRAFT_FILE, '/dev/null');
  assert.equal(posix.environment.NODE_OPTIONS, undefined);
  const windowsArgs = battleBridgeGitFixedConfigArgs('win32');
  assert.deepEqual(windowsArgs.slice(0, 2), ['-c', 'core.autocrlf=true']);
  assert.equal(windowsArgs.includes('core.hooksPath=NUL'), true);
  assert.equal(windowsArgs.includes('core.attributesFile='), true);
  assert.equal(windowsArgs.includes('core.excludesFile='), true);
  assert.equal(windowsArgs.includes('core.attributesFile=NUL'), false);
  assert.equal(windowsArgs.includes('core.excludesFile=NUL'), false);
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
  assert.equal(fixedKeys.includes('core.autocrlf'), true);
  assert.equal(fixedValues[fixedKeys.indexOf('core.autocrlf')], 'true');
  assert.equal(fixedKeys.includes('core.hooksPath'), true);
  assert.equal(fixedValues[fixedKeys.indexOf('core.hooksPath')], 'NUL');
  assert.equal(fixedValues[fixedKeys.indexOf('commit.gpgSign')], 'false');
  assert.equal(fixedValues[fixedKeys.indexOf('tag.gpgSign')], 'false');
  assert.equal(fixedValues[fixedKeys.indexOf('core.trustctime')], 'true');
  assert.equal(fixedValues[fixedKeys.indexOf('core.checkStat')], 'default');
  assert.equal(fixedValues[fixedKeys.indexOf('core.ignoreStat')], 'false');
  assert.equal(fixedValues[fixedKeys.indexOf('core.untrackedCache')], 'false');
  assert.equal(fixedValues[fixedKeys.indexOf('core.attributesFile')], '');
  assert.equal(fixedValues[fixedKeys.indexOf('core.excludesFile')], '');
  assert.equal(fixedValues.includes('attacker.exe'), false);
  assert.equal(result.GIT_NO_REPLACE_OBJECTS, '1');
  assert.equal(result.GIT_GRAFT_FILE, 'NUL');
  assert.equal(result.PATH.includes('attacker'), false);
  assert.equal(result.PATH.includes('C:\\Windows\\System32\\WindowsPowerShell\\v1.0'), true);
});

test('all Git signing program families and signing activation are rejected', () => {
  const base = 'remote.origin.url\nhttps://github.com/Cheekyfellastef/stephan-os.git\0';
  assert.equal(validateBattleBridgeLocalGitConfiguration(base).ok, true);
  for (const assignment of ['commit.gpgsign\ntrue', 'tag.gpgsign\ntrue',
    'gpg.program\nattacker', 'gpg.ssh.program\nattacker', 'gpg.x509.program\nattacker',
    'gpg.openpgp.program\nattacker', 'gpg.format\nssh']) {
    assert.equal(validateBattleBridgeLocalGitConfiguration(base + assignment + '\0').ok, false, assignment);
  }
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
  assert.equal(validateBattleBridgeLocalGitConfiguration(`${baseline}core.hooksPath\n.githooks\0`).ok, true);
  assert.equal(validateBattleBridgeLocalGitConfiguration(`${baseline}core.hooksPath\n.githooks-extra\0`).ok, false);
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

const canonicalConfiguration = 'remote.origin.url\n' + BATTLE_BRIDGE_CANONICAL_REMOTE_URL + '\0';
const configurationRiskCases = [
  ['alias.PRIVATE_SECRET', 'ALIAS'],
  ['core.worktree', 'CORE_WORKTREE'],
  ['core.sparsecheckout', 'CORE_SPARSE_CHECKOUT'],
  ['core.sparsecheckoutcone', 'CORE_SPARSE_CHECKOUT_CONE'],
  ['index.sparse', 'INDEX_SPARSE'],
  ['core.hookspath', 'CORE_HOOKS_PATH'],
  ['core.fsmonitor', 'CORE_FSMONITOR'],
  ['core.trustctime', 'CORE_TRUST_CTIME'],
  ['core.checkstat', 'CORE_CHECK_STAT'],
  ['core.ignorestat', 'CORE_IGNORE_STAT'],
  ['core.untrackedcache', 'CORE_UNTRACKED_CACHE'],
  ['core.sshcommand', 'CORE_SSH_COMMAND'],
  ['core.alternaterefscommand', 'CORE_ALTERNATE_REFS_COMMAND'],
  ['core.askpass', 'CORE_ASKPASS'],
  ['core.gitproxy', 'CORE_GIT_PROXY'],
  ['core.pager', 'CORE_PAGER'],
  ['diff.external', 'DIFF_EXTERNAL'],
  ['credential.https://PRIVATE:SECRET@example.invalid.helper', 'CREDENTIAL'],
  ['filter.PRIVATE_SECRET.clean', 'FILTER'],
  ['diff.PRIVATE_SECRET.command', 'DIFF_COMMAND'],
  ['diff.PRIVATE_SECRET.textconv', 'DIFF_TEXTCONV'],
  ['merge.PRIVATE_SECRET.driver', 'MERGE_DRIVER'],
  ['branch.PRIVATE_SECRET.mergeoptions', 'BRANCH_MERGE_OPTIONS'],
  ['remote.PRIVATE_SECRET.vcs', 'REMOTE_VCS'],
  ['remote.PRIVATE_SECRET.proxy', 'REMOTE_PROXY'],
  ['remote.PRIVATE_SECRET.uploadpack', 'REMOTE_UPLOAD_PACK'],
  ['remote.PRIVATE_SECRET.receivepack', 'REMOTE_RECEIVE_PACK'],
  ['url.https://PRIVATE:SECRET@example.invalid.insteadof', 'URL_REWRITE'],
  ['include.path', 'INCLUDE_PATH'],
  ['includeif.gitdir:PRIVATE_SECRET.path', 'INCLUDE_IF'],
  ['protocol.PRIVATE_SECRET.allow', 'PROTOCOL'],
  ['extensions.worktreeconfig', 'EXTENSIONS_WORKTREE_CONFIG'],
  ['submodule.PRIVATE_SECRET.update', 'SUBMODULE_UPDATE'],
  ['gc.PRIVATE_SECRET.hook', 'GC_HOOK_OR_COMMAND'],
  ['gc.PRIVATE_SECRET.command', 'GC_HOOK_OR_COMMAND'],
  ['gc.recentobjectshook', 'GC_RECENT_OBJECTS_HOOK'],
  ['pager.PRIVATE_SECRET', 'PAGER'],
  ['interactive.difffilter', 'INTERACTIVE_DIFF_FILTER'],
  ['sequence.editor', 'SEQUENCE_EDITOR'],
  ['core.editor', 'CORE_EDITOR'],
  ['gpg.PRIVATE_SECRET.program', 'GPG'],
  ['commit.gpgsign', 'COMMIT_GPG_SIGN'],
  ['tag.gpgsign', 'TAG_GPG_SIGN'],
  ['http.https://PRIVATE:SECRET@example.invalid.extraheader', 'HTTP'],
];

test('configuration diagnostics distinguish origin cardinality and identity without exposing a URL', () => {
  const noncanonical = 'remote.origin.url\nhttps://PRIVATE:SECRET@example.invalid/repo.git\0';
  for (const [configuration, ok, originCount, originMatch] of [
    ['', false, 'ZERO', 'UNKNOWN'],
    ['PRIVATE malformed configuration\0', false, 'ZERO', 'UNKNOWN'],
    ['remote.origin.url\0', false, 'ONE', 'NONCANONICAL'],
    [canonicalConfiguration, true, 'ONE', 'CANONICAL'],
    [canonicalConfiguration.toUpperCase(), true, 'ONE', 'CANONICAL'],
    [noncanonical, false, 'ONE', 'NONCANONICAL'],
    [canonicalConfiguration + canonicalConfiguration, false, 'MULTIPLE', 'CANONICAL'],
    [canonicalConfiguration + noncanonical, false, 'MULTIPLE', 'NONCANONICAL'],
    [noncanonical + canonicalConfiguration, false, 'MULTIPLE', 'NONCANONICAL'],
  ]) {
    const result = validateBattleBridgeLocalGitConfiguration(configuration);
    assert.equal(result.ok, ok);
    assert.equal(result.blocker, ok ? '' : 'CANONICAL_GIT_CONFIGURATION_INVALID');
    assert.deepEqual(result.diagnostic, { originCount, originMatch, riskCategories: [] });
    assert.doesNotMatch(JSON.stringify(result.diagnostic), /PRIVATE|SECRET|https|remote\.|value/);
  }
});

test('every existing rejected configuration key maps to a closed diagnostic category with private subsections removed', () => {
  const assignments = configurationRiskCases.map(([key]) => key + '\nPRIVATE SECRET value\0');
  for (const [[, category], assignment] of configurationRiskCases.map((item, index) => [item, assignments[index]])) {
    const result = validateBattleBridgeLocalGitConfiguration(canonicalConfiguration + assignment);
    assert.equal(result.ok, false, category);
    assert.deepEqual(result.diagnostic, {
      originCount: 'ONE', originMatch: 'CANONICAL', riskCategories: [category],
    });
    assert.doesNotMatch(JSON.stringify(result.diagnostic), /PRIVATE|SECRET|https|value|\/|\\/);
  }
  const combined = validateBattleBridgeLocalGitConfiguration(canonicalConfiguration + assignments.join('') + assignments[0]);
  assert.equal(combined.ok, false);
  assert.deepEqual(combined.diagnostic.riskCategories, [...new Set(configurationRiskCases.map(([, category]) => category))].sort());
  assert.doesNotMatch(JSON.stringify(combined.diagnostic), /PRIVATE|SECRET|https|value|\/|\\/);
});

test('configuration diagnostics preserve allowed hooks, disabled signing and harmless unknown settings', () => {
  const allowed = canonicalConfiguration
    + 'core.hooksPath\n.githooks\0commit.gpgSign\nFALSE\0tag.gpgSign\nfalse\0'
    + 'harmless.PRIVATE_SECRET\nPRIVATE SECRET value\0core.autocrlf\ntrue\0';
  const result = validateBattleBridgeLocalGitConfiguration(allowed);
  assert.equal(result.ok, true);
  assert.deepEqual(result.riskyKeys, []);
  assert.deepEqual(result.diagnostic, { originCount: 'ONE', originMatch: 'CANONICAL', riskCategories: [] });
  assert.doesNotMatch(JSON.stringify(result.diagnostic), /PRIVATE|SECRET|https|value/);
});
