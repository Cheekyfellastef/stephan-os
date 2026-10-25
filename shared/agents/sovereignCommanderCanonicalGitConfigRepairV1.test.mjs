import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  SOVEREIGN_COMMANDER_REMOTE_ACTIONS,
  executeSovereignCommanderRemoteOnBattleBridge,
  inspectCanonicalGitWorktreeConfigV1,
  repairCanonicalGitWorktreeConfigV1,
  validateSovereignCommanderRemoteCommandShape,
} from './sovereignCommanderRemoteMailboxV1.mjs';

const HEAD = 'a'.repeat(40);
const ORIGIN = 'https://github.com/Cheekyfellastef/stephan-os.git';

function result(status = 0, stdout = '') {
  return { status, stdout, stderr: '', error: null };
}

function fixture({
  worktreeEntries = '',
  worktreeConfigPresent = false,
  extraRisk = '',
  configuredValues = ['true'],
  worktreeRoots = ['/fixture/Documents/GitHub/stephan-os'],
  failAfterUnsetRead = false,
} = {}) {
  let extensionPresent = true;
  const calls = [];
  const spawnSyncFn = (_command, args, options = {}) => {
    calls.push([...args]);
    const tail = args.join('\u0001');
    if (tail.endsWith('rev-parse\u0001HEAD')) return result(0, HEAD + '\n');
    if (tail.endsWith('rev-parse\u0001--git-path\u0001config.worktree')) {
      const cwd = String(options.cwd || '/fixture/Documents/GitHub/stephan-os');
      return result(0, cwd + '/.git/config.worktree\n');
    }
    if (tail.endsWith('branch\u0001--show-current')) return result(0, 'main\n');
    if (tail.endsWith('worktree\u0001list\u0001--porcelain')) {
      return result(0, worktreeRoots.map(root =>
        'worktree ' + root + '\nHEAD ' + HEAD + '\nbranch refs/heads/main\n'
      ).join('\n'));
    }
    if (tail.endsWith('config\u0001--local\u0001--null\u0001--get-all\u0001extensions.worktreeConfig')) {
      return extensionPresent ? result(0, configuredValues.join('\0') + '\0') : result(1, '');
    }
    if (tail.includes('config\u0001--file\u0001') && tail.endsWith('\u0001--null\u0001--list')) {
      return result(0, worktreeEntries);
    }
    if (tail.endsWith('config\u0001--local\u0001--unset-all\u0001extensions.worktreeConfig')) {
      extensionPresent = false;
      return result(0, '');
    }
    if (tail.endsWith('config\u0001--local\u0001--null\u0001--list')) {
      if (!extensionPresent && failAfterUnsetRead) return result(1, '');
      const parts = [
        'remote.origin.url\n' + ORIGIN,
        ...(extensionPresent ? ['extensions.worktreeConfig\ntrue'] : []),
        ...(extraRisk ? [extraRisk] : []),
      ];
      return result(0, parts.join('\0') + '\0');
    }
    throw new Error('unexpected git invocation: ' + args.join(' '));
  };
  return {
    spawnSyncFn,
    calls,
    inspectTopologyFn: () => ({ ok: true, blocker: '', stableIdentities: {} }),
    existsFn: () => worktreeConfigPresent,
    mutationCount: () => calls.filter(args =>
      args.join('\u0001').endsWith('config\u0001--local\u0001--unset-all\u0001extensions.worktreeConfig')).length,
  };
}

function invoke(f, overrides = {}) {
  return repairCanonicalGitWorktreeConfigV1({
    repositoryRoot: '/fixture/Documents/GitHub/stephan-os',
    expectedHead: HEAD,
    platform: 'linux',
    environment: {},
    spawnSyncFn: f.spawnSyncFn,
    inspectTopologyFn: f.inspectTopologyFn,
    existsFn: f.existsFn,
    ...overrides,
  });
}

function realMailboxRepository(t) {
  const home = mkdtempSync(join(tmpdir(), 'stephanos-mailbox-git-repair-home-'));
  const repositoryRoot = join(home, 'Documents', 'GitHub', 'stephan-os');
  mkdirSync(repositoryRoot, { recursive: true });
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const git = (...args) => {
    const out = spawnSync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    assert.equal(out.status, 0, out.stderr);
    return out.stdout;
  };
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('remote', 'add', 'origin', ORIGIN);
  git('config', 'extensions.worktreeConfig', 'true');
  git('commit', '--allow-empty', '-m', 'fixture');
  return { home, repositoryRoot, head: git('rev-parse', 'HEAD').trim(), git };
}

