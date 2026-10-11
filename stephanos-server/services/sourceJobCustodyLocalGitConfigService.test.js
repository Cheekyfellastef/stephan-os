import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectSourceCustodyLocalGitConfig,
  validateSourceCustodyLocalGitConfig,
} from './sourceJobCustodyLocalGitConfigService.js';

const safe = [
  ['core.repositoryformatversion', '0'],
  ['core.filemode', 'false'],
  ['core.bare', 'false'],
  ['core.logallrefupdates', 'true'],
  ['core.ignorecase', 'true'],
  ['remote.origin.url', 'https://github.com/Cheekyfellastef/stephan-os.git'],
  ['remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
];
const blob = pairs => pairs.map(([k,v]) => k + '\n' + v + '\0').join('');

test('closed-world local Git profile admits only canonical noncredential core/remote keys', () => {
  assert.equal(validateSourceCustodyLocalGitConfig(blob(safe)).ok, true);
  assert.equal(validateSourceCustodyLocalGitConfig(blob([
    ...safe, ['branch.main.remote', 'origin'], ['branch.main.merge', 'refs/heads/main'],
  ])).ok, true);
});

test('Git local config credential helpers, HTTP headers, includes and URL rewriting are rejected', () => {
  for (const [key,value] of [
    ['credential.helper', 'manager'],
    ['credential.https://github.com.helper', '!evil'],
    ['http.extraheader', 'AUTHORIZATION: basic SECRETS'],
    ['http.https://github.com/.extraheader', 'AUTHORIZATION: basic SECRETS'],
    ['include.path', 'C:\\Users\\operator\\auth'],
    ['includeif.gitdir:somewhere.path', 'C:\\temp\\secrets'],
    ['url.https://token@github.com/.insteadof', 'https://github.com/'],
    ['core.sshcommand', 'ssh -i c:/Users/operator/id'],
    ['core.hooksPath', 'C:\\attacker'],
    ['remote.origin.pushurl', 'https://token@github.com/stephan-os'],
    ['gpg.program', 'C:\\attacker'],
    ['alias.sync', '!powershell -EncodedCommand foo'],
    ['submodule.private.url', 'https://token@github.com'],
    ['core.worktree', 'C:\\outside'],
    ['custom.password', 'secrets'],
  ]) {
    const outcome = validateSourceCustodyLocalGitConfig(blob([...safe, [key,value]]));
    assert.equal(outcome.ok, false, key);
  }
});

test('remote with embedded auth or unknown origin is never accepted', () => {
  for (const remote of [
    'https://x-token:SECRET@github.com/Cheekyfellastef/stephan-os.git',
    'file:///C:/Users/operator/credentials',
    'ssh://git@github.com/Cheekyfellastef/stephan-os.git',
    'https://github.com/OtherOwner/stephan-os.git',
  ]) {
    const modified = safe.map(x => x[0] === 'remote.origin.url' ? [x[0],remote] : x);
    assert.equal(validateSourceCustodyLocalGitConfig(blob(modified)).ok, false, remote);
  }
});

test('multiple values, duplicate keys and malformed config fail closed', () => {
  for (const value of [
    '',
    'core.bare\nfalse',
    blob(safe).slice(0,-1),
    blob([...safe, ['remote.origin.url', 'https://github.com/Cheekyfellastef/stephan-os.git']]),
    blob([...safe, ['core.filemode','true']]),
    blob(safe).replace('core.filemode\nfalse\0', 'core.filemode\ntrue\nbad\0'),
    blob(safe).repeat(1000),
    blob(safe.slice(0,-2)),
  ]) assert.equal(validateSourceCustodyLocalGitConfig(value).ok, false);
});

test('local Git inspection uses only read-only no-includes operation with caller isolated environment', () => {
  const seen = [];
  const isolated = { HOME: '/isolated', GIT_CONFIG_NOSYSTEM: '1' };
  const got = inspectSourceCustodyLocalGitConfig('/worktree','/trusted/git.exe', isolated, {
    execute: (...args) => {
      seen.push(args);
      return { status:0, stdout:blob(safe), stderr:'' };
    },
  });
  assert.equal(got.ok,true);
  assert.equal(seen.length,1);
  assert.equal(seen[0][0],'/trusted/git.exe');
  assert.deepEqual(seen[0][1], ['-C','/worktree','config','--local','--null','--list','--no-includes']);
  assert.equal(seen[0][2].env,isolated);
  assert.equal(seen[0][2].shell,false);
});

test('local config inspection refuses Git command errors and missing checkout configuration', () => {
  for (const result of [
    { status: 1, stdout: '' },
    { status: 0, stdout: '' },
    { status: 0, stdout: blob([...safe,['credential.helper','manager']]) },
    { status: 0, stdout: blob(safe), error: new Error('blocked') },
    { status: null, signal:'SIGKILL', stdout:blob(safe) },
  ]) {
    const got=inspectSourceCustodyLocalGitConfig('/worktree','/trusted/git.exe', {}, { execute:()=>result });
    assert.equal(got.ok,false);
  }
});
