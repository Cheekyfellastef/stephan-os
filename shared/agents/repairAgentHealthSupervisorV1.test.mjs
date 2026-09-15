import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REPAIR_AGENT_SYSTEM_IDS,
  evaluateRepairAgentHealthSupervisorV1,
} from './repairAgentHealthSupervisorV1.mjs';

const HEAD = 'a'.repeat(40);
const NOW = '2026-09-09T08:30:00.000Z';

function healthySystems() {
  return Object.fromEntries(REPAIR_AGENT_SYSTEM_IDS.map((id) => [id, {
    state: 'HEALTHY',
    observedAtUtc: '2026-09-09T08:29:30.000Z',
    sourceHead: ['githubSync', 'postSyncRefresh', 'workerWatchdog', 'missionWorker', 'repairAgentHealthSupervisor'].includes(id) ? HEAD : '',
    crossWatchHealthy: id === 'repairAgentHealthSupervisor' ? true : undefined,
  }]));
}

test('all eight independently healthy produces the only green aggregate verdict', () => {
  const result = evaluateRepairAgentHealthSupervisorV1({
    expectedHead: HEAD,
    observedAtUtc: NOW,
    systems: healthySystems(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.allEightHealthy, true);
  assert.equal(result.classification, 'REPAIR_AGENT_ALL_EIGHT_HEALTHY');
  assert.equal(result.systems.length, 8);
  assert.equal(result.repairCandidates.length, 0);
  assert.equal(result.selfCrossWatchRequired, true);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.sourceMutationAuthority, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('healthy mailbox cannot mask a stale Recovery Mesh', () => {
  const systems = healthySystems();
  systems.recoveryMesh = {
    state: 'HEALTHY',
    observedAtUtc: '2026-09-09T08:20:00.000Z',
    sourceHead: '',
  };

  const result = evaluateRepairAgentHealthSupervisorV1({ expectedHead: HEAD, observedAtUtc: NOW, systems });
  const mailbox = result.systems.find((system) => system.id === 'githubCommandMailbox');
  const mesh = result.systems.find((system) => system.id === 'recoveryMesh');

  assert.equal(mailbox.state, 'HEALTHY');
  assert.equal(mesh.state, 'STALE');
  assert.equal(mesh.repairRequired, true);
  assert.equal(mesh.repairRoute, 'CONTROL_PLANE_SELF_REPAIR');
  assert.equal(result.allEightHealthy, false);
  assert.equal(result.classification, 'REPAIR_AGENT_REPAIR_REQUIRED');
});

test('healthy mailbox and worker cannot mask a missing Recovery Lifeboat', () => {
  const systems = healthySystems();
  delete systems.recoveryLifeboat;

  const result = evaluateRepairAgentHealthSupervisorV1({ expectedHead: HEAD, observedAtUtc: NOW, systems });
  const lifeboat = result.systems.find((system) => system.id === 'recoveryLifeboat');

  assert.equal(lifeboat.state, 'MISSING');
  assert.equal(lifeboat.repairRequired, true);
  assert.equal(lifeboat.repairRoute, 'CONTROL_PLANE_SELF_REPAIR');
  assert.equal(result.allEightHealthy, false);
});

test('System 8 cannot call itself healthy without an independent cross-watch', () => {
  const systems = healthySystems();
  systems.repairAgentHealthSupervisor.crossWatchHealthy = false;

  const result = evaluateRepairAgentHealthSupervisorV1({ expectedHead: HEAD, observedAtUtc: NOW, systems });
  const supervisor = result.systems.find((system) => system.id === 'repairAgentHealthSupervisor');

  assert.equal(supervisor.state, 'DEGRADED');
  assert.equal(supervisor.blocker, 'SYSTEM_8_CROSS_WATCH_UNPROVEN');
  assert.equal(supervisor.repairRoute, 'INDEPENDENT_CROSS_WATCH_RESTORE');
  assert.equal(result.allEightHealthy, false);
});

test('head-bound system on the wrong source is blocked even when its prose state says healthy', () => {
  const systems = healthySystems();
  systems.missionWorker.sourceHead = 'b'.repeat(40);

  const result = evaluateRepairAgentHealthSupervisorV1({ expectedHead: HEAD, observedAtUtc: NOW, systems });
  const worker = result.systems.find((system) => system.id === 'missionWorker');

  assert.equal(worker.state, 'BLOCKED');
  assert.equal(worker.blocker, 'SYSTEM_SOURCE_HEAD_MISMATCH');
  assert.equal(worker.repairRequired, true);
  assert.equal(result.allEightHealthy, false);
});

test('stale head-bound evidence with an unproven source hard-holds before repair routing', () => {
  const systems = healthySystems();
  systems.missionWorker = {
    state: 'HEALTHY',
    observedAtUtc: '2026-09-09T08:00:00.000Z',
    sourceHead: '',
  };

  const result = evaluateRepairAgentHealthSupervisorV1({ expectedHead: HEAD, observedAtUtc: NOW, systems });
  const worker = result.systems.find((system) => system.id === 'missionWorker');

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'REPAIR_AGENT_HEALTH_SUPERVISOR_HARD_HOLD');
  assert.equal(worker.state, 'HARD_HOLD');
  assert.equal(worker.blocker, 'SYSTEM_SOURCE_HEAD_UNPROVEN');
  assert.equal(worker.repairRequired, false);
});

test('malformed health evidence fails closed rather than triggering arbitrary repair', () => {
  const systems = healthySystems();
  systems.recoveryMesh.state = 'TOTALLY_FINE_TRUST_ME';

  const result = evaluateRepairAgentHealthSupervisorV1({ expectedHead: HEAD, observedAtUtc: NOW, systems });
  const mesh = result.systems.find((system) => system.id === 'recoveryMesh');

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'REPAIR_AGENT_HEALTH_SUPERVISOR_HARD_HOLD');
  assert.equal(mesh.state, 'HARD_HOLD');
  assert.equal(mesh.repairRequired, false);
  assert.equal(result.arbitraryShellAllowed, false);
});

test('future-dated surface evidence hard-holds instead of being treated as infinitely fresh', () => {
  const systems = healthySystems();
  systems.githubSync.observedAtUtc = '2026-09-09T08:31:00.000Z';

  const result = evaluateRepairAgentHealthSupervisorV1({ expectedHead: HEAD, observedAtUtc: NOW, systems });
  const sync = result.systems.find((system) => system.id === 'githubSync');

  assert.equal(result.ok, false);
  assert.equal(sync.state, 'HARD_HOLD');
  assert.equal(sync.blocker, 'SYSTEM_HEALTH_TIMESTAMP_FUTURE');
  assert.equal(sync.repairRequired, false);
});

test('a ninth unknown health record is rejected by the closed-world eight-system contract', () => {
  const systems = healthySystems();
  systems.secretNinthController = {
    state: 'HEALTHY',
    observedAtUtc: '2026-09-09T08:29:30.000Z',
    sourceHead: HEAD,
  };

  const result = evaluateRepairAgentHealthSupervisorV1({ expectedHead: HEAD, observedAtUtc: NOW, systems });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'REPAIR_AGENT_HEALTH_SUPERVISOR_BLOCKED');
  assert.equal(result.blocker, 'UNKNOWN_SYSTEM_HEALTH_RECORD');
  assert.equal(result.systems.length, 0);
});

test('current masking incident stays red until Recovery Mesh and Lifeboat have independent fresh truth', () => {
  const systems = healthySystems();
  systems.githubCommandMailbox = {
    state: 'HEALTHY',
    observedAtUtc: '2026-09-09T08:29:35.000Z',
    sourceHead: '',
  };
  systems.recoveryMesh = {
    state: 'DEGRADED',
    observedAtUtc: '2026-09-07T00:55:34.637Z',
    sourceHead: '',
    blocker: 'RECOVERY_MESH_CORE_UNHEALTHY',
  };
  systems.recoveryLifeboat = {
    state: 'HEALTHY',
    observedAtUtc: '2026-09-09T08:14:48.112Z',
    sourceHead: '',
  };

  const result = evaluateRepairAgentHealthSupervisorV1({ expectedHead: HEAD, observedAtUtc: NOW, systems });
  const ids = result.repairCandidates.map((system) => system.id);

  assert.equal(result.allEightHealthy, false);
  assert.equal(ids.includes('recoveryMesh'), true);
  assert.equal(ids.includes('recoveryLifeboat'), true);
  assert.equal(ids.includes('githubCommandMailbox'), false);
});
