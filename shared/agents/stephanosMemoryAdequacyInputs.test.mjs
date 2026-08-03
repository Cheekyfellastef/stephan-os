import test from 'node:test';
import assert from 'node:assert/strict';

import { PROGRAMME_AUTHORITY_COMPONENTS } from './programmeAuthorityV1.mjs';
import { buildStephanosMemoryAdequacyInputs } from './stephanosMemoryAdequacyInputs.mjs';
import { buildStephanosMemoryAdequacyAudit } from '../runtime/stephanosMemoryAdequacy.mjs';

const NOW = '2026-08-03T20:00:00.000Z';

function record(type, id, overrides = {}) {
  return {
    namespace: 'continuity',
    id,
    type,
    source: 'operator-confirmed',
    scope: 'project',
    summary: `Record ${id}`,
    payload: { privateDetail: 'must-not-be-projected' },
    tags: [],
    importance: 'normal',
    retentionHint: 'default',
    createdAt: NOW,
    updatedAt: NOW,
    surface: 'hosted',
    ...overrides,
  };
}

function sharedDiagnostics(overrides = {}) {
  return {
    stateClass: 'shared-durable-truth',
    sourceUsedOnLoad: 'shared-backend',
    sourceUsedOnSave: 'shared-backend',
    hydrationCompleted: true,
    hydrationState: 'ready',
    fallbackReason: '',
    recordCount: 3,
    ...overrides,
  };
}

test('adapts typed memory records into domains without copying record payloads', () => {
  const inputs = buildStephanosMemoryAdequacyInputs({
    observedAtUtc: NOW,
    memoryDiagnostics: sharedDiagnostics(),
    memoryRecords: [
      record('operator.preference', 'preference-1'),
      record('operator.goal', 'goal-1'),
      record('continuity.note', 'architecture-1', { tags: ['architecture'] }),
      record('route.diagnostic', 'incident-1'),
      record('tile.event', 'proof-1'),
    ],
  });

  assert.equal(inputs.valid, true);
  assert.equal(inputs.finalVerdict, 'STEPHANOS_MEMORY_ADEQUACY_INPUTS_READY');
  assert.deepEqual(
    inputs.observations.map((entry) => entry.domain).sort(),
    [
      'goal-decision-memory',
      'lessons-incident-memory',
      'operator-memory',
      'project-architecture-memory',
      'project-architecture-memory',
      'runtime-proof-memory',
    ].sort(),
  );
  const serialized = JSON.stringify(inputs);
  assert.doesNotMatch(serialized, /must-not-be-projected/);
  assert.doesNotMatch(serialized, /Record preference-1/);
  assert.equal(inputs.observations.every((entry) => entry.retentionPolicy === 'DECLARED'), true);
  assert.equal(inputs.observations.every((entry) => entry.deletionState === 'UNKNOWN'), true);
});

test('requires a fully ready shared diagnostic before classifying memory as shared authority', () => {
  for (const diagnostics of [
    sharedDiagnostics({ hydrationState: 'degraded' }),
    sharedDiagnostics({ fallbackReason: 'backend-save-failed' }),
    sharedDiagnostics({ sourceUsedOnLoad: 'local-mirror-fallback' }),
    sharedDiagnostics({ stateClass: 'local-fallback-mirror' }),
  ]) {
    const inputs = buildStephanosMemoryAdequacyInputs({
      observedAtUtc: NOW,
      memoryDiagnostics: diagnostics,
      memoryRecords: [record('operator.preference', 'preference-1')],
      programmeComponents: [],
    });
    assert.equal(inputs.observations[0].authorityClass, 'LOCAL_MIRROR');
  }
});

test('pending local intent remains a separate authority class', () => {
  const inputs = buildStephanosMemoryAdequacyInputs({
    observedAtUtc: NOW,
    memoryDiagnostics: sharedDiagnostics({ pendingIntentCount: 2 }),
    memoryRecords: [record('operator.goal', 'goal-1')],
    programmeComponents: [],
  });
  assert.equal(inputs.observations[0].authorityClass, 'PENDING_LOCAL_INTENT');
});

