import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeSovereignCommanderRemoteOnBattleBridge,
  validateSovereignCommanderRemoteCommandShape,
} from './sovereignCommanderRemoteMailboxV1.mjs';
import {
  checkpointTerminalMailboxReceipt,
  serializeBoundedReceiptJson,
} from '../../scripts/battle-bridge-github-command-mailbox.mjs';
import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';

const HEAD = 'a'.repeat(40);
const readinessGuardFields = [
  'originalLeaseReleased', 'privilegedWindowsWitnessCommissioned',
  'sourceMutationAllowed', 'arbitraryShellAllowed',
];
const mandatory = [
  'INDEPENDENT_PROTECTED_SERVICE_SID_NOT_COMMISSIONED',
  'ORIGINAL_WRITER_OS_EXCLUSION_AND_NEGATIVE_TESTS_UNPROVEN',
  'PROTECTED_WITNESS_SIGNING_ROOT_UNCOMMISSIONED',
  'SEPARATE_OPERATOR_SIGNING_ROOT_UNCOMMISSIONED',
  'CANONICAL_R7_CAS_RELEASE_PROOF_MISSING',
];
const shape = (extra = {}) => ({
  schemaVersion: 'stephanos.battle-bridge-github-command.v1',
  requestId: 'r7-witness-readiness-test-v1',
  operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
  repository: 'Cheekyfellastef/stephan-os',
  issueNumber: CANONICAL_MAILBOX_ISSUE, branch: 'main', operatorApproval: 'operator-approved',
  expectedHead: HEAD, expiresAt: '2026-10-01T12:00:00.000Z',
  remoteAction: 'original-r7-witness-readiness', ...extra,
});
const rawObservation = () => ({
  schemaVersion: 'stephanos.original-r7-witness-commissioning-audit.v1',
  repository: 'Cheekyfellastef/stephan-os',
  originalLeaseId: 'critical-2962-elastic-goal-r7-lease',
  serviceName: 'StephanosOriginalR7CustodyWitness',
  inspectionMode: 'UNPRIVILEGED_READ_ONLY',
  observedAtUtc: new Date().toISOString(),
  servicePresent: true, serviceStatus: 'RUNNING',
  originalProcessCandidateCount: 0, relatedTaskCount: 0, unknownObservations: [],
  publisherTaskPresent: false, publisherTaskState: 'NOT_FOUND',
  publisherLastResultClass: 'UNKNOWN',
  privilegedServiceSidVerified: false, sourceAclDenialEnforced: false,
  outOfJobWritersExcluded: false, wmiComRelaunchDenied: false,
  scheduledTaskRelaunchDenied: false, trustRootsVerified: false,
  independentOperatorSignatureVerified: false,
  leaseReleaseAuthorized: false, sourceMutationAuthorized: false,
  finalVerdict: 'COMMISSIONING_NOT_PROVEN',
});
const mailboxReceipt = inner => ({
  schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
  requestId: 'r7-witness-readiness-test-v1',
  operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
  repository: 'Cheekyfellastef/stephan-os',
  issueNumber: CANONICAL_MAILBOX_ISSUE, branch: 'main', state: 'DONE', expectedHead: HEAD,
  acceptedAt: '2026-10-17T14:00:00.000Z',
  heartbeatAt: '2026-10-17T14:00:02.000Z',
  completedAt: '2026-10-17T14:00:02.000Z',
  proofRefs: [],
  result: { ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    requestId: 'r7-witness-readiness-test-v1', result: inner },
});

function projectCheckpointThroughPublicReceipt(inner, bound = 65_536) {
  // Production persists an already projected receipt before publishing it.
  // Re-publish the public result too, including the smaller core projection.
  let persisted;
  checkpointTerminalMailboxReceipt({}, mailboxReceipt(inner), {
    persist: state => { persisted = structuredClone(state); },
  });
  let receipt = persisted.lastReceipt;
  for (let pass = 0; pass < 2; pass++) {
    const json = serializeBoundedReceiptJson(receipt, bound);
    assert.ok(Buffer.byteLength(json, 'utf8') <= bound);
    receipt = JSON.parse(json);
  }
  assert.equal(receipt.issueNumber, CANONICAL_MAILBOX_ISSUE);
  return receipt;
}

