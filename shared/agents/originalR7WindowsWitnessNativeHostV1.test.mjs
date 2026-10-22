import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../../src/windows/Stephanos.OriginalR7CustodyWitness/', import.meta.url);
const program = await readFile(new URL('Program.cs', root), 'utf8');
const scm = await readFile(new URL('OriginalR7ScmPreflight.cs', root), 'utf8');
const project = await readFile(new URL('Stephanos.OriginalR7CustodyWitness.csproj', root), 'utf8');
const guide = await readFile(new URL('README.md', root), 'utf8');
const nativeCi = await readFile(new URL('../../.github/workflows/original-r7-native-windows-proof.yml', import.meta.url), 'utf8');
const scmCi = await readFile(new URL('../../.github/workflows/original-r7-scm-preflight.yml', import.meta.url), 'utf8');
const imagePin = await readFile(new URL('OriginalR7ImagePinPreflight.cs', root), 'utf8');

test('SCM proof follows audit-parser edits and tests the delivered complete managed payload', () => {
  const paths = scmCi.slice(scmCi.indexOf('    paths:'), scmCi.indexOf('\npermissions:'));
  for (const path of ['shared/agents/originalR7WitnessCommissioningAuditV1.mjs',
    'shared/agents/originalR7WitnessCommissioningAuditV1.test.mjs',
    'shared/agents/originalR7WindowsWitnessNativeHostV1.test.mjs']) {
    assert.ok(paths.includes("'" + path + "'"), path + ' must trigger hosted Windows proof');
  }
  assert.match(scmCi, /-p:PublishProfile=WitnessSingleFile[^\n]*--output \$stage/);
  assert.doesNotMatch(scmCi, /--self-contained false/);
  assert.match(scmCi, /& \$binary --inspect-bundle-only/);
  assert.match(scmCi, /R7_PUBLISHED_PACKAGE_BUNDLE_GATE_FAILED/);
  assert.match(program, /args\.Length == 1 && args\[0\] == "--inspect-bundle-only"/);
  assert.match(program, /if \(!OriginalR7ScmPreflight\.BundledPayloadObserved\(\)\) return 4/);
  assert.match(program, /OriginalR7ImagePinPreflight\.Evaluate\(image, untrustedDigest\)/);
  assert.match(imagePin, /MaxImageBytes = 128L \* 1024 \* 1024/);
  assert.match(scmCi, /Get-ChildItem -LiteralPath \$stage -File -Filter '\*\.dll'/);
  assert.match(scmCi, /R7_UNBUNDLED_EXECUTABLE_PAYLOAD/);
  assert.match(scmCi, /& \$binary --unapproved-ci-invocation/);
  assert.match(scmCi, /\$LASTEXITCODE -ne 2/);
  assert.match(imagePin, /R7_IMAGE_MANAGED_PAYLOAD_NOT_BUNDLED/);
  assert.match(scmCi, /physicalBattleBridgeCommissioned=false/);
});

test('native Windows witness host requires real SCM and its exact service identity', () => {
  assert.match(project, /<TargetFramework>net8\.0-windows<\/TargetFramework>/);
  assert.match(project, /System\.ServiceProcess\.ServiceController/);
  assert.match(program, /ServiceBase\.Run\(new OriginalR7CustodyWitnessService\(\)\)/);
  assert.match(program, /FixedServiceName = "StephanosOriginalR7CustodyWitness"/);
  assert.match(program, /FixedLeaseId = "critical-2962-elastic-goal-r7-lease"/);
  assert.match(program, /NTAccount\(\s*"NT SERVICE", FixedServiceName\)/);
  assert.match(program, /principal\.IsInRole\(expected\)/);
  assert.match(program, /exactVirtualServiceAccount = actual\?\.Equals\(expected\) == true/);
  assert.match(program, /actual\?\.Value == "S-1-5-19"/);
  assert.match(program, /principal\.IsInRole\(WindowsBuiltInRole\.Administrator\)/);
  assert.match(program, /identity\.IsSystem \|\| elevatedAdministrator/);
  assert.match(program, /Process\.GetCurrentProcess\(\)\.SessionId != 0/);
  assert.match(program, /Environment\.UserInteractive/);
  assert.match(program, /args\.Length != 0/);
});

