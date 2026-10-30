import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as preparation from './supervisedR7RecoveryPreparationV1.mjs';

// Executes the actual candidate fence-service source. The external canonical
// stores/host observations are explicit test doubles, NOT Battle Bridge proof.
const source = await readFile(new URL('./originalSourceAttemptFenceService.js', import.meta.url), 'utf8');
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const now = () => Date.parse('2026-10-24T10:30:00.000Z');
async function loadService() {
  let attemptedWrites = 0;
  const forbidden = () => { attemptedWrites++; throw new Error('TEST_UNEXPECTED_WRITE'); };
  const builtin = { 'node:crypto': { createHash }, 'node:fs/promises': { readFile },
    'node:path': { resolve: (...parts) => parts.join('/') } };
  const module = new vm.SourceTextModule(source, { identifier: 'candidate-fence-service' });
  await module.link(async specifier => {
    let exports;
    if (specifier === './supervisedR7RecoveryPreparationV1.mjs') exports = preparation;
    else if (specifier === './supervisedR7RecoveryRuntime.js') exports = {
      SUPERVISED_R7_FENCE_SCHEMA: 'stephanos.supervised-r7-retirement-fence.v1',
      supervisedR7FenceBindsLease: () => false,
      readSupervisedRecoverySourceHead: () => { throw new Error('TEST_RUNTIME_READER_UNAVAILABLE'); },
      readSupervisedRecoveryMaintenance: () => { throw new Error('TEST_RUNTIME_READER_UNAVAILABLE'); },
      prepareRuntimeSupervisedR7: forbidden, readRuntimeSupervisedR7Packet: forbidden,
      authenticateRuntimeSupervisedR7: forbidden, verifyRuntimeSupervisedR7Fence: forbidden, supervisedRecoveryDigest: digest,
    };
    else if (builtin[specifier]) exports = builtin[specifier];
    else if (specifier === './missionOrchestratorStore.js') exports = { readMissionRecord: forbidden, appendMissionEvent: forbidden, runWithMissionStatePrecondition: forbidden };
    else if (specifier === './programmeAuthorityService.js') exports = { readSourceMutationLease: forbidden, withOriginalSourceLeaseFenceGuard: forbidden };
    else if (specifier.endsWith('/executionReceiptV1.mjs')) exports = { readExecutionReceiptHistory: forbidden };
    else if (specifier === './legacyOriginalSourceOrphanQuarantineV1.js') exports = { authenticateLegacyOrphanQuarantine: forbidden };
    else if (specifier === './missionOrchestratorWorkerService.js') exports = { resolveMissionWorkerQueueRoot: env => env.STEPHANOS_MISSION_WORKER_QUEUE_DIR || '' };
    else if (specifier === './elasticPrHeadLeaseService.js') exports = {
      exactElasticPrHeadIdentity: state => ({ repository: state.repository, issueNumber: 2962,
        prNumber: state.pullRequest.number, branch: state.git.branch, headSha: state.pullRequest.headSha }),
      originalMissionHasQueuedWork: forbidden, readOriginalSourceExecutionIdV1: forbidden,
    };
    else throw new Error(`Unexpected dependency ${specifier}`);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    });
  });
  await module.evaluate();
  return { api: module.namespace, writes: () => attemptedWrites };
}
function fixture() {
  const mission = { missionId: 'critical-2962-elastic-goal', revision: 7,
    repository: 'Cheekyfellastef/stephan-os', currentPhase: 'REPAIR_REQUIRED',
    dispatch: { status: 'complete' }, git: { branch: 'openclaw/elastic-goal-2962', worktreePath: '/owned/test-worktree' },
    pullRequest: { number: 2987, headSha: 'a'.repeat(40) } };
  const lease = { leaseId: `${mission.missionId}-r7-lease`, laneId: mission.missionId,
    repository: mission.repository, issueNumber: 2962, prNumber: 2987,
    branch: mission.git.branch, headSha: mission.pullRequest.headSha, ownerId: 'mission-worker' };
  const input = { requestId: 'supervised-r7-integration', commandId: 'supervised-r7-integration-command',
    sourceRevision: 'b'.repeat(40), originalLeaseDigest: digest(lease) };
  const target = { repository: mission.repository, missionId: mission.missionId, revision: 7,
    leaseId: lease.leaseId, originalLeaseDigest: input.originalLeaseDigest, issueNumber: 2962, prNumber: 2987,
    branch: lease.branch, headSha: lease.headSha, worktreePath: mission.git.worktreePath, sourceRevision: input.sourceRevision };
  const observation = { schemaVersion: 'stephanos.supervised-r7-maintenance-observation.v1', target,
    observedAtUtc: '2026-10-24T10:29:59.000Z', expiresAtUtc: '2026-10-24T10:31:00.000Z',
    preservationVerified: true, preservationDigest: 'c'.repeat(64), maintenanceDigest: 'd'.repeat(64),
    originalExecutionStopped: true, staleQueueResumePrevented: true, stalePublicationPrevented: true,
    conflictingWriterObserved: false, unexplainedMutationObserved: false };
  const calls = [];
  const options = { paths: { workspaceRoot: '/shared', repoRoot: '/repo', orchestratorRoot: '/missions' },
    env: { STEPHANOS_MISSION_WORKER_QUEUE_DIR: '/queues' }, now,
    readRepositorySourceHead: async root => { calls.push(['head', root]); return input.sourceRevision; },
    readSupervisedRecoveryMaintenance: async () => { calls.push(['maintenance']); return observation; },
    readMissionRecord: async (id, opts) => { calls.push(['mission', id, opts.root]); return { state: mission }; },
    readSourceMutationLease: async opts => { calls.push(['lease', opts.root]); return {
      ok: true, record: lease, validation: { valid: true, stale: true, active: false } }; },
    originalMissionHasQueuedWork: async opts => { calls.push(['queues', opts.missionId]); return false; },
  };
  return { input, options, calls, observation, mission, lease };
}
test('existing fence service prepares through canonical readers and performs no mutations', async () => {
  const f = fixture(), { api, writes } = await loadService();
  const p = await api.prepareSupervisedOriginalSourceRecovery(f.input, f.options);
  assert.equal(p.packet.target.leaseId, f.lease.leaseId);
  assert.equal(p.packet.leaseReleaseAuthority, false);
  for (const operation of ['head', 'mission', 'lease', 'queues', 'maintenance'])
    assert.equal(f.calls.filter(c => c[0] === operation).length, 2, operation);
  assert.ok(f.calls.filter(c => c[0] === 'mission').every(c => c[1] === f.mission.missionId && c[2] === '/missions'));
  assert.equal(writes(), 0);
});
for (const missing of ['readRepositorySourceHead', 'readSupervisedRecoveryMaintenance']) {
  test(`missing ${missing} cannot fall back to fabricated observation`, async () => {
    const f = fixture(), { api, writes } = await loadService(); delete f.options[missing];
    await assert.rejects(api.prepareSupervisedOriginalSourceRecovery(f.input, f.options), /TEST_RUNTIME_READER_UNAVAILABLE/);
    assert.equal(writes(), 0);
  });
}
for (const missing of ['workspaceRoot', 'repoRoot', 'orchestratorRoot']) {
  test(`missing canonical ${missing} holds`, async () => {
    const f = fixture(), { api, writes } = await loadService(); delete f.options.paths[missing];
    await assert.rejects(api.prepareSupervisedOriginalSourceRecovery(f.input, f.options), /CANONICAL_PATHS_UNPROVEN/);
    assert.equal(writes(), 0);
  });
}
test('missing queue root is not interpreted as idle queues', async () => {
  const f = fixture(), { api, writes } = await loadService(); f.options.env = {};
  await assert.rejects(api.prepareSupervisedOriginalSourceRecovery(f.input, f.options), /MAINTENANCE_UNPROVEN/);
  assert.equal(writes(), 0);
});
test('canonical read failure propagates and does not invoke repair, cancellation or release', async () => {
  const f = fixture(), { api, writes } = await loadService();
  f.options.readSourceMutationLease = async () => { throw new Error('TEST_CANONICAL_STORE_UNAVAILABLE'); };
  await assert.rejects(api.prepareSupervisedOriginalSourceRecovery(f.input, f.options), /TEST_CANONICAL_STORE_UNAVAILABLE/);
  assert.equal(writes(), 0);
});
test('prepared packet is not accepted by the existing strict lease-fence verifier', async () => {
  const f = fixture(), { api, writes } = await loadService();
  const p = await api.prepareSupervisedOriginalSourceRecovery(f.input, f.options);
  assert.equal(api.originalSourceFenceBindsLease(p.packet, f.lease), false);
  assert.equal(writes(), 0);
});
test('ordinary cancellation still invokes the existing canonical store, not a new implementation', async () => {
  const f = fixture(), { api, writes } = await loadService();
  await assert.rejects(api.quarantineOriginalSourceAttempt({ missionId: f.mission.missionId,
    commandId: f.input.commandId, operatorRequestId: f.input.requestId,
    operatorSourceRevision: f.input.sourceRevision, expectedMissionRevision: 7,
    originalLeaseId: f.lease.leaseId, originalLeaseDigest: f.input.originalLeaseDigest,
  }, f.options), /TEST_UNEXPECTED_WRITE/);
  assert.equal(writes(), 1); // test double was reached; no canonical store exists here.
});
