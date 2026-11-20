// Test-only isolated package probe. The native process boundary is intercepted.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2]);
assert.ok(root.startsWith(resolve(tmpdir()) + sep));
assert.ok(root.split(sep).at(-1).startsWith('sovereign-directory-package-'));
const { executeSovereignDirectoryCreateV1 } = await import(pathToFileURL(join(root, 'shared/agents/sovereignDirectoryCreateV1.mjs')).href);
const helpers = ['scripts/windows/sovereign-create-directory.ps1', 'scripts/windows/SovereignDirectoryCreateV1.cs'];
const captured = helpers.map(path => readFileSync(join(root, path)));
const target = 'C:\\fixture\\uncreated-directory';
let spawns = 0;
const spawnSyncFn = (executable, args, options) => {
  spawns += 1;
  assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(args.at(-2), '-EncodedCommand');
  assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le'), captured[0].toString('utf8'));
  assert.equal(JSON.parse(options.input).nativeSource, captured[1].toString('utf8'));
  assert.equal(options.timeout, 15000);
  assert.equal(options.maxBuffer, 16384);
  assert.equal(options.shell, false);
  // Replacing disk files after capture cannot alter the command's approved buffers.
  for (const path of helpers) writeFileSync(join(root, path), 'replaced-after-capture');
  assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le'), captured[0].toString('utf8'));
  assert.equal(JSON.parse(options.input).nativeSource, captured[1].toString('utf8'));
  return { status: 0, stdout: JSON.stringify({ schemaVersion: 'stephanos.sovereign-directory-create.v1',
    ok: true, path: target, created: true, recursive: false, mutationState: 'CREATED',
    identity: '01234567:0123456789abcdef', parentIdentity: '89abcdef:fedcba9876543210' }) };
};
const options = { platform: 'win32', spawnSyncFn };
for (let index = 0; index < helpers.length; index++) {
  const path = join(root, helpers[index]);
  unlinkSync(path);
  assert.equal(executeSovereignDirectoryCreateV1(target, options).blocker, 'SOVEREIGN_DIRECTORY_SOURCE_UNAVAILABLE');
  assert.equal(spawns, 0);
  for (const bytes of [
    Buffer.from('tampered'),
    Buffer.from('\ufeff' + captured[index].toString('utf8')),
    Buffer.from(captured[index].toString('utf8').replace(/\r?\n/g, '\r\n')),
  ]) {
    writeFileSync(path, bytes);
    assert.equal(executeSovereignDirectoryCreateV1(target, options).blocker, 'SOVEREIGN_DIRECTORY_SOURCE_MISMATCH');
    assert.equal(spawns, 0);
  }
  writeFileSync(path, captured[index]);
}
assert.equal(executeSovereignDirectoryCreateV1(target, options).ok, true);
assert.equal(spawns, 1);
console.log(JSON.stringify({ realNativeSpawn: false, capturedBuffersVerified: true,
  missingAndTamperedRefused: true, canonicalFallback: false }));
