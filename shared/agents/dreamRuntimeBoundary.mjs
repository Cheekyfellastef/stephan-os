import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireSharedWorkspaceOperationLock } from './executionReceiptV1.mjs';
import {
  defaultOpenClawWorkspaceRoot,
  defaultRuntimeRoot,
  getRuntimePath,
} from './runtimeBoundaryRegistry.mjs';

export const DREAM_RUNTIME_BOUNDARY_SCHEMA = 'stephanos.dream-runtime-boundary.v1';
export const DREAM_VERSIONED_PRESERVATION_SCHEMA = 'stephanos.dream-versioned-preservation.v1';
export const DREAM_RUNTIME_MIGRATION_APPROVAL = 'operator-approved-dream-migration';
export const DREAM_VERSIONED_PRESERVATION_DIRECTORY = '.stephanos-preservation';

export function dreamDirectoryHandleNamespace(platform = process.platform) {
  if (platform === 'linux') return '/proc/self/fd';
  if (platform === 'darwin') return '/dev/fd';
  return '';
}

export const DREAM_EVENT_SET_RELATIONS = Object.freeze({
  IDENTICAL_CONTENT: 'IDENTICAL_CONTENT',
  SOURCE_STRICT_APPEND_OF_DESTINATION: 'SOURCE_STRICT_APPEND_OF_DESTINATION',
  DESTINATION_STRICT_APPEND_OF_SOURCE: 'DESTINATION_STRICT_APPEND_OF_SOURCE',
  DISJOINT_EVENT_SETS: 'DISJOINT_EVENT_SETS',
  PARTIAL_OVERLAP_COMPATIBLE: 'PARTIAL_OVERLAP_COMPATIBLE',
  CONFLICTING_DUPLICATE_IDENTITIES: 'CONFLICTING_DUPLICATE_IDENTITIES',
  MALFORMED_OR_AMBIGUOUS: 'MALFORMED_OR_AMBIGUOUS',
  OPAQUE_DIFFERENT_CONTENT: 'OPAQUE_DIFFERENT_CONTENT',
});

