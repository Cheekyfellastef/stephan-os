import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_MEMORY_AUTHORITY_CLASS,
  STEPHANOS_MEMORY_CONNECTION_STATE,
  buildStephanosMemoryAdequacyAudit,
} from './stephanosMemoryAdequacy.mjs';

const NOW = '2026-08-03T20:00:00.000Z';

function observation(domain, overrides = {}) {
  return {
    domain,
    authorityClass: STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY,
    recordCount: 12,
    approximateBytes: 12_000,
    observedAtUtc: NOW,
    source: 'shared-workspace-authority',
    retrievalCoverage: 1,
    retentionPolicy: 'ENFORCED',
    deletionState: 'PROVEN',
    conflictState: 'CONVERGED',
    backupState: 'PROVEN',
    proofRefs: [`proofs/memory/${domain}`],
    ...overrides,
  };
}

function durableObservations() {
  return [
    'operator-memory',
    'project-architecture-memory',
    'goal-decision-memory',
    'lessons-incident-memory',
    'runtime-proof-memory',
  ].map((domain) => observation(domain));
}

function connectedWorkspace(overrides = {}) {
  return {
    state: STEPHANOS_MEMORY_CONNECTION_STATE.CONNECTED,
    observed: true,
    observedAtUtc: NOW,
    source: 'battle-bridge-shared-workspace-receipt',
    proofRefs: ['shared-workspace/status/connection'],
    ...overrides,
  };
}

test('proves adequacy only from fresh shared authority with retention and lifecycle evidence', () => {
  const audit = buildStephanosMemoryAdequacyAudit({
    nowUtc: NOW,
    observations: durableObservations(),
    sharedWorkspaceConnection: connectedWorkspace(),
  });

  assert.equal(audit.finalVerdict, 'STEPHANOS_MEMORY_ADEQUACY_PROVEN');
  assert.equal(audit.memoryAdequate, true);
  assert.equal(audit.freshObserverReconstructionReady, true);
  assert.equal(audit.sharedWorkspaceConnected, true);
  assert.equal(audit.mutationAuthority, false);
  assert.equal(audit.blockers.length, 0);
  assert.equal(audit.domains.find((domain) => domain.domain === 'project-architecture-memory').adequate, true);
});

test('does not infer a Shared Workspace connection from repository or local memory evidence', () => {
  const audit = buildStephanosMemoryAdequacyAudit({
    nowUtc: NOW,
    observations: durableObservations(),
  });

  assert.equal(audit.sharedWorkspaceConnection.state, STEPHANOS_MEMORY_CONNECTION_STATE.UNKNOWN);
  assert.equal(audit.sharedWorkspaceConnected, false);
  assert.equal(audit.memoryAdequate, false);
  assert.equal(audit.finalVerdict, 'STEPHANOS_MEMORY_ADEQUACY_GAPS_FOUND');
  assert.match(audit.exactNextAction, /Shared Workspace connection receipt/);
});

test('keeps a local mirror separate from shared authority', () => {
  const observations = durableObservations();
  observations[0] = observation('operator-memory', {
    authorityClass: STEPHANOS_MEMORY_AUTHORITY_CLASS.LOCAL_MIRROR,
    source: 'browser-local-storage',
  });
  const audit = buildStephanosMemoryAdequacyAudit({
    nowUtc: NOW,
    observations,
    sharedWorkspaceConnection: connectedWorkspace(),
  });
  const operator = audit.domains.find((domain) => domain.domain === 'operator-memory');

  assert.equal(operator.authorityState, STEPHANOS_MEMORY_AUTHORITY_CLASS.LOCAL_MIRROR);
  assert.equal(operator.authoritativeRecordCount, 0);
  assert.ok(operator.gaps.includes('shared-authority-not-proven'));
  assert.equal(audit.memoryAdequate, false);
});

