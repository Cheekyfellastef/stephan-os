import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.includes('\0') || path.posix.isAbsolute(normalized)) return '';
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return segments.join('/');
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

async function ensureSafeDirectoryChain(target, { fsImpl = fs, create = false } = {}) {
  for (const directory of filesystemAncestors(target)) {
    let info;
    try {
      info = await fsImpl.lstat(directory);
    } catch (error) {
      if (error?.code !== 'ENOENT' || !create) throw error;
      try {
        await fsImpl.mkdir(directory, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') throw mkdirError;
      }
      info = await fsImpl.lstat(directory);
    }
    if (info.isSymbolicLink?.()) {
      throw codedError('DREAM_MIGRATION_REPARSE_ANCESTOR_BLOCKED', `Linked or reparse ancestor rejected: ${directory}`);
    }
    if (!info.isDirectory?.()) {
      throw codedError('DREAM_MIGRATION_ANCESTOR_UNSUPPORTED', `Non-directory ancestor rejected: ${directory}`);
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
  const snapshotPath = path.resolve(
    boundary.dreamMemoryRoot,
    DREAM_VERSIONED_PRESERVATION_DIRECTORY,
    'v1',
    mapping.id,
    logicalPathSha256,
    `${entry.sourceSha256}.snapshot`,
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
        const relativePath = safeRelativePath(path.relative(mapping.sourcePath, sourcePath));
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

async function writeReceipt(receipt, { fsImpl, receiptRoot }) {
  await ensureSafeDirectoryChain(receiptRoot, { fsImpl, create: true });
  const filename = `dream-migration-${safeTimestamp(new Date(receipt.completedAtUtc))}.json`;
  const receiptPath = path.join(receiptRoot, filename);
  await fsImpl.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  const identity = await assertRegularSingleLink(receiptPath, { fsImpl });
  return Object.freeze({ receiptPath, identity });
}

function versionedProofRefs(entry, paths) {
  return Object.freeze([
    `receipts/runtime-boundary/${paths.manifestFilename}`,
    `dream-preservation/${entry.mappingId}/${paths.logicalPathSha256}/${entry.sourceSha256}.snapshot`,
  ]);
}

function buildVersionedManifest(entry, paths, sourceHead, capturedAtUtc) {
  const proofRefs = versionedProofRefs(entry, paths);
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
  const expectedProofRefs = versionedProofRefs(expected.entry, expected.paths);
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
  try {
    const current = await fsImpl.lstat(artifactPath);
    if (!sameFileIdentity(identity, current) || current.isSymbolicLink?.() || Number(current.nlink) !== 1) return false;
    await fsImpl.unlink(artifactPath);
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
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
          await fsImpl.copyFile(entry.sourcePath, paths.snapshotPath, fsConstants.COPYFILE_EXCL);
          createdSnapshotIdentity = await assertRegularSingleLink(paths.snapshotPath, { fsImpl });
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
                await fsImpl.writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
                  encoding: 'utf8',
                  flag: 'wx',
                  mode: 0o600,
                });
                createdManifestIdentity = await assertRegularSingleLink(paths.manifestPath, { fsImpl });
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
                  blocker: error?.code === 'EEXIST' ? 'DREAM_VERSIONED_RECEIPT_CONFLICT' : 'DREAM_VERSIONED_MANIFEST_WRITE_FAILED',
                });
              }
            }
          }
        } catch (error) {
          outcome = Object.freeze({
            ok: false,
            blocker: error?.code === 'EEXIST' ? 'DREAM_VERSIONED_SNAPSHOT_COLLISION' : (error?.code || 'DREAM_VERSIONED_COPY_FAILED'),
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
    const released = await lock.release();
    if (!released && outcome?.ok === true) {
      outcome = Object.freeze({ ok: false, blocker: 'DREAM_VERSIONED_LOCK_RELEASE_FAILED' });
      if (!(await cleanupOwnedArtifacts())) {
        outcome = Object.freeze({ ...outcome, cleanupBlocker: 'DREAM_VERSIONED_ARTIFACT_CLEANUP_FAILED' });
      }
    }
  }
  return outcome;
}

async function copyRequiredEntry(entry, fsImpl) {
  await ensureSafeDirectoryChain(path.dirname(entry.sourcePath), { fsImpl, create: false });
  await ensureSafeDirectoryChain(path.dirname(entry.destinationPath), { fsImpl, create: true });
  const sourceBefore = await assertRegularSingleLink(entry.sourcePath, { fsImpl });
  if (await sha256File(entry.sourcePath, { fsImpl }) !== entry.sourceSha256) {
    return Object.freeze({ ok: false, blocker: 'DREAM_MIGRATION_SOURCE_CHANGED' });
  }
  try {
    await fsImpl.copyFile(entry.sourcePath, entry.destinationPath, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    return Object.freeze({ ok: false, blocker: error?.code === 'EEXIST' ? 'DREAM_MIGRATION_DESTINATION_RACE' : 'DREAM_MIGRATION_COPY_FAILED' });
  }
  const destinationInfo = await assertRegularSingleLink(entry.destinationPath, { fsImpl });
  const destinationSha256 = await sha256File(entry.destinationPath, { fsImpl });
  const sourceAfter = await assertRegularSingleLink(entry.sourcePath, { fsImpl });
  const sourceSha256After = await sha256File(entry.sourcePath, { fsImpl });
  if (
    destinationInfo.size !== entry.bytes
    || destinationSha256 !== entry.sourceSha256
    || sourceSha256After !== entry.sourceSha256
    || !sameFileIdentity(sourceBefore, sourceAfter)
  ) return Object.freeze({ ok: false, blocker: 'DREAM_MIGRATION_HASH_MISMATCH' });
  return Object.freeze({ ok: true, entry: Object.freeze({ ...entry, destinationSha256, state: 'copied-and-verified' }) });
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
  const createdPreservationArtifacts = [];
  const cleanupCreatedPreservationArtifacts = async () => {
    const results = [];
    for (const artifact of [...createdPreservationArtifacts].reverse()) {
      results.push(await removeOwnedArtifact(artifact.artifactPath, artifact.identity, fsImpl));
    }
    return results.every(Boolean);
  };
  for (const entry of plan.entries) {
    if (entry.state === 'copy-required') {
      const copyResult = await copyRequiredEntry(entry, fsImpl);
      if (!copyResult.ok) {
        return Object.freeze({
          ok: false,
          status: 'BLOCKED',
          finalVerdict: copyResult.blocker,
          blocker: copyResult.blocker,
          failedEntry: entry,
          copied: Object.freeze(copied),
          preserved: Object.freeze(preserved),
          sourceRemovalPerformed: false,
          destructiveGitOperationPerformed: false,
        });
      }
      copied.push(copyResult.entry);
    } else if (entry.state === 'versioned-preservation-required') {
      const preservation = await preserveVersionedConflict(entry, plan, {
        fsImpl,
        sourceHead,
        now,
        operationLockOptions,
        acquireOperationLockFn,
        verifySourceHeadFn: verifySourceHead,
      });
      if (!preservation.ok) {
        const priorArtifactsCleaned = preservation.blocker === 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED'
          ? await cleanupCreatedPreservationArtifacts()
          : true;
        return Object.freeze({
          ok: false,
          status: 'BLOCKED',
          finalVerdict: preservation.blocker,
          blocker: preservation.blocker,
          lockReason: preservation.lockReason || '',
          cleanupBlocker: preservation.cleanupBlocker || (priorArtifactsCleaned ? '' : 'DREAM_VERSIONED_ARTIFACT_CLEANUP_FAILED'),
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
  if (!(await verifySourceHead())) {
    const cleaned = await cleanupCreatedPreservationArtifacts();
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED',
      blocker: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED',
      cleanupBlocker: cleaned ? '' : 'DREAM_VERSIONED_ARTIFACT_CLEANUP_FAILED',
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
  const writtenReceipt = await writeReceipt(receipt, { fsImpl, receiptRoot: plan.receiptRoot });
  if (!(await verifySourceHead())) {
    const receiptCleaned = await removeOwnedArtifact(writtenReceipt.receiptPath, writtenReceipt.identity, fsImpl);
    const preservationCleaned = await cleanupCreatedPreservationArtifacts();
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED',
      blocker: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED',
      cleanupBlocker: receiptCleaned && preservationCleaned ? '' : 'DREAM_VERSIONED_ARTIFACT_CLEANUP_FAILED',
      copied: Object.freeze(copied),
      preserved: Object.freeze([]),
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  const receiptPath = writtenReceipt.receiptPath;
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