export const DREAM_RUNTIME_LEGACY_MAPPINGS = Object.freeze([
  Object.freeze({
    id: 'hidden-dream-state',
    legacyRelativePath: 'memory/.dreams',
    externalRelativePath: '.dreams',
  }),
  Object.freeze({
    id: 'dream-journals',
    legacyRelativePath: 'memory/dreaming',
    externalRelativePath: 'dreaming',
  }),
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_HEAD_PATTERN = /^[a-f0-9]{40}$/;
const MAX_EVENT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_LINE_BYTES = 64 * 1024;
const MAX_EVENT_COUNT = 20_000;
const MAX_MANIFEST_BYTES = 64 * 1024;
const DIRECTORY_GUARD_TIMEOUT_MS = 15_000;
const DIRECTORY_GUARD_OUTPUT_LIMIT = 4 * 1024;
const MAX_WINDOWS_ARTIFACT_BYTES = 64 * 1024 * 1024;
const WINDOWS_ARTIFACT_IO_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'windows',
  'dream-runtime-artifact-io.ps1',
);

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeComparable(value = '') {
  const resolved = path.resolve(String(value || '.'));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return normalizeComparable(left) === normalizeComparable(right);
}

export function pathIsInside(parent, candidate) {
  const root = normalizeComparable(parent);
  const target = normalizeComparable(candidate);
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeRelativePath(value) {
  const normalized = String(value || '');
  if (normalized.includes('\\')) return '';
  if (!normalized || normalized.includes('\0') || path.posix.isAbsolute(normalized)) return '';
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return segments.join('/');
}

export function normalizeDreamHostRelativePath(value, platform = process.platform) {
  const raw = String(value || '');
  return safeRelativePath(platform === 'win32' ? raw.replaceAll('\\', '/') : raw);
}

function logicalSourcePath(mapping, relativePath) {
  const relative = safeRelativePath(relativePath);
  if (!relative) throw codedError('DREAM_VERSIONED_LOGICAL_PATH_INVALID');
  return `${mapping.legacyRelativePath}/${relative}`;
}

function mappingForEntry(entry = {}) {
  return DREAM_RUNTIME_LEGACY_MAPPINGS.find((mapping) => mapping.id === entry.mappingId) || null;
}

export function resolveDreamRuntimeBoundary({
  repoRoot,
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  const canonicalRepoRoot = path.resolve(repoRoot || path.join(homeDir, 'Documents', 'GitHub', 'stephan-os'));
  const workspaceRoot = defaultOpenClawWorkspaceRoot({ env, homeDir });
  const runtimeRoot = defaultRuntimeRoot({ env, homeDir });
  const dreamMemoryRoot = getRuntimePath('dreams', { env, homeDir });
  const receiptRoot = path.join(runtimeRoot, 'receipts', 'runtime-boundary');
  const mappings = DREAM_RUNTIME_LEGACY_MAPPINGS.map((mapping) => Object.freeze({
    ...mapping,
    sourcePath: path.resolve(canonicalRepoRoot, mapping.legacyRelativePath),
    destinationPath: path.resolve(dreamMemoryRoot, mapping.externalRelativePath),
  }));
  const unsafePaths = [workspaceRoot, runtimeRoot, dreamMemoryRoot, receiptRoot, ...mappings.map((mapping) => mapping.destinationPath)]
    .filter((candidate) => pathIsInside(canonicalRepoRoot, candidate));
  const ok = unsafePaths.length === 0;
  return Object.freeze({
    ok,
    schemaVersion: DREAM_RUNTIME_BOUNDARY_SCHEMA,
    blocker: ok ? '' : 'DREAM_RUNTIME_ROOT_INSIDE_REPOSITORY',
    repoRoot: canonicalRepoRoot,
    workspaceRoot,
    runtimeRoot,
    dreamMemoryRoot,
    receiptRoot,
    mappings: Object.freeze(mappings),
    unsafePaths: Object.freeze(unsafePaths),
    launchContext: Object.freeze({
      cwd: workspaceRoot,
      env: Object.freeze({
        STEPHANOS_OPENCLAW_WORKSPACE: workspaceRoot,
        STEPHANOS_DREAMS_ROOT: dreamMemoryRoot,
      }),
    }),
  });
}

async function exists(target, fsImpl) {
  try {
    await fsImpl.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function filesystemAncestors(target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const relative = path.relative(parsed.root, resolved);
  const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
  const output = [parsed.root];
  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    output.push(current);
  }
  return output;
}

async function windowsAncestorIdentityProof(ancestorIdentities) {
  const identities = [];
  for (const { directory, identity } of ancestorIdentities) {
    const nativeIdentity = await fs.lstat(directory, { bigint: true });
    if (Number(nativeIdentity.dev) !== Number(identity?.dev) || Number(nativeIdentity.ino) !== Number(identity?.ino)) {
      throw codedError('DREAM_MIGRATION_WINDOWS_ANCESTOR_CHANGED');
    }
    if (nativeIdentity.dev < 0n || nativeIdentity.ino < 0n) {
      throw codedError('DREAM_MIGRATION_WINDOWS_ANCESTOR_IDENTITY_INVALID');
    }
    identities.push(`${nativeIdentity.dev.toString(16).padStart(8, '0')}:${nativeIdentity.ino.toString(16).padStart(16, '0')}`);
  }
  if (!identities.length) throw codedError('DREAM_MIGRATION_WINDOWS_ANCESTOR_IDENTITY_INVALID');
  return identities.join(',');
}

async function ensureWindowsDirectoryComponent(parentPath, directoryName, parentIdentities) {
  const token = randomUUID();
  const processState = startBoundedWindowsArtifactProcess([
    '-Mode', 'EnsureDirectory',
    '-ParentPath', parentPath,
    '-ArtifactName', directoryName,
    '-Token', token,
    '-ExpectedAncestorIdentities', await windowsAncestorIdentityProof(parentIdentities),
  ]);
  processState.child.stdin.end();
  const output = await processState.awaitExit();
  const readyPattern = new RegExp(`^DIRECTORY_READY:${token}:[a-f0-9:]+$`, 'm');
  if (output.timedOut || output.exit?.code !== 0 || !readyPattern.test(output.stdout) || output.stderr.trim()) {
    throw codedError('DREAM_MIGRATION_DIRECTORY_CREATE_FAILED');
  }
}

async function createSafeDirectoryComponent(directory, parentIdentities, fsImpl) {
  const parentPath = path.dirname(directory);
  const directoryName = path.basename(directory);
  if (!safeRelativePath(directoryName) || path.basename(directoryName) !== directoryName) {
    throw codedError('DREAM_MIGRATION_DIRECTORY_NAME_INVALID');
  }
  if (process.platform === 'win32' && fsImpl === fs) {
    await ensureWindowsDirectoryComponent(parentPath, directoryName, parentIdentities);
    return fsImpl.lstat(directory);
  }
  let boundary = null;
  let info = null;
  let failure = null;
  try {
    boundary = await acquireDirectoryMutationBoundary(parentPath, parentIdentities, fsImpl);
    const operationPath = path.join(boundary.operationParentPath, directoryName);
    try {
      await fsImpl.mkdir(operationPath, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const relativeInfo = await fsImpl.lstat(operationPath);
    if (relativeInfo.isSymbolicLink?.() || !relativeInfo.isDirectory?.()) {
      throw codedError('DREAM_MIGRATION_ANCESTOR_UNSUPPORTED');
    }
    await assertSafeDirectoryChainUnchanged(parentIdentities, { fsImpl });
    info = await fsImpl.lstat(directory);
    if (!sameDirectoryIdentity(relativeInfo, info)) throw codedError('DREAM_MIGRATION_ANCESTOR_CHANGED');
  } catch (error) {
    failure = error;
  }
  const released = boundary ? await boundary.release() : true;
  if (!released && !failure) failure = codedError('DREAM_MIGRATION_DIRECTORY_GUARD_RELEASE_FAILED');
  if (failure) throw failure;
  return info;
}

async function ensureSafeDirectoryChain(target, { fsImpl = fs, create = false } = {}) {
  const identities = [];
  for (const directory of filesystemAncestors(target)) {
    let info;
    try {
      info = await fsImpl.lstat(directory);
    } catch (error) {
      if (error?.code !== 'ENOENT' || !create) throw error;
      info = await createSafeDirectoryComponent(directory, identities, fsImpl);
    }
    if (info.isSymbolicLink?.()) {
      throw codedError('DREAM_MIGRATION_REPARSE_ANCESTOR_BLOCKED', `Linked or reparse ancestor rejected: ${directory}`);
    }
    if (!info.isDirectory?.()) {
      throw codedError('DREAM_MIGRATION_ANCESTOR_UNSUPPORTED', `Non-directory ancestor rejected: ${directory}`);
    }
    identities.push(Object.freeze({ directory, identity: info }));
  }
  return Object.freeze(identities);
}

function sameDirectoryIdentity(before, after) {
  return before?.isDirectory?.() === true
    && after?.isDirectory?.() === true
    && before?.isSymbolicLink?.() !== true
    && after?.isSymbolicLink?.() !== true
    && Number(before?.dev) === Number(after?.dev)
    && Number(before?.ino) === Number(after?.ino)
    && Number(before?.birthtimeMs) === Number(after?.birthtimeMs);
}

async function assertSafeDirectoryChainUnchanged(identities, { fsImpl = fs } = {}) {
  for (const expected of identities) {
    const current = await fsImpl.lstat(expected.directory);
    if (!sameDirectoryIdentity(expected.identity, current)) {
      throw codedError('DREAM_MIGRATION_ANCESTOR_CHANGED');
    }
  }
}

async function assertRegularSingleLink(target, { fsImpl = fs } = {}) {
  const info = await fsImpl.lstat(target);
  if (info.isSymbolicLink?.()) throw codedError('DREAM_MIGRATION_REPARSE_ENTRY_BLOCKED');
  if (!info.isFile?.()) throw codedError('DREAM_MIGRATION_ENTRY_UNSUPPORTED');
  if (Number(info.nlink) !== 1) throw codedError('DREAM_MIGRATION_HARD_LINK_BLOCKED');
  return info;
}

function sameFileIdentity(before, after) {
  return Number(before?.dev) === Number(after?.dev)
    && Number(before?.ino) === Number(after?.ino)
    && Number(before?.size) === Number(after?.size)
    && Number(before?.nlink) === 1
    && Number(after?.nlink) === 1
    && Number(before?.mtimeMs) === Number(after?.mtimeMs);
}

async function collectFiles(root, fsImpl, current = root, output = []) {
  if (!(await exists(root, fsImpl))) return output;
  const stat = await fsImpl.lstat(current);
  if (stat.isSymbolicLink?.()) {
    throw codedError('DREAM_MIGRATION_SYMLINK_BLOCKED', `Symbolic link not allowed in Dream migration: ${current}`);
  }
  if (stat.isFile?.()) {
    if (Number(stat.nlink) !== 1) throw codedError('DREAM_MIGRATION_HARD_LINK_BLOCKED');
    output.push(current);
    return output;
  }
  if (!stat.isDirectory?.()) {
    throw codedError('DREAM_MIGRATION_ENTRY_UNSUPPORTED', `Unsupported Dream migration entry: ${current}`);
  }
  const entries = await fsImpl.readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const child = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw codedError('DREAM_MIGRATION_SYMLINK_BLOCKED');
    if (entry.isDirectory()) await collectFiles(root, fsImpl, child, output);
    else if (entry.isFile()) {
      await assertRegularSingleLink(child, { fsImpl });
      output.push(child);
    } else throw codedError('DREAM_MIGRATION_ENTRY_UNSUPPORTED');
  }
  return output;
}

export async function sha256File(filePath, { fsImpl = fs } = {}) {
  const buffer = await fsImpl.readFile(filePath);
  return sha256(buffer);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function parseDreamEventJsonl(input, role) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ''), 'utf8');
  if (buffer.length > MAX_EVENT_FILE_BYTES) throw codedError('DREAM_EVENT_SET_MALFORMED_OR_AMBIGUOUS', `${role} event file exceeds bound`);
  const physicalLines = buffer.toString('utf8').split(/\r?\n/);
  if (physicalLines.at(-1) === '') physicalLines.pop();
  const records = [];
  for (let index = 0; index < physicalLines.length; index += 1) {
    const line = physicalLines[index];
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_LINE_BYTES || records.length >= MAX_EVENT_COUNT) {
      throw codedError('DREAM_EVENT_SET_MALFORMED_OR_AMBIGUOUS', `${role} event bounds exceeded`);
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw codedError('DREAM_EVENT_SET_MALFORMED_OR_AMBIGUOUS', `${role} contains malformed JSON`);
    }
    if (!record || Array.isArray(record) || typeof record !== 'object') {
      throw codedError('DREAM_EVENT_SET_MALFORMED_OR_AMBIGUOUS', `${role} contains a non-object event`);
    }
    const identity = {};
    for (const field of ['type', 'timestamp', 'phase', 'reportPath']) {
      if (typeof record[field] !== 'string' || !record[field].trim() || record[field].length > 2_048) {
        throw codedError('DREAM_EVENT_SET_MALFORMED_OR_AMBIGUOUS', `${role} event identity is incomplete`);
      }
      identity[field] = record[field];
    }
    if (!Number.isFinite(Date.parse(record.timestamp))) {
      throw codedError('DREAM_EVENT_SET_MALFORMED_OR_AMBIGUOUS', `${role} event timestamp is invalid`);
    }
    records.push(Object.freeze({
      identitySha256: sha256(JSON.stringify(canonicalize(identity))),
      canonicalRecordSha256: sha256(JSON.stringify(canonicalize(record))),
      rawRecordSha256: sha256(Buffer.from(line, 'utf8')),
    }));
  }
  if (!records.length) throw codedError('DREAM_EVENT_SET_MALFORMED_OR_AMBIGUOUS', `${role} event set is empty`);
  return Object.freeze({ fileSha256: sha256(buffer), records: Object.freeze(records) });
}

function identityMap(parsed) {
  const result = new Map();
  for (const record of parsed.records) {
    const previous = result.get(record.identitySha256);
    if (previous) {
      if (previous.canonicalRecordSha256 !== record.canonicalRecordSha256) {
        throw codedError('DREAM_EVENT_SET_CONFLICTING_DUPLICATE_IDENTITIES');
      }
      throw codedError('DREAM_EVENT_SET_DUPLICATE_IDENTITIES');
    }
    result.set(record.identitySha256, record);
  }
  return result;
}

export function classifyDreamEventSets(sourceInput, destinationInput) {
  try {
    const source = parseDreamEventJsonl(sourceInput, 'source');
    const destination = parseDreamEventJsonl(destinationInput, 'destination');
    const sourceMap = identityMap(source);
    const destinationMap = identityMap(destination);
    const overlap = [...sourceMap.keys()].filter((identity) => destinationMap.has(identity));
    const conflicting = overlap.filter((identity) =>
      sourceMap.get(identity).canonicalRecordSha256 !== destinationMap.get(identity).canonicalRecordSha256,
    );
    const sourceSequence = source.records.map((record) => record.identitySha256);
    const destinationSequence = destination.records.map((record) => record.identitySha256);
    const isPrefix = (shorter, longer) => shorter.every((identity, index) => longer[index] === identity);
    let relation = DREAM_EVENT_SET_RELATIONS.PARTIAL_OVERLAP_COMPATIBLE;
    if (source.fileSha256 === destination.fileSha256) relation = DREAM_EVENT_SET_RELATIONS.IDENTICAL_CONTENT;
    else if (conflicting.length) relation = DREAM_EVENT_SET_RELATIONS.CONFLICTING_DUPLICATE_IDENTITIES;
    else if (sourceSequence.length > destinationSequence.length && isPrefix(destinationSequence, sourceSequence)) relation = DREAM_EVENT_SET_RELATIONS.SOURCE_STRICT_APPEND_OF_DESTINATION;
    else if (destinationSequence.length > sourceSequence.length && isPrefix(sourceSequence, destinationSequence)) relation = DREAM_EVENT_SET_RELATIONS.DESTINATION_STRICT_APPEND_OF_SOURCE;
    else if (!overlap.length) relation = DREAM_EVENT_SET_RELATIONS.DISJOINT_EVENT_SETS;
    return Object.freeze({
      ok: true,
      relation,
      sourceEventCount: source.records.length,
      destinationEventCount: destination.records.length,
      overlappingEventCount: overlap.length,
      sourceOnlyEventCount: sourceMap.size - overlap.length,
      destinationOnlyEventCount: destinationMap.size - overlap.length,
      conflictingDuplicateIdentityCount: conflicting.length,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      relation: error?.code === 'DREAM_EVENT_SET_CONFLICTING_DUPLICATE_IDENTITIES'
        ? DREAM_EVENT_SET_RELATIONS.CONFLICTING_DUPLICATE_IDENTITIES
        : DREAM_EVENT_SET_RELATIONS.MALFORMED_OR_AMBIGUOUS,
      blocker: error?.code || 'DREAM_EVENT_SET_MALFORMED_OR_AMBIGUOUS',
    });
  }
}

async function classifyConflict(entry, fsImpl) {
  if (entry.logicalSourcePath !== 'memory/.dreams/events.jsonl') {
    return Object.freeze({ ok: true, relation: DREAM_EVENT_SET_RELATIONS.OPAQUE_DIFFERENT_CONTENT });
  }
  return classifyDreamEventSets(
    await fsImpl.readFile(entry.sourcePath),
    await fsImpl.readFile(entry.destinationPath),
  );
}

export function resolveDreamVersionedPreservationPaths(entry, boundary) {
  const mapping = mappingForEntry(entry);
  const relativePath = safeRelativePath(entry?.relativePath);
  if (!mapping || !relativePath || entry.logicalSourcePath !== `${mapping.legacyRelativePath}/${relativePath}`) {
    throw codedError('DREAM_VERSIONED_LOGICAL_PATH_INVALID');
  }
  if (!SHA256_PATTERN.test(String(entry.sourceSha256 || ''))) throw codedError('DREAM_VERSIONED_SOURCE_HASH_INVALID');
  const logicalPathSha256 = sha256(entry.logicalSourcePath);
  const snapshotRelativeSegments = Object.freeze([
    DREAM_VERSIONED_PRESERVATION_DIRECTORY,
    'v1',
    mapping.id,
    logicalPathSha256,
    `${entry.sourceSha256}.snapshot`,
  ]);
  const snapshotRelativePath = snapshotRelativeSegments.join('/');
  const snapshotPath = path.resolve(
    boundary.dreamMemoryRoot,
    ...snapshotRelativeSegments,
  );
  const manifestFilename = `dream-preservation-v1-${mapping.id}-${logicalPathSha256}-${entry.sourceSha256}.json`;
  const manifestPath = path.resolve(boundary.receiptRoot, manifestFilename);
  if (
    !pathIsInside(boundary.dreamMemoryRoot, snapshotPath)
    || !pathIsInside(boundary.receiptRoot, manifestPath)
    || pathIsInside(boundary.repoRoot, snapshotPath)
    || pathIsInside(boundary.repoRoot, manifestPath)
  ) throw codedError('DREAM_VERSIONED_DESTINATION_ESCAPE');
  return Object.freeze({
    logicalPathSha256,
    snapshotPath,
    snapshotRelativePath,
    manifestFilename,
    manifestPath,
    lockSegments: Object.freeze([
      'receipt-locks',
      'dream-preservation',
      `dream-${logicalPathSha256}.lock`,
    ]),
  });
}

export async function planDreamRuntimeMigration({
  repoRoot,
  env = process.env,
  homeDir = os.homedir(),
  fsImpl = fs,
} = {}) {
  const boundary = resolveDreamRuntimeBoundary({ repoRoot, env, homeDir });
  if (!boundary.ok) return Object.freeze({ ...boundary, mode: 'plan', entries: Object.freeze([]), copyRequired: 0, alreadyVerified: 0, conflicts: 0, versionedPreservationRequired: 0 });
  const entries = [];
  try {
    for (const mapping of boundary.mappings) {
      const sourceFiles = await collectFiles(mapping.sourcePath, fsImpl);
      for (const sourcePath of sourceFiles) {
        const relativePath = normalizeDreamHostRelativePath(path.relative(mapping.sourcePath, sourcePath));
        if (!relativePath) throw codedError('DREAM_MIGRATION_SOURCE_ESCAPE');
        const destinationPath = path.resolve(mapping.destinationPath, relativePath);
        if (!pathIsInside(mapping.destinationPath, destinationPath)) throw codedError('DREAM_MIGRATION_DESTINATION_ESCAPE');
        await ensureSafeDirectoryChain(path.dirname(sourcePath), { fsImpl, create: false });
        const sourceStat = await assertRegularSingleLink(sourcePath, { fsImpl });
        const sourceSha256 = await sha256File(sourcePath, { fsImpl });
        const baseEntry = {
          mappingId: mapping.id,
          relativePath,
          logicalSourcePath: logicalSourcePath(mapping, relativePath),
          sourcePath,
          destinationPath,
          bytes: sourceStat.size,
          sourceSha256,
        };
        let state = 'copy-required';
        let destinationSha256 = '';
        let relationClassification = '';
        let relationEvidence = null;
        if (await exists(destinationPath, fsImpl)) {
          await ensureSafeDirectoryChain(path.dirname(destinationPath), { fsImpl, create: false });
          await assertRegularSingleLink(destinationPath, { fsImpl });
          destinationSha256 = await sha256File(destinationPath, { fsImpl });
          if (destinationSha256 === sourceSha256) state = 'already-verified';
          else {
            const classification = await classifyConflict({ ...baseEntry, destinationSha256 }, fsImpl);
            if (!classification.ok) throw codedError(classification.blocker || 'DREAM_EVENT_SET_MALFORMED_OR_AMBIGUOUS');
            state = 'versioned-preservation-required';
            relationClassification = classification.relation;
            relationEvidence = classification;
          }
        }
        entries.push(Object.freeze({
          ...baseEntry,
          destinationSha256,
          state,
          relationClassification,
          relationEvidence,
        }));
      }
    }
  } catch (error) {
    return Object.freeze({
      ...boundary,
      ok: false,
      blocker: error?.code || 'DREAM_MIGRATION_SCAN_FAILED',
      error: error?.message || String(error),
      mode: 'plan',
      entries: Object.freeze(entries),
      copyRequired: 0,
      alreadyVerified: 0,
      conflicts: 0,
      versionedPreservationRequired: 0,
    });
  }
  const conflicts = entries.filter((entry) => entry.state === 'versioned-preservation-required').length;
  return Object.freeze({
    ...boundary,
    ok: true,
    blocker: '',
    mode: 'plan',
    entries: Object.freeze(entries),
    copyRequired: entries.filter((entry) => entry.state === 'copy-required').length,
    alreadyVerified: entries.filter((entry) => entry.state === 'already-verified').length,
    conflicts,
    versionedPreservationRequired: conflicts,
  });
}

function safeTimestamp(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, '-');
}

function windowsIdentity(stat, ownershipToken) {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    nlink: stat.nlink,
    mtimeMs: stat.mtimeMs,
    birthtimeMs: stat.birthtimeMs,
    isFile: () => stat.isFile(),
    isSymbolicLink: () => stat.isSymbolicLink(),
    windowsOwnershipToken: ownershipToken,
  });
}

