import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diagnoseSovereignCommanderIgnition,
  SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_SCHEMA,
} from './sovereign-commander-ignition-diagnosis.mjs';

const HEAD = 'a'.repeat(40);

function fixture({
  backend = true,
  ui = true,
  openclaw = true,
  workspace = true,
  sourceOk = true,
  supervisor = null,
  safetyBlockers = [],
} = {}) {
  return diagnoseSovereignCommanderIgnition({
    repoRoot: '/repo',
    sharedWorkspace: '/workspace',
    nowMs: () => Date.parse('2026-10-31T21:30:00Z'),
    sourceTruthFn: () => ({ head: HEAD }),
    evaluateSourceTruthFn: truth => sourceOk
      ? ({ ok: true, sourceTruth: truth })
      : ({ ok: false, blocker: { code: 'CANONICAL_SOURCE_TRUTH_UNPROVEN' } }),
    liveFactsFn: async () => ({ observedFacts: {} }),
    readinessFn: () => ({
      observedServices: {
        backend: { ready: backend },
        'stephanos-ui': { ready: ui },
        'openclaw-gateway': { ready: openclaw },
        'shared-workspace': { ready: workspace },
      },
      staleWorkspaceRecords: workspace ? [] : ['stale'],
      safetyBlockers,
      finalVerdict: backend && ui && workspace ? 'ready' : 'blocked-needs-supervisor-repair',
    }),
    supervisorReader: () => supervisor,
  });
}

test('healthy live runtime wins over a missing or stale supervisor record', async () => {
  const result = await fixture({
    supervisor: {
      observed: true,
      stale: true,
      observedAtUtc: '2026-10-30T13:42:54Z',
      currentPhase: 'Stephanos UI 4173',
      trafficLight: 'red',
      blockerId: 'stephanos-ui-4173-missing',
      phases: [],
    },
  });
  assert.equal(result.schemaVersion, SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_SCHEMA);
  assert.equal(result.ok, true);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.services.backend8787.ready, true);
  assert.equal(result.services.stephanosUi4173.ready, true);
  assert.equal(result.repairRequired, false);
  assert.equal(result.autoRepairEligible, false);
  assert.equal(result.nextRepairAction, '');
  assert.equal(result.blocker, '');
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_GREEN');
});

test('missing backend selects only the existing exact-head runtime restart', async () => {
  const result = await fixture({ backend: false, ui: false });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'IGNITION_BACKEND_8787_NOT_READY');
  assert.equal(result.autoRepairEligible, true);
  assert.equal(result.nextRepairAction, 'restart-stephanos-runtime');
  assert.equal(result.pcRestartAllowed, false);
  assert.equal(result.arbitraryShellAllowed, false);
});

test('missing UI with healthy prerequisites selects the existing UI repair', async () => {
  const result = await fixture({ ui: false });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'IGNITION_UI_4173_NOT_READY');
  assert.equal(result.autoRepairEligible, true);
  assert.equal(result.nextRepairAction, 'repair-ui-4173');
});

test('UI repair stays held when its existing prerequisites are not proven', async () => {
  const result = await fixture({ ui: false, openclaw: false });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'IGNITION_UI_4173_NOT_READY');
  assert.equal(result.autoRepairEligible, false);
  assert.equal(result.nextRepairAction, '');
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_ATTENTION_REQUIRED');
});

test('source truth failure never grants automatic runtime mutation', async () => {
  const result = await fixture({ sourceOk: false, backend: false, ui: false });
  assert.equal(result.sourceExact, false);
  assert.equal(result.autoRepairEligible, false);
  assert.equal(result.nextRepairAction, '');
  assert.equal(result.blocker, 'IGNITION_SOURCE_UNPROVEN');
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
});

test('dirty source blocks automatic repair even when a runtime target is missing', async () => {
  const result = await fixture({
    backend: false,
    ui: false,
    safetyBlockers: [{ id: 'dirty-source' }],
  });
  assert.equal(result.autoRepairEligible, false);
  assert.equal(result.nextRepairAction, 'restart-stephanos-runtime');
});

test('a fresh supervisor blocker remains visible when live required services are ready', async () => {
  const result = await fixture({
    supervisor: {
      observed: true,
      stale: false,
      observedAtUtc: '2026-10-31T21:29:58Z',
      currentPhase: 'browser/runtime proof',
      trafficLight: 'red',
      blockerId: 'BROWSER_RUNTIME_PROOF_UNPROVEN',
      phases: [],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.blocker, 'BROWSER_RUNTIME_PROOF_UNPROVEN');
  assert.equal(result.repairRequired, false);
  assert.equal(result.nextRepairAction, '');
});

test('public projection contains no raw log or path fields', async () => {
  const result = await fixture({ ui: false });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /logPath|stdout|stderr|C:\\/i);
  assert.equal(result.rawLogsReturned, false);
  assert.equal(result.rawPathsReturned, false);
  assert.equal(result.secretMaterialIncluded, false);
});