test('reclassifies expired authority evidence as stale rather than current shared truth', () => {
  const observations = durableObservations();
  observations[4] = observation('runtime-proof-memory', {
    observedAtUtc: '2026-08-03T18:00:00.000Z',
  });
  const audit = buildStephanosMemoryAdequacyAudit({
    nowUtc: NOW,
    observations,
    sharedWorkspaceConnection: connectedWorkspace(),
  });
  const runtime = audit.domains.find((domain) => domain.domain === 'runtime-proof-memory');

  assert.equal(runtime.authorityState, STEPHANOS_MEMORY_AUTHORITY_CLASS.STALE_EVIDENCE);
  assert.equal(runtime.authoritativeObservationCount, 0);
  assert.ok(runtime.gaps.includes('stale-evidence-present'));
  assert.equal(audit.freshObserverReconstructionReady, false);
});

test('pending local intent remains visible and blocks adequacy until convergence', () => {
  const observations = durableObservations();
  observations.push(observation('goal-decision-memory', {
    authorityClass: STEPHANOS_MEMORY_AUTHORITY_CLASS.PENDING_LOCAL_INTENT,
    recordCount: 1,
    source: 'pending-local-mutation',
  }));
  const audit = buildStephanosMemoryAdequacyAudit({
    nowUtc: NOW,
    observations,
    sharedWorkspaceConnection: connectedWorkspace(),
  });
  const goals = audit.domains.find((domain) => domain.domain === 'goal-decision-memory');

  assert.equal(goals.pendingLocalIntentRecordCount, 1);
  assert.ok(goals.gaps.includes('pending-local-intent-present'));
  assert.equal(audit.memoryAdequate, false);
});

test('deletion, conflict and backup ambiguity cannot be hidden by high record counts', () => {
  const observations = durableObservations();
  observations[2] = observation('goal-decision-memory', {
    recordCount: 500_000,
    deletionState: 'UNKNOWN',
    conflictState: 'PENDING',
    backupState: 'PARTIAL',
  });
  const audit = buildStephanosMemoryAdequacyAudit({
    nowUtc: NOW,
    observations,
    sharedWorkspaceConnection: connectedWorkspace(),
  });
  const goals = audit.domains.find((domain) => domain.domain === 'goal-decision-memory');

  assert.ok(goals.gaps.includes('deletion-not-proven'));
  assert.ok(goals.gaps.includes('conflict-convergence-not-proven'));
  assert.ok(goals.gaps.includes('backup-or-export-not-proven'));
  assert.equal(goals.adequate, false);
});

test('blocks unbounded or unsafe audit evidence instead of truncating it into authority', () => {
  const unsafe = durableObservations();
  unsafe[0] = observation('operator-memory', {
    recordCount: 1_000_001,
    proofRefs: ['../../secret'],
  });
  const audit = buildStephanosMemoryAdequacyAudit({
    nowUtc: NOW,
    observations: unsafe,
    sharedWorkspaceConnection: connectedWorkspace(),
  });

  assert.equal(audit.finalVerdict, 'STEPHANOS_MEMORY_ADEQUACY_AUDIT_BLOCKED');
  assert.ok(audit.blockers.includes('observation-0:invalid-record-count'));
  assert.ok(audit.blockers.includes('observation-0:unsafe-proof-ref'));
  assert.equal(audit.memoryAdequate, false);
});

test('reports capacity pressure and fails closed when the bounded store is exceeded', () => {
  const audit = buildStephanosMemoryAdequacyAudit({
    nowUtc: NOW,
    capacityBytes: 50_000,
    observations: durableObservations(),
    sharedWorkspaceConnection: connectedWorkspace(),
  });

  assert.equal(audit.totals.capacityPressure, true);
  assert.ok(audit.totals.capacityUsedPercent > 100);
  assert.ok(audit.blockers.includes('memory-capacity-exceeded'));
  assert.equal(audit.finalVerdict, 'STEPHANOS_MEMORY_ADEQUACY_AUDIT_BLOCKED');
});