function startBoundedWindowsArtifactProcess(args) {
  const child = spawn('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    WINDOWS_ARTIFACT_IO_SCRIPT,
    ...args,
  ], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let resolveExit;
  const exitPromise = new Promise((resolve) => { resolveExit = resolve; });
  const appendOutput = (current, chunk) => {
    const next = `${current}${String(chunk || '')}`;
    if (Buffer.byteLength(next, 'utf8') > DIRECTORY_GUARD_OUTPUT_LIMIT) {
      try { child.kill(); } catch {}
      return current;
    }
    return next;
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdin.on('error', () => {});
  child.stdout.on('data', (chunk) => { stdout = appendOutput(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = appendOutput(stderr, chunk); });
  child.once('error', () => { resolveExit(Object.freeze({ code: null })); });
  child.once('exit', (code) => { resolveExit(Object.freeze({ code })); });
  const awaitExit = async () => {
    let timedOut = false;
    const timeout = new Promise((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill(); } catch {}
        resolve(Object.freeze({ code: null }));
      }, DIRECTORY_GUARD_TIMEOUT_MS);
      timer.unref?.();
    });
    const exit = await Promise.race([exitPromise, timeout]);
    return Object.freeze({ exit, timedOut, stdout, stderr });
  };
  return Object.freeze({ child, awaitExit, output: () => Object.freeze({ stdout, stderr }) });
}

async function startWindowsOwnedArtifactPublication(parentPath, artifactName, content, ancestorIdentities) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  if (bytes.length > MAX_WINDOWS_ARTIFACT_BYTES) {
    throw codedError('DREAM_MIGRATION_WINDOWS_ARTIFACT_TOO_LARGE');
  }
  const token = randomUUID();
  const stagingPath = path.join(parentPath, `.stephanos-pending-${token}-${artifactName}`);
  const processState = startBoundedWindowsArtifactProcess([
    '-Mode', 'Publish',
    '-ParentPath', parentPath,
    '-ArtifactName', artifactName,
    '-Token', token,
    '-ExpectedAncestorIdentities', await windowsAncestorIdentityProof(ancestorIdentities),
  ]);
  let inputError = null;
  processState.child.stdin.write(`${bytes.toString('base64')}\n`, (error) => { inputError = error || null; });
  const readyPattern = new RegExp(`^READY:${token}:([a-f0-9:]+)$`, 'm');
  const startedAt = Date.now();
  let ownershipToken = '';
  while (Date.now() - startedAt < DIRECTORY_GUARD_TIMEOUT_MS) {
    const output = processState.output();
    const match = output.stdout.match(readyPattern);
    if (match) {
      ownershipToken = match[1];
      break;
    }
    if (inputError || output.stderr.trim()) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!ownershipToken) {
    const helperOutput = processState.output();
    try { processState.child.stdin.end('ABORT\n'); } catch {}
    try { processState.child.kill(); } catch {}
    throw codedError(
      helperOutput.stderr.split(/\r?\n/).includes('EEXIST')
        ? 'EEXIST'
        : inputError
          ? 'DREAM_MIGRATION_WINDOWS_ARTIFACT_INPUT_FAILED'
          : 'DREAM_MIGRATION_WINDOWS_ARTIFACT_START_FAILED',
    );
  }
  let finished = false;
  const finish = async (command, marker) => {
    if (finished) return false;
    finished = true;
    try { processState.child.stdin.end(`${command}\n`); } catch { return false; }
    const output = await processState.awaitExit();
    return !output.timedOut
      && output.exit?.code === 0
      && output.stdout.split(/\r?\n/).includes(`${marker}:${token}`)
      && !output.stderr.trim();
  };
  return Object.freeze({
    ownershipToken,
    stagingPath,
    commit: () => finish('COMMIT', 'COMMITTED'),
    abort: () => finish('ABORT', 'ABORTED'),
    failureCode: () => processState.output().stderr.split(/\r?\n/).includes('EEXIST') ? 'EEXIST' : '',
    cleanupConfirmed: () => processState.output().stdout.split(/\r?\n/).includes(`ABORTED:${token}`),
  });
}

async function deleteWindowsOwnedArtifact(artifactPath, identity, ancestorIdentities = null) {
  const ownershipToken = String(identity?.windowsOwnershipToken || '');
  if (!/^[a-f0-9:]+$/.test(ownershipToken)) return false;
  let provenAncestors = ancestorIdentities;
  try {
    provenAncestors ||= await ensureSafeDirectoryChain(path.dirname(artifactPath), { fsImpl: fs, create: false });
  } catch {
    return false;
  }
  const token = randomUUID();
  const processState = startBoundedWindowsArtifactProcess([
    '-Mode', 'DeleteOwned',
    '-ParentPath', path.dirname(artifactPath),
    '-ArtifactName', path.basename(artifactPath),
    '-Token', token,
    '-ExpectedOwnershipToken', ownershipToken,
    '-ExpectedAncestorIdentities', await windowsAncestorIdentityProof(provenAncestors),
  ]);
  processState.child.stdin.end();
  const output = await processState.awaitExit();
  return !output.timedOut
    && output.exit?.code === 0
    && output.stdout.split(/\r?\n/).includes(`DELETED:${token}`)
    && !output.stderr.trim();
}

