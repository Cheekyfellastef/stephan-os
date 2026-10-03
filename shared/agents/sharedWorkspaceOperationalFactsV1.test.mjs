import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHARED_WORKSPACE_OPERATIONAL_FACTS_STATUS_ID,
  buildSharedWorkspaceOperationalFactsRecord,
  createSharedWorkspaceOperationalFact,
  projectSharedWorkspaceOperationalFacts,
} from './sharedWorkspaceOperationalFactsV1.mjs';
import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';

const MAIN = 'a'.repeat(40);
const NOW_UTC = '2026-10-03T16:40:00.000Z';
const NOW = Date.parse(NOW_UTC);

function headTruth(overrides = {}) {
  return {
    state: 'CURRENT',
    blocker: '',
    githubMainHead: MAIN,
    windowsCheckoutHead: MAIN,
    builtRuntimeHead: MAIN,
    servedRuntimeHead: MAIN,
    syncTaskLastObservedUtc: '2026-10-03T16:38:00.000Z',
    observedAtUtc: '2026-10-03T16:39:00.000Z',
    proofRefs: ['receipts/battle-bridge-github-sync/current.json'],
    windowsProofCoverage: {
      checks: {
        builtRuntime: { observedAtUtc: '2026-10-03T16:38:30.000Z' },
        servedRuntime: { observedAtUtc: '2026-10-03T16:39:00.000Z' },
      },
    },
    ...overrides,
  };
}

function battleBridgeStatus(overrides = {}) {
  return {
    timestampUtc: '2026-10-03T16:39:30.000Z',
    proofRefs: ['proof/battle-bridge-current.json'],
    observedServiceFacts: {
      backend: { ready: true },
      'stephanos-ui': { ready: true },
      'openclaw-gateway': { ready: true },
      'shared-workspace': { ready: true },
    },
    ...overrides,
  };
}

test('builds one reusable current-system facts record from canonical head and service truth', () => {
  const record = buildSharedWorkspaceOperationalFactsRecord({
    headTruth: headTruth(),
    battleBridgeStatus: battleBridgeStatus(),
    timestampUtc: NOW_UTC,
    nowMs: NOW,
  });

  assert.equal(record.statusId, SHARED_WORKSPACE_OPERATIONAL_FACTS_STATUS_ID);
  assert.equal(record.status, 'CURRENT');
  assert.equal(record.factCounts.total, 10);
  assert.equal(record.operationalFacts.find((fact) => fact.factId === 'version.github-main-head').value, MAIN);
  assert.equal(record.operationalFacts.find((fact) => fact.factId === 'version.served-runtime-head').value, MAIN);
  assert.equal(record.operationalFacts.find((fact) => fact.factId === 'service.backend.health').value, 'READY');
  assert.equal(record.operationalFacts.every((fact) => ['CURRENT', 'STALE', 'UNKNOWN'].includes(fact.freshness)), true);
  assert.equal(validateSharedWorkspaceRecord(record, { nowMs: NOW }).valid, true);
});

test('missing head evidence stays UNKNOWN instead of copying a guessed version', () => {
  const record = buildSharedWorkspaceOperationalFactsRecord({
    headTruth: headTruth({
      githubMainHead: '',
      windowsCheckoutHead: '',
      builtRuntimeHead: '',
      servedRuntimeHead: '',
      syncTaskLastObservedUtc: '',
      observedAtUtc: '',
      windowsProofCoverage: { checks: {} },
    }),
    battleBridgeStatus: battleBridgeStatus(),
    timestampUtc: NOW_UTC,
    nowMs: NOW,
  });

  const main = record.operationalFacts.find((fact) => fact.factId === 'version.github-main-head');
  assert.equal(main.value, 'UNKNOWN');
  assert.equal(main.freshness, 'UNKNOWN');
  assert.equal(record.factCounts.unknown >= 4, true);
});

test('projection recomputes stale facts at read time instead of trusting stored freshness', () => {
  const old = createSharedWorkspaceOperationalFact({
    factId: 'version.served-runtime-head',
    label: 'Served runtime head',
    value: MAIN,
    observedAtUtc: '2026-10-03T15:00:00.000Z',
    source: 'fixture',
    proofRefs: ['proof/runtime.json'],
    staleAfterMs: 5 * 60 * 1000,
    nowMs: Date.parse('2026-10-03T15:01:00.000Z'),
  });
  assert.equal(old.freshness, 'CURRENT');

  const projection = projectSharedWorkspaceOperationalFacts({
    statusRecords: [{
      operationalFacts: [old],
    }],
    nowMs: NOW,
  });

  assert.equal(projection.factsById['version.served-runtime-head'].freshness, 'STALE');
  assert.equal(projection.state, 'DEGRADED');
});

test('newer fact wins while older duplicates remain historical evidence only', () => {
  const projection = projectSharedWorkspaceOperationalFacts({
    statusRecords: [
      {
        operationalFacts: [{
          factId: 'runtime.ai-router-mode',
          label: 'AI router mode',
          value: 'legacy',
          observedAtUtc: '2026-10-03T16:00:00.000Z',
          source: 'old',
          proofRefs: ['proof/old.json'],
          staleAfterMs: 60 * 60 * 1000,
        }],
      },
      {
        operationalFacts: [{
          factId: 'runtime.ai-router-mode',
          label: 'AI router mode',
          value: 'brain-router',
          observedAtUtc: '2026-10-03T16:39:00.000Z',
          source: 'new',
          proofRefs: ['proof/new.json'],
          staleAfterMs: 60 * 60 * 1000,
        }],
      },
    ],
    nowMs: NOW,
  });

  assert.equal(projection.factsById['runtime.ai-router-mode'].value, 'brain-router');
  assert.equal(projection.factCounts.total, 1);
});

test('unsafe complex values are not retained as operational facts', () => {
  const fact = createSharedWorkspaceOperationalFact({
    factId: 'runtime.example',
    value: { token: 'do-not-store-complex-material' },
    observedAtUtc: NOW_UTC,
    source: 'fixture',
    nowMs: NOW,
  });
  assert.equal(fact.value, 'UNKNOWN');
  assert.equal(fact.freshness, 'UNKNOWN');
});