test('reuses canonical programme-authority components as source inventory evidence', () => {
  const inputs = buildStephanosMemoryAdequacyInputs({
    observedAtUtc: NOW,
    memoryDiagnostics: sharedDiagnostics(),
    memoryRecords: [],
  });
  const programme = inputs.observations.find((entry) => entry.source === 'github-programme-authority-source-inventory');

  assert.ok(PROGRAMME_AUTHORITY_COMPONENTS.length > 10);
  assert.equal(programme.domain, 'project-architecture-memory');
  assert.equal(programme.recordCount, PROGRAMME_AUTHORITY_COMPONENTS.length);
  assert.equal(programme.authorityClass, 'SHARED_AUTHORITY');
  assert.equal(programme.retentionPolicy, 'DECLARED');
  assert.equal(programme.backupState, 'PARTIAL');
  assert.deepEqual(programme.proofRefs, ['github/programme-authority/components']);
});

test('does not claim a Shared Workspace connection without a fresh observed ready receipt', () => {
  const unknown = buildStephanosMemoryAdequacyInputs({
    observedAtUtc: NOW,
    memoryDiagnostics: sharedDiagnostics(),
    memoryRecords: [],
    sharedWorkspaceStatus: null,
  });
  assert.equal(unknown.sharedWorkspaceConnection.state, 'UNKNOWN');
  assert.equal(unknown.sharedWorkspaceConnection.observed, false);

  const blocked = buildStephanosMemoryAdequacyInputs({
    observedAtUtc: NOW,
    memoryDiagnostics: sharedDiagnostics(),
    memoryRecords: [],
    sharedWorkspaceStatus: {
      observed: true,
      ok: false,
      finalVerdict: 'SHARED_WORKSPACE_STATUS_BLOCKED',
      observedAtUtc: NOW,
      expectedHeadMatch: true,
    },
  });
  assert.equal(blocked.sharedWorkspaceConnection.state, 'UNKNOWN');
  assert.equal(blocked.sharedWorkspaceConnection.observed, true);

  const ready = buildStephanosMemoryAdequacyInputs({
    observedAtUtc: NOW,
    memoryDiagnostics: sharedDiagnostics(),
    memoryRecords: [],
    sharedWorkspaceStatus: {
      observed: true,
      ok: true,
      finalVerdict: 'SHARED_WORKSPACE_STATUS_READY',
      expectedHeadMatch: true,
      observedAtUtc: NOW,
      proofRefs: ['receipts/github-command-mailbox/shared-workspace-status.json'],
    },
  });
  assert.equal(ready.sharedWorkspaceConnection.state, 'CONNECTED');
  assert.equal(ready.sharedWorkspaceConnection.observed, true);
});

test('feeds existing evidence into the adequacy audit while preserving lifecycle gaps', () => {
  const inputs = buildStephanosMemoryAdequacyInputs({
    observedAtUtc: NOW,
    memoryDiagnostics: sharedDiagnostics(),
    memoryRecords: [
      record('operator.preference', 'preference-1'),
      record('operator.goal', 'goal-1'),
      record('continuity.note', 'architecture-1'),
      record('route.diagnostic', 'incident-1'),
      record('tile.event', 'proof-1'),
    ],
    sharedWorkspaceStatus: {
      observed: true,
      ok: true,
      finalVerdict: 'SHARED_WORKSPACE_STATUS_READY',
      expectedHeadMatch: true,
      observedAtUtc: NOW,
      proofRefs: ['shared-workspace/status/connection'],
    },
  });
  const audit = buildStephanosMemoryAdequacyAudit({
    nowUtc: NOW,
    observations: inputs.observations,
    sharedWorkspaceConnection: inputs.sharedWorkspaceConnection,
  });

  assert.equal(audit.sharedWorkspaceConnected, true);
  assert.equal(audit.memoryAdequate, false);
  assert.equal(audit.finalVerdict, 'STEPHANOS_MEMORY_ADEQUACY_GAPS_FOUND');
  assert.ok(audit.domains.some((domain) => domain.gaps.includes('retention-not-enforced')));
  assert.ok(audit.domains.some((domain) => domain.gaps.includes('deletion-not-proven')));
});

test('fails closed on excessive or malformed existing evidence', () => {
  const malformed = buildStephanosMemoryAdequacyInputs({
    observedAtUtc: NOW,
    memoryDiagnostics: 'not-an-object',
    memoryRecords: [null],
    programmeComponents: [{ componentId: '', source: '' }],
  });
  assert.equal(malformed.valid, false);
  assert.ok(malformed.blockers.includes('memory-diagnostics-not-object'));
  assert.ok(malformed.blockers.includes('memory-record-not-object'));
  assert.ok(malformed.blockers.includes('programme-component-invalid'));
});