async function promoteWindowsOwnedArtifact(pendingPath, artifactPath, identity) {
  const ownershipToken = String(identity?.windowsOwnershipToken || '');
  if (!/^[a-f0-9:]+$/.test(ownershipToken) || !samePath(path.dirname(pendingPath), path.dirname(artifactPath))) {
    throw codedError('DREAM_MIGRATION_RECEIPT_COMMIT_IDENTITY_INVALID');
  }
  const ancestorIdentities = await ensureSafeDirectoryChain(path.dirname(artifactPath), { fsImpl: fs, create: false });
  const token = randomUUID();
  const processState = startBoundedWindowsArtifactProcess([
    '-Mode', 'PromoteOwned',
    '-ParentPath', path.dirname(artifactPath),
    '-ArtifactName', path.basename(artifactPath),
    '-PendingName', path.basename(pendingPath),
    '-Token', token,
    '-ExpectedOwnershipToken', ownershipToken,
    '-ExpectedAncestorIdentities', await windowsAncestorIdentityProof(ancestorIdentities),
  ]);
  processState.child.stdin.end();
  const output = await processState.awaitExit();
  const promoted = !output.timedOut
    && output.exit?.code === 0
    && output.stdout.split(/\r?\n/).includes(`PROMOTED:${token}`)
    && !output.stderr.trim();
  if (!promoted) {
    let pendingStillOwned = false;
    try {
      pendingStillOwned = sameOwnedArtifactIdentity(identity, await fs.lstat(pendingPath), 1);
    } catch {}
    let cleaned = pendingStillOwned;
    if (!pendingStillOwned) cleaned = await deleteWindowsOwnedArtifact(artifactPath, identity, ancestorIdentities);
    const error = codedError('DREAM_MIGRATION_RECEIPT_COMMIT_FAILED');
    error.reasonCode = output.stderr.split(/\r?\n/).includes('EEXIST')
      ? 'EEXIST'
      : 'DREAM_MIGRATION_RECEIPT_COMMIT_FAILED';
    error.cleanupBlocker = cleaned ? '' : 'DREAM_MIGRATION_RECEIPT_CLEANUP_FAILED';
    throw error;
  }
  await assertSafeDirectoryChainUnchanged(ancestorIdentities, { fsImpl: fs });
  const promotedIdentity = await assertRegularSingleLink(artifactPath, { fsImpl: fs });
  if (!sameFileIdentity(identity, promotedIdentity)) {
    const cleaned = await deleteWindowsOwnedArtifact(artifactPath, identity, ancestorIdentities);
    const error = codedError('DREAM_MIGRATION_RECEIPT_COMMIT_FAILED');
    error.reasonCode = 'DREAM_MIGRATION_RECEIPT_IDENTITY_CHANGED';
    error.cleanupBlocker = cleaned ? '' : 'DREAM_MIGRATION_RECEIPT_CLEANUP_FAILED';
    throw error;
  }
  return Object.freeze({ artifactPath, identity: windowsIdentity(promotedIdentity, ownershipToken) });
}

async function acquireDirectoryMutationBoundary(parentPath, ancestorIdentities, fsImpl) {
  const parentIdentity = ancestorIdentities.at(-1)?.identity;
  const handleNamespace = dreamDirectoryHandleNamespace();
  if (handleNamespace) {
    const parentHandle = await fsImpl.open(parentPath, 'r');
    try {
      const openedParentIdentity = await parentHandle.stat();
      if (!sameDirectoryIdentity(parentIdentity, openedParentIdentity)) {
        throw codedError('DREAM_MIGRATION_ANCESTOR_CHANGED');
      }
      if (!Number.isSafeInteger(parentHandle.fd) || parentHandle.fd < 0) {
        throw codedError('DREAM_MIGRATION_DIRECTORY_HANDLE_INVALID');
      }
      await assertSafeDirectoryChainUnchanged(ancestorIdentities, { fsImpl });
      return Object.freeze({
        operationParentPath: path.join(handleNamespace, String(parentHandle.fd)),
        release: async () => {
          try {
            await parentHandle.close();
            return true;
          } catch {
            return false;
          }
        },
      });
    } catch (error) {
      try { await parentHandle.close(); } catch {}
      throw error;
    }
  }
  if (process.platform === 'win32' && fsImpl !== fs) {
    await assertSafeDirectoryChainUnchanged(ancestorIdentities, { fsImpl });
    return Object.freeze({
      operationParentPath: parentPath,
      release: async () => true,
    });
  }
  throw codedError('DREAM_MIGRATION_DIRECTORY_RELATIVE_PUBLICATION_UNSUPPORTED');
}

async function writeWindowsOwnedExclusiveArtifact(artifactPath, content, {
  fsImpl,
  writeFailureCode,
  cleanupFailureCode,
  identityInvalidCode,
  identityChangedCode,
}) {
  const ancestorIdentities = await ensureSafeDirectoryChain(path.dirname(artifactPath), { fsImpl, create: false });
  let publication = null;
  let identity = null;
  let committed = false;
  try {
    publication = await startWindowsOwnedArtifactPublication(
      path.dirname(artifactPath),
      path.basename(artifactPath),
      content,
      ancestorIdentities,
    );
    await assertSafeDirectoryChainUnchanged(ancestorIdentities, { fsImpl });
    const pathIdentity = await assertRegularSingleLink(publication.stagingPath, { fsImpl });
    const expectedBytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    if (pathIdentity.size !== expectedBytes.length || await sha256File(publication.stagingPath, { fsImpl }) !== sha256(expectedBytes)) {
      throw codedError(identityInvalidCode);
    }
    identity = windowsIdentity(pathIdentity, publication.ownershipToken);
    if (!(await publication.commit())) {
      throw codedError(publication.failureCode() || 'DREAM_MIGRATION_WINDOWS_ARTIFACT_COMMIT_FAILED');
    }
    committed = true;
    await assertSafeDirectoryChainUnchanged(ancestorIdentities, { fsImpl });
    const committedIdentity = await assertRegularSingleLink(artifactPath, { fsImpl });
    if (!sameFileIdentity(identity, committedIdentity)) throw codedError(identityChangedCode);
    return Object.freeze({ artifactPath, identity });
  } catch (error) {
    let cleaned = false;
    if (publication && !committed) cleaned = await publication.abort();
    if (publication && !cleaned) cleaned = publication.cleanupConfirmed();
    if (publication && !cleaned) {
      cleaned = await deleteWindowsOwnedArtifact(
        committed ? artifactPath : publication.stagingPath,
        identity || { windowsOwnershipToken: publication.ownershipToken },
        ancestorIdentities,
      );
    }
    const wrapped = codedError(writeFailureCode);
    wrapped.reasonCode = error?.code || writeFailureCode;
    wrapped.cleanupBlocker = publication && !cleaned ? cleanupFailureCode : '';
    throw wrapped;
  }
}

async function writeOwnedExclusiveArtifact(artifactPath, content, {
  fsImpl,
  writeFailureCode,
  cleanupFailureCode,
  identityInvalidCode,
  identityChangedCode,
}) {
  if (process.platform === 'win32' && fsImpl === fs) {
    return writeWindowsOwnedExclusiveArtifact(artifactPath, content, {
      fsImpl,
      writeFailureCode,
      cleanupFailureCode,
      identityInvalidCode,
      identityChangedCode,
    });
  }
  const ancestorIdentities = await ensureSafeDirectoryChain(path.dirname(artifactPath), { fsImpl, create: false });
  const parentPath = path.dirname(artifactPath);
  const artifactName = path.basename(artifactPath);
  const stagingName = `.stephanos-pending-${randomUUID()}-${artifactName}`;
  let boundary = null;
  let operationArtifactPath = '';
  let operationStagingPath = '';
  let handle = null;
  let stagingCreated = false;
  let finalLinked = false;
  let identity = null;
  let result = null;
  let failure = null;
  try {
    boundary = await acquireDirectoryMutationBoundary(parentPath, ancestorIdentities, fsImpl);
    operationArtifactPath = path.join(boundary.operationParentPath, artifactName);
    operationStagingPath = path.join(boundary.operationParentPath, stagingName);
    await assertSafeDirectoryChainUnchanged(ancestorIdentities, { fsImpl });
    handle = await fsImpl.open(operationStagingPath, 'wx', 0o600);
    stagingCreated = true;
    await assertSafeDirectoryChainUnchanged(ancestorIdentities, { fsImpl });
    await handle.writeFile(content, typeof content === 'string' ? { encoding: 'utf8' } : undefined);
    identity = await handle.stat();
    if (!identity.isFile?.() || Number(identity.nlink) !== 1) throw codedError(identityInvalidCode);
    await assertSafeDirectoryChainUnchanged(ancestorIdentities, { fsImpl });
    await handle.close();
    handle = null;
    await assertSafeDirectoryChainUnchanged(ancestorIdentities, { fsImpl });
    await fsImpl.link(operationStagingPath, operationArtifactPath);
    finalLinked = true;
    await fsImpl.unlink(operationStagingPath);
    stagingCreated = false;
    const pathIdentity = await assertRegularSingleLink(artifactPath, { fsImpl });
    if (!sameFileIdentity(identity, pathIdentity)) throw codedError(identityChangedCode);
    result = Object.freeze({ artifactPath, identity: pathIdentity });
  } catch (error) {
    if (handle) {
      if (!identity) {
        try { identity = await handle.stat(); } catch {}
      }
      try { await handle.close(); } catch {}
      handle = null;
    }
    let cleaned = true;
    if (finalLinked) {
      cleaned = Boolean(identity && boundary && await removeOwnedArtifactWithinBoundary(
        boundary.operationParentPath,
        artifactName,
        identity,
        fsImpl,
        { maxLinkCount: stagingCreated ? 2 : 1 },
      ));
      finalLinked = false;
    }
    if (stagingCreated) {
      const stagingCleaned = Boolean(identity && boundary && await removeOwnedArtifactWithinBoundary(
        boundary.operationParentPath,
        stagingName,
        identity,
        fsImpl,
      ));
      cleaned = cleaned && stagingCleaned;
      stagingCreated = false;
    }
    const wrapped = codedError(writeFailureCode);
    wrapped.reasonCode = error?.code || writeFailureCode;
    wrapped.cleanupBlocker = cleaned ? '' : cleanupFailureCode;
    failure = wrapped;
  }
  const released = boundary ? await boundary.release() : true;
  if (!released) {
    if (result) {
      const cleaned = await removeOwnedArtifact(artifactPath, result.identity, fsImpl);
      const wrapped = codedError(writeFailureCode);
      wrapped.reasonCode = 'DREAM_MIGRATION_DIRECTORY_GUARD_RELEASE_FAILED';
      wrapped.cleanupBlocker = cleaned ? '' : cleanupFailureCode;
      throw wrapped;
    }
    if (failure && !failure.cleanupBlocker) failure.cleanupBlocker = cleanupFailureCode;
  }
  if (failure) throw failure;
  return result;
}

