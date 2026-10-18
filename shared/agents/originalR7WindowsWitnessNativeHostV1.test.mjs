import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../src/windows/Stephanos.OriginalR7CustodyWitness/', import.meta.url);
const program = await readFile(new URL('Program.cs', root), 'utf8');
const scm = await readFile(new URL('OriginalR7ScmPreflight.cs', root), 'utf8');
const project = await readFile(new URL('Stephanos.OriginalR7CustodyWitness.csproj', root), 'utf8');
const guide = await readFile(new URL('README.md', root), 'utf8');
const nativeCi = await readFile(new URL('../../.github/workflows/original-r7-native-windows-proof.yml', import.meta.url), 'utf8');

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
  assert.match(guide, /NO installer or release command/);
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