test('direct pre-admission Git config actions are excluded from remote plans', () => {
  for (const actionId of [
    'inspect-canonical-git-worktree-config',
    'repair-canonical-git-worktree-config',
  ]) {
    const validated = validateSovereignCommanderRemoteCommandShape({
      schemaVersion: 'stephanos.battle-bridge-github-command.v1',
      requestId: 'git-config-direct-only-plan-test',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 3149,
      branch: 'main',
      operatorApproval: 'operator-approved',
      expectedHead: HEAD,
      expiresAt: '2099-01-01T00:00:00.000Z',
      remoteAction: '',
      remotePlan: [actionId],
    });
    assert.equal(validated.ok, false);
    assert.equal(validated.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');
    assert.equal(validated.remoteAction, actionId);
  }
});

test('the reusable read-only worktree/config inspection action is registered', () => {
  assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('inspect-canonical-git-worktree-config'));
});

test('read-only inspection proves one-worktree repair eligibility without mutating Git', () => {
  const f = fixture({ worktreeConfigPresent: false });
  const inspected = inspectCanonicalGitWorktreeConfigV1({
    repositoryRoot: '/fixture/Documents/GitHub/stephan-os',
    expectedHead: HEAD,
    platform: 'linux',
    environment: {},
    spawnSyncFn: f.spawnSyncFn,
    inspectTopologyFn: f.inspectTopologyFn,
    existsFn: f.existsFn,
  });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.inspectionComplete, true);
  assert.equal(inspected.safeForFixedUnset, true);
  assert.equal(inspected.registeredWorktreeCount, 1);
  assert.equal(inspected.linkedWorktreeCount, 0);
  assert.equal(inspected.extensionValueState, 'TRUE');
  assert.equal(inspected.worktreeConfigEntryCount, 0);
  assert.equal(inspected.mutationPerformed, false);
  assert.equal(inspected.rawPathsReturned, false);
  assert.equal(inspected.rawConfigValuesReturned, false);
  assert.equal(f.mutationCount(), 0);
  assert.equal(JSON.stringify(inspected).includes('/fixture/'), false);
});

test('read-only inspection exposes linked worktree state without paths and never mutates', () => {
  const f = fixture({
    worktreeRoots: ['/fixture/Documents/GitHub/stephan-os', '/fixture/linked'],
  });
  const inspected = inspectCanonicalGitWorktreeConfigV1({
    repositoryRoot: '/fixture/Documents/GitHub/stephan-os',
    expectedHead: HEAD,
    platform: 'linux',
    environment: {},
    spawnSyncFn: f.spawnSyncFn,
    inspectTopologyFn: f.inspectTopologyFn,
    existsFn: f.existsFn,
  });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.registeredWorktreeCount, 2);
  assert.equal(inspected.linkedWorktreeCount, 1);
  assert.equal(inspected.safeForFixedUnset, false);
  assert.equal(inspected.mutationPerformed, false);
  assert.equal(JSON.stringify(inspected).includes('/fixture/linked'), false);
  assert.equal(f.mutationCount(), 0);
});

test('read-only inspection reports nonempty worktree config as repair-held without leaking values', () => {
  const f = fixture({ worktreeConfigPresent: true, worktreeEntries: 'user.example\nkeep-me\0' });
  const inspected = inspectCanonicalGitWorktreeConfigV1({
    repositoryRoot: '/fixture/Documents/GitHub/stephan-os',
    expectedHead: HEAD,
    platform: 'linux',
    environment: {},
    spawnSyncFn: f.spawnSyncFn,
    inspectTopologyFn: f.inspectTopologyFn,
    existsFn: f.existsFn,
  });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.worktreeConfigFileCount, 1);
  assert.equal(inspected.nonEmptyWorktreeConfigFileCount, 1);
  assert.equal(inspected.worktreeConfigEntryCount, 1);
  assert.equal(inspected.safeForFixedUnset, false);
  assert.equal(JSON.stringify(inspected).includes('keep-me'), false);
  assert.equal(f.mutationCount(), 0);
});

