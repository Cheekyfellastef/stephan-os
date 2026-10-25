import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOVEREIGN_COMMANDER_REMOTE_ACTIONS,
  executeSovereignCommanderRemoteOnBattleBridge,
  repairCanonicalGitWorktreeConfigV1,
} from './sovereignCommanderRemoteMailboxV1.mjs';

const HEAD = 'a'.repeat(40);
const ORIGIN = 'https://github.com/Cheekyfellastef/stephan-os.git';

function result(status = 0, stdout = '') {
  return { status, stdout, stderr: '', error: null };
}

function fixture({ worktreeEntries = '', extraRisk = '', configuredValue = 'true' } = {}) {
  let extensionPresent = true;
  const calls = [];
  const spawnSyncFn = (_command, args) => {
    calls.push([...args]);
    const tail = args.join('\u0001');
    if (tail.endsWith('rev-parse\u0001HEAD')) return result(0, HEAD + '\n');
    if (tail.endsWith('branch\u0001--show-current')) return result(0, 'main\n');
    if (tail.endsWith('config\u0001--local\u0001--get-all\u0001extensions.worktreeConfig')) {
      return extensionPresent ? result(0, configuredValue + '\n') : result(1, '');
    }
    if (tail.endsWith('config\u0001--worktree\u0001--null\u0001--list')) return result(0, worktreeEntries);
    if (tail.endsWith('config\u0001--local\u0001--unset-all\u0001extensions.worktreeConfig')) {
      extensionPresent = false;
      return result(0, '');
    }
    if (tail.endsWith('config\u0001--local\u0001--null\u0001--list')) {
      const parts = [
        'remote.origin.url\n' + ORIGIN,
        ...(extensionPresent ? ['extensions.worktreeConfig\ntrue'] : []),
        ...(extraRisk ? [extraRisk] : []),
      ];
      return result(0, parts.join('\0') + '\0');
    }
    throw new Error('unexpected git invocation: ' + args.join(' '));
  };
  return { spawnSyncFn, calls, mutationCount: () => calls.filter(args =>
    args.join('\u0001').endsWith('config\u0001--local\u0001--unset-all\u0001extensions.worktreeConfig')).length };
}

test('the pre-admission repair action is registered', () => {
  assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('repair-canonical-git-worktree-config'));
});

test('fixed repair removes only an empty true worktreeConfig extension and proves canonical postcondition', () => {
  const f = fixture();
  const repaired = repairCanonicalGitWorktreeConfigV1({
    repositoryRoot: '/fixture/Documents/GitHub/stephan-os',
    expectedHead: HEAD,
    platform: 'linux',
    environment: {},
    spawnSyncFn: f.spawnSyncFn,
  });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.mutationPerformed, true);
  assert.equal(repaired.finalVerdict, 'CANONICAL_GIT_WORKTREE_CONFIG_REPAIRED');
  assert.deepEqual(repaired.riskCategoriesBefore, ['EXTENSIONS_WORKTREE_CONFIG']);
  assert.equal(repaired.canonicalAfter, true);
  assert.equal(f.mutationCount(), 1);
});

test('fixed repair refuses nonempty worktree config before mutation', () => {
  const f = fixture({ worktreeEntries: 'user.example\nkeep-me\0' });
  const repaired = repairCanonicalGitWorktreeConfigV1({
    repositoryRoot: '/fixture/Documents/GitHub/stephan-os',
    expectedHead: HEAD,
    platform: 'linux',
    environment: {},
    spawnSyncFn: f.spawnSyncFn,
  });
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'CANONICAL_GIT_WORKTREE_CONFIG_CONTENT_PRESENT');
  assert.equal(f.mutationCount(), 0);
});

test('fixed repair refuses any second rejected config category before mutation', () => {
  const f = fixture({ extraRisk: 'core.fsmonitor\ntrue' });
  const repaired = repairCanonicalGitWorktreeConfigV1({
    repositoryRoot: '/fixture/Documents/GitHub/stephan-os',
    expectedHead: HEAD,
    platform: 'linux',
    environment: {},
    spawnSyncFn: f.spawnSyncFn,
  });
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'CANONICAL_GIT_WORKTREE_CONFIG_SCOPE_MISMATCH');
  assert.equal(f.mutationCount(), 0);
});

test('mailbox executes the fixed repair before Commander health or maintenance-owner admission', async () => {
  const f = fixture();
  const env = { USERPROFILE: '/fixture' };
  const rawSpawn = f.spawnSyncFn;
  const spawnSyncFn = (command, args, options) => {
    if (args[0] === '-C' && args[1].endsWith('/fixture/Documents/GitHub/stephan-os')) {
      if (args[2] === 'branch') return result(0, 'main\n');
      if (args[2] === 'rev-parse') return result(0, HEAD + '\n');
    }
    return rawSpawn(command, args, options);
  };
  const receipt = await executeSovereignCommanderRemoteOnBattleBridge({
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'repair-canonical-git-config-test-01',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 3149,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2099-01-01T00:00:00.000Z',
    remoteAction: 'repair-canonical-git-worktree-config',
  }, {
    env,
    spawnSyncFn,
    fetchFn: async () => { throw new Error('Commander health must not be contacted'); },
    ensureRuntimeFn: async () => { throw new Error('Commander runtime must not be recycled'); },
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.finalVerdict, 'CANONICAL_GIT_WORKTREE_CONFIG_REPAIRED');
  assert.equal(receipt.sourceHead, HEAD);
  assert.equal(receipt.gitConfigurationMutationPerformed, true);
  assert.equal(receipt.sourceMutationAllowed, false);
  assert.equal(receipt.arbitraryShellAllowed, false);
  assert.equal(receipt.pcRestartAuthority, false);
  assert.equal(f.mutationCount(), 1);
});
