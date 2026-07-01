import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleBridgeGitPullHelper } from '../shared/agents/battleBridgeSupervisor.mjs';

const localSha = 'a'.repeat(40);
const mainSha = 'b'.repeat(40);

test('Battle Bridge git pull helper blocks dirty-tree auto-update claims', () => {
  const projection = createBattleBridgeGitPullHelper({ updateStatus: 'UPDATE_AVAILABLE', localSha, mainSha, dirtyTree: true });
  assert.equal(projection.safeToPull, false);
  assert.equal(projection.autoPullClaim, false);
  assert.equal(projection.command, '');
  assert.match(projection.exactUnblockAction, /Commit or stash/);
});

test('Battle Bridge git pull helper exposes manual safe pull action for clean update', () => {
  const projection = createBattleBridgeGitPullHelper({ updateStatus: 'UPDATE_AVAILABLE', localSha, mainSha, dirtyTree: false });
  assert.equal(projection.safeToPull, true);
  assert.equal(projection.command, 'npm run stephanos:publish-merge');
  assert.match(projection.exactUnblockAction, /rebuild Stephanos UI/);
});