function sameOwnedArtifactIdentity(expected, current, maxLinkCount) {
  const links = Number(current?.nlink);
  return current?.isFile?.() === true
    && current?.isSymbolicLink?.() !== true
    && links >= 1
    && links <= maxLinkCount
    && Number(expected?.dev) === Number(current?.dev)
    && Number(expected?.ino) === Number(current?.ino)
    && Number(expected?.size) === Number(current?.size)
    && Number(expected?.mtimeMs) === Number(current?.mtimeMs);
}

async function removeOwnedArtifactWithinBoundary(
  operationParentPath,
  artifactName,
  identity,
  fsImpl,
  { maxLinkCount = 1 } = {},
) {
  if (!identity || !safeRelativePath(artifactName) || path.basename(artifactName) !== artifactName) return false;
  const operationArtifactPath = path.join(operationParentPath, artifactName);
  let quarantinePath = '';
  let quarantineRoot = '';
  let moved = false;
  try {
    const current = await fsImpl.lstat(operationArtifactPath);
    if (!sameOwnedArtifactIdentity(identity, current, maxLinkCount)) return false;
    quarantineRoot = await fsImpl.mkdtemp(path.join(operationParentPath, '.stephanos-owned-delete-'));
    const quarantineInfo = await fsImpl.lstat(quarantineRoot);
    if (!quarantineInfo.isDirectory?.() || quarantineInfo.isSymbolicLink?.()) return false;
    quarantinePath = path.join(quarantineRoot, artifactName);
    await fsImpl.rename(operationArtifactPath, quarantinePath);
    moved = true;
    const quarantined = await fsImpl.lstat(quarantinePath);
    if (!sameOwnedArtifactIdentity(identity, quarantined, maxLinkCount)) return false;
    await fsImpl.unlink(quarantinePath);
    moved = false;
    await fsImpl.rmdir(quarantineRoot);
    quarantineRoot = '';
    return true;
  } catch (error) {
    return error?.code === 'ENOENT' && !moved;
  } finally {
    if (moved) {
      try { await fsImpl.rename(quarantinePath, operationArtifactPath); } catch {}
    }
    if (quarantineRoot && !moved) {
      try { await fsImpl.rmdir(quarantineRoot); } catch {}
    }
  }
}

async function copyOwnedExclusiveArtifact(sourcePath, artifactPath, options) {
  const content = await options.fsImpl.readFile(sourcePath);
  return writeOwnedExclusiveArtifact(artifactPath, content, options);
}

async function promoteOwnedArtifact(pendingPath, artifactPath, identity, fsImpl) {
  if (!samePath(path.dirname(pendingPath), path.dirname(artifactPath))) {
    throw codedError('DREAM_MIGRATION_RECEIPT_COMMIT_PATH_INVALID');
  }
  if (process.platform === 'win32' && fsImpl === fs) {
    return promoteWindowsOwnedArtifact(pendingPath, artifactPath, identity);
  }
  const parentPath = path.dirname(artifactPath);
  const pendingName = path.basename(pendingPath);
  const artifactName = path.basename(artifactPath);
  if (!safeRelativePath(pendingName) || !safeRelativePath(artifactName)) {
    throw codedError('DREAM_MIGRATION_RECEIPT_COMMIT_PATH_INVALID');
  }
  const ancestorIdentities = await ensureSafeDirectoryChain(parentPath, { fsImpl, create: false });
  let boundary = null;
  let pendingHandle = null;
  let finalIdentity = null;
  let result = null;
  let failure = null;
  try {
    boundary = await acquireDirectoryMutationBoundary(parentPath, ancestorIdentities, fsImpl);
    const operationPendingPath = path.join(boundary.operationParentPath, pendingName);
    const operationArtifactPath = path.join(boundary.operationParentPath, artifactName);
    pendingHandle = await fsImpl.open(operationPendingPath, 'r');
    const pendingIdentity = await pendingHandle.stat();
    if (!sameOwnedArtifactIdentity(identity, pendingIdentity, 1)) {
      throw codedError('DREAM_MIGRATION_RECEIPT_COMMIT_IDENTITY_CHANGED');
    }
    await assertSafeDirectoryChainUnchanged(ancestorIdentities, { fsImpl });
    const handleRoot = dreamDirectoryHandleNamespace();
    const handleSourcePath = handleRoot
      ? path.join(handleRoot, String(pendingHandle.fd))
      : operationPendingPath;
    const expectedHash = sha256(await fsImpl.readFile(handleSourcePath));
    await fsImpl.copyFile(handleSourcePath, operationArtifactPath, fsConstants.COPYFILE_EXCL);
    finalIdentity = await assertRegularSingleLink(artifactPath, { fsImpl });
    if (finalIdentity.size !== identity.size || await sha256File(artifactPath, { fsImpl }) !== expectedHash) {
      throw codedError('DREAM_MIGRATION_RECEIPT_COMMIT_IDENTITY_CHANGED');
    }
    const pendingRemoved = await removeOwnedArtifactWithinBoundary(
      boundary.operationParentPath,
      pendingName,
      identity,
      fsImpl,
    );
    if (!pendingRemoved) throw codedError('DREAM_MIGRATION_RECEIPT_PENDING_CLEANUP_FAILED');
    result = Object.freeze({ artifactPath, identity: finalIdentity });
  } catch (error) {
    let cleaned = true;
    if (finalIdentity && boundary) {
      cleaned = await removeOwnedArtifactWithinBoundary(
        boundary.operationParentPath,
        artifactName,
        finalIdentity,
        fsImpl,
      );
    }
    const wrapped = codedError('DREAM_MIGRATION_RECEIPT_COMMIT_FAILED');
    wrapped.reasonCode = error?.code || 'DREAM_MIGRATION_RECEIPT_COMMIT_FAILED';
    wrapped.cleanupBlocker = cleaned ? '' : 'DREAM_MIGRATION_RECEIPT_CLEANUP_FAILED';
    failure = wrapped;
  }
  if (pendingHandle) {
    try { await pendingHandle.close(); } catch {
      if (!failure) {
        const cleaned = Boolean(result && boundary && await removeOwnedArtifactWithinBoundary(
          boundary.operationParentPath,
          artifactName,
          result.identity,
          fsImpl,
        ));
        result = null;
        failure = codedError('DREAM_MIGRATION_RECEIPT_COMMIT_FAILED');
        failure.reasonCode = 'DREAM_MIGRATION_RECEIPT_HANDLE_CLOSE_FAILED';
        failure.cleanupBlocker = cleaned ? '' : 'DREAM_MIGRATION_RECEIPT_CLEANUP_FAILED';
      }
    }
  }
  const released = boundary ? await boundary.release() : true;
  if (!released) {
    if (result) {
      const cleaned = await removeOwnedArtifact(artifactPath, result.identity, fsImpl);
      const wrapped = codedError('DREAM_MIGRATION_RECEIPT_COMMIT_FAILED');
      wrapped.reasonCode = 'DREAM_MIGRATION_DIRECTORY_GUARD_RELEASE_FAILED';
      wrapped.cleanupBlocker = cleaned ? '' : 'DREAM_MIGRATION_RECEIPT_CLEANUP_FAILED';
      throw wrapped;
    }
    if (failure && !failure.cleanupBlocker) failure.cleanupBlocker = 'DREAM_MIGRATION_RECEIPT_CLEANUP_FAILED';
  }
  if (failure) throw failure;
  return result;
}

async function writeReceipt(receipt, { fsImpl, receiptRoot }) {
  await ensureSafeDirectoryChain(receiptRoot, { fsImpl, create: true });
  const filename = `dream-migration-${safeTimestamp(new Date(receipt.completedAtUtc))}.json`;
  const receiptPath = path.join(receiptRoot, filename);
  const pendingReceiptPath = path.join(receiptRoot, `.stephanos-pending-${randomUUID()}-${filename}`);
  const publication = await writeOwnedExclusiveArtifact(
    pendingReceiptPath,
    `${JSON.stringify(receipt, null, 2)}\n`,
    {
      fsImpl,
      writeFailureCode: 'DREAM_MIGRATION_RECEIPT_WRITE_FAILED',
      cleanupFailureCode: 'DREAM_MIGRATION_RECEIPT_CLEANUP_FAILED',
      identityInvalidCode: 'DREAM_MIGRATION_RECEIPT_IDENTITY_INVALID',
      identityChangedCode: 'DREAM_MIGRATION_RECEIPT_IDENTITY_CHANGED',
    },
  );
  return Object.freeze({ receiptPath, pendingReceiptPath, identity: publication.identity });
}

function versionedProofRefs(paths) {
  return Object.freeze([
    `receipts/runtime-boundary/${paths.manifestFilename}`,
    paths.snapshotRelativePath,
  ]);
}

function buildVersionedManifest(entry, paths, sourceHead, capturedAtUtc) {
  const proofRefs = versionedProofRefs(paths);
  return Object.freeze({
    schemaVersion: DREAM_VERSIONED_PRESERVATION_SCHEMA,
    kind: 'dream-runtime-versioned-preservation-manifest',
    logicalSourcePath: entry.logicalSourcePath,
    canonicalDestinationPath: entry.destinationPath,
    versionedSnapshotPath: paths.snapshotPath,
    sourceSha256: entry.sourceSha256,
    destinationSha256: entry.sourceSha256,
    byteSize: entry.bytes,
    sourceHead,
    capturedAtUtc,
    previousCanonicalDestinationSha256: entry.destinationSha256,
    relationClassification: entry.relationClassification,
    proofRefs,
    canonicalDestinationPreserved: true,
    sourceRemovalPerformed: false,
  });
}

