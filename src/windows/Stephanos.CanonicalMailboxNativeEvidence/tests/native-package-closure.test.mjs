import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const project = readFileSync(fileURLToPath(new URL('../Stephanos.CanonicalMailboxNativeEvidence.csproj', import.meta.url)), 'utf8');
const lock = JSON.parse(readFileSync(fileURLToPath(new URL('../packages.lock.json', import.meta.url)), 'utf8'));

test('native evidence library copies its exact locked cryptographic dependency to production output', () => {
  assert.match(project, /<TargetFramework>net8\.0-windows<\/TargetFramework>/);
  assert.match(project, /<RestorePackagesWithLockFile>true<\/RestorePackagesWithLockFile>/);
  assert.match(project, /<CopyLocalLockFileAssemblies>true<\/CopyLocalLockFileAssemblies>/);
  assert.match(project, /<RestoreLockedMode Condition="'\$\(CI\)' == 'true'">true<\/RestoreLockedMode>/);
  assert.match(project, /<PackageReference Include="BouncyCastle\.Cryptography" Version="\[2\.7\.0\]" \/>/);
  const item = lock.dependencies?.['net8.0-windows7.0']?.['BouncyCastle.Cryptography'];
  assert.deepEqual({type:item?.type,requested:item?.requested,resolved:item?.resolved},
    {type:'Direct',requested:'[2.7.0, 2.7.0]',resolved:'2.7.0'});
  assert.equal(typeof item.contentHash, 'string');
  assert.ok(item.contentHash.length > 40);
});

test('runtime dependency packaging cannot create an executable signing entry or loosen build checks', () => {
  assert.match(project, /<EnableDefaultCompileItems>false<\/EnableDefaultCompileItems>/);
  assert.match(project, /<TreatWarningsAsErrors>true<\/TreatWarningsAsErrors>/);
  const compiles = [...project.matchAll(/<Compile Include="([^"]+)" \/>/g)].map(m=>m[1]);
  assert.deepEqual(compiles, ['CanonicalMailboxNativeEvidenceProducer.cs']);
  assert.doesNotMatch(project, /<OutputType>Exe<\/OutputType>|<AllowUnsafeBlocks>true<\/AllowUnsafeBlocks>|<NoWarn>/);
});
