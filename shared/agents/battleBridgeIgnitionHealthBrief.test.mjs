import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBattleBridgeIgnitionHealthBriefContract,
  createBattleBridgeIgnitionHealthBrief,
} from './battleBridgeIgnitionHealthBrief.mjs';

const currentWorkspace = { status: 'CURRENT', current: true, records: ['status/battle-bridge-current.json'] };

function facts(overrides = {}) {
  return {
    endpoints: {
      backend8787: { observed: true },
      openclaw18789: { observed: true },
      ui4173: { observed: true },
      ...overrides.endpoints,
    },
    processes: { known: ['backend', 'openclaw-gateway', 'stephanos-ui'], unknown: [], ...overrides.processes },
    gitDirtyFiles: overrides.gitDirtyFiles || [],
    sharedWorkspaceStatus: overrides.sharedWorkspaceStatus || currentWorkspace,
    stalePublishers: overrides.stalePublishers || [],
  };
}

test('all-ready facts produce all-ready', () => {
  const brief = createBattleBridgeIgnitionHealthBrief(facts());
  assert.equal(brief.ignitionState, 'all-ready');
  assert.equal(brief.finalVerdict, 'HEALTH_BRIEF_READY');
});

test('backend-only facts produce partial-backend-only', () => {
  const brief = createBattleBridgeIgnitionHealthBrief(facts({ endpoints: { openclaw18789: { observed: false }, ui4173: { observed: false } } }));
  assert.equal(brief.ignitionState, 'partial-backend-only');
});

test('missing UI 4173 produces partial-ui-missing', () => {
  const brief = createBattleBridgeIgnitionHealthBrief(facts({ endpoints: { ui4173: { observed: false } } }));
  assert.equal(brief.ignitionState, 'partial-ui-missing');
  assert.match(brief.smallestNextOperatorAction, /UI 4173/);
});

test('stale workspace records block health success', () => {
  const brief = createBattleBridgeIgnitionHealthBrief(facts({ sharedWorkspaceStatus: { status: 'STALE', current: false }, stalePublishers: ['battle-bridge-current'] }));
  assert.equal(brief.ignitionState, 'stale-shared-workspace');
  assert.equal(brief.finalVerdict, 'HEALTH_BRIEF_NOT_HEALTHY');
});

test('source dirt blocks supervisor action', () => {
  const brief = createBattleBridgeIgnitionHealthBrief(facts({ gitDirtyFiles: ['shared/agents/battleBridgeSupervisor.mjs'] }));
  assert.equal(brief.ignitionState, 'blocked-dirty-source');
  assert.equal(brief.gitDirtyFiles.sourceBlocked, true);
});

test('runtime-only dirt is reported as caveat, not source blocker', () => {
  const brief = createBattleBridgeIgnitionHealthBrief(facts({ gitDirtyFiles: ['data/activity/latest.json', 'stephanos-server/data/memory/durable-memory.json'] }));
  assert.equal(brief.ignitionState, 'all-ready');
  assert.equal(brief.gitDirtyFiles.sourceBlocked, false);
  assert.match(brief.caveats.join('\n'), /Runtime-only dirt/);
});

test('unknown processes require operator inspection', () => {
  const brief = createBattleBridgeIgnitionHealthBrief(facts({ processes: { unknown: ['mystery-node.exe'] } }));
  assert.equal(brief.ignitionState, 'blocked-unknown-processes');
  assert.match(brief.safetyBlockers.join('\n'), /operator inspection/);
});

test('no start/kill/merge/push authority is exposed', () => {
  const contract = buildBattleBridgeIgnitionHealthBriefContract();
  assert.equal(contract.shellExecutionAllowed, false);
  assert.equal(contract.processKillAllowed, false);
  assert.equal(contract.serviceStartAllowed, false);
  assert.equal(contract.runtimeFileMutationAllowed, false);
  assert.equal(contract.mergeAllowed, false);
  assert.equal(contract.pushAllowed, false);
});