function validateVersionedManifest(manifest, expected) {
  const errors = [];
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') errors.push('manifest-not-object');
  if (manifest?.schemaVersion !== DREAM_VERSIONED_PRESERVATION_SCHEMA) errors.push('schema-version');
  if (manifest?.kind !== 'dream-runtime-versioned-preservation-manifest') errors.push('kind');
  if (manifest?.logicalSourcePath !== expected.entry.logicalSourcePath) errors.push('logical-source-path');
  if (!samePath(manifest?.canonicalDestinationPath, expected.entry.destinationPath)) errors.push('canonical-destination-path');
  if (!samePath(manifest?.versionedSnapshotPath, expected.paths.snapshotPath)) errors.push('versioned-snapshot-path');
  if (manifest?.sourceSha256 !== expected.entry.sourceSha256 || !SHA256_PATTERN.test(String(manifest?.sourceSha256 || ''))) errors.push('source-hash');
  if (manifest?.destinationSha256 !== expected.entry.sourceSha256) errors.push('destination-hash');
  if (manifest?.byteSize !== expected.entry.bytes || !Number.isSafeInteger(manifest?.byteSize) || manifest.byteSize < 0) errors.push('byte-size');
  if (!SOURCE_HEAD_PATTERN.test(String(manifest?.sourceHead || '')) || manifest?.sourceHead !== expected.sourceHead) errors.push('source-head');
  if (!Number.isFinite(Date.parse(String(manifest?.capturedAtUtc || '')))) errors.push('captured-at');
  if (manifest?.previousCanonicalDestinationSha256 !== expected.entry.destinationSha256) errors.push('previous-canonical-hash');
  if (manifest?.relationClassification !== expected.entry.relationClassification) errors.push('relation');
  const expectedProofRefs = versionedProofRefs(expected.paths);
  if (!Array.isArray(manifest?.proofRefs)
    || manifest.proofRefs.length !== expectedProofRefs.length
    || manifest.proofRefs.some((ref, index) => ref !== expectedProofRefs[index])) errors.push('proof-refs');
  if (manifest?.canonicalDestinationPreserved !== true || manifest?.sourceRemovalPerformed !== false) errors.push('rollback-truth');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

async function readExistingManifest(paths, expected, fsImpl) {
  if (!(await exists(paths.manifestPath, fsImpl))) return Object.freeze({ exists: false });
  let manifest;
  try {
    const info = await assertRegularSingleLink(paths.manifestPath, { fsImpl });
    if (info.size > MAX_MANIFEST_BYTES) throw codedError('DREAM_VERSIONED_MANIFEST_MALFORMED');
    manifest = JSON.parse(await fsImpl.readFile(paths.manifestPath, 'utf8'));
  } catch (error) {
    return Object.freeze({ exists: true, ok: false, blocker: error?.code || 'DREAM_VERSIONED_MANIFEST_MALFORMED' });
  }
  const validation = validateVersionedManifest(manifest, expected);
  if (!validation.valid) return Object.freeze({ exists: true, ok: false, blocker: 'DREAM_VERSIONED_RECEIPT_CONFLICT', validation });
  if (!(await exists(paths.snapshotPath, fsImpl))) return Object.freeze({ exists: true, ok: false, blocker: 'DREAM_VERSIONED_SNAPSHOT_MISSING' });
  try {
    const snapshotInfo = await assertRegularSingleLink(paths.snapshotPath, { fsImpl });
    if (snapshotInfo.size !== expected.entry.bytes || await sha256File(paths.snapshotPath, { fsImpl }) !== expected.entry.sourceSha256) {
      return Object.freeze({ exists: true, ok: false, blocker: 'DREAM_VERSIONED_SNAPSHOT_COLLISION' });
    }
    if (await sha256File(expected.entry.sourcePath, { fsImpl }) !== expected.entry.sourceSha256) {
      return Object.freeze({ exists: true, ok: false, blocker: 'DREAM_MIGRATION_SOURCE_CHANGED' });
    }
    if (await sha256File(expected.entry.destinationPath, { fsImpl }) !== expected.entry.destinationSha256) {
      return Object.freeze({ exists: true, ok: false, blocker: 'DREAM_CANONICAL_DESTINATION_CHANGED' });
    }
  } catch (error) {
    return Object.freeze({ exists: true, ok: false, blocker: error?.code || 'DREAM_VERSIONED_VERIFICATION_FAILED' });
  }
  return Object.freeze({ exists: true, ok: true, manifest });
}

async function removeOwnedArtifact(artifactPath, identity, fsImpl) {
  if (!identity) return true;
  if (process.platform === 'win32' && fsImpl === fs) {
    return deleteWindowsOwnedArtifact(artifactPath, identity);
  }
  let boundary = null;
  let removed = false;
  try {
    const ancestorIdentities = await ensureSafeDirectoryChain(path.dirname(artifactPath), { fsImpl, create: false });
    boundary = await acquireDirectoryMutationBoundary(path.dirname(artifactPath), ancestorIdentities, fsImpl);
    await assertSafeDirectoryChainUnchanged(ancestorIdentities, { fsImpl });
    removed = await removeOwnedArtifactWithinBoundary(
      boundary.operationParentPath,
      path.basename(artifactPath),
      identity,
      fsImpl,
    );
  } catch {
    removed = false;
  } finally {
    if (boundary && !(await boundary.release())) removed = false;
  }
  return removed;
}

async function preserveVersionedConflict(entry, boundary, {
  fsImpl,
  sourceHead,
  now,
  operationLockOptions,
  acquireOperationLockFn,
  verifySourceHeadFn,
}) {
  const paths = resolveDreamVersionedPreservationPaths(entry, boundary);
  await ensureSafeDirectoryChain(boundary.runtimeRoot, { fsImpl, create: true });
  await ensureSafeDirectoryChain(path.join(boundary.runtimeRoot, 'receipt-locks', 'dream-preservation'), { fsImpl, create: true });
  const lock = await acquireOperationLockFn(boundary.runtimeRoot, paths.lockSegments, {
    repoRoot: boundary.repoRoot,
    ...operationLockOptions,
  });
  if (!lock.ok) {
    return Object.freeze({ ok: false, blocker: 'DREAM_VERSIONED_PRESERVATION_CONCURRENT', lockReason: lock.reason });
  }
  let outcome;
  let createdSnapshotIdentity = null;
  let createdManifestIdentity = null;
  try {
    await ensureSafeDirectoryChain(path.dirname(entry.sourcePath), { fsImpl, create: false });
    await ensureSafeDirectoryChain(path.dirname(entry.destinationPath), { fsImpl, create: false });
    await ensureSafeDirectoryChain(path.dirname(paths.snapshotPath), { fsImpl, create: true });
    await ensureSafeDirectoryChain(path.dirname(paths.manifestPath), { fsImpl, create: true });
    const sourceBefore = await assertRegularSingleLink(entry.sourcePath, { fsImpl });
    await assertRegularSingleLink(entry.destinationPath, { fsImpl });
    if (sourceBefore.size !== entry.bytes || await sha256File(entry.sourcePath, { fsImpl }) !== entry.sourceSha256) {
      outcome = Object.freeze({ ok: false, blocker: 'DREAM_MIGRATION_SOURCE_CHANGED' });
    } else if (await sha256File(entry.destinationPath, { fsImpl }) !== entry.destinationSha256) {
      outcome = Object.freeze({ ok: false, blocker: 'DREAM_CANONICAL_DESTINATION_CHANGED' });
    } else {
      const existingManifest = await readExistingManifest(paths, { entry, paths, sourceHead }, fsImpl);
      if (existingManifest.exists) {
        outcome = existingManifest.ok
          ? Object.freeze({
            ok: true,
            state: 'already-versioned-and-verified',
            snapshotPath: paths.snapshotPath,
            manifestPath: paths.manifestPath,
            manifest: existingManifest.manifest,
          })
          : existingManifest;
      } else if (await exists(paths.snapshotPath, fsImpl)) {
        try {
          await assertRegularSingleLink(paths.snapshotPath, { fsImpl });
          outcome = Object.freeze({
            ok: false,
            blocker: await sha256File(paths.snapshotPath, { fsImpl }) === entry.sourceSha256
              ? 'DREAM_VERSIONED_SNAPSHOT_ORPHANED'
              : 'DREAM_VERSIONED_SNAPSHOT_COLLISION',
          });
        } catch (error) {
          outcome = Object.freeze({ ok: false, blocker: error?.code || 'DREAM_VERSIONED_SNAPSHOT_COLLISION' });
        }
      } else {
        try {
          const publication = await copyOwnedExclusiveArtifact(
            entry.sourcePath,
            paths.snapshotPath,
            {
              fsImpl,
              writeFailureCode: 'DREAM_VERSIONED_SNAPSHOT_WRITE_FAILED',
              cleanupFailureCode: 'DREAM_VERSIONED_SNAPSHOT_CLEANUP_FAILED',
              identityInvalidCode: 'DREAM_VERSIONED_SNAPSHOT_IDENTITY_INVALID',
              identityChangedCode: 'DREAM_VERSIONED_SNAPSHOT_IDENTITY_CHANGED',
            },
          );
          createdSnapshotIdentity = publication.identity;
          const snapshotHash = await sha256File(paths.snapshotPath, { fsImpl });
          const sourceAfter = await assertRegularSingleLink(entry.sourcePath, { fsImpl });
          const sourceHashAfter = await sha256File(entry.sourcePath, { fsImpl });
          const canonicalHashAfter = await sha256File(entry.destinationPath, { fsImpl });
          if (snapshotHash !== entry.sourceSha256 || sourceHashAfter !== entry.sourceSha256 || !sameFileIdentity(sourceBefore, sourceAfter)) {
            outcome = Object.freeze({ ok: false, blocker: 'DREAM_MIGRATION_SOURCE_CHANGED' });
          } else if (canonicalHashAfter !== entry.destinationSha256) {
            outcome = Object.freeze({ ok: false, blocker: 'DREAM_CANONICAL_DESTINATION_CHANGED' });
          } else {
            if (!(await verifySourceHeadFn())) {
              outcome = Object.freeze({ ok: false, blocker: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED' });
            } else {
              const capturedAtUtc = now().toISOString();
              if (!Number.isFinite(Date.parse(capturedAtUtc))) throw codedError('DREAM_VERSIONED_CAPTURE_TIME_INVALID');
              const manifest = buildVersionedManifest(entry, paths, sourceHead, capturedAtUtc);
              try {
                const publication = await writeOwnedExclusiveArtifact(
                  paths.manifestPath,
                  `${JSON.stringify(manifest, null, 2)}\n`,
                  {
                    fsImpl,
                    writeFailureCode: 'DREAM_VERSIONED_MANIFEST_WRITE_FAILED',
                    cleanupFailureCode: 'DREAM_VERSIONED_MANIFEST_CLEANUP_FAILED',
                    identityInvalidCode: 'DREAM_VERSIONED_MANIFEST_IDENTITY_INVALID',
                    identityChangedCode: 'DREAM_VERSIONED_MANIFEST_IDENTITY_CHANGED',
                  },
                );
                createdManifestIdentity = publication.identity;
                if (!(await verifySourceHeadFn())) {
                  outcome = Object.freeze({ ok: false, blocker: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED' });
                } else {
                  outcome = Object.freeze({
                    ok: true,
                    state: 'versioned-and-verified',
                    snapshotPath: paths.snapshotPath,
                    manifestPath: paths.manifestPath,
                    manifest,
                    createdArtifacts: Object.freeze([
                      Object.freeze({ artifactPath: paths.manifestPath, identity: createdManifestIdentity }),
                      Object.freeze({ artifactPath: paths.snapshotPath, identity: createdSnapshotIdentity }),
                    ]),
                  });
                }
              } catch (error) {
                outcome = Object.freeze({
                  ok: false,
                  blocker: error?.reasonCode === 'EEXIST' ? 'DREAM_VERSIONED_RECEIPT_CONFLICT' : 'DREAM_VERSIONED_MANIFEST_WRITE_FAILED',
                  manifestWriteReason: error?.reasonCode || error?.code || 'DREAM_VERSIONED_MANIFEST_WRITE_FAILED',
                  cleanupBlocker: error?.cleanupBlocker || '',
                });
              }
            }
          }
        } catch (error) {
          outcome = Object.freeze({
            ok: false,
            blocker: error?.reasonCode === 'EEXIST' ? 'DREAM_VERSIONED_SNAPSHOT_COLLISION' : 'DREAM_VERSIONED_COPY_FAILED',
            snapshotWriteReason: error?.reasonCode || error?.code || 'DREAM_VERSIONED_COPY_FAILED',
            cleanupBlocker: error?.cleanupBlocker || '',
          });
        }
      }
    }
  } catch (error) {
    outcome = Object.freeze({ ok: false, blocker: error?.code || 'DREAM_VERSIONED_PRESERVATION_FAILED' });
  } finally {
    const cleanupOwnedArtifacts = async () => {
      const manifestCleaned = await removeOwnedArtifact(paths.manifestPath, createdManifestIdentity, fsImpl);
      const snapshotCleaned = await removeOwnedArtifact(paths.snapshotPath, createdSnapshotIdentity, fsImpl);
      return manifestCleaned && snapshotCleaned;
    };
    if (outcome?.ok !== true && !(await cleanupOwnedArtifacts())) {
      outcome = Object.freeze({ ...outcome, cleanupBlocker: 'DREAM_VERSIONED_ARTIFACT_CLEANUP_FAILED' });
    }
    let released = false;
    let lockReleaseReason = '';
    try {
      released = await lock.release();
    } catch (error) {
      lockReleaseReason = error?.code || 'DREAM_VERSIONED_LOCK_RELEASE_FAILED';
    }
    if (!released && outcome?.ok === true) {
      outcome = Object.freeze({
        ok: false,
        blocker: 'DREAM_VERSIONED_LOCK_RELEASE_FAILED',
        lockReleaseReason,
      });
      if (!(await cleanupOwnedArtifacts())) {
        outcome = Object.freeze({ ...outcome, cleanupBlocker: 'DREAM_VERSIONED_ARTIFACT_CLEANUP_FAILED' });
      }
    } else if (!released) {
      outcome = Object.freeze({
        ...outcome,
        cleanupBlocker: outcome?.cleanupBlocker || 'DREAM_VERSIONED_LOCK_RELEASE_FAILED',
        lockCleanupBlocker: 'DREAM_VERSIONED_LOCK_RELEASE_FAILED',
        lockReleaseReason,
      });
    }
  }
  return outcome;
}

async function copyRequiredEntry(entry, fsImpl) {
  let phase = 'preflight';
  let destinationInfo = null;
  try {
    await ensureSafeDirectoryChain(path.dirname(entry.sourcePath), { fsImpl, create: false });
    await ensureSafeDirectoryChain(path.dirname(entry.destinationPath), { fsImpl, create: true });
    const sourceBefore = await assertRegularSingleLink(entry.sourcePath, { fsImpl });
    if (await sha256File(entry.sourcePath, { fsImpl }) !== entry.sourceSha256) {
      return Object.freeze({ ok: false, blocker: 'DREAM_MIGRATION_SOURCE_CHANGED' });
    }
    phase = 'publication';
    const publication = await copyOwnedExclusiveArtifact(
      entry.sourcePath,
      entry.destinationPath,
      {
        fsImpl,
        writeFailureCode: 'DREAM_MIGRATION_COPY_FAILED',
        cleanupFailureCode: 'DREAM_MIGRATION_COPY_CLEANUP_FAILED',
        identityInvalidCode: 'DREAM_MIGRATION_COPY_IDENTITY_INVALID',
        identityChangedCode: 'DREAM_MIGRATION_COPY_IDENTITY_CHANGED',
      },
    );
    destinationInfo = publication.identity;
    phase = 'verification';
    const destinationSha256 = await sha256File(entry.destinationPath, { fsImpl });
    const sourceAfter = await assertRegularSingleLink(entry.sourcePath, { fsImpl });
    const sourceSha256After = await sha256File(entry.sourcePath, { fsImpl });
    if (
      destinationInfo.size !== entry.bytes
      || destinationSha256 !== entry.sourceSha256
      || sourceSha256After !== entry.sourceSha256
      || !sameFileIdentity(sourceBefore, sourceAfter)
    ) throw codedError('DREAM_MIGRATION_HASH_MISMATCH');
    return Object.freeze({
      ok: true,
      entry: Object.freeze({ ...entry, destinationSha256, state: 'copied-and-verified' }),
      createdArtifact: Object.freeze({ artifactPath: entry.destinationPath, identity: destinationInfo }),
    });
  } catch (error) {
    if (phase === 'preflight') {
      return Object.freeze({
        ok: false,
        blocker: 'DREAM_MIGRATION_COPY_PREFLIGHT_FAILED',
        copyFailureReason: error?.code || 'DREAM_MIGRATION_COPY_PREFLIGHT_FAILED',
      });
    }
    if (phase === 'publication') {
      return Object.freeze({
        ok: false,
        blocker: error?.reasonCode === 'EEXIST' ? 'DREAM_MIGRATION_DESTINATION_RACE' : 'DREAM_MIGRATION_COPY_FAILED',
        copyFailureReason: error?.reasonCode || error?.code || 'DREAM_MIGRATION_COPY_FAILED',
        cleanupBlocker: error?.cleanupBlocker || '',
      });
    }
    const cleaned = await removeOwnedArtifact(entry.destinationPath, destinationInfo, fsImpl);
    return Object.freeze({
      ok: false,
      blocker: error?.code === 'DREAM_MIGRATION_HASH_MISMATCH'
        ? 'DREAM_MIGRATION_HASH_MISMATCH'
        : 'DREAM_MIGRATION_COPY_VERIFICATION_FAILED',
      copyFailureReason: error?.code || 'DREAM_MIGRATION_COPY_VERIFICATION_FAILED',
      cleanupBlocker: cleaned ? '' : 'DREAM_MIGRATION_COPY_CLEANUP_FAILED',
    });
  }
}

async function revalidateMigrationReceiptInputs(plan, { fsImpl, sourceHead }) {
  for (const entry of plan.entries) {
    try {
      const sourceInfo = await assertRegularSingleLink(entry.sourcePath, { fsImpl });
      if (sourceInfo.size !== entry.bytes || await sha256File(entry.sourcePath, { fsImpl }) !== entry.sourceSha256) {
        return Object.freeze({ ok: false, blocker: 'DREAM_MIGRATION_SOURCE_CHANGED', failedEntry: entry });
      }
      await assertRegularSingleLink(entry.destinationPath, { fsImpl });
      if (entry.state === 'versioned-preservation-required') {
        if (await sha256File(entry.destinationPath, { fsImpl }) !== entry.destinationSha256) {
          return Object.freeze({ ok: false, blocker: 'DREAM_CANONICAL_DESTINATION_CHANGED', failedEntry: entry });
        }
        const paths = resolveDreamVersionedPreservationPaths(entry, plan);
        const existingManifest = await readExistingManifest(paths, { entry, paths, sourceHead }, fsImpl);
        if (!existingManifest.exists || !existingManifest.ok) {
          return Object.freeze({
            ok: false,
            blocker: existingManifest.blocker || 'DREAM_VERSIONED_FINAL_REVALIDATION_FAILED',
            failedEntry: entry,
          });
        }
      } else if (await sha256File(entry.destinationPath, { fsImpl }) !== entry.sourceSha256) {
        return Object.freeze({ ok: false, blocker: 'DREAM_MIGRATION_DESTINATION_CHANGED', failedEntry: entry });
      }
    } catch (error) {
      return Object.freeze({
        ok: false,
        blocker: error?.code || 'DREAM_MIGRATION_FINAL_REVALIDATION_FAILED',
        failedEntry: entry,
      });
    }
  }
  return Object.freeze({ ok: true, blocker: '' });
}

export async function executeDreamRuntimeMigration({
  repoRoot,
  env = process.env,
  homeDir = os.homedir(),
  fsImpl = fs,
  operatorApproval = '',
  sourceHead = '',
  now = () => new Date(),
  operationLockOptions = {},
  acquireOperationLockFn = acquireSharedWorkspaceOperationLock,
  sourceHeadVerifierFn = null,
} = {}) {
  if (operatorApproval !== DREAM_RUNTIME_MIGRATION_APPROVAL) {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'DREAM_MIGRATION_APPROVAL_REQUIRED',
      blocker: 'DREAM_MIGRATION_APPROVAL_REQUIRED',
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  const plan = await planDreamRuntimeMigration({ repoRoot, env, homeDir, fsImpl });
  if (!plan.ok) {
    return Object.freeze({
      ...plan,
      status: 'BLOCKED',
      finalVerdict: plan.blocker || 'DREAM_MIGRATION_PLAN_BLOCKED',
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  if (!SOURCE_HEAD_PATTERN.test(String(sourceHead || '')) || typeof sourceHeadVerifierFn !== 'function') {
    return Object.freeze({
      ...plan,
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'DREAM_VERSIONED_SOURCE_HEAD_REQUIRED',
      blocker: 'DREAM_VERSIONED_SOURCE_HEAD_REQUIRED',
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  const verifySourceHead = async () => {
    try {
      const observed = String(await sourceHeadVerifierFn(plan.repoRoot)).trim().toLowerCase();
      return SOURCE_HEAD_PATTERN.test(observed) && observed === sourceHead;
    } catch {
      return false;
    }
  };
  if (!(await verifySourceHead())) {
    return Object.freeze({
      ...plan,
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED',
      blocker: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED',
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  const copied = [];
  const preserved = [];
  const createdCopyArtifacts = [];
  const createdPreservationArtifacts = [];
  const cleanupCreatedMigrationArtifacts = async () => {
    const results = [];
    const artifacts = [...createdCopyArtifacts, ...createdPreservationArtifacts];
    for (const artifact of artifacts.reverse()) {
      results.push(await removeOwnedArtifact(artifact.artifactPath, artifact.identity, fsImpl));
    }
    return results.every(Boolean);
  };
  for (const entry of plan.entries) {
    if (entry.state === 'copy-required') {
      const copyResult = await copyRequiredEntry(entry, fsImpl);
      if (!copyResult.ok) {
        const priorArtifactsCleaned = await cleanupCreatedMigrationArtifacts();
        return Object.freeze({
          ok: false,
          status: 'BLOCKED',
          finalVerdict: copyResult.blocker,
          blocker: copyResult.blocker,
          copyFailureReason: copyResult.copyFailureReason || '',
          cleanupBlocker: copyResult.cleanupBlocker || (priorArtifactsCleaned ? '' : 'DREAM_MIGRATION_ARTIFACT_CLEANUP_FAILED'),
          failedEntry: entry,
          copied: Object.freeze(copied),
          preserved: Object.freeze(preserved),
          sourceRemovalPerformed: false,
          destructiveGitOperationPerformed: false,
        });
      }
      copied.push(copyResult.entry);
      createdCopyArtifacts.push(copyResult.createdArtifact);
    } else if (entry.state === 'versioned-preservation-required') {
      let preservation;
      try {
        preservation = await preserveVersionedConflict(entry, plan, {
          fsImpl,
          sourceHead,
          now,
          operationLockOptions,
          acquireOperationLockFn,
          verifySourceHeadFn: verifySourceHead,
        });
      } catch (error) {
        preservation = Object.freeze({
          ok: false,
          blocker: 'DREAM_VERSIONED_PRESERVATION_SETUP_FAILED',
          preservationFailureReason: error?.code || 'DREAM_VERSIONED_PRESERVATION_SETUP_FAILED',
        });
      }
      if (!preservation.ok) {
        const priorArtifactsCleaned = await cleanupCreatedMigrationArtifacts();
        return Object.freeze({
          ok: false,
          status: 'BLOCKED',
          finalVerdict: preservation.blocker,
          blocker: preservation.blocker,
          lockReason: preservation.lockReason || '',
          lockCleanupBlocker: preservation.lockCleanupBlocker || '',
          lockReleaseReason: preservation.lockReleaseReason || '',
          preservationFailureReason: preservation.preservationFailureReason || '',
          snapshotWriteReason: preservation.snapshotWriteReason || '',
          manifestWriteReason: preservation.manifestWriteReason || '',
          cleanupBlocker: preservation.cleanupBlocker || (priorArtifactsCleaned ? '' : 'DREAM_MIGRATION_ARTIFACT_CLEANUP_FAILED'),
          failedEntry: entry,
          copied: Object.freeze(copied),
          preserved: Object.freeze(preserved),
          sourceRemovalPerformed: false,
          destructiveGitOperationPerformed: false,
        });
      }
      preserved.push(Object.freeze({
        ...entry,
        state: preservation.state,
        versionedSnapshotPath: preservation.snapshotPath,
        preservationManifestPath: preservation.manifestPath,
        manifest: preservation.manifest,
      }));
      createdPreservationArtifacts.push(...(preservation.createdArtifacts || []));
    }
  }
  const finalRevalidation = await revalidateMigrationReceiptInputs(plan, { fsImpl, sourceHead });
  if (!finalRevalidation.ok) {
    const cleaned = await cleanupCreatedMigrationArtifacts();
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: finalRevalidation.blocker,
      blocker: finalRevalidation.blocker,
      cleanupBlocker: cleaned ? '' : 'DREAM_MIGRATION_ARTIFACT_CLEANUP_FAILED',
      failedEntry: finalRevalidation.failedEntry,
      copied: Object.freeze(copied),
      preserved: Object.freeze([]),
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  if (!(await verifySourceHead())) {
    const cleaned = await cleanupCreatedMigrationArtifacts();
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED',
      blocker: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED',
      cleanupBlocker: cleaned ? '' : 'DREAM_MIGRATION_ARTIFACT_CLEANUP_FAILED',
      copied: Object.freeze(copied),
      preserved: Object.freeze([]),
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  const completedAtUtc = now().toISOString();
  const finalVerdict = preserved.length
    ? 'DREAM_RUNTIME_COPY_AND_VERSIONED_PRESERVATION_VERIFIED'
    : 'DREAM_RUNTIME_COPY_HASH_VERIFIED';
  const receipt = Object.freeze({
    schemaVersion: DREAM_RUNTIME_BOUNDARY_SCHEMA,
    kind: 'dream-runtime-migration-receipt',
    completedAtUtc,
    repoRoot: plan.repoRoot,
    workspaceRoot: plan.workspaceRoot,
    dreamMemoryRoot: plan.dreamMemoryRoot,
    copiedCount: copied.length,
    alreadyVerifiedCount: plan.alreadyVerified,
    versionedPreservedCount: preserved.length,
    sourceRemovalPerformed: false,
    canonicalDestinationRemovalPerformed: false,
    destructiveGitOperationPerformed: false,
    sourceHead,
    files: Object.freeze([
      ...plan.entries.filter((entry) => entry.state === 'already-verified'),
      ...copied,
      ...preserved,
    ]),
    finalVerdict,
  });
  let writtenReceipt;
  try {
    writtenReceipt = await writeReceipt(receipt, { fsImpl, receiptRoot: plan.receiptRoot });
  } catch (error) {
    const migrationArtifactsCleaned = await cleanupCreatedMigrationArtifacts();
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'DREAM_MIGRATION_RECEIPT_WRITE_FAILED',
      blocker: 'DREAM_MIGRATION_RECEIPT_WRITE_FAILED',
      receiptWriteReason: error?.reasonCode || error?.code || 'DREAM_MIGRATION_RECEIPT_WRITE_FAILED',
      cleanupBlocker: error?.cleanupBlocker || (migrationArtifactsCleaned ? '' : 'DREAM_MIGRATION_ARTIFACT_CLEANUP_FAILED'),
      copied: Object.freeze(copied),
      preserved: Object.freeze([]),
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  const postReceiptRevalidation = await revalidateMigrationReceiptInputs(plan, { fsImpl, sourceHead });
  if (!postReceiptRevalidation.ok) {
    const receiptCleaned = await removeOwnedArtifact(writtenReceipt.pendingReceiptPath, writtenReceipt.identity, fsImpl);
    const migrationArtifactsCleaned = await cleanupCreatedMigrationArtifacts();
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: postReceiptRevalidation.blocker,
      blocker: postReceiptRevalidation.blocker,
      cleanupBlocker: receiptCleaned && migrationArtifactsCleaned ? '' : 'DREAM_MIGRATION_ARTIFACT_CLEANUP_FAILED',
      failedEntry: postReceiptRevalidation.failedEntry,
      copied: Object.freeze(copied),
      preserved: Object.freeze([]),
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  if (!(await verifySourceHead())) {
    const receiptCleaned = await removeOwnedArtifact(writtenReceipt.pendingReceiptPath, writtenReceipt.identity, fsImpl);
    const migrationArtifactsCleaned = await cleanupCreatedMigrationArtifacts();
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED',
      blocker: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED',
      cleanupBlocker: receiptCleaned && migrationArtifactsCleaned ? '' : 'DREAM_MIGRATION_ARTIFACT_CLEANUP_FAILED',
      copied: Object.freeze(copied),
      preserved: Object.freeze([]),
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  let committedReceipt;
  try {
    committedReceipt = await promoteOwnedArtifact(
      writtenReceipt.pendingReceiptPath,
      writtenReceipt.receiptPath,
      writtenReceipt.identity,
      fsImpl,
    );
  } catch (error) {
    const pendingReceiptCleaned = await removeOwnedArtifact(
      writtenReceipt.pendingReceiptPath,
      writtenReceipt.identity,
      fsImpl,
    );
    const migrationArtifactsCleaned = await cleanupCreatedMigrationArtifacts();
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'DREAM_MIGRATION_RECEIPT_WRITE_FAILED',
      blocker: 'DREAM_MIGRATION_RECEIPT_WRITE_FAILED',
      receiptWriteReason: error?.reasonCode || error?.code || 'DREAM_MIGRATION_RECEIPT_COMMIT_FAILED',
      cleanupBlocker: error?.cleanupBlocker
        || (pendingReceiptCleaned && migrationArtifactsCleaned ? '' : 'DREAM_MIGRATION_ARTIFACT_CLEANUP_FAILED'),
      copied: Object.freeze(copied),
      preserved: Object.freeze([]),
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  const receiptPath = committedReceipt.artifactPath;
  return Object.freeze({
    ok: true,
    status: 'DONE',
    finalVerdict,
    blocker: '',
    boundary: plan,
    copied: Object.freeze(copied),
    preserved: Object.freeze(preserved),
    receipt,
    receiptPath,
    launchContext: plan.launchContext,
    sourceRemovalPerformed: false,
    canonicalDestinationRemovalPerformed: false,
    destructiveGitOperationPerformed: false,
    nextOperatorAction: 'Keep canonical destination and legacy source in place until separately approved source reconciliation and cleanup.',
  });
}
