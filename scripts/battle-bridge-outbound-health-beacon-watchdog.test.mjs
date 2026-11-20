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
  // An explicitly malformed restart head must NOT fall back to older evidence.
  assert.equal(facts.sourceHead, '');
  assert.equal(facts.exactHeadMatch, false);
  assert.equal(facts.exactNextAction, 'READ_WATCHDOG_FAILURE_BOUNDARY');

  const projected = projectBeaconStatus(record, SPEC, NOW, HEAD);
  assert.equal(projected.blocker, 'WORKER_WATCHDOG_START_FAILED');
  assert.doesNotMatch(JSON.stringify(projected), /ATTACKER_SELECTED|attacker-controlled/i);
});

test('typed original watchdog Inspect failure reaches beacon without leaking private process errors', () => {
  const cases = [
    {
      label: 'timed out fixed 5-second Inspect',
      probeError: 'spawnSync C:\\private\\powershell.exe ETIMEDOUT',
      code: 'WATCHDOG_INSPECT_TIMEOUT',
      action: 'QUALIFY_WATCHDOG_INSPECT_LATENCY',
    },
    {
      label: 'missing canonical executable',
      probeError: 'spawnSync C:\\private\\powershell.exe ENOENT',
      code: 'WATCHDOG_INSPECT_EXECUTABLE_MISSING',
      action: 'VERIFY_CANONICAL_POWERSHELL_PROBE_PATH',
    },
    {
      label: 'unexpected JSON output',
      probeError: 'Worker watchdog probe returned invalid JSON.',
      code: 'WATCHDOG_INSPECT_INVALID_JSON',
      action: 'REPAIR_WATCHDOG_PROBE_JSON_BOUNDARY',
    },
    {
      label: 'ambiguous competing error codes',
      probeError: 'C:\\private ETIMEDOUT ENOENT',
      code: 'WATCHDOG_INSPECT_CAUSE_UNPROVEN',
      action: 'READ_WATCHDOG_FAILURE_BOUNDARY',
    },
    {
      label: 'unrecognized script exception',
      probeError: 'C:\\private\\user\\secret\\custom-error',
      code: 'WATCHDOG_INSPECT_CAUSE_UNPROVEN',
      action: 'READ_WATCHDOG_FAILURE_BOUNDARY',
    },
    {
      label: 'oversized private diagnostic',
      probeError: 'ETIMEDOUT' + 'x'.repeat(2048),
      code: 'WATCHDOG_INSPECT_CAUSE_UNPROVEN',
      action: 'READ_WATCHDOG_FAILURE_BOUNDARY',
    },
  ];
  for (const scenario of cases) {
    const record = failedWatchdog({
      classification: 'WORKER_WATCHDOG_PROBE_FAILED',
      restartAttempted: false,
      restartBlocker: '',
      restartSourceHead: '',
      initialAssessment: null,
      finalAssessment: null,
      probeError: scenario.probeError,
    });
    const facts = projectWorkerWatchdogBeaconFacts(record, HEAD);
    assert.equal(facts.classification, 'WORKER_WATCHDOG_PROBE_FAILED', scenario.label);
    assert.equal(facts.probeFailureCode, scenario.code, scenario.label);
    assert.equal(facts.exactNextAction, scenario.action, scenario.label);
    assert.equal(facts.restartAttempted, false);
    assert.equal(facts.rawErrorPublished, false);
    const projected = projectBeaconStatus(record, SPEC, NOW, HEAD);
    assert.equal(projected.blocker, scenario.code === 'WATCHDOG_INSPECT_CAUSE_UNPROVEN'
      ? 'WORKER_WATCHDOG_PROBE_FAILED' : scenario.code, scenario.label);
    assert.doesNotMatch(JSON.stringify(projected), /private|secret|ETIMEDOUT|ENOENT|probeError/i, scenario.label);
    assert.equal(projected.workerWatchdogFacts.sourceHead, '');
    assert.equal(projected.workerWatchdogFacts.exactHeadMatch, false);
  }
});

test('successful and start-failed watchdog cases never promote an irrelevant Inspect error', () => {
  for (const classification of ['WORKER_WATCHDOG_HEALTHY', 'WORKER_WATCHDOG_START_FAILED']) {
    const facts = projectWorkerWatchdogBeaconFacts(failedWatchdog({
      classification,
      probeError: 'ETIMEDOUT C:\\private',
    }), HEAD);
    assert.equal(facts.probeFailureCode, '');
    assert.notEqual(facts.exactNextAction, 'QUALIFY_WATCHDOG_INSPECT_LATENCY');
    assert.doesNotMatch(JSON.stringify(facts), /private|ETIMEDOUT|probeError/i);
  }
});
