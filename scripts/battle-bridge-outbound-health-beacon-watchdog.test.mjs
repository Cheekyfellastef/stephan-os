import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectBeaconStatus,
  projectWorkerWatchdogBeaconFacts,
} from './battle-bridge-outbound-health-beacon.mjs';

const HEAD = 'a'.repeat(40);
const NOW = Date.parse('2026-09-01T04:30:30.000Z');
const SPEC = Object.freeze({ id: 'workerWatchdog', staleAfterMs: 180_000 });

function failedWatchdog(overrides = {}) {
  return {
    timestampUtc: '2026-09-01T04:30:00.000Z',
    classification: 'WORKER_WATCHDOG_START_FAILED',
    restartBlocker: 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
    restartSourceHead: HEAD,
    restartVerdict: 'APPROVED_RUNTIME_RESTART_BLOCKED',
    restartAttempted: true,
    restartExactHeadProofOk: false,
    restartProofFresh: false,
    supervisorDetectedWorkerDown: true,
    supervisorRestartedWorker: true,
    workerRecovered: false,
    workerFromMain: false,
    probeError: 'C:/private/path should never be projected',
    initialAssessment: {
      canonicalRepositoryHead: HEAD,
      taskActionMatchesCanonicalWorker: true,
      heartbeatAgeMs: 999_999,
    },
    finalAssessment: {
      sourceHead: HEAD,
      processHealthy: false,
      processLaunchIdentityVerified: false,
      heartbeatFresh: false,
      heartbeatAgeMs: 999_999,
    },
    ...overrides,
  };
}

test('watchdog telemetry exposes only bounded exact-head restart facts and the typed blocker', () => {
  const facts = projectWorkerWatchdogBeaconFacts(failedWatchdog(), HEAD);
  assert.equal(facts.classification, 'WORKER_WATCHDOG_START_FAILED');
  assert.equal(facts.restartBlocker, 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT');
  assert.equal(facts.restartVerdict, 'APPROVED_RUNTIME_RESTART_BLOCKED');
  assert.equal(facts.sourceHead, HEAD);
  assert.equal(facts.expectedHead, HEAD);
  assert.equal(facts.exactHeadMatch, true);
  assert.equal(facts.taskActionMatchesCanonicalWorker, true);
  assert.equal(facts.restartAttempted, true);
  assert.equal(facts.workerRecovered, false);
  assert.equal(facts.exactNextAction, 'REPAIR_TYPED_MISSION_WORKER_RESTART_BLOCKER');
  assert.equal(facts.rawErrorPublished, false);
  assert.doesNotMatch(JSON.stringify(facts), /private|probeError/i);

  const projected = projectBeaconStatus(failedWatchdog(), SPEC, NOW, HEAD);
  assert.equal(projected.state, 'WORKER_WATCHDOG_START_FAILED');
  assert.equal(projected.rawState, 'WORKER_WATCHDOG_START_FAILED');
  assert.equal(projected.head, HEAD);
  assert.equal(projected.blocker, 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT');
  assert.equal(projected.workerWatchdogFacts.exactHeadMatch, true);
  assert.doesNotMatch(JSON.stringify(projected), /private|probeError/i);
});

test('watchdog telemetry fails closed for unallowlisted or ambiguous-looking restart text', () => {
  const record = failedWatchdog({
    restartBlocker: 'MISSION_WORKER_ATTACKER_SELECTED',
    restartVerdict: 'attacker-controlled-verdict',
    restartSourceHead: 'not-a-sha',
  });
  const facts = projectWorkerWatchdogBeaconFacts(record, HEAD);
  assert.equal(facts.restartBlocker, '');
  assert.equal(facts.restartVerdict, '');
  assert.equal(facts.sourceHead, HEAD);
  assert.equal(facts.exactHeadMatch, true);
  assert.equal(facts.exactNextAction, 'READ_WATCHDOG_FAILURE_BOUNDARY');

  const projected = projectBeaconStatus(record, SPEC, NOW, HEAD);
  assert.equal(projected.blocker, 'WORKER_WATCHDOG_START_FAILED');
  assert.doesNotMatch(JSON.stringify(projected), /ATTACKER_SELECTED|attacker-controlled/i);
});