test('fixed original-r7 readiness action samples immutable Windows script without MCP mutation', async () => {
  const observed = rawObservation();
  observed.privateHostPath = 'DO_NOT_EXPOSE_WINDOWS_PATH';
  const calls = [];
  const spawnSyncFn = (_bin, args) => {
    calls.push(args);
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: HEAD + '\n', stderr: '' };
    if (args.includes('show')) return { status: 0, stdout: '# fixed read-only script', stderr: '' };
    if (args.includes('-EncodedCommand')) return { status: 0, stdout: JSON.stringify(observed), stderr: '' };
    throw new Error('unexpected command');
  };
  const command = () => executeSovereignCommanderRemoteOnBattleBridge(shape(), {
    spawnSyncFn, readFileFn: async () => 'x'.repeat(44),
    fetchFn: async () => { throw new Error('MCP not allowed'); },
    env: { USERPROFILE: 'C:\\Users\\Operator' },
  });
  const result = await command();
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_R7_READINESS_OBSERVED_HOLD');
  assert.equal(result.witnessReadiness.serviceStatus, 'RUNNING');
  assert.equal(result.witnessReadiness.publisherTaskPresent, false);
  assert.equal(result.witnessReadiness.publisherTaskState, 'NOT_FOUND');
  assert.equal(result.witnessReadiness.publisherOriginalWriterAuthenticated, false);
  assert.equal(result.witnessReadiness.authenticatedWitness, false);
  assert.equal(result.witnessReadiness.leaseReleaseAuthority, false);
  assert.equal(result.witnessReadiness.observedAtUtc, observed.observedAtUtc);
  const script = calls.find(args => args.includes('-EncodedCommand'));
  assert.ok(script);
  assert.match(Buffer.from(script[script.indexOf('-EncodedCommand')+1], 'base64').toString('utf16le'), /fixed read-only script/);
  assert.ok(calls.some(args => args.includes(HEAD + ':scripts/windows/inspect-original-r7-witness-readiness-readonly.ps1')));
  assert.equal(calls.some(args => args.includes('-File')), false);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /DO_NOT_EXPOSE_WINDOWS_PATH/);
  for (const bound of [65_536, 9_216, 4_500]) {
    const publicResult = projectCheckpointThroughPublicReceipt(result, bound);
    const summary = publicResult.result.result.witnessReadiness;
    assert.ok(summary, 'readiness must survive local checkpoint and repeated public projection');
    for (const field of readinessGuardFields) assert.equal(publicResult.result.result[field], false, field);
    assert.equal(summary.servicePresent, true);
    assert.equal(summary.serviceStatus, 'RUNNING');
    assert.equal(summary.publisherTaskState, 'NOT_FOUND');
    assert.equal(summary.publisherOriginalWriterAuthenticated, false);
    assert.equal(summary.finalVerdict, 'ORIGINAL_R7_WINDOWS_WITNESS_NOT_COMMISSIONED');
    assert.equal(summary.leaseReleaseAuthority, false);
    assert.equal(summary.sourceMutationAuthority, false);
    assert.equal(summary.physicalPickupProven, false);
    assert.equal(summary.historicalOutcome, 'UNKNOWN');
    assert.deepEqual(summary.blockers, mandatory);
    assert.doesNotMatch(JSON.stringify(publicResult), /DO_NOT_EXPOSE_WINDOWS_PATH/);
  }
  observed.leaseReleaseAuthorized = true;
  const forged = await command();
  assert.equal(forged.ok, false);
  assert.equal(forged.blocker, 'SOVEREIGN_R7_READINESS_UNTRUSTED_OR_STALE');
  observed.leaseReleaseAuthorized = false;
  observed.observedAtUtc = '2020-01-01T00:00:00.000Z';
  const stale = await command();
  assert.equal(stale.ok, false);
  assert.equal(stale.blocker, 'SOVEREIGN_R7_READINESS_UNTRUSTED_OR_STALE');
});

test('mailbox retains publisher result classes without claiming witness execution or identity', () => {
  const raw = {
    ok: true, remoteAction: 'original-r7-witness-readiness',
    finalVerdict: 'SOVEREIGN_R7_READINESS_OBSERVED_HOLD',
    originalLeaseReleased: false, privilegedWindowsWitnessCommissioned: false,
    sourceMutationAllowed: false, arbitraryShellAllowed: false,
    publicReceiptSafe: true, secretMaterialReturned: false,
    witnessReadiness: {
      observedAtUtc: '2026-10-17T14:00:00.000Z',
      servicePresent: false, serviceStatus: 'NOT_INSTALLED',
      publisherTaskPresent: true, publisherTaskState: 'READY',
      publisherLastResultClass: 'NEVER_RUN', publisherOriginalWriterAuthenticated: false,
      blockers: mandatory, historicalOutcome: 'UNKNOWN', authenticatedWitness: false,
      physicalPickupProven: false, leaseReleaseAuthority: false,
      sourceMutationAuthority: false,
      finalVerdict: 'ORIGINAL_R7_WINDOWS_WITNESS_NOT_COMMISSIONED',
    },
  };
  for (const resultClass of ['ZERO', 'NONZERO', 'NEVER_RUN', 'UNKNOWN']) {
    raw.witnessReadiness.publisherLastResultClass = resultClass;
    const projected = projectCheckpointThroughPublicReceipt(raw, 4500).result.result;
    assert.ok(projected.witnessReadiness);
    assert.equal(projected.witnessReadiness.publisherLastResultClass, resultClass);
    assert.equal(projected.witnessReadiness.publisherOriginalWriterAuthenticated, false);
    assert.equal(projected.witnessReadiness.leaseReleaseAuthority, false);
    assert.equal(projected.witnessReadiness.authenticatedWitness, false);
    assert.equal(projected.witnessReadiness.historicalOutcome, 'UNKNOWN');
    for (const field of readinessGuardFields) assert.equal(projected[field], false, field);
  }
});