test('native host refuses trust even when expected SCM SID is present', () => {
  assert.match(program, /throw new InvalidOperationException\("WINDOWS_WITNESS_PHYSICAL_CONTAINMENT_UNCOMMISSIONED"\)/);
  assert.doesNotMatch(program, /\b(?:SignData|SignHash|RSA\.Sign|ECDsa\.Sign|CngKey\.Create|File\.WriteAllText|File\.WriteAllBytes|Process\.Start|SetAccessControl|SetNamedSecurityInfo|CreateService|DeleteService)\s*\(/);
  assert.doesNotMatch(program, /\b(?:TcpListener|HttpListener|NamedPipeServerStream|Socket)\b/);
  assert.doesNotMatch(program, /static\s+void\s+Main\s*\(\s*string\[\]\s+args\s*\)[\s\S]*CommandLine/);
  assert.match(guide, /NOT the\s+privileged Windows proof issuer/);
  assert.match(guide, /historical outcome UNKNOWN/);
  assert.match(guide, /no privileged commissioning, signing or lease-release command/);
});

test('project cannot run as native generic mutable helper', () => {
  assert.doesNotMatch(program, /\b(?:System\.Management|WMI|powershell\.exe|cmd\.exe|sc\.exe|schtasks\.exe)\b/i);
  assert.doesNotMatch(program, /\b(?:GetCommandLineArgs|Environment\.GetEnvironmentVariable|Console\.ReadLine|StreamReader)\b/);
  assert.match(program, /return 2;/);
  assert.match(program, /return 3;/);
});

test('service SID cannot be carried by an unrelated or elevated Windows principal', () => {
  assert.match(program, /\(!exactVirtualServiceAccount && !localServiceWithEnabledSid\)/);
  assert.match(program, /identity\.IsSystem \|\| elevatedAdministrator/);
  assert.doesNotMatch(program, /identity\.Groups\?\.Contains\(expected\)/);
  assert.doesNotMatch(program, /(?:RunAs|TokenImpersonationLevel|LogonUser|AdjustTokenPrivileges|OpenProcessToken|SetTokenInformation)/);
  assert.match(program, /WINDOWS_WITNESS_PHYSICAL_CONTAINMENT_UNCOMMISSIONED/);
});

test('Windows CI compiles real native SCM witness and proves CLI denial without commissioning', () => {
  assert.match(nativeCi, /src\/windows\/Stephanos\.OriginalR7CustodyWitness\/\*\*/);
  assert.match(nativeCi, /- 'scripts\/windows\/stage-original-r7-witness-candidate\.ps1'/);
  assert.match(nativeCi, /dotnet build src\/windows\/Stephanos\.OriginalR7CustodyWitness\/Stephanos\.OriginalR7CustodyWitness\.csproj --configuration Release/);
  assert.match(nativeCi, /--unapproved-ci-invocation/);
  assert.match(nativeCi, /\$rejected -ne 2/);
  assert.match(nativeCi, /node --test shared\/agents\/originalR7WindowsWitnessNativeHostV1\.test\.mjs/);
  assert.match(nativeCi, /persist-credentials: false/);
  assert.match(nativeCi, /permissions:\s*\n  contents: read/);
  assert.match(nativeCi, /BATTLE_BRIDGE_WINDOWS_WITNESS_COMMISSIONED=false/);
  assert.match(nativeCi, /ORIGINAL_R7_LEASE_RELEASED=false/);
  assert.doesNotMatch(nativeCi, /\b(?:New-Service|Start-Service|Set-Service|Set-Acl|icacls|schtasks|Set-ExecutionPolicy)\b/i);
});

test('SCM preflight checks the exact on-disk witness image pin before any custody claim', () => {
  assert.match(scm, /PinnedImageSha256/);
  assert.match(scm, /SHA256\.HashData\(stream\)/);
  assert.match(scm, /CryptographicOperations\.FixedTimeEquals/);
  assert.match(scm, /LocalImageHasNoReparseAncestors/);
  assert.match(scm, /FileAttributes\.ReparsePoint/);
  assert.match(scm, /R7_SCM_PINNED_IMAGE_DIGEST_UNPROVEN/);
  assert.match(scm, /R7_SCM_BUNDLED_PAYLOAD_UNPROVEN/);
  assert.match(scm, /R7_SCM_SHAPE_OBSERVED_NOT_PHYSICAL_CUSTODY/);
  assert.match(program, /WINDOWS_WITNESS_PHYSICAL_CONTAINMENT_UNCOMMISSIONED/);
  assert.doesNotMatch(scm, /\b(?:Registry\.SetValue|CreateSubKey|SetAccessControl|File\.WriteAllBytes|File\.WriteAllText|Process\.Start)\s*\(/);
  assert.doesNotMatch(scm, /\b(?:SignData|SignHash|ECDsa\.Sign|CngKey\.Create)\s*\(/);
});

const stagingScriptUrl = new URL('../../scripts/windows/stage-original-r7-witness-candidate.ps1', import.meta.url);

test('Windows PowerShell 5.1 delivers the fixed SCM arguments to a harmless native receiver', {
  skip: process.platform !== 'win32',
}, async () => {
  const source = await readFile(stagingScriptUrl, 'utf8');
  const commands = source.split(/\r?\n/).map(line => line.trim())
    .filter(line => line.startsWith('& $sc create '));
  assert.equal(commands.length, 1, 'one fixed SCM creation invocation');
  const command = commands[0].replace(/ \| Out-Null$/, '');
  const dir = await mkdtemp(join(tmpdir(), 'r7-scm-argument-test-'));
  const installedExe = 'C:\\Program Files\\StephanosR7CustodyWitness\\Stephanos.OriginalR7CustodyWitness.exe';
  try {
    const script = join(dir, 'argument-test.ps1');
    // Compile a receiver that only reports argv. This never invokes SCM,
    // stages an image, edits a service/registry/ACL, or requires elevation.
    await writeFile(script, `
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'TEST_REQUIRES_WINDOWS_POWERSHELL_51' }
$sc = [IO.Path]::Combine($env:R7_ARGUMENT_TEST_DIRECTORY, 'argument-receiver.exe')
Add-Type -OutputAssembly $sc -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.Text;
public static class R7ArgumentReceiver {
  public static void Main(string[] args) {
    foreach (string arg in args) Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(arg)));
  }
}
'@
$service = 'StephanosOriginalR7CustodyWitness'
$account = 'NT SERVICE\\StephanosOriginalR7CustodyWitness'
$installedExe = '${installedExe}'
${command}
exit $LASTEXITCODE
`, 'utf8');
    const run = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    ], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, R7_ARGUMENT_TEST_DIRECTORY: dir },
    });
    assert.equal(run.status, 0, run.stderr || run.error?.message || 'native argument receiver failed');
    const args = run.stdout.trim().split(/\r?\n/).map(value => Buffer.from(value, 'base64').toString('utf8'));
    assert.deepEqual(args, [
      'create', 'StephanosOriginalR7CustodyWitness', 'type=', 'own', 'start=', 'disabled',
      'binPath=', `"${installedExe}"`, 'obj=', 'NT SERVICE\\StephanosOriginalR7CustodyWitness',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('R7 stage candidate cannot start, commission or release the protected witness', async () => {
  const source = await readFile(stagingScriptUrl, 'utf8');
  assert.match(source, /\[CmdletBinding\(SupportsShouldProcess = \$true, ConfirmImpact = 'High'\)\]/);
  assert.match(source, /Assert-NoExistingServiceOrDestination/);
  assert.match(source, /R7_STAGE_REPARSE_ANCESTOR/);
  assert.match(source, /ExpectedSha256/);
  assert.match(source, /serviceStarted = \$false/);
  assert.match(source, /witnessCommissioned = \$false/);
  assert.match(source, /leaseReleased = \$false/);
  assert.match(source, /R7_STAGE_B_DISABLED_SERVICE_STAGED_NOT_COMMISSIONED/);
  assert.match(source, /'start=' 'disabled'/);
  assert.match(source, /\[int\]\$props\.Start -ne 4/);
  assert.match(source, /& \$sc sidtype \$service restricted/);
  assert.match(source, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(source, /R7_STAGE_SERVICE_NOT_STOPPED/);
  assert.match(source, /R7_STAGE_PROTECTED_ACL_NOT_OBSERVED/);
  assert.match(source, /R7_STAGE_UNEXPECTED_ACL_PRINCIPAL/);
  // A familiar SID alone is insufficient: verify each mandatory SID and its
  // least-privilege effective ACE, with no duplicates or inherited surprises.
  assert.match(source, /R7_STAGE_REQUIRED_ACL_PRINCIPAL_MISSING/);
  assert.match(source, /R7_STAGE_UNEXPECTED_ACL_RIGHTS/);
  assert.match(source, /\$seen\.ContainsKey\(\$sid\)/);
  assert.match(source, /\$seen\.ContainsKey\(\$requiredSid\)/);
  assert.match(source, /\$rights -band \(-bnot \$allowedRead\)/);
  assert.match(source, /\$entry\.InheritanceFlags -ne \$expectedInheritance/);
  assert.match(source, /R7_STAGE_POST_ACL_IMAGE_HASH_MISMATCH/);
  assert.match(source, /\$props\.ImagePath/);
  assert.match(source, /SpecialFolder\]::ProgramFiles/);
  assert.match(source, /SpecialFolder\]::System/);
  assert.doesNotMatch(source, /\$env:(?:ProgramFiles|SystemRoot)/i);

  assert.doesNotMatch(source, /\b(?:Start-Service|Restart-Computer|Invoke-Expression|New-PSSession|Invoke-WebRequest|Remove-Item|Force-Push)\b/i);
  assert.doesNotMatch(source, /'start=' '(?:auto|demand)'/);
});

test('Windows stage script read-only plan and incorrect-image negative test execute without admin', {
  skip: process.platform !== 'win32',
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r7-stage-source-test-'));
  try {
    const file = join(dir, 'Stephanos.OriginalR7CustodyWitness.exe');
    const bytes = Buffer.from('untrusted synthetic bytes: read-only hash logic only');
    await writeFile(file, bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const path = fileURLToPath(stagingScriptUrl);
    const call = (hash, candidate = file) => spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path, '-CandidateExe', candidate, '-ExpectedSha256', hash,
    ], { shell: false, windowsHide: true, encoding: 'utf8', timeout: 60000 });

    const valid = call(digest);
    assert.equal(valid.status, 0, `${valid.stderr || ''}\n${valid.error?.code || ''}`);
    const report = JSON.parse(valid.stdout);
    assert.equal(report.finalVerdict, 'R7_STAGE_B_PREFLIGHT_ONLY');
    assert.equal(report.serviceStarted, false);
    assert.equal(report.witnessCommissioned, false);
    assert.equal(report.leaseReleased, false);
    const invalid = call('0'.repeat(64));
    assert.notEqual(invalid.status, 0, 'a changed candidate must fail');
    assert.match(invalid.stderr, /R7_STAGE_CANDIDATE_HASH_MISMATCH/);

    // A matching hash is insufficient when the executable identity is wrong.
    const wrongFilename = join(dir, 'untrusted-r7.exe');
    await writeFile(wrongFilename, bytes);
    const wrongName = call(digest, wrongFilename);
    assert.notEqual(wrongName.status, 0, 'a different executable name must fail');
    assert.match(wrongName.stderr, /R7_STAGE_FIXED_BUNDLE_FILENAME_REQUIRED/);

    // A matching apphost with adjacent managed code is not a pinned bundle.
    await writeFile(join(dir, 'untrusted-managed.dll'), Buffer.from('not a trusted bundle'));
    const withSidecar = call(digest);
    assert.notEqual(withSidecar.status, 0, 'a managed DLL sidecar must fail');
    assert.match(withSidecar.stderr, /R7_STAGE_NOT_SINGLE_FILE_BUNDLE/);
    await rm(join(dir, 'untrusted-managed.dll'));

    // Hidden files still affect the bundle identity. Exercise actual Windows
    // attributes rather than assuming a filename convention hides a file.
    for (const name of ['hidden-managed.dll', 'hidden.runtimeconfig.json']) {
      const sidecar = join(dir, name);
      await writeFile(sidecar, Buffer.from('hidden untrusted payload'));
      const hide = spawnSync('attrib.exe', ['+H', sidecar], {
        shell: false, windowsHide: true, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(hide.status, 0, hide.stderr || hide.error?.message || 'set hidden attribute');
      const hiddenSidecar = call(digest);
      assert.notEqual(hiddenSidecar.status, 0, `hidden ${name} must fail`);
      assert.match(hiddenSidecar.stderr, /R7_STAGE_NOT_SINGLE_FILE_BUNDLE/);
      await rm(sidecar, { force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
