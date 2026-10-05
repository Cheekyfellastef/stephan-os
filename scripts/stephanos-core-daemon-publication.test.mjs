import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { projectStephanosCoreDaemonState } from '../shared/agents/stephanosCoreDaemonV1.mjs';
import * as flywheel from '../shared/agents/stephanosCorePersistentFlywheelV1.mjs';
import * as onion from '../shared/agents/stephanosCoreOnionContinuationV1.mjs';
import * as spine from '../shared/agents/stephanosControlPlaneSpineV1.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(join(repoRoot, 'scripts', 'stephanos-core-daemon.mjs'), 'utf8');

// Run the actual publisher and initial telemetry declarations without loading
// the daemon entrypoint, acquiring its lock, or starting autonomous work.
function sourceChunk(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, 'publisher source boundaries must exist');
  return source.slice(startIndex, endIndex);
}

function isolatedPublisher(workspaceRoot) {
  const context = vm.createContext({
    Object, String, Promise, Date, process: { pid: process.pid },
    repoRoot, workspaceRoot,
    FLYWHEEL_FALLBACK_MS: flywheel.DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS,
    TARGET_MATERIAL_LANES: 15,
    OCTOPUS_SELF_HEAL_COOLDOWN_MS: flywheel.DEFAULT_OCTOPUS_SELF_HEAL_COOLDOWN_MS,
    DEPENDENCY_SELF_HEAL_COOLDOWN_MS: 120000,
    OCTOPUS_SELF_HEAL_ACTION_ID: 'repair-goal-builder-flow',
    RELATED_ISSUE: '#2593',
    PROOF_REF: 'proof/stephanos-core-daemon-current.json',
    ...flywheel, ...onion, ...spine,
    createSharedWorkspaceProofRecord,
    createSharedWorkspaceStatusRecord,
    ensureSharedWorkspaceLayout,
    writeAtomicJson,
  });
  vm.runInContext([
    sourceChunk('let flywheelCycleRunning =', 'async function runBoundedDependencyMaintenance'),
    sourceChunk('function persistentFlywheelStatus()', 'async function maybeStartPersistentFlywheel'),
    sourceChunk('async function publish(', 'async function sample('),
  ].join('\n'), context);
  return context;
}

test('Core publisher atomically writes valid status and proof for startup, degraded and reload states', async () => {
  const tempParent = resolve(tmpdir());
  const root = await mkdtemp(join(tempParent, 'stephanos-core-publish-test-'));
  try {
    const context = isolatedPublisher(root);
    const ready = projectStephanosCoreDaemonState({
      sourceHead: '237fd54f7c33798515b20efd344ea8864aff30ab',
      sovereignCommanderHealthy: true, backendHealthy: true,
      missionWorkerHeartbeatAgeMs: 0, gamingActive: false,
    });
    const states = [
      ready,
      projectStephanosCoreDaemonState({ ...ready, backendHealthy: false }),
      { ...ready, readiness: 'RELOAD_REQUIRED', finalVerdict: 'STEPHANOS_CORE_DAEMON_SOURCE_ADVANCED' },
    ];
    for (const [index, state] of states.entries()) {
      const timestampUtc = new Date(Date.parse('2026-10-05T19:00:00Z') + index * 15000).toISOString();
      await context.publish(state, timestampUtc);
      for (const directory of ['status', 'proof']) {
        const record = JSON.parse(await readFile(join(root, directory, 'stephanos-core-daemon-current.json'), 'utf8'));
        assert.equal(record.schemaVersion, 'shared-agent-workspace-record.v1');
        assert.equal(record.controlPlaneSchemaVersion, 'stephanos.control-plane-spine.v1');
        assert.equal(record.timestampUtc, timestampUtc);
        assert.equal(record.sourceHead, ready.sourceHead);
        assert.equal(record.readiness, state.readiness);
        assert.equal(record.logicalLaneTruth, 'UNKNOWN');
        assert.equal(record.logicalControllerCount, 0);
        assert.equal(record.logicalLaneDeficitToTarget, null);
        assert.equal(record.sourceMutationAllowed, false);
        assert.equal(record.mergeAuthority, false);
        const validation = validateSharedWorkspaceRecord(record);
        assert.equal(validation.valid, true, validation.errors.join(','));
        assert.deepEqual(await readdir(join(root, directory)), ['stephanos-core-daemon-current.json']);
      }
    }
  } finally {
    assert.equal(dirname(root), tempParent);
    assert.ok(basename(root).startsWith('stephanos-core-publish-test-'));
    await rm(root, { recursive: true, force: true });
  }
});

test('Core publisher refuses secret-bearing telemetry without replacing prior status or proof', async () => {
  const tempParent = resolve(tmpdir());
  const root = await mkdtemp(join(tempParent, 'stephanos-core-publish-test-'));
  try {
    const context = isolatedPublisher(root);
    const state = projectStephanosCoreDaemonState({
      sourceHead: '237fd54f7c33798515b20efd344ea8864aff30ab',
      sovereignCommanderHealthy: true, backendHealthy: true,
      missionWorkerHeartbeatAgeMs: 0,
    });
    await context.publish(state, '2026-10-05T19:00:00.000Z');
    const paths = ['status', 'proof'].map((directory) => join(root, directory, 'stephanos-core-daemon-current.json'));
    const before = await Promise.all(paths.map((path) => readFile(path, 'utf8')));
    await assert.rejects(
      context.publish(state, '2026-10-05T19:00:15.000Z', {
        ...context.persistentFlywheelStatus(), logicalSessionToken: 'sentinel',
      }),
      /STEPHANOS_CORE_DAEMON_HEARTBEAT_WRITE_FAILED/,
    );
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, 'utf8'))), before);
  } finally {
    assert.equal(dirname(root), tempParent);
    assert.ok(basename(root).startsWith('stephanos-core-publish-test-'));
    await rm(root, { recursive: true, force: true });
  }
});