test('closed-world readiness command rejects caller-selected paths, elevation and release', () => {
  assert.equal(validateSovereignCommanderRemoteCommandShape(shape()).ok, true);
  for (const injected of [{path:'C:\\checkout'}, {command:'powershell.exe'},
    {serviceName:'evil'}, {script:'Invoke-Expression'}, {leaseReleaseAuthorized:true},
    {signedClaim:{authenticated:true}}, {principalSid:'S-1-5-18'}]) {
    const r = validateSovereignCommanderRemoteCommandShape(shape(injected));
    assert.equal(r.ok, false);
    assert.equal(r.blocker, 'SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED');
  }
});

test('public readiness summary refuses caller-forged affirmative authority and unknown blockers', () => {
  const inner = {
    ok: true, remoteAction: 'original-r7-witness-readiness',
    finalVerdict: 'SOVEREIGN_R7_READINESS_OBSERVED_HOLD',
    originalLeaseReleased: false, privilegedWindowsWitnessCommissioned: false,
    sourceMutationAllowed: false, arbitraryShellAllowed: false,
    publicReceiptSafe: true, secretMaterialReturned: false,
    witnessReadiness: {
      observedAtUtc: '2026-10-17T14:00:00.000Z',
      servicePresent: true, serviceStatus: 'RUNNING',
      publisherTaskPresent: true, publisherTaskState: 'READY',
      publisherLastResultClass: 'NONZERO',
      publisherOriginalWriterAuthenticated: false,
      blockers: mandatory, historicalOutcome: 'UNKNOWN',
      authenticatedWitness: false, physicalPickupProven: false,
      leaseReleaseAuthority: false, sourceMutationAuthority: false,
      finalVerdict: 'ORIGINAL_R7_WINDOWS_WITNESS_NOT_COMMISSIONED',
    },
  };
  const project = () => projectCheckpointThroughPublicReceipt(inner).result.result.witnessReadiness;
  assert.deepEqual(project().blockers, mandatory);
  inner.witnessReadiness.blockers = [...mandatory, 'PUBLISHER_TASK_CONTEXT_UNAVAILABLE'];
  for (const limit of [65_536, 4_500]) {
    const receipt = projectCheckpointThroughPublicReceipt(inner, limit);
    const detail = receipt.result.result.witnessReadiness;
    assert.ok(detail, 'unavailable publisher context must remain visible');
    assert.deepEqual(detail.blockers, inner.witnessReadiness.blockers);
    assert.equal(detail.authenticatedWitness, false);
    assert.equal(detail.leaseReleaseAuthority, false);
    assert.equal(detail.publisherOriginalWriterAuthenticated, false);
  }
  inner.witnessReadiness.blockers = mandatory;
  for (const field of readinessGuardFields) {
    for (const invalid of [true, null, undefined, 'false', 0]) {
      const forged = structuredClone(inner);
      if (invalid === undefined) delete forged[field];
      else forged[field] = invalid;
      for (const bound of [65_536, 4_500]) {
        const projected = projectCheckpointThroughPublicReceipt(forged, bound).result.result;
        assert.equal(projected.witnessReadiness, null, `${field}: ${invalid}`);
        assert.equal(projected[field], invalid === true ? true : null,
          'projection must not turn affirmative or missing authority into a false guard');
      }
    }
  }
  inner.witnessReadiness.authenticatedWitness = true;
  assert.equal(project(), null);
  inner.witnessReadiness.authenticatedWitness = false;
  inner.witnessReadiness.publisherOriginalWriterAuthenticated = true;
  assert.equal(project(), null);
  inner.witnessReadiness.publisherOriginalWriterAuthenticated = false;
  inner.witnessReadiness.publisherTaskState = 'ACTIVE';
  assert.equal(project(), null);
  inner.witnessReadiness.publisherTaskState = 'READY';
  inner.witnessReadiness.authenticatedWitness = false;
  inner.witnessReadiness.blockers = [...mandatory, 'PRIVATE_PATH_C:\\secret'];
  assert.equal(project(), null);
  inner.witnessReadiness.blockers = mandatory.slice(1);
  assert.equal(project(), null);
  inner.witnessReadiness.blockers = mandatory;
  inner.privilegedWindowsWitnessCommissioned = true;
  assert.equal(project(), null);
});
