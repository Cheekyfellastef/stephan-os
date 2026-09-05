import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTROLLER_MIGRATION_STATUS,
  assessControllerRetirementV1,
  buildControllerEstateMigrationLedgerV1,
  buildControllerRetirementSharedProjectionV1,
  reconcilePostRetirementEstateV1,
} from './controllerEstateMigrationV1.mjs';

const observedAtUtc = '2026-09-05T15:30:00.000Z';

function controllers() {
  return {
    predecessor: {
      controllerId: 'stephanos-elastic-product-build',
      title: 'Stephanos Elastic Product Build',
      enabled: true,
    },
    successor: {
      controllerId: 'stephanos-autonomous-goal-builder',
      title: 'Stephanos Autonomous Goal Builder',
      enabled: true,
    },
  };
}

function estate() {
  return [
    {
      itemId: 'goal-1624-music',
      kind: 'GOAL',
      state: 'BUILDING',
      canonicalOwner: 'issue-1624',
      repository: 'Cheekyfellastef/stephan-os',
      branch: 'agent/music-current',
      headSha: '1111111111111111111111111111111111111111',
      acceptanceCriteria: ['playback-survives-rating', 'ratings-persist', 'live-proof-required'],
      continuationRules: ['build-to-apron', 'refill-capacity-on-operator-gate'],
      providerRequirements: ['provider-neutral-review'],
      authorityBoundary: ['exact-head-merge-approval-required'],
      resourceScopes: ['music-tile'],
    },
    {
      itemId: 'mission-1308-conversation',
      kind: 'MISSION',
      state: 'SOURCE_CHANGED',
      canonicalOwner: 'issue-1308',
      activeLease: true,
      writerOwner: 'lane-conversation-canvas',
      acceptanceCriteria: ['peer-intelligence-evaluation'],
      continuationRules: ['resume-existing-wip-first'],
      providerRequirements: [],
      authorityBoundary: ['no-self-review'],
      resourceScopes: ['conversation-canvas'],
    },
    {
      itemId: 'apron-1902-research',
      kind: 'APRON_PACKET',
      state: 'OPERATOR_READY_PARKED',
      canonicalOwner: 'issue-1902',
      apronState: 'OPERATOR_READY_PARKED',
      consumesBuilderCapacity: false,
      acceptanceCriteria: ['exact-head-review-clean'],
      continuationRules: ['drift-watch'],
      providerRequirements: ['provider-neutral-review'],
      authorityBoundary: ['operator-gate-only'],
      resourceScopes: ['native-research'],
    },
    {
      itemId: 'goal-terminal-example',
      kind: 'GOAL',
      state: 'COMPLETE',
      terminal: true,
      canonicalOwner: 'issue-1506',
    },
  ];
}

function mappings() {
  return [
    {
      itemId: 'goal-1624-music',
      successorControllerId: 'stephanos-autonomous-goal-builder',
      successorOwner: 'issue-1624',
      preserveCanonicalIdentity: true,
      acceptanceCriteria: ['playback-survives-rating', 'ratings-persist', 'live-proof-required'],
      continuationRules: ['build-to-apron', 'refill-capacity-on-operator-gate'],
      providerRequirements: ['provider-neutral-review'],
      authorityBoundary: ['exact-head-merge-approval-required'],
      resourceScopes: ['music-tile'],
    },
    {
      itemId: 'mission-1308-conversation',
      successorControllerId: 'stephanos-autonomous-goal-builder',
      successorOwner: 'issue-1308',
      writerOwner: 'lane-conversation-canvas',
      preserveCanonicalIdentity: true,
      preserveActiveLease: true,
      acceptanceCriteria: ['peer-intelligence-evaluation'],
      continuationRules: ['resume-existing-wip-first'],
      authorityBoundary: ['no-self-review'],
      resourceScopes: ['conversation-canvas'],
    },
    {
      itemId: 'apron-1902-research',
      successorControllerId: 'stephanos-autonomous-goal-builder',
      successorOwner: 'issue-1902',
      preserveCanonicalIdentity: true,
      apronState: 'OPERATOR_READY_PARKED',
      consumesBuilderCapacity: false,
      acceptanceCriteria: ['exact-head-review-clean'],
      continuationRules: ['drift-watch'],
      providerRequirements: ['provider-neutral-review'],
      authorityBoundary: ['operator-gate-only'],
      resourceScopes: ['native-research'],
    },
  ];
}

function build(overrides = {}) {
  const pair = controllers();
  return buildControllerEstateMigrationLedgerV1({
    observedAtUtc,
    ...pair,
    estate: estate(),
    mappings: mappings(),
    ...overrides,
  });
}

test('complete lossless migration reaches ready-for-retirement', () => {
  const ledger = build();
  assert.equal(ledger.migrationStatus, CONTROLLER_MIGRATION_STATUS.READY);
  assert.equal(ledger.retirementAllowed, true);
  assert.equal(ledger.unmappedCount, 0);
  assert.equal(ledger.mappedCount, 3);
  assert.equal(ledger.terminalCount, 1);
  assert.match(ledger.migrationId, /^controller-migration:[0-9a-f]{64}$/);
});

test('one omitted unfinished goal fails closed', () => {
  const ledger = build({ mappings: mappings().slice(1) });
  assert.equal(ledger.migrationStatus, CONTROLLER_MIGRATION_STATUS.BLOCKED);
  assert.equal(ledger.retirementAllowed, false);
  assert.equal(ledger.unmappedCount, 1);
  assert.ok(ledger.blockers.includes('goal-1624-music:unfinished-item-unmapped'));
});

