import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateGitStatusForIgnition } from '../../scripts/ignite-stephanos-local.mjs';
import { RESCUE_ISLAND_NATIVE_HOST_FILES, RESCUE_ISLAND_NATIVE_HOST_RELATIVE,
  RESCUE_ISLAND_NATIVE_SOURCE_BLOBS, observeRescueIslandNativeHostV1,
  resolveRescueIslandNativeHostV1 } from './rescueIslandNativeHostLocationV1.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function fixture(t) {
  const base = resolve(tmpdir()), root = mkdtempSync(join(base, 'island-host-location-'));
  assert.ok(!relative(base, root).startsWith('..'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  for (const path of Object.keys(RESCUE_ISLAND_NATIVE_SOURCE_BLOBS)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(repo, path), join(root, path));
  }
  const output = dirname(resolveRescueIslandNativeHostV1(root));
  mkdirSync(output, { recursive: true });
  for (const name of Object.keys(RESCUE_ISLAND_NATIVE_HOST_FILES)) writeFileSync(join(output, name), 'unapproved fixture bytes');
  return { root, output };
}
const rejects = (root, code) => assert.throws(() => observeRescueIslandNativeHostV1(root), { code });

test('one fixed generated path preserves the unchanged native six-parent source root', () => {
  const executable = resolveRescueIslandNativeHostV1(repo);
  assert.equal(relative(repo, dirname(executable)).replaceAll('\\', '/'), RESCUE_ISLAND_NATIVE_HOST_RELATIVE);
  assert.equal(resolve(dirname(executable), '../../../../../..'), repo);
  assert.throws(() => resolveRescueIslandNativeHostV1('relative'), { code: 'ISLAND_HOST_NATIVE_LOCATION_INVALID' });
});

test('uses the existing generated-estate classification without exempting source build outputs', () => {
  assert.equal(evaluateGitStatusForIgnition('!! .stephanos/local-state-checkpoints/\n').meaningfulEntries.length, 0);
  assert.equal(evaluateGitStatusForIgnition('!! src/windows/Stephanos.RescueIslandHost/bin/\n').meaningfulEntries.length, 1);
  assert.equal(evaluateGitStatusForIgnition('?? .stephanos/local-state-checkpoints/\n').meaningfulEntries.length, 1);
});

test('a complete inventory of arbitrary binaries cannot become an approved host', t => {
  const f = fixture(t); rejects(f.root, 'ISLAND_HOST_NATIVE_ARTIFACT_CHANGED');
});

test('oversized artifacts are refused before reading their contents', t => {
  const f = fixture(t), name = Object.keys(RESCUE_ISLAND_NATIVE_HOST_FILES).sort()[0];
  truncateSync(join(f.output, name), 2 * 1024 * 1024 + 1);
  rejects(f.root, 'ISLAND_HOST_NATIVE_FILE_BOUNDS');
});

test('missing or extra artifact names hold instead of silently accepting a partial directory', t => {
  const f = fixture(t), name = Object.keys(RESCUE_ISLAND_NATIVE_HOST_FILES)[0];
  rmSync(join(f.output, name)); rejects(f.root, 'ISLAND_HOST_NATIVE_ARTIFACT_INVENTORY_CHANGED');
  writeFileSync(join(f.output, name), 'not approved');
  writeFileSync(join(f.output, 'extra.dll'), 'not approved');
  rejects(f.root, 'ISLAND_HOST_NATIVE_ARTIFACT_INVENTORY_CHANGED');
});

test('changed source, including BOM-only changes, cannot reuse the historical binary profile', t => {
  const f = fixture(t), path = join(f.root, Object.keys(RESCUE_ISLAND_NATIVE_SOURCE_BLOBS)[0]);
  const original = readFileSync(path);
  writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]));
  rejects(f.root, 'ISLAND_HOST_NATIVE_SOURCE_CHANGED');
  writeFileSync(path, Buffer.concat([original, Buffer.from('\n// changed\n')]));
  rejects(f.root, 'ISLAND_HOST_NATIVE_SOURCE_CHANGED');
});

test('new native source or ancestor build customization invalidates the historical source profile', t => {
  const f = fixture(t), extra = join(f.root, 'src/windows/Stephanos.RescueIslandHost/Extra.cs');
  writeFileSync(extra, 'class Extra {}'); rejects(f.root, 'ISLAND_HOST_NATIVE_SOURCE_INVENTORY_CHANGED');
  rmSync(extra); writeFileSync(join(f.root, 'Directory.Build.props'), '<Project/>');
  rejects(f.root, 'ISLAND_HOST_NATIVE_SOURCE_INVENTORY_CHANGED');
});

test('a hardlinked artifact is rejected before its bytes can be trusted', t => {
  const f = fixture(t), path = join(f.output, Object.keys(RESCUE_ISLAND_NATIVE_HOST_FILES).sort()[0]);
  rmSync(path); const outside = join(f.root, 'other-file'); writeFileSync(outside, 'unapproved'); linkSync(outside, path);
  rejects(f.root, 'ISLAND_HOST_NATIVE_PATH_UNSAFE');
});

test('a redirected generated parent is not an approved host location', t => {
  const f = fixture(t), parent = join(f.root, '.stephanos/local-state-checkpoints');
  rmSync(parent, { recursive: true });
  const outside = join(f.root, 'redirected'); mkdirSync(outside);
  symlinkSync(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');
  rejects(f.root, 'ISLAND_HOST_NATIVE_PATH_UNSAFE');
});

test('an absent primary Git directory or host is fail closed', t => {
  const f = fixture(t); rmSync(join(f.root, '.git'), { recursive: true });
  rejects(f.root, 'ISLAND_HOST_NATIVE_ARTIFACT_MISSING');
});