test('mailbox serves read-only Git worktree/config inspection before Commander health', async () => {
  const f = fixture();
  const env = { USERPROFILE: '/fixture' };
  const rawSpawn = f.spawnSyncFn;
  const spawnSyncFn = (command, args, options) => {
    if (args[0] === '-C' && args[1].endsWith('/fixture/Documents/GitHub/stephan-os')) {
      if (args[2] === 'branch') return result(0, 'main\n');
      if (args[2] === 'rev-parse' && args[3] === 'HEAD') return result(0, HEAD + '\n');
    }
    return rawSpawn(command, args, options);
  };
  const receipt = await executeSovereignCommanderRemoteOnBattleBridge({
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'inspect-canonical-git-config-test-01',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 3149,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2099-01-01T00:00:00.000Z',
    remoteAction: 'inspect-canonical-git-worktree-config',
  }, {
    env,
    spawnSyncFn,
    fetchFn: async () => { throw new Error('Commander health must not be contacted'); },
    ensureRuntimeFn: async () => { throw new Error('Commander runtime must not be recycled'); },
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.verdict, 'COMMAND_EXECUTION_COMPLETE');
  assert.equal(receipt.remoteAction, 'inspect-canonical-git-worktree-config');
  assert.equal(receipt.canonicalGitWorktreeConfigInspection.safeForFixedUnset, true);
  assert.equal(receipt.gitConfigurationMutationPerformed, false);
  assert.equal(receipt.readOnly, true);
  assert.equal(f.mutationCount(), 0);
});

test('the pre-admission repair action is registered', () => {
  assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('repair-canonical-git-worktree-config'));
});

test('fixed repair accepts a proven absent main config.worktree and proves canonical postcondition', () => {
  const f = fixture({ worktreeConfigPresent: false });
  const repaired = invoke(f);
  assert.equal(repaired.ok, true);
  assert.equal(repaired.mutationPerformed, true);
  assert.equal(repaired.finalVerdict, 'CANONICAL_GIT_WORKTREE_CONFIG_REPAIRED');
  assert.deepEqual(repaired.riskCategoriesBefore, ['EXTENSIONS_WORKTREE_CONFIG']);
  assert.equal(repaired.canonicalAfter, true);
  assert.equal(f.mutationCount(), 1);
  assert.equal(f.calls.some(args => args.includes('--file')), false);
});

test('fixed repair refuses nonempty main worktree config before mutation', () => {
  const f = fixture({ worktreeConfigPresent: true, worktreeEntries: 'user.example\nkeep-me\0' });
  const repaired = invoke(f);
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'CANONICAL_GIT_WORKTREE_CONFIG_CONTENT_PRESENT');
  assert.equal(f.mutationCount(), 0);
});

test('fixed repair refuses any linked worktree before mutation', () => {
  const f = fixture({
    worktreeRoots: ['/fixture/Documents/GitHub/stephan-os', '/fixture/linked'],
  });
  const repaired = invoke(f);
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'CANONICAL_GIT_WORKTREE_CONFIG_LINKED_WORKTREES_PRESENT');
  assert.equal(f.mutationCount(), 0);
});

test('fixed repair counts empty values when enforcing exactly one configured value', () => {
  const f = fixture({ configuredValues: ['', 'true'] });
  const repaired = invoke(f);
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'CANONICAL_GIT_WORKTREE_CONFIG_VALUE_UNEXPECTED');
  assert.equal(f.mutationCount(), 0);
});

test('fixed repair refuses any second rejected config category before mutation', () => {
  const f = fixture({ extraRisk: 'core.fsmonitor\ntrue' });
  const repaired = invoke(f);
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'CANONICAL_GIT_WORKTREE_CONFIG_SCOPE_MISMATCH');
  assert.equal(f.mutationCount(), 0);
});

test('postcondition failure retains truthful evidence that mutation occurred', () => {
  const f = fixture({ failAfterUnsetRead: true });
  const repaired = invoke(f);
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'CANONICAL_GIT_WORKTREE_CONFIG_POSTCONDITION_UNPROVEN');
  assert.equal(repaired.mutationPerformed, true);
  assert.equal(f.mutationCount(), 1);
});

