import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectOriginalSourceCustodyRemoteCensusV1,
  executeSovereignCommanderRemoteOnBattleBridge,
  validateSovereignCommanderRemoteCommandShape,
} from './sovereignCommanderRemoteMailboxV1.mjs';

const HEAD = 'e42d31670da802cc15d4c323dd8dcff10a03033f';
const when = new Date().toISOString();
const census = (overrides = {}) => ({
  schemaVersion: 'stephanos.original-source-custody-readonly-census.v1',
  repository: 'Cheekyfellastef/stephan-os',
  originalLeaseId: 'critical-2962-elastic-goal-r7-lease',
  inspectionMode: 'UNPRIVILEGED_READ_ONLY',
  inspectedAtUtc: when,
  checkoutPresent: true,
  aclReadable: true,
  candidateProcessCount: 0,
  stephanosScheduledTaskCount: 2,
  unknownObservations: [],
  historicalExecutionOutcome: 'UNKNOWN',
  originalReceiptReconstructed: false,
  independentWindowsExclusionProven: false,
  outOfJobWriterExclusionProven: false,
  sourceAclDenialProven: false,
  independentOperatorApprovalProven: false,
  leaseReleaseAuthorized: false,
  sourceMutationAuthorized: false,
  finalVerdict: 'INSPECTION_ONLY_CUSTODY_HOLD',
  ...overrides,
});

test('fixed r7 census projects only readonly original custody HOLD without privacy leakage', () => {
  const record = census({ forbiddenPath: 'C:\\Private\\secret', processId: 12345 });
  const result = projectOriginalSourceCustodyRemoteCensusV1(JSON.stringify(record), { nowUtc: when });
  assert.equal(result.observable, true);
  assert.equal(result.finalVerdict, 'ORIGINAL_SOURCE_CUSTODY_HOLD');
  assert.equal(result.independentWindowsExclusionProven, false);
  assert.equal(result.independentlySignedOperatorApprovalProven, false);
  assert.equal(result.leaseReleaseAuthorized, false);
  assert.equal(result.safeToCancelOriginal, false);
  assert.equal(result.historicallyMissingReceiptStillMissing, true);
  assert.ok(result.blockers.includes('INDEPENDENT_OS_EXCLUSION_WITNESS_NOT_COMMISSIONED'));
  assert.ok(result.blockers.includes('INDEPENDENT_OPERATOR_APPROVAL_NOT_PROVEN'));
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('12345'), false);
});

test('hostile or stale census fails closed without privileged authority', () => {
  for (const body of [
    '{"invalid":true}',
    JSON.stringify(census({ independentWindowsExclusionProven: true })),
    JSON.stringify(census({ leaseReleaseAuthorized: true })),
    JSON.stringify(census({ finalVerdict: 'WINDOWS_WITNESS_COMMISSIONED' })),
    JSON.stringify(census({ originalLeaseId: 'different-lease' })),
    JSON.stringify(census({ inspectedAtUtc: '2026-10-15T14:10:00.000Z' })),
    'x'.repeat(8001),
    'private-machine-stdout',
  ]) {
    assert.equal(projectOriginalSourceCustodyRemoteCensusV1(body, { nowUtc: when }), null);
  }
});

test('remote census executes only pinned HEAD script; never returns stdout, keys, paths or a signed witness', async () => {
  const calls = [];
  const spawnSyncFn = (_executable, args) => {
    calls.push(args);
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: HEAD + '\n', stderr: '' };
    if (args.includes('show')) return { status: 0, stdout: '# already reviewed fixed read-only census', stderr: '' };
    if (args.includes('-EncodedCommand')) {
      return { status: 0, stdout: JSON.stringify(census({ forbiddenPath: 'C:\\secret' })), stderr: 'SECRET STDERR' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  const command = {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'custody-readonly-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    remoteAction: 'original-source-custody-census',
  };
  assert.equal(validateSovereignCommanderRemoteCommandShape(command).ok, true);
  const result = await executeSovereignCommanderRemoteOnBattleBridge(command, {
    spawnSyncFn,
    env: { USERPROFILE: 'C:\\Users\\Operator' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'ORIGINAL_SOURCE_CUSTODY_HOLD');
  assert.equal(result.result.custody.safeToCancelOriginal, false);
  assert.equal(result.result.sourceMutationAllowed, false);
  assert.equal(result.result.leaseReleaseAuthorized, false);
  assert.equal(result.result.serviceInstallAuthorized, false);
  assert.equal(result.result.publicReceiptSafe, true);
  const show = calls.find(args => args.includes('show'));
  assert.ok(show);
  assert.ok(show.some(v => v === HEAD + ':scripts/windows/inspect-original-source-custody-readonly.ps1'));
  assert.ok(calls.some(args => args.includes('-EncodedCommand')));
  assert.equal(JSON.stringify(result).includes('SECRET STDERR'), false);
  assert.equal(JSON.stringify(result).includes('C:\\secret'), false);
  assert.equal(validateSovereignCommanderRemoteCommandShape({ ...command, arbitraryScript: 'Write-Host bad' }).ok, false);
});
