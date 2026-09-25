import test from 'node:test';
import assert from 'node:assert/strict';

import {
  proveProviderNeutralWorktreeHead,
  resolveProviderNeutralSourceHeadBinding,
} from './providerNeutralSourceBuilderService.js';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);

function claim(overrides = {}) {
  return {
    item: {
      executionBinding: {
        headSha: HEAD,
      },
      actionGrant: {
        headSha: HEAD,
      },
      payload: {
        expectedHeadSha: HEAD,
      },
      ...overrides,
    },
  };
}

test('source head binding requires all durable head identities to agree', () => {
  assert.equal(resolveProviderNeutralSourceHeadBinding(claim()), HEAD);
});

test('source head binding fails closed when queue identities disagree', () => {
  assert.throws(
    () => resolveProviderNeutralSourceHeadBinding(claim({
      actionGrant: { headSha: OTHER_HEAD },
    })),
    /PROVIDER_NEUTRAL_SOURCE_HEAD_BINDING_MISMATCH/,
  );
});

test('source head binding is mandatory for provider-neutral source mutation', () => {
  assert.throws(
    () => resolveProviderNeutralSourceHeadBinding({
      item: { executionBinding: {}, actionGrant: {}, payload: {} },
    }),
    /PROVIDER_NEUTRAL_SOURCE_HEAD_BINDING_REQUIRED/,
  );
});

test('source head binding rejects malformed durable head truth', () => {
  assert.throws(
    () => resolveProviderNeutralSourceHeadBinding(claim({
      executionBinding: { headSha: 'not-a-sha' },
    })),
    /PROVIDER_NEUTRAL_SOURCE_HEAD_BINDING_INVALID/,
  );
});

test('worktree head proof returns the exact observed head', () => {
  const run = (_exe, args) => {
    assert.deepEqual(args, ['-C', 'C:\\worktree', 'rev-parse', 'HEAD']);
    return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
  };
  assert.equal(proveProviderNeutralWorktreeHead('C:\\worktree', HEAD, run, 'BEFORE_PROVIDER'), HEAD);
});

test('worktree head drift is typed with the exact stage and both heads', () => {
  const run = () => ({ status: 0, stdout: `${OTHER_HEAD}\n`, stderr: '' });
  assert.throws(
    () => proveProviderNeutralWorktreeHead('C:\\worktree', HEAD, run, 'AFTER_PROVIDER'),
    new RegExp(`PROVIDER_NEUTRAL_WORKTREE_HEAD_DRIFT:AFTER_PROVIDER:${HEAD}:${OTHER_HEAD}`),
  );
});

test('unreadable worktree head fails closed before source mutation', () => {
  const run = () => ({ status: 1, stdout: '', stderr: 'fatal' });
  assert.throws(
    () => proveProviderNeutralWorktreeHead('C:\\worktree', HEAD, run, 'BEFORE_PROVIDER'),
    /PROVIDER_NEUTRAL_WORKTREE_HEAD_PROBE_FAILED:BEFORE_PROVIDER/,
  );
});
