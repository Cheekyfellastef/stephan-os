import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectOriginalSourceCustodyCensusV1 as inspect,
  ORIGINAL_SOURCE_CUSTODY_CENSUS_SCHEMA as schema,
} from './originalSourceCustodyInspectionV1.mjs';
const now = '2026-10-14T14:00:00.000Z';
const good = () => ({
  schemaVersion: schema, repository: 'Cheekyfellastef/stephan-os',
  originalLeaseId: 'critical-2962-elastic-goal-r7-lease',
  inspectionMode: 'UNPRIVILEGED_READ_ONLY',
  inspectedAtUtc: now, checkoutPresent: true, aclReadable: true,
  candidateProcessCount: 0, stephanosScheduledTaskCount: 5,
  unknownObservations: [], historicalExecutionOutcome: 'UNKNOWN',
  originalReceiptReconstructed: false, independentWindowsExclusionProven: false,
  outOfJobWriterExclusionProven: false, sourceAclDenialProven: false,
  independentOperatorApprovalProven: false,
  leaseReleaseAuthorized: false, sourceMutationAuthorized: false,
  finalVerdict: 'INSPECTION_ONLY_CUSTODY_HOLD',
});
test('apparently clean local census cannot grant source custody or release', () => {
  const result = inspect(good(), { nowUtc: now });
  assert.equal(result.observable, true);
  assert.equal(result.finalVerdict, 'ORIGINAL_SOURCE_CUSTODY_HOLD');
  assert.equal(result.leaseReleaseAuthorized, false);
  assert.equal(result.safeToCancelOriginal, false);
  assert.deepEqual(result.blockers, [
    'INDEPENDENT_OS_EXCLUSION_WITNESS_NOT_COMMISSIONED',
    'INDEPENDENT_OPERATOR_APPROVAL_NOT_PROVEN',
  ]);
  assert.equal(Object.isFrozen(result.blockers), true);
});
test('process candidates and unavailable observations remain visible', () => {
  const input = good();
  input.candidateProcessCount = 2;
  input.unknownObservations = ['TASK_INVENTORY_UNAVAILABLE'];
  const result = inspect(input, { nowUtc: now });
  assert.equal(result.observable, true);
  assert.ok(result.blockers.includes('ORIGINAL_PROCESS_CANDIDATES_PRESENT'));
  assert.ok(result.blockers.includes('TASK_INVENTORY_UNAVAILABLE'));
  assert.equal(result.leaseReleaseAuthorized, false);
});
test('unreadable Windows process command lines cannot become false zero-writer confidence', async () => {
  const result = inspect({ ...good(),
    candidateProcessCount: 0,
    unknownObservations: ['CIM_PROCESS_COMMAND_LINE_UNOBSERVED'],
  }, { nowUtc: now });
  assert.equal(result.observable, true);
  assert.equal(result.finalVerdict, 'ORIGINAL_SOURCE_CUSTODY_HOLD');
  assert.equal(result.safeToCancelOriginal, false);
  assert.ok(result.blockers.includes('CIM_PROCESS_COMMAND_LINE_UNOBSERVED'));
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../scripts/windows/inspect-original-source-custody-readonly.ps1', import.meta.url), 'utf8');
  assert.match(source, /Get-CimInstance -ClassName Win32_Process/);
  assert.match(source, /IsNullOrWhiteSpace\(\[string\]\$_\.CommandLine\)/);
  assert.match(source, /CIM_PROCESS_COMMAND_LINE_UNOBSERVED/);
  assert.doesNotMatch(source, /Stop-Process|Set-Acl|Start-Process|Remove-Item/);
});
test('forged proof flags, wrong identities, stale and missing telemetry HOLD', () => {
  const attempts = [
    { leaseReleaseAuthorized: true }, { independentWindowsExclusionProven: true },
    { independentOperatorApprovalProven: true }, { sourceAclDenialProven: true },
    { originalReceiptReconstructed: true }, { historicalExecutionOutcome: 'COMPLETED' },
    { sourceMutationAuthorized: true },
    { outOfJobWriterExclusionProven: true },
    { inspectionMode: 'PRIVILEGED' }, { originalLeaseId: 'other' },
    { candidateProcessCount: -1 }, { stephanosScheduledTaskCount: NaN },
    { unknownObservations: ['FALSE_PROOF'] },
    { inspectedAtUtc: '2026-10-13T14:00:00.000Z' },
  ];
  for (const override of attempts) {
    const result = inspect({ ...good(), ...override }, { nowUtc: now });
    assert.equal(result.observable, false, JSON.stringify(override));
    assert.equal(result.leaseReleaseAuthorized, false);
    assert.ok(result.blockers.includes('CENSUS_UNTRUSTED_OR_STALE'));
  }
});
test('malformed snapshots do not throw or assume safe defaults', () => {
  for (const value of [null, undefined, [], 1, {}, { ...good(), unknownObservations: null }]) {
    const result = inspect(value, { nowUtc: now });
    assert.equal(result.observable, false);
    assert.equal(result.safeToCancelOriginal, false);
  }
});

test('Sovereign Commander custody skill bumps both plugin cache identities together', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../../plugins/sovereign-commander/plugin.json', import.meta.url), 'utf8'));
  const codexManifest = JSON.parse(await readFile(new URL('../../plugins/sovereign-commander/.codex-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'sovereign-commander');
  assert.equal(codexManifest.name, manifest.name);
  assert.equal(manifest.version, codexManifest.version);
  assert.equal(manifest.version, '1.0.8');
});

test('Skill YAML description preserves original custody trigger instead of truncating at #', async () => {
  const { readFile } = await import('node:fs/promises');
  const content = (await readFile(new URL('../../plugins/sovereign-commander/skills/inspect-original-source-custody/SKILL.md', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  assert.ok(frontmatter, 'skill must have YAML frontmatter');
  const description = frontmatter[1].split('\n').find(line => line.startsWith('description: '));
  assert.ok(description, 'skill description must be defined');
  assert.match(description, /^description: ["'][^"']*#2962\/r7[^"']*["']$/, 'quoted YAML must preserve the exact custody trigger');
  assert.match(description, /never forge a terminal receipt or release a lease/i);
});
