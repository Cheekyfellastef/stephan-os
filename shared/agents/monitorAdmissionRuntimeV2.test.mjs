import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MONITOR_ADMISSION_ENVELOPE_VERSION,
  MONITOR_ADMISSION_OPERATIONS,
  MONITOR_ADMISSION_PROPOSAL_VERSION,
} from './monitorAdmissionBridge.mjs';
import {
  admitLogicalMonitorWithRuntimeV2,
  buildMonitorRuntimeProjectionV2,
  isLogicalControllerPulseProposalV2,
  loadMonitorAdmissionRegistryV2,
  runMonitorAdmissionRuntimeV2,
} from './monitorAdmissionRuntimeV2.mjs';

const NOW = Date.parse('2026-09-19T18:30:00.000Z');
const OWNER = 'stephan';
const CLAIMS_HASH = 'a'.repeat(64);
const root = () => mkdtemp(join(tmpdir(), 'monitor-runtime-v2-'));

function controllerRequest(overrides = {}, proposalOverrides = {}) {
  return {
    schemaVersion: MONITOR_ADMISSION_ENVELOPE_VERSION,
    operation: MONITOR_ADMISSION_OPERATIONS.UPSERT,
    owner: OWNER,
    claimsHash: CLAIMS_HASH,
    requestId: 'controller-pulse-request-1',
    issuedAtUtc: '2026-09-19T18:29:00.000Z',
    expiresAtUtc: '2026-09-19T18:35:00.000Z',
    idempotencyKey: 'controller-pulse-intent-1',
    proposal: {
      schemaVersion: MONITOR_ADMISSION_PROPOSAL_VERSION,
      monitorId: 'controller-openclaw',
      idempotencyKey: 'controller-pulse-intent-1',
      handlerType: 'SCHEDULED_SUMMARY',
      boundedSubject: {
        topic: 'OpenClaw autonomy construction front',
        scope: 'controller:openclaw-autonomy',
      },
      schedule: {
        intervalMs: 60_000,
        nextDueUtc: '2026-09-19T18:30:00.000Z',
      },
      mode: 'RECURRING',
      notificationPolicy: 'STATE_CHANGE',
      relatedIssueOrGoal: '#1657',
      enabled: true,
      proofRefs: ['proof/controller-openclaw.json'],
      ...proposalOverrides,
    },
    ...overrides,
  };
}

function options(workspace, nowMs = NOW) {
  return {
    root: workspace,
    repoRoot: process.cwd(),
    authenticatedPrincipal: { subject: OWNER, claimsHash: CLAIMS_HASH },
    nowMs,
  };
}

test('V2 recognises a bounded scheduled-summary controller pulse without adding authority', () => {
  const proposal = controllerRequest().proposal;
  assert.equal(isLogicalControllerPulseProposalV2(proposal), true);
  assert.equal(isLogicalControllerPulseProposalV2({ ...proposal, boundedSubject: { ...proposal.boundedSubject, scope: 'summary:ordinary' } }), false);
});

test('V2 converts the old fail-closed admission into durable READY only after the runtime can re-read it', async () => {
  const workspace = await root();
  const result = await admitLogicalMonitorWithRuntimeV2(controllerRequest(), options(workspace));
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'MULTIPLEXER_ADMISSION_READY');
  assert.equal(result.runtimeConsumerProven, true);
  assert.equal(result.externalTaskSlotsRequired, 1);
  assert.equal(result.receipt.verdict, 'MULTIPLEXER_ADMISSION_READY');

  const durable = JSON.parse(await readFile(join(workspace, 'receipts', `${result.receipt.receiptId}.json`), 'utf8'));
  assert.equal(durable.verdict, 'MULTIPLEXER_ADMISSION_READY');
  assert.equal(durable.sourceMutationAllowed, false);
  assert.equal(durable.mergeAuthority, false);
});

test('runtime projection exposes many logical controllers through one external task slot', async () => {
  const workspace = await root();
  await admitLogicalMonitorWithRuntimeV2(controllerRequest(), options(workspace));
  await admitLogicalMonitorWithRuntimeV2(controllerRequest({
    requestId: 'controller-pulse-request-2',
    idempotencyKey: 'controller-pulse-intent-2',
  }, {
    monitorId: 'controller-vr',
    idempotencyKey: 'controller-pulse-intent-2',
    boundedSubject: { topic: 'VR research and Battle Bridge front', scope: 'controller:vr-research' },
    relatedIssueOrGoal: '#1596',
  }), options(workspace));

  const loaded = await loadMonitorAdmissionRegistryV2(options(workspace));
  assert.equal(loaded.ok, true);
  const projection = buildMonitorRuntimeProjectionV2(loaded.registry);
  assert.equal(projection.monitorCount, 2);
  assert.equal(projection.logicalControllerCount, 2);
  assert.equal(projection.externalTaskSlotsRequired, 1);
  assert.equal(projection.maximumConcurrency, 16);
  assert.equal(projection.sourceMutationAllowed, false);
});

test('controller pulses produce a fresh batched outbox notification on each due cycle', async () => {
  const workspace = await root();
  await admitLogicalMonitorWithRuntimeV2(controllerRequest(), options(workspace));

  const first = await runMonitorAdmissionRuntimeV2({
    root: workspace,
    repoRoot: process.cwd(),
    nowMs: NOW,
    timestampUtc: new Date(NOW).toISOString(),
  });
  assert.equal(first.ok, true);
  assert.equal(first.logicalControllerCount, 1);
  assert.equal(first.externalTaskSlotsRequired, 1);
  assert.equal(first.tick.notificationRecords.length, 1);
  assert.equal(first.tick.registryStatus.notificationSurface, 'chatgpt-task-outbox');

  const secondNow = NOW + 61_000;
  const second = await runMonitorAdmissionRuntimeV2({
    root: workspace,
    repoRoot: process.cwd(),
    nowMs: secondNow,
    timestampUtc: new Date(secondNow).toISOString(),
  });
  assert.equal(second.ok, true);
  assert.equal(second.tick.notificationRecords.length, 1);
  assert.notEqual(second.tick.notificationRecords[0].messageId, first.tick.notificationRecords[0].messageId);
});

test('malformed or missing durable registry never fabricates a live runtime', async () => {
  const workspace = await root();
  const loaded = await loadMonitorAdmissionRegistryV2(options(workspace));
  assert.equal(loaded.ok, false);
  assert.equal(loaded.reason, 'MONITOR_ADMISSION_REGISTRY_NOT_FOUND');

  const result = await runMonitorAdmissionRuntimeV2({ root: workspace, repoRoot: process.cwd(), nowMs: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'MONITOR_ADMISSION_RUNTIME_BLOCKED');
});
