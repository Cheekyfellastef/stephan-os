import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_INTERVAL_MS,
  BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_SCHEMA,
  refreshBattleBridgeCodexCapacity,
} from './battleBridgeCodexCapacityRefreshV1.mjs';

const NOW = '2026-08-26T11:00:00.000Z';
const HEAD = 'a'.repeat(40);

function input(overrides = {}) {
  return {
    nowUtc: NOW,
    sourceIdentity: { ok: true, branch: 'main', sourceHead: HEAD },
    checkpoint: null,
    workspaceRoot: 'C:\\Shared Workspace',
    repoRoot: 'C:\\repo',
    ...overrides,
  };
}

function status(command, overrides = {}) {
  return {
    ok: true,
    blocker: '',
    finalVerdict: 'CODEX_BANKED_RESET_STATUS_READY',
    requestId: command.requestId,
    observedAtUtc: NOW,
    meterSummary: 'Codex weekly usage | 72% remaining',
    usageSurfaceMatched: true,
    activeCodexTask: false,
    readOnly: true,
    pressAttempted: false,
    pressCount: 0,
    arbitraryShellAllowed: false,
    arbitraryBrowserAutomationAllowed: false,
    credentialsMayBeReadOrExported: false,
    proofRefs: ['proofs/codex-meter-current.json'],
    ...overrides,
  };
}

function publication(options = {}) {
  return {
    ok: true,
    reason: 'CODEX_CAPACITY_WORKSPACE_PUBLISHED',
    finalVerdict: 'CODEX_CAPACITY_WORKSPACE_PUBLISH_PASS',
    slice: {
      schemaVersion: 'stephanos.codex-capacity-workspace.v1',
      timestampUtc: NOW,
      truthState: 'CURRENT',
      capacityUsable: true,
      rawUiTextPublished: false,
      dispatchAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      ...options,
    },
  };
}

test('idle refresh reads the fixed status surface and publishes one non-dispatching capacity receipt', async () => {
  const reads = [];
  const writes = [];
  const result = await refreshBattleBridgeCodexCapacity(input(), {
    readStatus: async (command, options) => {
      reads.push({ command, options });
      return status(command);
    },
    publishCapacity: async (...args) => {
      writes.push(args);
      return publication();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempted, true);
  assert.equal(result.publicationAttempted, true);
  assert.equal(result.capacityUsable, true);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.resetAuthority, false);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].command.operation, 'READ_CODEX_BANKED_RESET_STATUS');
  assert.equal(reads[0].command.expectedHead, HEAD);
  assert.equal(reads[0].options.repoRoot, 'C:\\repo');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'C:\\Shared Workspace');
  assert.equal(writes[0][1].statusResult.pressAttempted, false);
  assert.equal(writes[0][1].statusResult.pressCount, 0);
  assert.equal(result.checkpoint.schemaVersion, BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_SCHEMA);
  assert.equal(result.checkpoint.published, true);
  assert.equal(
    Date.parse(result.nextEligibleAtUtc) - Date.parse(NOW),
    BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_INTERVAL_MS,
  );
});

