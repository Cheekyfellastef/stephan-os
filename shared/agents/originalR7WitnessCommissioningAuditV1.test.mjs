import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORIGINAL_R7_WITNESS_AUDIT_SCHEMA,
  projectOriginalR7WitnessCommissioningAuditV1 as project,
} from './originalR7WitnessCommissioningAuditV1.mjs';

const now = '2026-10-14T20:00:00.000Z';
const observation = () => ({
  schemaVersion: ORIGINAL_R7_WITNESS_AUDIT_SCHEMA,
  repository: 'Cheekyfellastef/stephan-os',
  originalLeaseId: 'critical-2962-elastic-goal-r7-lease',
  serviceName: 'StephanosOriginalR7CustodyWitness',
  inspectionMode: 'UNPRIVILEGED_READ_ONLY',
  observedAtUtc: now,
  servicePresent: false,
  serviceStatus: 'NOT_INSTALLED',
  originalProcessCandidateCount: 0,
  relatedTaskCount: 6,
  publisherTaskPresent: true,
  publisherTaskState: 'READY',
  publisherLastResultClass: 'NONZERO',
  unknownObservations: [],
  privilegedServiceSidVerified: false,
  sourceAclDenialEnforced: false,
  outOfJobWritersExcluded: false,
  wmiComRelaunchDenied: false,
  scheduledTaskRelaunchDenied: false,
  trustRootsVerified: false,
  independentOperatorSignatureVerified: false,
  leaseReleaseAuthorized: false,
  sourceMutationAuthorized: false,
  finalVerdict: 'COMMISSIONING_NOT_PROVEN',
});
const inspect = input => project(input, { nowUtc: now });

test('native publisher exact-name task is contextual evidence, not authenticated original R7 writer', () => {
  const result = inspect(observation());
  assert.equal(result.observable, true);
  assert.equal(result.publisherTaskPresent, true);
  assert.equal(result.publisherTaskState, 'READY');
  assert.equal(result.publisherLastResultClass, 'NONZERO');
  assert.equal(result.publisherOriginalWriterAuthenticated, false);
  assert.equal(result.leaseReleaseAuthority, false);
  const absent = inspect({ ...observation(),
    publisherTaskPresent: false, publisherTaskState: 'NOT_FOUND',
    publisherLastResultClass: 'UNKNOWN',
  });
  assert.equal(absent.observable, true);
  assert.equal(absent.publisherOriginalWriterAuthenticated, false);
});

test('publisher scheduler never-run is NOT a successful execution or original writer proof', async () => {
  const never = inspect({ ...observation(), publisherLastResultClass: 'NEVER_RUN' });
  assert.equal(never.observable, true);
  assert.equal(never.publisherTaskPresent, true);
  assert.equal(never.publisherLastResultClass, 'NEVER_RUN');
  assert.equal(never.authenticatedWitness, false);
  assert.equal(never.leaseReleaseAuthority, false);
  const { readFile } = await import('node:fs/promises');
  const script = await readFile(new URL('../../scripts/windows/inspect-original-r7-witness-readiness-readonly.ps1', import.meta.url), 'utf8');
  assert.match(script, /Get-ScheduledTaskInfo -InputObject \$publisherMatches\[0\]/);
  assert.match(script, /\[datetime\]\$info\.LastRunTime -eq \[datetime\]::MinValue/);
  assert.doesNotMatch(script, /Get-ScheduledTaskInfo -TaskName 'Stephanos Native Capacity Publisher'/);
});

test('uncommissioned Windows witness remains an explicit hold', () => {
  const result = inspect(observation());
  assert.equal(result.observable, true);
  assert.equal(result.finalVerdict, 'ORIGINAL_R7_WINDOWS_WITNESS_NOT_COMMISSIONED');
  assert.ok(result.blockers.includes('OS_WITNESS_SERVICE_NOT_OBSERVED'));
  assert.equal(result.originalHistoricalOutcome, 'UNKNOWN');
  assert.equal(result.historicalReceiptReconstructed, false);
  assert.equal(result.leaseReleaseAuthority, false);
  assert.equal(result.sourceMutationAuthority, false);
  assert.equal(result.operatorApprovalAuthority, false);
  assert.equal(result.privilegedServiceInstallAuthority, false);
  assert.equal(result.physicalPickupProven, false);
  assert.ok(Object.isFrozen(result.blockers));
});

