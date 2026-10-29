// Fixed production placement for the original cooperative Island executable.
// Observation only: no copy, build, enrollment, claim or execution grant.
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const RESCUE_ISLAND_NATIVE_HOST_RELATIVE =
  '.stephanos/local-state-checkpoints/rescue-island-native-host/bin/Release/net8.0-windows';
export const RESCUE_ISLAND_NATIVE_HOST_FILES = Object.freeze({
  'Stephanos.RescueIslandCustody.dll': 'e3befd67b410860494b7f1557abebfe25ef979156997458774d5c08e3a111998',
  'Stephanos.RescueIslandCustody.pdb': 'd76c27199b500c33e8902fc2e60fdacdd3c90d3b713488bd128d99aa93889cbe',
  'Stephanos.RescueIslandHost.deps.json': '689f1638fd92d0c266f1cf7397a4679f80d096d2b8b7ec28c4d17c4ad049cd88',
  'Stephanos.RescueIslandHost.dll': 'a22775574e7ecdb67143eb7479a3d14b763ed5f018a0b1a9afb7b9ce8779e370',
  'Stephanos.RescueIslandHost.exe': 'd880eeb6807cb60bfb5f0f23a4617498a443a376aac5c75f3199a61fc7f34d89',
  'Stephanos.RescueIslandHost.pdb': '52358039d4ad5220f9b4d0428e39b50a85562efd9f54d4e224471867d5766a10',
  'Stephanos.RescueIslandHost.runtimeconfig.json': '28329cf08f6505e73806b17558b187c02f0c1c516fe47ebfb7a013d082aaa306',
});
export const RESCUE_ISLAND_NATIVE_SOURCE_BLOBS = Object.freeze({
  'src/windows/Stephanos.RescueIslandHost/Program.cs': '0aee75853fbd9466a753dbe420331c720071a634',
  'src/windows/Stephanos.RescueIslandHost/Stephanos.RescueIslandHost.csproj': '4d7bf4cfc35c7880086903172ea3dcdbfe9502a4',
  'src/windows/Stephanos.RescueIslandCustody/PinnedFileSnapshot.cs': '55dd96597300c69444898039e7cc21b8da46e7fb',
  'src/windows/Stephanos.RescueIslandCustody/PinnedFileCreation.cs': 'a9cf79526d4cc138b74fd74e4266c8abd5cc7565',
  'src/windows/Stephanos.RescueIslandCustody/PinnedProposalCustody.cs': 'a772d4225b12ebd3fa609a4387a89d23346f40f0',
  'src/windows/Stephanos.RescueIslandCustody/Stephanos.RescueIslandCustody.csproj': '734356f4ee1acc65f533d6827754f99b7c3be23e',
  'src/windows/Stephanos.RescueIslandCustody/WindowsProcessPrincipalObservation.cs': '2621fa877a27680cfae8b45c83c5262ccf2b2c60',
});
const fold = p => process.platform === 'win32' ? p.toLowerCase() : p;
const held = code => { throw Object.assign(new Error(code), { code }); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function resolveRescueIslandNativeHostV1(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || !isAbsolute(repositoryRoot))
    held('ISLAND_HOST_NATIVE_LOCATION_INVALID');
  return join(resolve(repositoryRoot), RESCUE_ISLAND_NATIVE_HOST_RELATIVE, 'Stephanos.RescueIslandHost.exe');
}

function physical(root, path, directory) {
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) held('ISLAND_HOST_NATIVE_PATH_UNSAFE');
  let current = root;
  for (const part of ['', ...rel.split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    const st = lstatSync(current);
    if (st.isSymbolicLink() || fold(realpathSync(current)) !== fold(resolve(current)))
      held('ISLAND_HOST_NATIVE_PATH_UNSAFE');
    if (current !== path && !st.isDirectory()) held('ISLAND_HOST_NATIVE_PATH_UNSAFE');
  }
  const st = lstatSync(path);
  if (directory ? !st.isDirectory() : (!st.isFile() || st.nlink !== 1)) held('ISLAND_HOST_NATIVE_PATH_UNSAFE');
  return st;
}

