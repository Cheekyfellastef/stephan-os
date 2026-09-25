import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createProviderNeutralDispatchBaton,
  listProviderNeutralDispatchBatonCandidates,
  persistProviderNeutralDispatchBaton,
  readProviderNeutralDispatchBaton,
  PROVIDER_NEUTRAL_DISPATCH_BATON_BODY_SCHEMA,
} from './providerNeutralDispatchBatonV1.mjs';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const NOW = '2026-09-25T15:20:00.000Z';
const JOB = 'codex-job-11111111111111111111';

function input(overrides = {}) {
  return {
    dispatchJobId: JOB,
    requestId: 'provider-neutral-baton-test',
    repository: 'Cheekyfellastef/stephan-os',
    expectedHead: HEAD,
    issueNumber: 2002,
    timestampUtc: NOW,
    selectedRoute: {
      routeId: 'openclaw-capacity-current',
      adapterId: 'openclaw-local',
      providerFamily: 'OPENCLAW',
      workerId: 'openclaw-worker-1',
      capacityReceiptId: 'openclaw-capacity-current',
      proofRefs: ['proof/openclaw-capacity-current'],
    },
    proofRefs: ['proof/openclaw-capacity-current'],
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-provider-baton-'));
  const repoRoot = await mkdtemp(join(tmpdir(), 'stephanos-provider-baton-repo-'));
  return { root, repoRoot };
}

test('builds a zero-authority baton keyed by durable exact handoff identity', () => {
  const baton = createProviderNeutralDispatchBaton(input());
  assert.equal(baton.ok, true);
  assert.match(baton.batonId, /^provider-baton-[0-9a-f]{24}$/);
  assert.equal(baton.record.correlationId, JOB);
  assert.equal(baton.record.fromParticipantId, 'codex-dispatch');
  assert.equal(baton.record.toParticipantId, 'provider-router');
  assert.equal(baton.body.schemaVersion, PROVIDER_NEUTRAL_DISPATCH_BATON_BODY_SCHEMA);
  assert.equal(baton.body.dispatchJobId, JOB);
  assert.equal(baton.body.expectedHead, HEAD);
  assert.equal(baton.body.providerExecutionStarted, false);
  assert.equal(baton.body.resultReadbackOperation, '');
  assert.equal(Object.values(baton.body.authority).every((value) => value === false), true);

  const rebuilt = createProviderNeutralDispatchBaton(input({ expectedHead: OTHER_HEAD }));
  assert.notEqual(rebuilt.batonId, baton.batonId);
  assert.notEqual(rebuilt.body.expectedHead, baton.body.expectedHead);

  const sameExactHandoff = createProviderNeutralDispatchBaton(input({ timestampUtc: '2026-09-25T15:23:00.000Z' }));
  assert.equal(sameExactHandoff.batonId, baton.batonId);
});

test('accepts canonical provider planner routes with a singular proofRef', () => {
  const route = {
    routeId: 'openclaw-planner-route',
    adapterId: 'openclaw-local',
    providerFamily: 'OPENCLAW',
    proofRef: 'proof/openclaw-planner-route',
  };
  const baton = createProviderNeutralDispatchBaton(input({
    selectedRoute: route,
    proofRefs: undefined,
  }));
  assert.equal(baton.ok, true);
  assert.deepEqual(baton.body.selectedRoute.proofRefs, ['proof/openclaw-planner-route']);
  assert.equal(baton.body.selectedRoute.capacityReceiptId, 'openclaw-planner-route');
});

test('persists and recovers the same provider-neutral baton after the caller disappears', async () => {
  const f = await fixture();
  try {
    const persisted = await persistProviderNeutralDispatchBaton(f.root, input(), { repoRoot: f.repoRoot });
    assert.equal(persisted.ok, true);
    assert.equal(persisted.alreadyPresent, false);
    assert.equal(persisted.finalVerdict, 'PROVIDER_NEUTRAL_DISPATCH_BATON_PERSISTED');

    const recovered = await readProviderNeutralDispatchBaton(f.root, JOB, { repoRoot: f.repoRoot, requestId: input().requestId, expectedHead: HEAD });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.finalVerdict, 'PROVIDER_NEUTRAL_DISPATCH_BATON_RECOVERED');
    assert.equal(recovered.body.dispatchJobId, JOB);
    assert.equal(recovered.body.expectedHead, HEAD);
    assert.equal(recovered.body.selectedRoute.providerFamily, 'OPENCLAW');
    assert.equal(recovered.body.providerExecutionStarted, false);

    const onDisk = JSON.parse(await readFile(persisted.path, 'utf8'));
    assert.equal(onDisk.handoffId, persisted.batonId);
    assert.equal(JSON.parse(onDisk.body).dispatchJobId, JOB);
  } finally {
    await rm(f.root, { recursive: true, force: true });
    await rm(f.repoRoot, { recursive: true, force: true });
  }
});

