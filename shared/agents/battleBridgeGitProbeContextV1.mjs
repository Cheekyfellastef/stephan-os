// Private administrative input for the existing canonical Git source probe.
// It is not a worktree registration, source writer, signer or execution route.
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdtempSync, openSync,
  readSync, readdirSync, realpathSync, rmdirSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseBattleBridgeNullConfigV1, validateBattleBridgeLocalGitConfiguration } from './battleBridgeExecutionBoundaryV1.mjs';

const contexts = new WeakMap();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const deny = code => { throw Object.assign(new Error(code), { code }); };
const samePath = (a, b) => process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

function directory(name) {
  const info = lstatSync(name, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(realpathSync(name), name))
    deny('CANONICAL_GIT_PROBE_DIRECTORY_UNPROVEN');
  return info;
}

function file(name, limit) {
  let fd;
  try {
    const before = lstatSync(name, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
      || before.size < 0n || before.size > BigInt(limit) || !samePath(realpathSync(name), name))
      deny('CANONICAL_GIT_PROBE_FILE_UNPROVEN');
    fd = openSync(name, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = fstatSync(fd, { bigint: true });
    if (!sameFile(before, opened)) deny('CANONICAL_GIT_PROBE_FILE_CHANGED');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (!count) break;
      offset += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (offset !== Number(before.size) || !sameFile(before, after)
      || !sameFile(before, lstatSync(name, { bigint: true }))) deny('CANONICAL_GIT_PROBE_FILE_CHANGED');
    const bytes = Buffer.from(buffer.subarray(0, offset));
    return { name, limit, info: after, bytes, digest: sha256(bytes) };
  } finally { if (fd !== undefined) closeSync(fd); }
}

function sameFile(a, b) {
  return b.isFile() && !b.isSymbolicLink() && b.nlink === 1n
    && a.dev === b.dev && a.ino === b.ino && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function unchanged(saved) {
  const current = file(saved.name, saved.limit);
  return sameFile(saved.info, current.info) && saved.digest === current.digest;
}

function verifyPrivate(record) {
  const current = directory(record.privateRoot);
  if (current.dev !== record.privateIdentity.dev || current.ino !== record.privateIdentity.ino)
    deny('CANONICAL_GIT_PROBE_CONTEXT_CHANGED');
  const names = readdirSync(record.privateRoot);
  const capturedNames = record.privateFiles.map(saved => path.basename(saved.name));
  if (names.some(name => !capturedNames.includes(name) && !(record.privateFiles.length === 4 && name === 'FETCH_HEAD')))
    deny('CANONICAL_GIT_PROBE_CONTEXT_CHANGED');
  for (const saved of record.privateFiles) if (!unchanged(saved)) deny('CANONICAL_GIT_PROBE_CONTEXT_CHANGED');
  if (names.includes('FETCH_HEAD')) file(path.join(record.privateRoot, 'FETCH_HEAD'), 64 * 1024);
}

function verify(record) {
  if (!record.active) deny('CANONICAL_GIT_PROBE_CONTEXT_CLOSED');
  for (const [name, saved] of [[record.root, record.rootIdentity], [record.gitDirectory, record.gitIdentity]]) {
    const current = directory(name);
    if (current.dev !== saved.dev || current.ino !== saved.ino) deny('CANONICAL_GIT_PROBE_ORIGINAL_CHANGED');
  }
  if (!unchanged(record.head) || !unchanged(record.index)) deny('CANONICAL_GIT_PROBE_ORIGINAL_CHANGED');
  verifyPrivate(record);
}

function assertRecord(record) {
  try { verify(record); return true; }
  catch (error) { deny(String(error?.code || '').startsWith('CANONICAL_GIT_PROBE_')
    ? error.code : 'CANONICAL_GIT_PROBE_CONTEXT_CHANGED'); }
}

export function createBattleBridgeGitProbeContextV1(repoRoot) {
  let record;
  try {
    const root = path.resolve(repoRoot), gitDirectory = path.join(root, '.git');
    if (/[\0\r\n]/.test(root)) deny('CANONICAL_GIT_PROBE_DIRECTORY_UNPROVEN');
    const rootIdentity = directory(root), gitIdentity = directory(gitDirectory);
    const head = file(path.join(gitDirectory, 'HEAD'), 4096);
    if (!/^(?:ref: refs\/heads\/[A-Za-z0-9._/-]+|[a-f0-9]{40})\r?\n?$/.test(head.bytes.toString('ascii'))
      || head.bytes.includes(Buffer.from('..'))) deny('CANONICAL_GIT_PROBE_HEAD_UNSUPPORTED');
    // Match the existing canonical topology's bounded index capture.
    const index = file(path.join(gitDirectory, 'index'), 1024 * 1024);
    if (index.bytes.length < 32 || index.bytes.toString('ascii', 0, 4) !== 'DIRC'
      || ![2, 3, 4].includes(index.bytes.readUInt32BE(4))
      || !createHash('sha1').update(index.bytes.subarray(0, -20)).digest().equals(index.bytes.subarray(-20)))
      deny('CANONICAL_GIT_PROBE_INDEX_UNSUPPORTED');
    const conservativeSecond = index.info.mtimeNs / 1_000_000_000n - 1n;
    if (conservativeSecond <= 0n || conservativeSecond > BigInt(Number.MAX_SAFE_INTEGER))
      deny('CANONICAL_GIT_PROBE_INDEX_TIMESTAMP_UNPROVEN');
    const privateRoot = mkdtempSync(path.join(tmpdir(), 'stephanos-git-source-probe-'));
    record = { root, gitDirectory, rootIdentity, gitIdentity, head, index, privateRoot,
      privateIdentity: directory(privateRoot), privateFiles: [], active: true };
    for (const [name, bytes] of [['HEAD', head.bytes], ['index', index.bytes],
      ['commondir', Buffer.from(gitDirectory.replace(/\\/g, '/') + '\n')], ['config.worktree', Buffer.alloc(0)]]) {
      const target = path.join(privateRoot, name);
      writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
      if (name === 'index') utimesSync(target, Number(conservativeSecond), Number(conservativeSecond));
      record.privateFiles.push(file(target, name === 'index' ? 1024 * 1024 : 4096));
    }
    const copiedIndex = record.privateFiles.find(saved => path.basename(saved.name) === 'index');
    if (copiedIndex.info.mtimeNs < 1_000_000_000n || copiedIndex.info.mtimeNs > index.info.mtimeNs)
      deny('CANONICAL_GIT_PROBE_INDEX_TIMESTAMP_UNPROVEN');
    const context = Object.freeze({
      assert: () => assertRecord(record),
      repositoryArgs: () => { assertRecord(record); return Object.freeze([
        `--git-dir=${privateRoot}`, `--work-tree=${root}`,
      ]); },
      indexSnapshotSha256: index.digest,
      close: () => {
        if (!record.active) return true;
        record.active = false;
        // No recursive delete and no pruning. Unknown identity/content is held
        // for inspection, rather than deleting an unproven directory or file.
        try {
          verifyPrivate(record);
          for (const name of readdirSync(privateRoot)) unlinkSync(path.join(privateRoot, name));
          rmdirSync(privateRoot);
          return true;
        } catch { deny('CANONICAL_GIT_PROBE_CLEANUP_UNPROVEN'); }
      },
    });
    contexts.set(context, record);
    verify(record);
    return context;
  } catch (error) {
    if (record?.active) {
      record.active = false;
      try {
        verifyPrivate(record);
        for (const name of readdirSync(record.privateRoot)) unlinkSync(path.join(record.privateRoot, name));
        rmdirSync(record.privateRoot);
      } catch { /* Leave unproven private metadata intact; never delete by guess. */ }
    }
    deny(String(error?.message || '').startsWith('CANONICAL_GIT_PROBE_')
      ? error.message : 'CANONICAL_GIT_PROBE_CONTEXT_UNPROVEN');
  }
}

export function isBattleBridgeGitProbeContextV1(context, repoRoot) {
  const record = context && contexts.get(context);
  if (!record || typeof repoRoot !== 'string' || !samePath(record.root, repoRoot)) return false;
  try { verify(record); return true; } catch { return false; }
}

// Reuse the closed canonical configuration model. Only the extension whose
// input namespace is actually isolated is projected out; every other key,
// value, duplicate origin and unsafe category retains the original policy.
export function validateBattleBridgeGitProbeConfigurationV1(output, {
  gitProbeContext, repoRoot, validateBase = validateBattleBridgeLocalGitConfiguration,
} = {}) {
  const entries = parseBattleBridgeNullConfigV1(output);
  const declarations = entries.filter(entry => entry.key === 'extensions.worktreeconfig');
  if (declarations.length !== 1 || declarations[0].value.toLowerCase() !== 'true'
    || !isBattleBridgeGitProbeContextV1(gitProbeContext, repoRoot)) return validateBase(output);
  const projected = entries.filter(entry => entry.key !== 'extensions.worktreeconfig')
    .map(entry => entry.key + '\n' + entry.value + '\0').join('');
  return Object.freeze({ ...validateBase(projected), worktreeConfigurationIsolated: true });
}
