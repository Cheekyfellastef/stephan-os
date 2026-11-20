import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const project = readFileSync(fileURLToPath(new URL('Stephanos.CanonicalMailboxNativeEvidenceHost.csproj', root)), 'utf8');
const source = readFileSync(fileURLToPath(new URL('Program.cs', root)), 'utf8');

test('original native mailbox host is a one-shot .NET 8 executable linked to the existing signer library', () => {
  assert.match(project, /<OutputType>Exe<\/OutputType>/);
  assert.match(project, /<TargetFramework>net8\.0-windows<\/TargetFramework>/);
  assert.match(project, /<RestorePackagesWithLockFile>true<\/RestorePackagesWithLockFile>/);
  assert.match(project, /<CopyLocalLockFileAssemblies>true<\/CopyLocalLockFileAssemblies>/);
  assert.match(project, /<ProjectReference Include="\.\.\/Stephanos\.CanonicalMailboxNativeEvidence\/Stephanos\.CanonicalMailboxNativeEvidence\.csproj" \/>/);
  assert.deepEqual([...project.matchAll(/<Compile Include="([^"]+)" \/>/g)].map(x => x[1]), ['Program.cs']);
});

test('no command arguments, dynamic execution, key access, signer invocation or mailbox mutation is exposed', () => {
  assert.match(source, /if \(args\.Length != 0\)/);
  assert.match(source, /NATIVE_ROTATION_ARGUMENTS_FORBIDDEN/);
  assert.match(source, /WindowsIdentity\.GetCurrent\(\)/);
  assert.match(source, /!identity\.IsSystem/);
  assert.match(source, /NATIVE_ROTATION_PROTECTED_IMAGE_UNPROVEN/);
  assert.match(source, /NATIVE_ROTATION_PRODUCER_UNQUALIFIED/);
  assert.doesNotMatch(source, /Process\.Start\s*\(|File\.Write|FileStream\s*\(|HttpClient|WebClient|CreateProcess|NativeEvidenceSigningSession\s*\(|GetPrivateKey|GetEnvironmentVariable|Registry\./);
});

test('one-shot host refuses to authenticate or activate itself, even when library links', () => {
  for (const literal of [
    'originalGuardHeld = false', 'separatelyProtectedSignerQualified = false',
    'keyEnrollmentCommissioned = false', 'signedEvidenceIssued = false',
    'freezeCertified = false', 'sourceSyncAuthorized = false', 'newMailboxActive = false',
  ]) assert.ok(source.includes(literal), literal);
  assert.match(source, /status = "BLOCKED"/);
  assert.match(source, /return 2;/);
});