test('one omitted acceptance criterion blocks retirement', () => {
  const changed = mappings();
  changed[0] = {
    ...changed[0],
    acceptanceCriteria: ['playback-survives-rating', 'ratings-persist'],
  };
  const ledger = build({ mappings: changed });
  assert.ok(ledger.blockers.includes('goal-1624-music:acceptance-criteria-loss'));
  assert.equal(ledger.retirementAllowed, false);
});

test('duplicate successor ownership blocks retirement', () => {
  const changed = mappings();
  changed.push({ ...changed[0] });
  const ledger = build({ mappings: changed });
  assert.ok(ledger.blockers.includes('goal-1624-music:duplicate-successor-ownership'));
  assert.equal(ledger.retirementAllowed, false);
});

test('active WIP preserves exact writer and lease', () => {
  const ledger = build();
  const mission = ledger.items.find((item) => item.itemId === 'mission-1308-conversation');
  assert.equal(mission.mappingStatus, 'MAPPED_LOSSLESSLY');

  const changed = mappings();
  changed[1] = { ...changed[1], writerOwner: 'different-writer' };
  const blocked = build({ mappings: changed });
  assert.ok(blocked.blockers.includes('mission-1308-conversation:active-writer-owner-drift'));
});

test('approval-ready parked work stays parked and consumes zero capacity', () => {
  const changed = mappings();
  changed[2] = { ...changed[2], consumesBuilderCapacity: true };
  const blocked = build({ mappings: changed });
  assert.ok(blocked.blockers.includes('apron-1902-research:parked-capacity-regression'));

  changed[2] = { ...mappings()[2], apronState: 'BUILDING' };
  const stateBlocked = build({ mappings: changed });
  assert.ok(stateBlocked.blockers.includes('apron-1902-research:parked-state-loss'));
});

test('provider-specific continuation requirements cannot disappear', () => {
  const changed = mappings();
  changed[2] = { ...changed[2], providerRequirements: [] };
  const blocked = build({ mappings: changed });
  assert.ok(blocked.blockers.includes('apron-1902-research:provider-requirement-loss'));
});

test('retirement gate requires ready ledger and enabled successor', () => {
  const ledger = build();
  const allowed = assessControllerRetirementV1({
    ledger,
    predecessorEnabled: true,
    successorEnabled: true,
  });
  assert.equal(allowed.disablePredecessorAllowed, true);
  assert.equal(allowed.decision, 'RETIREMENT_ALLOWED');

  const denied = assessControllerRetirementV1({
    ledger,
    predecessorEnabled: true,
    successorEnabled: false,
  });
  assert.equal(denied.disablePredecessorAllowed, false);
  assert.ok(denied.blockers.includes('successor-not-enabled'));
});

test('retirement attempt with unresolved mapping fails closed', () => {
  const ledger = build({ mappings: mappings().slice(0, 2) });
  const decision = assessControllerRetirementV1({
    ledger,
    predecessorEnabled: true,
    successorEnabled: true,
  });
  assert.equal(decision.disablePredecessorAllowed, false);
  assert.ok(decision.blockers.includes('migration-ledger-not-ready'));
});

test('post-retirement reconciliation proves all migrated work remains selectable or parked', () => {
  const ledger = build();
  const result = reconcilePostRetirementEstateV1({
    ledger,
    successorInventory: [
      { itemId: 'goal-1624-music', canonicalOwner: 'issue-1624', state: 'BUILDING', selectable: true },
      { itemId: 'mission-1308-conversation', canonicalOwner: 'issue-1308', state: 'SOURCE_CHANGED', buildable: true },
      { itemId: 'apron-1902-research', canonicalOwner: 'issue-1902', state: 'OPERATOR_READY_PARKED' },
    ],
  });
  assert.equal(result.postRetirementProven, true);
  assert.equal(result.reconciliationStatus, CONTROLLER_MIGRATION_STATUS.POST_RETIREMENT_PROVEN);
  assert.deepEqual(result.orphanedItemIds, []);
});

test('post-retirement missing work is classified ORPHANED_REPAIR_REQUIRED', () => {
  const ledger = build();
  const result = reconcilePostRetirementEstateV1({
    ledger,
    successorInventory: [
      { itemId: 'goal-1624-music', canonicalOwner: 'issue-1624', state: 'BUILDING', selectable: true },
      { itemId: 'apron-1902-research', canonicalOwner: 'issue-1902', state: 'OPERATOR_READY_PARKED' },
    ],
  });
  assert.equal(result.postRetirementProven, false);
  assert.equal(result.reconciliationStatus, CONTROLLER_MIGRATION_STATUS.ORPHANED_REPAIR_REQUIRED);
  assert.deepEqual(result.orphanedItemIds, ['mission-1308-conversation']);
});

test('shared projection is read-only and exposes migration counts', () => {
  const ledger = build();
  const reconciliation = reconcilePostRetirementEstateV1({
    ledger,
    successorInventory: [
      { itemId: 'goal-1624-music', canonicalOwner: 'issue-1624', state: 'BUILDING', selectable: true },
      { itemId: 'mission-1308-conversation', canonicalOwner: 'issue-1308', state: 'BUILDING', selectable: true },
      { itemId: 'apron-1902-research', canonicalOwner: 'issue-1902', state: 'OPERATOR_READY_PARKED' },
    ],
  });
  const projection = buildControllerRetirementSharedProjectionV1({ ledger, reconciliation });
  assert.equal(projection.unmappedCount, 0);
  assert.equal(projection.orphanedCount, 0);
  assert.equal(projection.controllerDisableAuthority, false);
  assert.equal(projection.sourceMutationAuthority, false);
  assert.equal(projection.mergeAuthority, false);
  assert.equal(projection.runtimeMutationAuthority, false);
});