test('fresh exact-head checkpoint suppresses repeated UI reads and publication', async () => {
  let calls = 0;
  const nextEligibleAtUtc = new Date(Date.parse(NOW) + 60_000).toISOString();
  const prior = {
    schemaVersion: BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_SCHEMA,
    lastAttemptAtUtc: new Date(Date.parse(NOW) - 60_000).toISOString(),
    nextEligibleAtUtc,
    sourceHead: HEAD,
  };
  const result = await refreshBattleBridgeCodexCapacity(input({ checkpoint: prior }), {
    readStatus: async () => { calls += 1; },
    publishCapacity: async () => { calls += 1; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempted, false);
  assert.equal(result.finalVerdict, 'BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_COOLDOWN');
  assert.equal(result.nextEligibleAtUtc, nextEligibleAtUtc);
  assert.notEqual(result.checkpoint, prior);
  assert.equal(Object.isFrozen(result.checkpoint), true);
  assert.equal(result.checkpoint.sourceHead, HEAD);
  assert.equal(calls, 0);
});

test('reader blocker is checkpointed and cannot publish capacity', async () => {
  let publishes = 0;
  const result = await refreshBattleBridgeCodexCapacity(input(), {
    readStatus: async (command) => status(command, {
      ok: false,
      blocker: 'RESET_STATUS_USAGE_SURFACE_NOT_FOUND',
      finalVerdict: 'CODEX_BANKED_RESET_STATUS_BLOCKED',
    }),
    publishCapacity: async () => { publishes += 1; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempted, true);
  assert.equal(result.publicationAttempted, false);
  assert.equal(result.blocker, 'RESET_STATUS_USAGE_SURFACE_NOT_FOUND');
  assert.equal(result.checkpoint.published, false);
  assert.equal(publishes, 0);
});

test('status claiming a reset press is rejected before publication', async () => {
  let publishes = 0;
  const result = await refreshBattleBridgeCodexCapacity(input(), {
    readStatus: async (command) => status(command, { pressAttempted: true, pressCount: 1 }),
    publishCapacity: async () => { publishes += 1; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CODEX_CAPACITY_REFRESH_READER_INVALID');
  assert.equal(result.resetAuthority, false);
  assert.equal(publishes, 0);
});

test('malformed source identity cannot inspect UI or publish capacity', async () => {
  let calls = 0;
  const result = await refreshBattleBridgeCodexCapacity(input({
    sourceIdentity: { ok: true, branch: 'feature', sourceHead: HEAD },
  }), {
    readStatus: async () => { calls += 1; },
    publishCapacity: async () => { calls += 1; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CODEX_CAPACITY_REFRESH_SOURCE_IDENTITY_INVALID');
  assert.equal(result.attempted, false);
  assert.equal(calls, 0);
});

test('authority-widening publication is rejected even after a valid read', async () => {
  const result = await refreshBattleBridgeCodexCapacity(input(), {
    readStatus: async (command) => status(command),
    publishCapacity: async () => publication({ dispatchAllowed: true }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.publicationAttempted, true);
  assert.equal(result.blocker, 'CODEX_CAPACITY_REFRESH_PUBLICATION_INVALID');
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.checkpoint.published, false);
});

test('accessor-shaped checkpoint is ignored without invoking it', async () => {
  let getterInvoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'schemaVersion', {
    enumerable: true,
    get() {
      getterInvoked = true;
      return BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_SCHEMA;
    },
  });
  let reads = 0;
  const result = await refreshBattleBridgeCodexCapacity(input({ checkpoint: hostile }), {
    readStatus: async (command) => {
      reads += 1;
      return status(command);
    },
    publishCapacity: async () => publication(),
  });
  assert.equal(getterInvoked, false);
  assert.equal(reads, 1);
  assert.equal(result.ok, true);
});

test('accessor-shaped optional status data is not invoked or forwarded', async () => {
  let getterInvoked = false;
  let forwardedStatus = null;
  const result = await refreshBattleBridgeCodexCapacity(input(), {
    readStatus: async (command) => {
      const value = status(command);
      delete value.meterSummary;
      Object.defineProperty(value, 'meterSummary', {
        enumerable: true,
        get() {
          getterInvoked = true;
          return 'Codex weekly usage | 99% remaining';
        },
      });
      return value;
    },
    publishCapacity: async (_root, payload) => {
      forwardedStatus = payload.statusResult;
      return publication({ truthState: 'UNKNOWN', capacityUsable: false });
    },
  });
  assert.equal(getterInvoked, false);
  assert.equal(forwardedStatus.meterSummary, '');
  assert.equal(Object.isFrozen(forwardedStatus), true);
  assert.equal(result.truthState, 'UNKNOWN');
  assert.equal(result.dispatchAllowed, false);
});

test('coercion-shaped identity and checkpoint values fail closed without invocation', async () => {
  let coercionInvoked = false;
  const hostile = {
    [Symbol.toPrimitive]() {
      coercionInvoked = true;
      return HEAD;
    },
  };
  let calls = 0;
  const invalidIdentity = await refreshBattleBridgeCodexCapacity(input({
    sourceIdentity: { ok: true, branch: 'main', sourceHead: hostile },
  }), {
    readStatus: async () => { calls += 1; },
    publishCapacity: async () => { calls += 1; },
  });
  assert.equal(invalidIdentity.ok, false);
  assert.equal(invalidIdentity.blocker, 'CODEX_CAPACITY_REFRESH_SOURCE_IDENTITY_INVALID');
  assert.equal(calls, 0);

  const checkpointResult = await refreshBattleBridgeCodexCapacity(input({
    checkpoint: {
      schemaVersion: BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_SCHEMA,
      lastAttemptAtUtc: new Date(Date.parse(NOW) - 60_000).toISOString(),
      nextEligibleAtUtc: new Date(Date.parse(NOW) + 60_000).toISOString(),
      sourceHead: hostile,
    },
  }), {
    readStatus: async (command) => {
      calls += 1;
      return status(command);
    },
    publishCapacity: async () => publication(),
  });
  assert.equal(checkpointResult.ok, true);
  assert.equal(checkpointResult.attempted, true);
  assert.equal(calls, 1);
  assert.equal(coercionInvoked, false);
});

test('coercion-shaped status scalars cannot become meter or reset truth', async () => {
  let coercionInvoked = false;
  const hostile = {
    valueOf() {
      coercionInvoked = true;
      return 0;
    },
  };
  let publishes = 0;
  const invalidPressCount = await refreshBattleBridgeCodexCapacity(input(), {
    readStatus: async (command) => status(command, { pressCount: hostile }),
    publishCapacity: async () => { publishes += 1; },
  });
  assert.equal(invalidPressCount.ok, false);
  assert.equal(invalidPressCount.blocker, 'CODEX_CAPACITY_REFRESH_READER_INVALID');
  assert.equal(publishes, 0);

  let forwardedStatus = null;
  const invalidPercent = await refreshBattleBridgeCodexCapacity(input(), {
    readStatus: async (command) => status(command, { remainingPercent: hostile }),
    publishCapacity: async (_root, payload) => {
      forwardedStatus = payload.statusResult;
      return publication();
    },
  });
  assert.equal(invalidPercent.ok, true);
  assert.equal(forwardedStatus.remainingPercent, undefined);
  assert.equal(coercionInvoked, false);
});

test('coercion-shaped published truth state is rejected without invocation', async () => {
  let coercionInvoked = false;
  const hostile = {
    toString() {
      coercionInvoked = true;
      return 'CURRENT';
    },
  };
  const result = await refreshBattleBridgeCodexCapacity(input(), {
    readStatus: async (command) => status(command),
    publishCapacity: async () => publication({ truthState: hostile }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CODEX_CAPACITY_REFRESH_PUBLICATION_INVALID');
  assert.equal(coercionInvoked, false);
});

test('truthful unknown publication remains non-routable', async () => {
  const result = await refreshBattleBridgeCodexCapacity(input(), {
    readStatus: async (command) => status(command, { meterSummary: 'Codex usage unavailable' }),
    publishCapacity: async () => publication({ truthState: 'UNKNOWN', capacityUsable: false }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.truthState, 'UNKNOWN');
  assert.equal(result.capacityUsable, false);
  assert.equal(result.dispatchAllowed, false);
});