test('an apparently running Windows service and empty process inventory are not attestation', () => {
  const result = inspect({ ...observation(), servicePresent: true, serviceStatus: 'RUNNING' });
  assert.equal(result.observable, true);
  assert.equal(result.authenticatedWitness, false);
  assert.equal(result.leaseReleaseAuthority, false);
  assert.ok(result.blockers.includes('ORIGINAL_WRITER_OS_EXCLUSION_AND_NEGATIVE_TESTS_UNPROVEN'));
  assert.ok(result.blockers.includes('PROTECTED_WITNESS_SIGNING_ROOT_UNCOMMISSIONED'));
  assert.ok(result.blockers.includes('SEPARATE_OPERATOR_SIGNING_ROOT_UNCOMMISSIONED'));
});

test('process candidates, absent task inventory and unsupported telemetry stay visible', () => {
  const result = inspect({
    ...observation(),
    servicePresent: true, serviceStatus: 'STOPPED',
    originalProcessCandidateCount: 3, relatedTaskCount: null,
    unknownObservations: ['SCHEDULED_TASK_ENUMERATION_UNAVAILABLE'],
  });
  assert.equal(result.observable, true);
  for (const blocker of [
    'OS_WITNESS_SERVICE_NOT_RUNNING', 'ORIGINAL_WRITER_PROCESS_CANDIDATES_PRESENT',
    'RELATED_SCHEDULED_TASK_INVENTORY_UNAVAILABLE', 'SCHEDULED_TASK_ENUMERATION_UNAVAILABLE',
  ]) assert.ok(result.blockers.includes(blocker), blocker);
});

test('unreadable process command lines stay an explicit diagnostic blocker, never lease authority', () => {
  const result = inspect({
    ...observation(),
    servicePresent: true, serviceStatus: 'RUNNING',
    unknownObservations: ['PROCESS_COMMANDLINE_VISIBILITY_INCOMPLETE'],
  });
  assert.equal(result.observable, true);
  assert.ok(result.blockers.includes('PROCESS_COMMANDLINE_VISIBILITY_INCOMPLETE'));
  assert.equal(result.authenticatedWitness, false);
  assert.equal(result.leaseReleaseAuthority, false);
});

test('forged eligibility, authority, wrong identity, unknown evidence or old snapshot fails closed', () => {
  const attempts = [
    { repository: 'different/repo' }, { originalLeaseId: 'another-lease' },
    { serviceName: 'OtherService' }, { inspectionMode: 'PRIVILEGED' },
    { servicePresent: 'true' }, { serviceStatus: 'GREEN' },
    { observedAtUtc: '2026-10-14T19:57:00.000Z' },
    { originalProcessCandidateCount: -1 }, { relatedTaskCount: -1 },
    { publisherTaskPresent: 'true' }, { publisherTaskState: 'ACTIVE' },
    { publisherLastResultClass: 1 },
    { publisherTaskPresent: false, publisherTaskState: 'RUNNING' },
    { unknownObservations: ['CONTENTION_CLEARED'] },
    { privilegedServiceSidVerified: true }, { sourceAclDenialEnforced: true },
    { outOfJobWritersExcluded: true }, { wmiComRelaunchDenied: true },
    { scheduledTaskRelaunchDenied: true }, { trustRootsVerified: true },
    { independentOperatorSignatureVerified: true },
    { leaseReleaseAuthorized: true }, { sourceMutationAuthorized: true },
    { finalVerdict: 'READY' },
  ];
  for (const override of attempts) {
    const result = inspect({ ...observation(), ...override });
    assert.equal(result.observable, false, JSON.stringify(override));
    assert.equal(result.leaseReleaseAuthority, false);
    assert.deepEqual(result.blockers, ['COMMISSIONING_AUDIT_UNTRUSTED_OR_STALE']);
  }
  for (const value of [null, undefined, {}, [], 1]) {
    assert.equal(inspect(value).observable, false);
  }
});