function pinnedRead(root, path) {
  const before = physical(root, path, false);
  if (before.size < 1 || before.size > 2 * 1024 * 1024) held('ISLAND_HOST_NATIVE_FILE_BOUNDS');
  const fd = openSync(path, 'r');
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs) held('ISLAND_HOST_NATIVE_FILE_CHANGED');
    // Never let a file growing after stat turn this observation into an
    // unbounded allocation/read. One extra byte detects growth at the bound.
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    const after = physical(root, path, false), closed = fstatSync(fd);
    if ([after, closed].some(st => st.dev !== before.dev || st.ino !== before.ino
      || st.size !== before.size || st.mtimeMs !== before.mtimeMs || st.nlink !== 1)
      || length !== before.size) held('ISLAND_HOST_NATIVE_FILE_CHANGED');
    return buffer.subarray(0, length);
  } finally { closeSync(fd); }
}

function verifySource(root) {
  for (const parent of ['', 'src', 'src/windows', 'src/windows/Stephanos.RescueIslandHost', 'src/windows/Stephanos.RescueIslandCustody']) {
    for (const name of ['Directory.Build.props', 'Directory.Build.targets']) {
      try { lstatSync(join(root, parent, name)); }
      catch (error) { if (error?.code === 'ENOENT') continue; throw error; }
      held('ISLAND_HOST_NATIVE_SOURCE_INVENTORY_CHANGED');
    }
  }
  for (const directory of ['src/windows/Stephanos.RescueIslandHost', 'src/windows/Stephanos.RescueIslandCustody']) {
    const expected = Object.keys(RESCUE_ISLAND_NATIVE_SOURCE_BLOBS)
      .filter(p => p.startsWith(directory + '/')).map(p => p.slice(directory.length + 1));
    physical(root, join(root, directory), true);
    if (readdirSync(join(root, directory)).some(name => ![...expected, 'README.md', 'bin', 'obj'].includes(name)))
      held('ISLAND_HOST_NATIVE_SOURCE_INVENTORY_CHANGED');
  }
  for (const [path, blob] of Object.entries(RESCUE_ISLAND_NATIVE_SOURCE_BLOBS)) {
    const raw = pinnedRead(root, join(root, path));
    // The original native sources allow checkout CRLF. Only line endings differ;
    // executable/project text must still be the exact protected Git blob.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw).replace(/\r\n/g, '\n');
    if (text.includes('\r') || text.includes('\0')) held('ISLAND_HOST_NATIVE_SOURCE_CHANGED');
    const bytes = Buffer.from(text, 'utf8');
    const observed = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    if (observed !== blob) held('ISLAND_HOST_NATIVE_SOURCE_CHANGED');
  }
}

export function observeRescueIslandNativeHostV1(repositoryRoot) {
  const executable = resolveRescueIslandNativeHostV1(repositoryRoot), root = resolve(repositoryRoot);
  try {
    physical(root, join(root, '.git'), true); // The unchanged host requires a primary checkout.
    verifySource(root);
    const directory = resolve(executable, '..');
    physical(root, directory, true);
    const expected = Object.keys(RESCUE_ISLAND_NATIVE_HOST_FILES).sort();
    if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expected))
      held('ISLAND_HOST_NATIVE_ARTIFACT_INVENTORY_CHANGED');
    const files = {};
    for (const name of expected) {
      const observed = sha256(pinnedRead(root, join(directory, name)));
      if (observed !== RESCUE_ISLAND_NATIVE_HOST_FILES[name]) held('ISLAND_HOST_NATIVE_ARTIFACT_CHANGED');
      files[name] = observed;
    }
    return Object.freeze({ executable, files: Object.freeze(files),
      profile: 'ORIGINAL_SUPERVISED_COOPERATIVE_HOST_V1', executionAuthority: false });
  } catch (error) {
    if (String(error?.code || '').startsWith('ISLAND_HOST_')) throw error;
    held(error?.code === 'ENOENT' ? 'ISLAND_HOST_NATIVE_ARTIFACT_MISSING' : 'ISLAND_HOST_NATIVE_ARTIFACT_UNPROVEN');
  }
}