test('same baton write is idempotent while conflicting rewrite fails closed', async () => {
  const f = await fixture();
  try {
    const first = await persistProviderNeutralDispatchBaton(f.root, input(), { repoRoot: f.repoRoot });
    assert.equal(first.ok, true);

    const same = await persistProviderNeutralDispatchBaton(
      f.root,
      input({ timestampUtc: '2026-09-25T15:22:00.000Z' }),
      { repoRoot: f.repoRoot },
    );
    assert.equal(same.ok, true);
    assert.equal(same.alreadyPresent, true);
    assert.equal(same.finalVerdict, 'PROVIDER_NEUTRAL_DISPATCH_BATON_ALREADY_PRESENT');

    const conflict = await persistProviderNeutralDispatchBaton(
      f.root,
      input({
        selectedRoute: {
          ...input().selectedRoute,
          routeId: 'openclaw-capacity-conflict',
          capacityReceiptId: 'openclaw-capacity-conflict',
          proofRefs: ['proof/openclaw-capacity-conflict'],
        },
        proofRefs: ['proof/openclaw-capacity-conflict'],
      }),
      { repoRoot: f.repoRoot },
    );
    assert.equal(conflict.ok, false);
    assert.equal(conflict.blocker, 'PROVIDER_NEUTRAL_BATON_CONFLICT');

    const recovered = await readProviderNeutralDispatchBaton(f.root, JOB, { repoRoot: f.repoRoot, requestId: input().requestId, expectedHead: HEAD });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.body.expectedHead, HEAD);
  } finally {
    await rm(f.root, { recursive: true, force: true });
    await rm(f.repoRoot, { recursive: true, force: true });
  }
});

test('workspace boundary and malformed baton input fail closed', async () => {
  const f = await fixture();
  try {
    assert.equal(createProviderNeutralDispatchBaton(input({ dispatchJobId: 'bad' })).blocker, 'PROVIDER_NEUTRAL_BATON_JOB_ID_INVALID');
    assert.equal(createProviderNeutralDispatchBaton(input({ expectedHead: 'bad' })).blocker, 'PROVIDER_NEUTRAL_BATON_EXPECTED_HEAD_INVALID');
    assert.equal(createProviderNeutralDispatchBaton(input({
      selectedRoute: { ...input().selectedRoute, proofRefs: [] },
      proofRefs: [],
    })).blocker, 'PROVIDER_NEUTRAL_BATON_ROUTE_INVALID');

    const inside = await persistProviderNeutralDispatchBaton(f.repoRoot, input(), { repoRoot: f.repoRoot });
    assert.equal(inside.ok, false);
    assert.equal(inside.blocker, 'WORKSPACE_PATH_INSIDE_REPOSITORY');
  } finally {
    await rm(f.root, { recursive: true, force: true });
    await rm(f.repoRoot, { recursive: true, force: true });
  }
});

test('fresh process can discover stranded baton candidates without authorizing duplicate dispatch', async () => {
  const f = await fixture();
  try {
    const first = await persistProviderNeutralDispatchBaton(f.root, input(), { repoRoot: f.repoRoot });
    assert.equal(first.ok, true);
    const secondJob = 'codex-job-22222222222222222222';
    const second = await persistProviderNeutralDispatchBaton(
      f.root,
      input({
        dispatchJobId: secondJob,
        requestId: 'provider-neutral-baton-test-2',
        timestampUtc: '2026-09-25T15:21:00.000Z',
      }),
      { repoRoot: f.repoRoot },
    );
    assert.equal(second.ok, true);

    await writeFile(join(f.root, 'outbox', 'provider-baton-ffffffffffffffffffffffff.json'), '{not-json', 'utf8');

    const discovered = await listProviderNeutralDispatchBatonCandidates(
      f.root,
      { repoRoot: f.repoRoot, maxResults: 10 },
    );
    assert.equal(discovered.ok, true);
    assert.equal(discovered.finalVerdict, 'PROVIDER_NEUTRAL_DISPATCH_BATON_CANDIDATES_READY');
    assert.equal(discovered.candidates.length, 2);
    assert.equal(discovered.invalidCount, 1);
    assert.equal(discovered.automaticRedispatchAllowed, false);
    assert.equal(discovered.candidates[0].dispatchJobId, secondJob);
    assert.equal(discovered.candidates[0].providerExecutionStarted, false);
    assert.equal(discovered.candidates[0].automaticRedispatchAllowed, false);
    assert.match(discovered.candidates[0].exactNextAction, /durable execution receipt/);
    assert.equal(discovered.candidates[1].dispatchJobId, JOB);
  } finally {
    await rm(f.root, { recursive: true, force: true });
    await rm(f.repoRoot, { recursive: true, force: true });
  }
});