test('mailbox executes fixed repair before Commander health', async t => {
  const f = realMailboxRepository(t);
  const env = { ...process.env, USERPROFILE: f.home };
  const receipt = await executeSovereignCommanderRemoteOnBattleBridge({
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'repair-canonical-git-config-test-01',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 3149,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: f.head,
    expiresAt: '2099-01-01T00:00:00.000Z',
    remoteAction: 'repair-canonical-git-worktree-config',
  }, {
    env,
    fetchFn: async () => { throw new Error('Commander health must not be contacted'); },
    ensureRuntimeFn: async () => { throw new Error('Commander runtime must not be recycled'); },
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.finalVerdict, 'CANONICAL_GIT_WORKTREE_CONFIG_REPAIRED');
  assert.equal(receipt.sourceHead, f.head);
  assert.equal(receipt.gitConfigurationMutationPerformed, true);
  assert.equal(receipt.sourceMutationAllowed, false);
  assert.equal(receipt.arbitraryShellAllowed, false);
  assert.equal(receipt.pcRestartAuthority, false);
  const after = spawnSync('git', ['config', '--local', '--get-all', 'extensions.worktreeConfig'], {
    cwd: f.repositoryRoot, encoding: 'utf8', shell: false, windowsHide: true,
  });
  assert.notEqual(after.status, 0);
});

test('mailbox failure after completed mutation reports the mutation truthfully', async t => {
  const f = realMailboxRepository(t);
  const env = { ...process.env, USERPROFILE: f.home };
  let unsetCompleted = false;
  let failedPostUnsetRead = false;
  const spawnSyncFn = (command, args, options) => {
    const joined = args.join('\u0001');
    if (joined.endsWith('config\u0001--local\u0001--unset-all\u0001extensions.worktreeConfig')) {
      const out = spawnSync(command, args, options);
      if (!out.error && Number(out.status) === 0) unsetCompleted = true;
      return out;
    }
    if (unsetCompleted && !failedPostUnsetRead
        && joined.endsWith('config\u0001--local\u0001--null\u0001--list')) {
      failedPostUnsetRead = true;
      return result(1, '');
    }
    return spawnSync(command, args, options);
  };
  const receipt = await executeSovereignCommanderRemoteOnBattleBridge({
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'repair-canonical-git-config-test-02',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 3149,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: f.head,
    expiresAt: '2099-01-01T00:00:00.000Z',
    remoteAction: 'repair-canonical-git-worktree-config',
  }, { env, spawnSyncFn });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.blocker, 'CANONICAL_GIT_WORKTREE_CONFIG_POSTCONDITION_UNPROVEN');
  assert.equal(receipt.gitConfigurationMutationPerformed, true);
  assert.equal(unsetCompleted, true);
  assert.equal(failedPostUnsetRead, true);
  const after = spawnSync('git', ['config', '--local', '--get-all', 'extensions.worktreeConfig'], {
    cwd: f.repositoryRoot, encoding: 'utf8', shell: false, windowsHide: true,
  });
  assert.notEqual(after.status, 0);
});

test('real Git: absent config.worktree is treated as empty and repaired', t => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-git-config-repair-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const out = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
    assert.equal(out.status, 0, out.stderr);
    return out.stdout;
  };
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('remote', 'add', 'origin', ORIGIN);
  git('config', 'extensions.worktreeConfig', 'true');
  git('commit', '--allow-empty', '-m', 'fixture');
  const head = git('rev-parse', 'HEAD').trim();
  const repaired = repairCanonicalGitWorktreeConfigV1({
    repositoryRoot: root,
    expectedHead: head,
    platform: process.platform,
    environment: process.env,
  });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.mutationPerformed, true);
  const after = spawnSync('git', ['config', '--local', '--get-all', 'extensions.worktreeConfig'],
    { cwd: root, encoding: 'utf8', shell: false });
  assert.notEqual(after.status, 0);
});

test('real Git: linked worktree is refused before repository-wide extension mutation', t => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-git-config-linked-'));
  const linked = root + '-linked';
  t.after(() => {
    rmSync(linked, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => {
    const out = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
    assert.equal(out.status, 0, out.stderr);
    return out.stdout;
  };
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('remote', 'add', 'origin', ORIGIN);
  git('config', 'extensions.worktreeConfig', 'true');
  git('commit', '--allow-empty', '-m', 'fixture');
  git('worktree', 'add', '-b', 'linked-fixture', linked);
  const head = git('rev-parse', 'HEAD').trim();
  const repaired = repairCanonicalGitWorktreeConfigV1({
    repositoryRoot: root,
    expectedHead: head,
    platform: process.platform,
    environment: process.env,
  });
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'CANONICAL_GIT_WORKTREE_CONFIG_LINKED_WORKTREES_PRESENT');
  assert.equal(repaired.mutationPerformed, false);
  assert.equal(git('config', '--local', '--get', 'extensions.worktreeConfig').trim(), 'true');
});
