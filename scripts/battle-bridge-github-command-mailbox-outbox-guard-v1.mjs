#!/usr/bin/env node
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAILBOX_OUTBOX_GUARD_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-guard.v1';
export const MAILBOX_OUTBOX_DEFERRED_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-deferred.v1';
export const MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-deferred-manifest.v2';
export const MAILBOX_OUTBOX_DEFERRED_SEGMENT_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-deferred-segment.v2';
export const MAILBOX_OUTBOX_LEDGER_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-ledger.v3';
export const MAILBOX_OUTBOX_LEDGER_SEGMENT_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-ledger-segment.v3';
export const MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-ledger-index.v3';
export const MAILBOX_OUTBOX_LEDGER_TRANSACTION_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-ledger-transaction.v3';
export const MAILBOX_OUTBOX_GUARD_LEASE_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-guard-lease.v1';
export const MAILBOX_OUTBOX_GUARD_LEASE_ENV = Object.freeze({
  schema: 'STEPHANOS_MAILBOX_OUTBOX_GUARD_LEASE_SCHEMA',
  lockPath: 'STEPHANOS_MAILBOX_OUTBOX_GUARD_LOCK_PATH',
  token: 'STEPHANOS_MAILBOX_OUTBOX_GUARD_LOCK_TOKEN',
  guardPid: 'STEPHANOS_MAILBOX_OUTBOX_GUARD_PID',
});
export const MAILBOX_OUTBOX_MAX_ATTEMPTS_PER_CYCLE = 1;
export const MAILBOX_OUTBOX_MAX_ENTRIES = 500;
export const MAILBOX_OUTBOX_SEGMENT_MAX_BYTES = 2 * 1024 * 1024;
export const MAILBOX_OUTBOX_MANIFEST_MAX_BYTES = 64 * 1024;

const MAILBOX_STATE_MAX_BYTES = 32 * 1024 * 1024;
const MAILBOX_LEGACY_V1_MIGRATION_MAX_BYTES = 2 * 1024 * 1024;
const MAILBOX_LEDGER_INDEX_MAX_BYTES = 8 * 1024;
// One bounded intent can contain the current ingress batch (itself bounded by the
// 32 MiB canonical state file) plus its small index/manifest metadata. Keeping
// the segment payloads in the intent is what makes a crash before segment
// publication resumable instead of leaving unauthorised future segments behind.
const MAILBOX_LEDGER_TRANSACTION_MAX_BYTES = 40 * 1024 * 1024;
const MAILBOX_LOCK_MAX_BYTES = 8 * 1024;
const MAILBOX_LOCK_STALE_AFTER_MS = 20 * 60 * 1000;
const MAILBOX_LEGACY_V1_MAX_MIGRATION_ENTRIES = 500;
const MAILBOX_MAX_SEQUENCE = 9_007_199_254_740_000;

const defaultRepoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const PUBLICATION_ID_LIMIT = 360;
const HEX_32 = /^[a-f0-9]{32}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const PROCESS_IDENTITY_COMPONENT = /^[A-Za-z0-9._:-]{6,160}$/;
const LEGACY_SLOT = /^(a|b)$/;

function fail(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    blocker,
    finalVerdict: 'MAILBOX_OUTBOX_GUARD_BLOCKED',
    ...details,
    arbitraryShellAllowed: false,
    arbitraryPathAllowed: false,
    sourceMutationAllowed: false,
  });
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function recordDigest(value) {
  return sha256(stableJson(value));
}

function safePublicationId(value) {
  const text = String(value || '');
  return text.length > 0 && text.length <= PUBLICATION_ID_LIMIT && !/[\r\n\0]/.test(text) ? text : '';
}

function validatePendingEntry(value) {
  if (!isPlainObject(value)) return false;
  const publicationId = safePublicationId(value.publicationId);
  const requestId = String(value?.receipt?.requestId || '');
  const state = String(value?.receipt?.state || '');
  return Boolean(
    publicationId
    && isPlainObject(value.receipt)
    && REQUEST_ID.test(requestId)
    && ['ACCEPTED', 'DONE', 'BLOCKED'].includes(state)
  );
}

export function pendingReceiptPublicationDigest(entry) {
  if (!validatePendingEntry(entry)) throw new Error('MAILBOX_OUTBOX_PENDING_ENTRY_INVALID');
  return recordDigest(entry);
}

export function normalizePendingReceiptPublications(entries = [], { maxEntries = MAILBOX_OUTBOX_MAX_ENTRIES } = {}) {
  if (!Array.isArray(entries)) throw new Error('MAILBOX_OUTBOX_PENDING_ARRAY_REQUIRED');
  const byId = new Map();
  for (const entry of entries) {
    if (!validatePendingEntry(entry)) throw new Error('MAILBOX_OUTBOX_PENDING_ENTRY_INVALID');
    const publicationId = String(entry.publicationId);
    const digest = pendingReceiptPublicationDigest(entry);
    const existing = byId.get(publicationId);
    if (existing && existing.digest !== digest) throw new Error('MAILBOX_OUTBOX_PUBLICATION_ID_CONFLICT');
    if (!existing) byId.set(publicationId, { digest, entry: structuredClone(entry) });
  }
  const normalized = [...byId.values()].map(({ entry }) => entry);
  if (Number.isSafeInteger(maxEntries) && normalized.length > maxEntries) throw new Error('MAILBOX_OUTBOX_PENDING_LIMIT_EXCEEDED');
  return normalized;
}

function normalizeAccumulatedDebt(entries = []) {
  return normalizePendingReceiptPublications(entries, { maxEntries: null });
}

function createIoMetrics() {
  return {
    jsonReads: 0,
    jsonWrites: 0,
    segmentReads: 0,
    segmentWrites: 0,
    indexReads: 0,
    indexWrites: 0,
  };
}

function snapshotIo(metrics) {
  return Object.freeze({ ...metrics });
}

function bumpRead(metrics, kind) {
  if (!metrics) return;
  metrics.jsonReads += 1;
  if (kind === 'segment') metrics.segmentReads += 1;
  if (kind === 'index') metrics.indexReads += 1;
}

function bumpWrite(metrics, kind) {
  if (!metrics) return;
  metrics.jsonWrites += 1;
  if (kind === 'segment') metrics.segmentWrites += 1;
  if (kind === 'index') metrics.indexWrites += 1;
}

function assertRegularUnlinkedFile(path, { allowMissing = false } = {}) {
  if (!existsSync(path)) {
    if (allowMissing) return null;
    throw new Error('MAILBOX_OUTBOX_FILE_MISSING');
  }
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('MAILBOX_OUTBOX_FILE_IDENTITY_INVALID');
  return info;
}

function assertUnlinkedDirectory(path, { allowMissing = false } = {}) {
  if (!existsSync(path)) {
    if (allowMissing) return null;
    throw new Error('MAILBOX_OUTBOX_DIRECTORY_MISSING');
  }
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('MAILBOX_OUTBOX_DIRECTORY_IDENTITY_INVALID');
  return info;
}

function fixedDirectoryChain(root, components = [], { create = false } = {}) {
  const paths = [root];
  for (const component of components) paths.push(join(paths.at(-1), component));
  for (const path of paths) {
    const existing = assertUnlinkedDirectory(path, { allowMissing: true });
    if (existing) continue;
    if (!create) return false;
    const parent = dirname(path);
    assertUnlinkedDirectory(parent);
    mkdirSync(path);
    assertUnlinkedDirectory(path);
    syncDirectoryBestEffort(parent);
  }
  return true;
}

function sameFileIdentity(before, after) {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs;
}

function sameDirectoryIdentity(before, after) {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.isDirectory()
    && after.isDirectory();
}

export function readJsonObject(path, {
  allowMissing = false,
  missingValue = null,
  maxBytes = MAILBOX_STATE_MAX_BYTES,
  metrics = null,
  kind = 'json',
  openFile = openSync,
  fstatFile = fstatSync,
  readFile = readSync,
} = {}) {
  const pathBefore = assertRegularUnlinkedFile(path, { allowMissing });
  if (!pathBefore) return missingValue;
  let descriptor = null;
  try {
    descriptor = openFile(path, 'r');
    const before = fstatFile(descriptor);
    if (!before.isFile() || !sameFileIdentity(pathBefore, before)) {
      throw new Error('MAILBOX_OUTBOX_FILE_IDENTITY_CHANGED');
    }
    if (before.size > maxBytes) throw new Error('MAILBOX_OUTBOX_JSON_TOO_LARGE');
    bumpRead(metrics, kind);
    const payload = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < payload.byteLength) {
      const bytesRead = readFile(descriptor, payload, offset, payload.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const overflow = Buffer.alloc(1);
    const overflowBytes = readFile(descriptor, overflow, 0, 1, offset);
    const after = fstatFile(descriptor);
    const pathAfter = assertRegularUnlinkedFile(path);
    if (offset !== payload.byteLength
      || overflowBytes !== 0
      || !sameFileIdentity(before, after)
      || !sameFileIdentity(before, pathAfter)) {
      throw new Error('MAILBOX_OUTBOX_FILE_IDENTITY_CHANGED');
    }
    const value = JSON.parse(payload.toString('utf8'));
    if (!isPlainObject(value)) throw new Error('MAILBOX_OUTBOX_JSON_OBJECT_REQUIRED');
    return value;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function syncDirectoryBestEffort(path) {
  let descriptor = null;
  try {
    descriptor = openSync(path, 'r');
    fsyncSync(descriptor);
  } catch (error) {
    if (!['EACCES', 'EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR', 'EBADF', 'UNKNOWN'].includes(String(error?.code || ''))) throw error;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

export function atomicWriteJson(path, value, {
  maxBytes = null,
  metrics = null,
  kind = 'json',
  space = 2,
  beforeTemporaryOpenFn = () => {},
  beforeRenameFn = () => {},
} = {}) {
  const parentPath = dirname(path);
  mkdirSync(parentPath, { recursive: true });
  const parentIdentity = assertUnlinkedDirectory(parentPath);
  const targetIdentity = assertRegularUnlinkedFile(path, { allowMissing: true });
  const payload = `${JSON.stringify(value, null, space)}\n`;
  if (Number.isSafeInteger(maxBytes) && Buffer.byteLength(payload, 'utf8') > maxBytes) {
    throw new Error('MAILBOX_OUTBOX_JSON_TOO_LARGE');
  }
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID().replaceAll('-', '')}`;
  let descriptor = null;
  try {
    beforeTemporaryOpenFn();
    descriptor = openSync(temporary, 'wx');
    if (!sameDirectoryIdentity(parentIdentity, assertUnlinkedDirectory(parentPath))) {
      throw new Error('MAILBOX_OUTBOX_DIRECTORY_IDENTITY_CHANGED');
    }
    writeFileSync(descriptor, payload, { encoding: 'utf8' });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    beforeRenameFn();
    if (!sameDirectoryIdentity(parentIdentity, assertUnlinkedDirectory(parentPath))) {
      throw new Error('MAILBOX_OUTBOX_DIRECTORY_IDENTITY_CHANGED');
    }
    const currentTargetIdentity = assertRegularUnlinkedFile(path, { allowMissing: true });
    if (Boolean(targetIdentity) !== Boolean(currentTargetIdentity)
      || (targetIdentity && !sameFileIdentity(targetIdentity, currentTargetIdentity))) {
      throw new Error('MAILBOX_OUTBOX_FILE_IDENTITY_CHANGED');
    }
    renameSync(temporary, path);
    if (!sameDirectoryIdentity(parentIdentity, assertUnlinkedDirectory(parentPath))) {
      throw new Error('MAILBOX_OUTBOX_DIRECTORY_IDENTITY_CHANGED');
    }
    syncDirectoryBestEffort(parentPath);
    bumpWrite(metrics, kind);
  } catch (error) {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch {}
    }
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

function removeRegularFile(path) {
  if (!existsSync(path)) return;
  assertRegularUnlinkedFile(path);
  unlinkSync(path);
  syncDirectoryBestEffort(dirname(path));
}

function canonicalPendingFromState(state) {
  if (Object.prototype.hasOwnProperty.call(state, 'pendingReceiptPublications')
    && !Array.isArray(state.pendingReceiptPublications)) {
    throw new Error('MAILBOX_OUTBOX_CANONICAL_PENDING_ARRAY_REQUIRED');
  }
  return normalizePendingReceiptPublications(state.pendingReceiptPublications || []);
}

function ledgerRoot(path) {
  return `${path}.ledger-v3`;
}

function transactionPath(path) {
  return `${path}.transaction-v3.json`;
}

function lockPath(path) {
  return `${path}.lock-v1.json`;
}

function mailboxStateRootFromEnv(env = process.env) {
  const workspaceRoot = resolve(env.STEPHANOS_SHARED_WORKSPACE_ROOT || join(env.USERPROFILE || homedir(), 'Documents', 'Stephanos', 'shared-agent-workspace'));
  return join(workspaceRoot, 'github-command-mailbox');
}

export function resolveMailboxOutboxGuardLockPath({ env = process.env } = {}) {
  return lockPath(join(mailboxStateRootFromEnv(env), 'receipt-publication-deferred-v1.json'));
}

function sequenceText(sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > MAILBOX_MAX_SEQUENCE) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_SEQUENCE_INVALID');
  }
  return String(sequence).padStart(16, '0');
}

function segmentPath(path, sequence) {
  const text = sequenceText(sequence);
  const bucket = sequenceBucket(sequence);
  return join(ledgerRoot(path), 'segments', bucket, `segment-${text}.json`);
}

function sequenceBucket(sequence) {
  sequenceText(sequence);
  return String(Math.floor(sequence / 1000)).padStart(13, '0');
}

function publicationIndexPath(path, publicationId) {
  const digest = sha256(String(publicationId));
  return join(ledgerRoot(path), 'index', digest.slice(0, 2), `${digest}.json`);
}

function ledgerSegmentDirectoryReady(path, sequence, { create = false } = {}) {
  return fixedDirectoryChain(ledgerRoot(path), ['segments', sequenceBucket(sequence)], { create });
}

function ledgerIndexDirectoryReady(path, publicationId, { create = false } = {}) {
  const digest = sha256(String(publicationId));
  return fixedDirectoryChain(ledgerRoot(path), ['index', digest.slice(0, 2)], { create });
}

function legacySegmentDirectoryReady(path, legacy) {
  return fixedDirectoryChain(`${path}.segments`, [legacy.activeSlot]);
}

function legacyV2SegmentPath(path, legacy, segmentIndex) {
  if (!LEGACY_SLOT.test(String(legacy?.activeSlot || ''))
    || !Number.isSafeInteger(segmentIndex)
    || segmentIndex < 0
    || segmentIndex >= legacy.segmentCount) {
    throw new Error('MAILBOX_OUTBOX_LEGACY_CURSOR_INVALID');
  }
  return join(`${path}.segments`, legacy.activeSlot, `segment-${String(segmentIndex).padStart(8, '0')}.json`);
}

function validSequence(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAILBOX_MAX_SEQUENCE;
}

function validateLegacyDescriptor(value) {
  if (value === null) return null;
  if (!isPlainObject(value)
    || value.kind !== 'segmented-v2'
    || !LEGACY_SLOT.test(String(value.activeSlot || ''))
    || !HEX_32.test(String(value.generation || ''))
    || !Number.isSafeInteger(value.segmentCount)
    || value.segmentCount < 0
    || !Number.isSafeInteger(value.segmentIndex)
    || value.segmentIndex < 0
    || value.segmentIndex > value.segmentCount
    || !Number.isSafeInteger(value.entryOffset)
    || value.entryOffset < 0
    || !Number.isSafeInteger(value.remainingEntryCount)
    || value.remainingEntryCount < 0
    || (value.remainingEntryCount === 0) !== (value.segmentIndex === value.segmentCount)) {
    throw new Error('MAILBOX_OUTBOX_LEGACY_DESCRIPTOR_INVALID');
  }
  return value;
}

function validateLedgerManifest(record) {
  if (record.schemaVersion !== MAILBOX_OUTBOX_LEDGER_SCHEMA
    || !HEX_32.test(String(record.storeId || ''))
    || !validSequence(record.headSequence)
    || !validSequence(record.nextSequence)
    || record.headSequence > record.nextSequence) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_MANIFEST_INVALID');
  }
  validateLegacyDescriptor(record.legacy ?? null);
  return record;
}

function validateV2Manifest(record) {
  if (record.schemaVersion !== MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA
    || !LEGACY_SLOT.test(String(record.activeSlot || ''))
    || !HEX_32.test(String(record.generation || ''))
    || !Number.isSafeInteger(record.segmentCount)
    || record.segmentCount < 0
    || !Number.isSafeInteger(record.entryCount)
    || record.entryCount < 0
    || (record.segmentCount === 0) !== (record.entryCount === 0)
    || record.entryCount < record.segmentCount
    || record.entryCount > record.segmentCount * MAILBOX_OUTBOX_MAX_ENTRIES) {
    throw new Error('MAILBOX_OUTBOX_DEFERRED_MANIFEST_INVALID');
  }
  return record;
}

function createLedgerManifest({ storeId, timestampUtc, legacy = null, headSequence = 0, nextSequence = 0 }) {
  return {
    schemaVersion: MAILBOX_OUTBOX_LEDGER_SCHEMA,
    timestampUtc,
    storeId,
    headSequence,
    nextSequence,
    legacy,
  };
}

function validateIndexRecord(record, expectedPublicationId = null) {
  const publicationId = safePublicationId(record?.publicationId);
  const queuedLedger = record?.status === 'QUEUED'
    && record?.source === 'ledger-v3'
    && validSequence(record?.sequence)
    && record?.legacySegmentIndex === undefined
    && record?.legacyEntryOffset === undefined;
  const queuedLegacy = record?.status === 'QUEUED'
    && record?.source === 'legacy-v2'
    && record?.sequence === null
    && Number.isSafeInteger(record?.legacySegmentIndex)
    && record.legacySegmentIndex >= 0
    && Number.isSafeInteger(record?.legacyEntryOffset)
    && record.legacyEntryOffset >= 0;
  const completed = record?.status === 'COMPLETED'
    && record?.source === 'ledger-v3'
    && record?.sequence === null
    && record?.legacySegmentIndex === undefined
    && record?.legacyEntryOffset === undefined;
  if (!isPlainObject(record)
    || record.schemaVersion !== MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA
    || !publicationId
    || publicationId !== record.publicationId
    || (expectedPublicationId !== null && publicationId !== expectedPublicationId)
    || !HEX_64.test(String(record.entryDigest || ''))
    || (!queuedLedger && !queuedLegacy && !completed)) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_INDEX_INVALID');
  }
  return record;
}

function readIndex(path, entry, metrics) {
  if (!ledgerIndexDirectoryReady(path, entry.publicationId)) return null;
  const indexPath = publicationIndexPath(path, entry.publicationId);
  const record = readJsonObject(indexPath, {
    allowMissing: true,
    missingValue: null,
    maxBytes: MAILBOX_LEDGER_INDEX_MAX_BYTES,
    metrics,
    kind: 'index',
  });
  if (!record) return null;
  return validateIndexRecord(record, entry.publicationId);
}

function queuedLedgerIndex(entry, entryDigest, sequence) {
  return {
    schemaVersion: MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA,
    publicationId: entry.publicationId,
    entryDigest,
    status: 'QUEUED',
    source: 'ledger-v3',
    sequence,
  };
}

function queuedLegacyIndex(entry, entryDigest, legacy) {
  return {
    schemaVersion: MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA,
    publicationId: entry.publicationId,
    entryDigest,
    status: 'QUEUED',
    source: 'legacy-v2',
    sequence: null,
    legacySegmentIndex: legacy.segmentIndex,
    legacyEntryOffset: legacy.entryOffset,
  };
}

function completedIndex(entry, entryDigest) {
  return {
    schemaVersion: MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA,
    publicationId: entry.publicationId,
    entryDigest,
    status: 'COMPLETED',
    source: 'ledger-v3',
    sequence: null,
  };
}

function segmentRecord(manifest, sequence, entry, entryDigest) {
  return {
    schemaVersion: MAILBOX_OUTBOX_LEDGER_SEGMENT_SCHEMA,
    storeId: manifest.storeId,
    sequence,
    entryDigest,
    entry,
  };
}

function validateSegment(record, manifest, sequence) {
  if (record.schemaVersion !== MAILBOX_OUTBOX_LEDGER_SEGMENT_SCHEMA
    || record.storeId !== manifest.storeId
    || record.sequence !== sequence
    || !HEX_64.test(String(record.entryDigest || ''))
    || !validatePendingEntry(record.entry)
    || pendingReceiptPublicationDigest(record.entry) !== record.entryDigest) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_SEGMENT_INVALID');
  }
  return record;
}

function writeSegment(path, record, metrics) {
  ledgerSegmentDirectoryReady(path, record.sequence, { create: true });
  const targetPath = segmentPath(path, record.sequence);
  const existing = readJsonObject(targetPath, {
    allowMissing: true,
    missingValue: null,
    maxBytes: MAILBOX_OUTBOX_SEGMENT_MAX_BYTES,
    metrics,
    kind: 'segment',
  });
  if (existing) {
    if (stableJson(existing) === stableJson(record)) return;
    throw new Error('MAILBOX_OUTBOX_LEDGER_FUTURE_SEGMENT_CONFLICT');
  }
  atomicWriteJson(targetPath, record, {
    maxBytes: MAILBOX_OUTBOX_SEGMENT_MAX_BYTES,
    metrics,
    kind: 'segment',
    space: 0,
  });
}

function readSegment(path, manifest, sequence, metrics) {
  if (!ledgerSegmentDirectoryReady(path, sequence)) throw new Error('MAILBOX_OUTBOX_LEDGER_SEGMENT_DIRECTORY_MISSING');
  return validateSegment(readJsonObject(segmentPath(path, sequence), {
    maxBytes: MAILBOX_OUTBOX_SEGMENT_MAX_BYTES,
    metrics,
    kind: 'segment',
  }), manifest, sequence);
}

function removeLedgerSegment(path, sequence) {
  if (!ledgerSegmentDirectoryReady(path, sequence)) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_SEGMENT_DIRECTORY_MISSING');
  }
  removeRegularFile(segmentPath(path, sequence));
}

function assertIndexCompatible(existing, target, expected) {
  if (existing && stableJson(existing) === stableJson(target)) return 'already-target';
  if (expected === null && existing === null) return 'apply';
  if (expected && existing && stableJson(existing) === stableJson(expected)) return 'apply';
  throw new Error('MAILBOX_OUTBOX_LEDGER_INDEX_CONFLICT');
}

function applyIndexWrite(path, mutation, metrics) {
  if (!isPlainObject(mutation) || !isPlainObject(mutation.target)
    || (mutation.expected !== null && !isPlainObject(mutation.expected))) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_INDEX_INVALID');
  }
  const target = validateIndexRecord(mutation.target);
  const expected = mutation.expected === null
    ? null
    : validateIndexRecord(mutation.expected, target.publicationId);
  if (expected && expected.entryDigest !== target.entryDigest) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_INDEX_INVALID');
  }
  ledgerIndexDirectoryReady(path, target.publicationId, { create: true });
  const indexPath = publicationIndexPath(path, target.publicationId);
  const existing = readJsonObject(indexPath, {
    allowMissing: true,
    missingValue: null,
    maxBytes: MAILBOX_LEDGER_INDEX_MAX_BYTES,
    metrics,
    kind: 'index',
  });
  const validatedExisting = existing === null ? null : validateIndexRecord(existing, target.publicationId);
  if (assertIndexCompatible(validatedExisting, target, expected) === 'already-target') return;
  atomicWriteJson(indexPath, target, {
    maxBytes: MAILBOX_LEDGER_INDEX_MAX_BYTES,
    metrics,
    kind: 'index',
  });
}

function legacyCursorTransition(baseValue, targetValue) {
  if (stableJson(baseValue) === stableJson(targetValue)) return 'SAME';
  const base = validateLegacyDescriptor(baseValue);
  const target = validateLegacyDescriptor(targetValue);
  if (!base) throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
  if (base.remainingEntryCount === 1 && target === null) return 'ADVANCED';
  if (!target
    || target.kind !== base.kind
    || target.activeSlot !== base.activeSlot
    || target.generation !== base.generation
    || target.segmentCount !== base.segmentCount
    || target.remainingEntryCount !== base.remainingEntryCount - 1) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
  }
  const sameSegmentAdvance = target.segmentIndex === base.segmentIndex
    && target.entryOffset === base.entryOffset + 1;
  const nextSegmentAdvance = target.segmentIndex === base.segmentIndex + 1
    && target.entryOffset === 0;
  if (!sameSegmentAdvance && !nextSegmentAdvance) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
  }
  return 'ADVANCED';
}

function validateLedgerTransition(baseManifest, targetManifest, transaction) {
  const base = validateLedgerManifest(baseManifest);
  const target = validateLedgerManifest(targetManifest);
  const headDelta = target.headSequence - base.headSequence;
  const nextDelta = target.nextSequence - base.nextSequence;
  const legacyTransition = legacyCursorTransition(base.legacy ?? null, target.legacy ?? null);
  if (target.storeId !== base.storeId
    || ![0, 1].includes(headDelta)
    || nextDelta < 0
    || nextDelta > MAILBOX_OUTBOX_MAX_ENTRIES + 1
    || (headDelta === 1 && base.legacy !== null)
    || (headDelta === 1 && legacyTransition !== 'SAME')
    || (headDelta === 0 && legacyTransition === 'ADVANCED' && base.legacy === null)) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
  }
  const expectedCleanup = headDelta === 1 ? [base.headSequence] : [];
  if (stableJson(transaction.cleanupSequences) !== stableJson(expectedCleanup)) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
  }
  const referencedSequences = [...transaction.segmentRefs].map((ref) => ref.sequence).sort((left, right) => left - right);
  const expectedSequences = Array.from({ length: nextDelta }, (_, offset) => base.nextSequence + offset);
  if (stableJson(referencedSequences) !== stableJson(expectedSequences)) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
  }
  return transaction;
}

function validateTransaction(record) {
  if (record.schemaVersion !== MAILBOX_OUTBOX_LEDGER_TRANSACTION_SCHEMA
    || !HEX_32.test(String(record.transactionId || ''))
    || !HEX_64.test(String(record.baseManifestDigest || ''))
    || !HEX_64.test(String(record.targetManifestDigest || ''))
    || !isPlainObject(record.baseManifest)
    || !Array.isArray(record.segmentWrites)
    || record.segmentWrites.length > MAILBOX_OUTBOX_MAX_ENTRIES + 1
    || !Array.isArray(record.segmentRefs)
    || record.segmentRefs.length > MAILBOX_OUTBOX_MAX_ENTRIES + 1
    || record.segmentWrites.length !== record.segmentRefs.length
    || !Array.isArray(record.indexWrites)
    || record.indexWrites.length > MAILBOX_OUTBOX_MAX_ENTRIES + 1
    || !Array.isArray(record.cleanupSequences)
    || record.cleanupSequences.length > 1) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
  }
  validateLedgerManifest(record.baseManifest);
  validateLedgerManifest(record.targetManifest);
  if (recordDigest(record.baseManifest) !== record.baseManifestDigest
    || recordDigest(record.targetManifest) !== record.targetManifestDigest) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
  }
  const segmentSequenceKeys = new Set();
  const segmentWritesBySequence = new Map();
  for (const segment of record.segmentWrites) {
    if (!isPlainObject(segment) || !validSequence(segment.sequence)
      || segmentWritesBySequence.has(segment.sequence)) {
      throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
    }
    validateSegment(segment, record.targetManifest, segment.sequence);
    segmentWritesBySequence.set(segment.sequence, segment);
  }
  for (const ref of record.segmentRefs) {
    if (!isPlainObject(ref)
      || !validSequence(ref.sequence)
      || !HEX_64.test(String(ref.entryDigest || ''))
      || segmentSequenceKeys.has(ref.sequence)) {
      throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
    }
    const segment = segmentWritesBySequence.get(ref.sequence);
    if (!segment || segment.entryDigest !== ref.entryDigest) {
      throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
    }
    segmentSequenceKeys.add(ref.sequence);
  }
  const indexPublicationIds = new Set();
  const queuedSegmentIndexes = new Map();
  for (const mutation of record.indexWrites) {
    if (!isPlainObject(mutation) || !isPlainObject(mutation.target) || (mutation.expected !== null && !isPlainObject(mutation.expected))) {
      throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
    }
    const target = validateIndexRecord(mutation.target);
    const expected = mutation.expected === null
      ? null
      : validateIndexRecord(mutation.expected, target.publicationId);
    if ((expected && expected.entryDigest !== target.entryDigest)
      || indexPublicationIds.has(target.publicationId)) {
      throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
    }
    indexPublicationIds.add(target.publicationId);
    if (target.status === 'QUEUED' && target.source === 'ledger-v3') {
      if (queuedSegmentIndexes.has(target.sequence)) throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
      queuedSegmentIndexes.set(target.sequence, target);
    }
  }
  if (record.cleanupSequences.some((sequence) => !validSequence(sequence))) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
  }
  for (const ref of record.segmentRefs) {
    const target = queuedSegmentIndexes.get(ref.sequence);
    if (!target || target.entryDigest !== ref.entryDigest) {
      throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
    }
  }
  if (queuedSegmentIndexes.size !== record.segmentRefs.length) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_INVALID');
  }
  return validateLedgerTransition(record.baseManifest, record.targetManifest, record);
}

function recoverTransaction(path, manifest, metrics) {
  const pending = readJsonObject(transactionPath(path), {
    allowMissing: true,
    missingValue: null,
    maxBytes: MAILBOX_LEDGER_TRANSACTION_MAX_BYTES,
    metrics,
  });
  if (!pending) return manifest;
  const transaction = validateTransaction(pending);
  const currentDigest = recordDigest(manifest);
  if (currentDigest !== transaction.baseManifestDigest && currentDigest !== transaction.targetManifestDigest) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_BASE_MISMATCH');
  }
  for (const segment of transaction.segmentWrites) writeSegment(path, segment, metrics);
  for (const ref of transaction.segmentRefs) {
    const segment = readSegment(path, transaction.targetManifest, ref.sequence, metrics);
    const targetIndex = transaction.indexWrites
      .map((mutation) => mutation.target)
      .find((target) => target.status === 'QUEUED'
        && target.source === 'ledger-v3'
        && target.sequence === ref.sequence);
    if (segment.entryDigest !== ref.entryDigest
      || targetIndex?.publicationId !== segment.entry.publicationId
      || targetIndex?.entryDigest !== segment.entryDigest) {
      throw new Error('MAILBOX_OUTBOX_LEDGER_TRANSACTION_SEGMENT_MISMATCH');
    }
  }
  for (const mutation of transaction.indexWrites) applyIndexWrite(path, mutation, metrics);
  if (currentDigest === transaction.baseManifestDigest) {
    atomicWriteJson(path, transaction.targetManifest, {
      maxBytes: MAILBOX_OUTBOX_MANIFEST_MAX_BYTES,
      metrics,
    });
  }
  for (const sequence of transaction.cleanupSequences) removeLedgerSegment(path, sequence);
  removeRegularFile(transactionPath(path));
  return transaction.targetManifest;
}

function commitLedgerMutation(path, baseManifest, {
  targetManifest,
  segmentWrites = [],
  indexWrites = [],
  cleanupSequences = [],
}, { metrics, faultFn = () => {} } = {}) {
  if (segmentWrites.length === 0
    && indexWrites.length === 0
    && cleanupSequences.length === 0
    && stableJson(baseManifest) === stableJson(targetManifest)) return baseManifest;
  const transaction = {
    schemaVersion: MAILBOX_OUTBOX_LEDGER_TRANSACTION_SCHEMA,
    transactionId: randomUUID().replaceAll('-', ''),
    baseManifestDigest: recordDigest(baseManifest),
    targetManifestDigest: recordDigest(targetManifest),
    baseManifest,
    targetManifest,
    segmentWrites,
    segmentRefs: segmentWrites.map((segment) => ({ sequence: segment.sequence, entryDigest: segment.entryDigest })),
    indexWrites,
    cleanupSequences,
  };
  validateTransaction(transaction);
  atomicWriteJson(transactionPath(path), transaction, {
    maxBytes: MAILBOX_LEDGER_TRANSACTION_MAX_BYTES,
    metrics,
  });
  faultFn('after-ledger-transaction');
  for (const segment of segmentWrites) writeSegment(path, segment, metrics);
  faultFn('after-ledger-segments');
  for (const mutation of indexWrites) applyIndexWrite(path, mutation, metrics);
  faultFn('after-ledger-indexes');
  atomicWriteJson(path, targetManifest, {
    maxBytes: MAILBOX_OUTBOX_MANIFEST_MAX_BYTES,
    metrics,
  });
  faultFn('after-ledger-manifest');
  for (const sequence of cleanupSequences) removeLedgerSegment(path, sequence);
  removeRegularFile(transactionPath(path));
  return targetManifest;
}

function parseLegacyV1(record) {
  if (record.schemaVersion !== MAILBOX_OUTBOX_DEFERRED_SCHEMA) throw new Error('MAILBOX_OUTBOX_DEFERRED_RECORD_INVALID');
  let entries;
  if (Array.isArray(record.entries)) {
    if (record.entries.length > MAILBOX_LEGACY_V1_MAX_MIGRATION_ENTRIES) {
      throw new Error('MAILBOX_OUTBOX_LEGACY_V1_MIGRATION_WORK_LIMIT_EXCEEDED');
    }
    entries = normalizeAccumulatedDebt(record.entries);
  }
  else {
    if (!Array.isArray(record.segments)
      || record.segments.length > MAILBOX_LEGACY_V1_MAX_MIGRATION_ENTRIES) {
      throw new Error(record.segments?.length > MAILBOX_LEGACY_V1_MAX_MIGRATION_ENTRIES
        ? 'MAILBOX_OUTBOX_LEGACY_V1_MIGRATION_WORK_LIMIT_EXCEEDED'
        : 'MAILBOX_OUTBOX_DEFERRED_RECORD_INVALID');
    }
    const accumulated = [];
    let rawEntryCount = 0;
    for (const segment of record.segments) {
      if (!Array.isArray(segment)) throw new Error('MAILBOX_OUTBOX_DEFERRED_SEGMENT_INVALID');
      rawEntryCount += segment.length;
      if (rawEntryCount > MAILBOX_LEGACY_V1_MAX_MIGRATION_ENTRIES) {
        throw new Error('MAILBOX_OUTBOX_LEGACY_V1_MIGRATION_WORK_LIMIT_EXCEEDED');
      }
      accumulated.push(...normalizePendingReceiptPublications(segment));
    }
    entries = normalizeAccumulatedDebt(accumulated);
  }
  return entries;
}

function migrateLegacyV1(path, record, timestampUtc, metrics) {
  const entries = parseLegacyV1(record);
  const storeId = sha256(`legacy-v1:${stableJson(record)}`).slice(0, 32);
  const base = createLedgerManifest({ storeId, timestampUtc });
  const segmentWrites = [];
  const indexWrites = [];
  let nextSequence = 0;
  for (const entry of entries) {
    const entryDigest = pendingReceiptPublicationDigest(entry);
    segmentWrites.push(segmentRecord(base, nextSequence, entry, entryDigest));
    indexWrites.push({ expected: null, target: queuedLedgerIndex(entry, entryDigest, nextSequence) });
    nextSequence += 1;
  }
  const target = { ...base, nextSequence };
  for (const segment of segmentWrites) writeSegment(path, segment, metrics);
  for (const mutation of indexWrites) applyIndexWrite(path, mutation, metrics);
  atomicWriteJson(path, target, { maxBytes: MAILBOX_OUTBOX_MANIFEST_MAX_BYTES, metrics });
  return target;
}

function loadOrInitializeLedger(path, timestampUtc, metrics) {
  assertUnlinkedDirectory(ledgerRoot(path), { allowMissing: true });
  assertUnlinkedDirectory(`${path}.segments`, { allowMissing: true });
  const record = readJsonObject(path, {
    allowMissing: true,
    missingValue: null,
    maxBytes: MAILBOX_LEGACY_V1_MIGRATION_MAX_BYTES,
    metrics,
  });
  if (!record) {
    const manifest = createLedgerManifest({ storeId: randomUUID().replaceAll('-', ''), timestampUtc });
    atomicWriteJson(path, manifest, { maxBytes: MAILBOX_OUTBOX_MANIFEST_MAX_BYTES, metrics });
    return manifest;
  }
  if (record.schemaVersion === MAILBOX_OUTBOX_LEDGER_SCHEMA) {
    if (assertRegularUnlinkedFile(path).size > MAILBOX_OUTBOX_MANIFEST_MAX_BYTES) {
      throw new Error('MAILBOX_OUTBOX_LEDGER_MANIFEST_TOO_LARGE');
    }
    return recoverTransaction(path, validateLedgerManifest(record), metrics);
  }
  if (record.schemaVersion === MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA) {
    if (assertRegularUnlinkedFile(path).size > MAILBOX_OUTBOX_MANIFEST_MAX_BYTES) {
      throw new Error('MAILBOX_OUTBOX_DEFERRED_MANIFEST_TOO_LARGE');
    }
    const legacy = validateV2Manifest(record);
    const manifest = createLedgerManifest({
      storeId: sha256(`legacy-v2:${legacy.generation}`).slice(0, 32),
      timestampUtc,
      legacy: legacy.entryCount === 0 ? null : {
        kind: 'segmented-v2',
        activeSlot: legacy.activeSlot,
        generation: legacy.generation,
        segmentCount: legacy.segmentCount,
        segmentIndex: 0,
        entryOffset: 0,
        remainingEntryCount: legacy.entryCount,
      },
    });
    atomicWriteJson(path, manifest, { maxBytes: MAILBOX_OUTBOX_MANIFEST_MAX_BYTES, metrics });
    return manifest;
  }
  return migrateLegacyV1(path, record, timestampUtc, metrics);
}

function updateManifestTimestamp(manifest, timestampUtc, overrides = {}) {
  return { ...manifest, ...overrides, timestampUtc };
}

function assertQueuedIndexReachable(path, manifest, entry, index, metrics) {
  if (index.status === 'COMPLETED') return;
  if (index.source === 'ledger-v3') {
    if (index.sequence < manifest.headSequence || index.sequence >= manifest.nextSequence) {
      throw new Error('MAILBOX_OUTBOX_LEDGER_INDEX_UNREACHABLE');
    }
    const segment = readSegment(path, manifest, index.sequence, metrics);
    if (segment.entry.publicationId !== entry.publicationId
      || segment.entryDigest !== index.entryDigest) {
      throw new Error('MAILBOX_OUTBOX_LEDGER_INDEX_UNREACHABLE');
    }
    return;
  }
  const legacy = validateLegacyDescriptor(manifest.legacy ?? null);
  if (!legacy
    || index.source !== 'legacy-v2'
    || index.legacySegmentIndex !== legacy.segmentIndex
    || index.legacyEntryOffset !== legacy.entryOffset) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_INDEX_UNREACHABLE');
  }
  const head = readLegacyHead(path, manifest, metrics);
  if (!head
    || head.entry.publicationId !== entry.publicationId
    || head.entryDigest !== index.entryDigest) {
    throw new Error('MAILBOX_OUTBOX_LEDGER_INDEX_UNREACHABLE');
  }
}

function planAppendEntries(path, manifest, entries, metrics, virtualIndexes = new Map()) {
  const segmentWrites = [];
  const indexWrites = [];
  let nextSequence = manifest.nextSequence;
  for (const entry of normalizePendingReceiptPublications(entries)) {
    const entryDigest = pendingReceiptPublicationDigest(entry);
    const publicationId = entry.publicationId;
    const virtual = virtualIndexes.has(publicationId);
    const existing = virtual
      ? virtualIndexes.get(publicationId)
      : readIndex(path, entry, metrics);
    if (existing) {
      if (existing.entryDigest !== entryDigest) throw new Error('MAILBOX_OUTBOX_PUBLICATION_ID_CONFLICT');
      if (!virtual) assertQueuedIndexReachable(path, manifest, entry, existing, metrics);
      continue;
    }
    if (!validSequence(nextSequence + 1)) throw new Error('MAILBOX_OUTBOX_LEDGER_SEQUENCE_EXHAUSTED');
    const targetIndex = queuedLedgerIndex(entry, entryDigest, nextSequence);
    segmentWrites.push(segmentRecord(manifest, nextSequence, entry, entryDigest));
    indexWrites.push({ expected: null, target: targetIndex });
    virtualIndexes.set(publicationId, targetIndex);
    nextSequence += 1;
  }
  return { segmentWrites, indexWrites, nextSequence, virtualIndexes };
}

function appendCanonicalDebt(path, manifest, entries, timestampUtc, metrics, faultFn) {
  const planned = planAppendEntries(path, manifest, entries, metrics);
  if (planned.segmentWrites.length === 0) return manifest;
  return commitLedgerMutation(path, manifest, {
    targetManifest: updateManifestTimestamp(manifest, timestampUtc, { nextSequence: planned.nextSequence }),
    segmentWrites: planned.segmentWrites,
    indexWrites: planned.indexWrites,
  }, { metrics, faultFn });
}

function readLegacyHead(path, manifest, metrics) {
  const legacy = validateLegacyDescriptor(manifest.legacy);
  if (!legacy) return null;
  if (!legacySegmentDirectoryReady(path, legacy)) {
    throw new Error('MAILBOX_OUTBOX_DEFERRED_SEGMENT_DIRECTORY_MISSING');
  }
  const record = readJsonObject(legacyV2SegmentPath(path, legacy, legacy.segmentIndex), {
    maxBytes: MAILBOX_OUTBOX_SEGMENT_MAX_BYTES,
    metrics,
    kind: 'segment',
  });
  if (record.schemaVersion !== MAILBOX_OUTBOX_DEFERRED_SEGMENT_SCHEMA
    || record.generation !== legacy.generation
    || record.segmentIndex !== legacy.segmentIndex
    || !Array.isArray(record.entries)
    || record.entries.length === 0
    || record.entries.length > MAILBOX_OUTBOX_MAX_ENTRIES
    || legacy.entryOffset >= record.entries.length) {
    throw new Error('MAILBOX_OUTBOX_DEFERRED_SEGMENT_INVALID');
  }
  const entries = normalizePendingReceiptPublications(record.entries);
  if (entries.length !== record.entries.length) throw new Error('MAILBOX_OUTBOX_LEGACY_DUPLICATE_INVALID');
  const entry = entries[legacy.entryOffset];
  return {
    origin: 'legacy-v2',
    entry,
    entryDigest: pendingReceiptPublicationDigest(entry),
    legacySegmentEntryCount: entries.length,
  };
}

function advanceLegacy(manifest, head, timestampUtc) {
  const legacy = { ...manifest.legacy };
  legacy.remainingEntryCount -= 1;
  legacy.entryOffset += 1;
  if (legacy.entryOffset >= head.legacySegmentEntryCount) {
    legacy.segmentIndex += 1;
    legacy.entryOffset = 0;
  }
  const nextLegacy = legacy.remainingEntryCount === 0 ? null : legacy;
  if (nextLegacy && nextLegacy.segmentIndex >= nextLegacy.segmentCount) {
    throw new Error('MAILBOX_OUTBOX_LEGACY_CURSOR_INVALID');
  }
  return updateManifestTimestamp(manifest, timestampUtc, { legacy: nextLegacy });
}

function peekLedgerHead(path, manifest, timestampUtc, metrics, faultFn) {
  if (manifest.legacy) {
    const head = readLegacyHead(path, manifest, metrics);
    const existing = readIndex(path, head.entry, metrics);
    if (existing && existing.entryDigest !== head.entryDigest) throw new Error('MAILBOX_OUTBOX_PUBLICATION_ID_CONFLICT');
    if (existing && existing.status === 'COMPLETED') {
      const advanced = commitLedgerMutation(path, manifest, {
        targetManifest: advanceLegacy(manifest, head, timestampUtc),
      }, { metrics, faultFn });
      return { manifest: advanced, head: null, duplicateCollapsed: true };
    }
    if (existing && existing.source === 'ledger-v3') {
      assertQueuedIndexReachable(path, manifest, head.entry, existing, metrics);
      const advanced = commitLedgerMutation(path, manifest, {
        targetManifest: advanceLegacy(manifest, head, timestampUtc),
      }, { metrics, faultFn });
      return { manifest: advanced, head: null, duplicateCollapsed: true };
    }
    const expectedLegacy = queuedLegacyIndex(head.entry, head.entryDigest, manifest.legacy);
    if (existing && stableJson(existing) !== stableJson(expectedLegacy)) {
      throw new Error('MAILBOX_OUTBOX_LEDGER_INDEX_CONFLICT');
    }
    if (!existing) applyIndexWrite(path, { expected: null, target: expectedLegacy }, metrics);
    return { manifest, head, duplicateCollapsed: false };
  }
  if (manifest.headSequence === manifest.nextSequence) return { manifest, head: null, duplicateCollapsed: false };
  const segment = readSegment(path, manifest, manifest.headSequence, metrics);
  const index = readIndex(path, segment.entry, metrics);
  const expected = queuedLedgerIndex(segment.entry, segment.entryDigest, manifest.headSequence);
  if (!index || stableJson(index) !== stableJson(expected)) throw new Error('MAILBOX_OUTBOX_LEDGER_INDEX_CONFLICT');
  return {
    manifest,
    head: {
      origin: 'ledger-v3',
      sequence: manifest.headSequence,
      entry: segment.entry,
      entryDigest: segment.entryDigest,
    },
    duplicateCollapsed: false,
  };
}

function applyPostChildOutcome(path, manifest, head, statePending, timestampUtc, metrics, faultFn) {
  const normalized = normalizePendingReceiptPublications(statePending);
  const attemptedAfter = head
    ? normalized.find((entry) => entry.publicationId === head.entry.publicationId) || null
    : null;
  if (attemptedAfter && pendingReceiptPublicationDigest(attemptedAfter) !== head.entryDigest) {
    throw new Error('MAILBOX_OUTBOX_PUBLICATION_ID_CONFLICT');
  }
  const appendEntries = head
    ? normalized.filter((entry) => entry.publicationId !== head.entry.publicationId)
    : normalized;
  let targetManifest = manifest;
  const segmentWrites = [];
  const indexWrites = [];
  const cleanupSequences = [];
  const virtualIndexes = new Map();

  if (head) {
    const existing = readIndex(path, head.entry, metrics);
    if (!existing || existing.entryDigest !== head.entryDigest || existing.status !== 'QUEUED') {
      throw new Error('MAILBOX_OUTBOX_LEDGER_INDEX_CONFLICT');
    }
    if (head.origin === 'legacy-v2') targetManifest = advanceLegacy(targetManifest, head, timestampUtc);
    else {
      targetManifest = updateManifestTimestamp(targetManifest, timestampUtc, {
        headSequence: targetManifest.headSequence + 1,
      });
      cleanupSequences.push(head.sequence);
    }
    if (attemptedAfter) {
      const sequence = targetManifest.nextSequence;
      if (!validSequence(sequence + 1)) throw new Error('MAILBOX_OUTBOX_LEDGER_SEQUENCE_EXHAUSTED');
      const targetIndex = queuedLedgerIndex(head.entry, head.entryDigest, sequence);
      segmentWrites.push(segmentRecord(targetManifest, sequence, head.entry, head.entryDigest));
      indexWrites.push({ expected: existing, target: targetIndex });
      virtualIndexes.set(head.entry.publicationId, targetIndex);
      targetManifest = updateManifestTimestamp(targetManifest, timestampUtc, { nextSequence: sequence + 1 });
    } else {
      const targetIndex = completedIndex(head.entry, head.entryDigest);
      indexWrites.push({ expected: existing, target: targetIndex });
      virtualIndexes.set(head.entry.publicationId, targetIndex);
    }
  }

  const appended = planAppendEntries(path, targetManifest, appendEntries, metrics, virtualIndexes);
  segmentWrites.push(...appended.segmentWrites);
  indexWrites.push(...appended.indexWrites);
  targetManifest = updateManifestTimestamp(targetManifest, timestampUtc, { nextSequence: appended.nextSequence });
  return commitLedgerMutation(path, manifest, {
    targetManifest,
    segmentWrites,
    indexWrites,
    cleanupSequences,
  }, { metrics, faultFn });
}

function pendingCount(manifest) {
  return (manifest.nextSequence - manifest.headSequence) + Number(manifest.legacy?.remainingEntryCount || 0);
}

function defaultProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return Object.freeze({ state: 'unknown' });
  if (process.platform !== 'win32') {
    if (pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return Object.freeze({ state: 'unknown' });
      } catch (error) {
        return Object.freeze({ state: error?.code === 'ESRCH' ? 'dead' : 'unknown' });
      }
    }
    return Object.freeze({
      state: 'known',
      bootId: `nonwindows-boot-${process.pid}`,
      processStartId: `nonwindows-start-${Math.floor(Date.now() - (process.uptime() * 1000))}`,
    });
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    'if ($null -eq $p) { exit 3 }',
    '$os=Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop',
    "[Console]::Out.Write($os.LastBootUpTime.ToUniversalTime().Ticks.ToString()+'|'+$p.StartTime.ToUniversalTime().Ticks.ToString())",
  ].join('; ');
  const result = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 10_000,
  });
  if (result?.status === 3) return Object.freeze({ state: 'dead' });
  if (result?.error || result?.status !== 0) return Object.freeze({ state: 'unknown' });
  const match = String(result.stdout || '').trim().match(/^([0-9]+)\|([0-9]+)$/);
  if (!match) return Object.freeze({ state: 'unknown' });
  return Object.freeze({
    state: 'known',
    bootId: `windows-boot-${match[1]}`,
    processStartId: `windows-process-${match[2]}`,
  });
}

function validKnownProcessIdentity(identity) {
  return identity?.state === 'known'
    && PROCESS_IDENTITY_COMPONENT.test(String(identity.bootId || ''))
    && PROCESS_IDENTITY_COMPONENT.test(String(identity.processStartId || ''));
}

function lockRecord(token, now, processIdentity) {
  if (!validKnownProcessIdentity(processIdentity)) throw new Error('MAILBOX_OUTBOX_LOCK_PROCESS_IDENTITY_UNPROVEN');
  return {
    schemaVersion: 'stephanos.battle-bridge-mailbox-outbox-lock.v1',
    token,
    pid: process.pid,
    ownerBootId: processIdentity.bootId,
    ownerProcessStartId: processIdentity.processStartId,
    acquiredAtUtc: now.toISOString(),
  };
}

function writeExclusiveLock(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  let descriptor = null;
  try {
    descriptor = openSync(path, 'wx');
    writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  syncDirectoryBestEffort(dirname(path));
}

function acquireGuardLock(path, now, {
  tokenFn,
  processIdentityFn,
  staleAfterMs,
  allowRecovery = true,
} = {}) {
  const target = lockPath(path);
  const token = String(tokenFn() || '').toLowerCase();
  if (!HEX_32.test(token)) throw new Error('MAILBOX_OUTBOX_LOCK_TOKEN_INVALID');
  const selfIdentity = processIdentityFn(process.pid);
  if (!validKnownProcessIdentity(selfIdentity)) throw new Error('MAILBOX_OUTBOX_LOCK_PROCESS_IDENTITY_UNPROVEN');
  try {
    writeExclusiveLock(target, lockRecord(token, now, selfIdentity));
    return Object.freeze({ path: target, token, processIdentity: selfIdentity, recoveredStaleLock: !allowRecovery });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const info = assertRegularUnlinkedFile(target);
    let existing = null;
    try { existing = readJsonObject(target, { maxBytes: MAILBOX_LOCK_MAX_BYTES }); } catch {}
    const parsedAt = Date.parse(String(existing?.acquiredAtUtc || ''));
    const latestTrustedTimeMs = now.getTime() + 60_000;
    const fallbackMtimeMs = Number.isFinite(info.mtimeMs) && info.mtimeMs <= latestTrustedTimeMs
      ? info.mtimeMs
      : now.getTime() - staleAfterMs - 1;
    const acquiredAtMs = Number.isFinite(parsedAt) && parsedAt <= latestTrustedTimeMs
      ? parsedAt
      : fallbackMtimeMs;
    const ageMs = now.getTime() - acquiredAtMs;
    const liveIdentity = processIdentityFn(Number.parseInt(existing?.pid, 10));
    const exactOwnerAlive = validKnownProcessIdentity(liveIdentity)
      && liveIdentity.bootId === existing?.ownerBootId
      && liveIdentity.processStartId === existing?.ownerProcessStartId;
    const exactOwnerAbsent = liveIdentity?.state === 'dead'
      || (validKnownProcessIdentity(liveIdentity) && !exactOwnerAlive);
    if (allowRecovery && Number.isFinite(ageMs) && ageMs > staleAfterMs && exactOwnerAbsent) {
      const currentInfo = assertRegularUnlinkedFile(target);
      if (!sameFileIdentity(info, currentInfo)) throw new Error('MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING');
      const stalePath = `${target}.stale-${token}`;
      renameSync(target, stalePath);
      removeRegularFile(stalePath);
      return acquireGuardLock(path, now, {
        tokenFn,
        processIdentityFn,
        staleAfterMs,
        allowRecovery: false,
      });
    }
    throw new Error('MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING');
  }
}

function verifyGuardLock(lock) {
  const current = readJsonObject(lock.path, { maxBytes: MAILBOX_LOCK_MAX_BYTES });
  if (current.token !== lock.token
    || Number(current.pid) !== process.pid
    || current.ownerBootId !== lock.processIdentity?.bootId
    || current.ownerProcessStartId !== lock.processIdentity?.processStartId) {
    throw new Error('MAILBOX_OUTBOX_GUARD_LOCK_LOST');
  }
}

function guardLeaseFailure(blocker) {
  return Object.freeze({
    ok: false,
    blocker,
    finalVerdict: 'MAILBOX_OUTBOX_GUARD_LEASE_BLOCKED',
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
  });
}

export function verifyMailboxOutboxGuardLease({
  env = process.env,
  parentPid = process.ppid,
} = {}) {
  try {
    const schema = String(env[MAILBOX_OUTBOX_GUARD_LEASE_ENV.schema] || '');
    const claimedLockPath = String(env[MAILBOX_OUTBOX_GUARD_LEASE_ENV.lockPath] || '');
    const token = String(env[MAILBOX_OUTBOX_GUARD_LEASE_ENV.token] || '').toLowerCase();
    const guardPid = Number.parseInt(env[MAILBOX_OUTBOX_GUARD_LEASE_ENV.guardPid], 10);
    if (schema !== MAILBOX_OUTBOX_GUARD_LEASE_SCHEMA
      || !claimedLockPath
      || !HEX_32.test(token)
      || !Number.isSafeInteger(guardPid)
      || guardPid <= 0
      || guardPid !== Number(parentPid)) {
      return guardLeaseFailure('MAILBOX_OUTBOX_GUARD_LEASE_REQUIRED');
    }
    const expectedLockPath = resolveMailboxOutboxGuardLockPath({ env });
    if (resolve(claimedLockPath).toLowerCase() !== resolve(expectedLockPath).toLowerCase()) {
      return guardLeaseFailure('MAILBOX_OUTBOX_GUARD_LEASE_PATH_MISMATCH');
    }
    const current = readJsonObject(expectedLockPath, { maxBytes: MAILBOX_LOCK_MAX_BYTES });
    if (current.schemaVersion !== 'stephanos.battle-bridge-mailbox-outbox-lock.v1'
      || String(current.token || '').toLowerCase() !== token
      || Number(current.pid) !== guardPid
      || !PROCESS_IDENTITY_COMPONENT.test(String(current.ownerBootId || ''))
      || !PROCESS_IDENTITY_COMPONENT.test(String(current.ownerProcessStartId || ''))) {
      return guardLeaseFailure('MAILBOX_OUTBOX_GUARD_LEASE_MISMATCH');
    }
    return Object.freeze({
      ok: true,
      blocker: '',
      finalVerdict: 'MAILBOX_OUTBOX_GUARD_LEASE_READY',
      lockPath: expectedLockPath,
      guardPid,
      sourceMutationAllowed: false,
      commandExecutionAllowed: true,
    });
  } catch {
    return guardLeaseFailure('MAILBOX_OUTBOX_GUARD_LEASE_UNPROVEN');
  }
}

export function createMailboxOutboxGuardChildEnvironment(env, lock) {
  verifyGuardLock(lock);
  return Object.freeze({
    ...env,
    [MAILBOX_OUTBOX_GUARD_LEASE_ENV.schema]: MAILBOX_OUTBOX_GUARD_LEASE_SCHEMA,
    [MAILBOX_OUTBOX_GUARD_LEASE_ENV.lockPath]: lock.path,
    [MAILBOX_OUTBOX_GUARD_LEASE_ENV.token]: lock.token,
    [MAILBOX_OUTBOX_GUARD_LEASE_ENV.guardPid]: String(process.pid),
  });
}

function releaseGuardLock(lock) {
  if (!lock || !existsSync(lock.path)) return;
  try {
    const current = readJsonObject(lock.path, { maxBytes: MAILBOX_LOCK_MAX_BYTES });
    if (current.token === lock.token) removeRegularFile(lock.path);
  } catch {}
}

function resolveProductionPaths({ env = process.env, repoRoot = defaultRepoRoot } = {}) {
  const actualRepoRoot = resolve(repoRoot);
  const expectedRepoRoot = resolve(env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os');
  const mailboxStateRoot = mailboxStateRootFromEnv(env);
  return Object.freeze({
    actualRepoRoot,
    expectedRepoRoot,
    statePath: join(mailboxStateRoot, 'state.json'),
    deferredPath: join(mailboxStateRoot, 'receipt-publication-deferred-v1.json'),
    childRunnerPath: join(actualRepoRoot, 'scripts', 'battle-bridge-github-command-mailbox-with-receipt-index.mjs'),
  });
}

export function runMailboxOutboxGuard({
  platform = process.platform,
  env = process.env,
  repoRoot = defaultRepoRoot,
  now = () => new Date(),
  lockTokenFn = () => randomUUID().replaceAll('-', ''),
  processIdentityFn = defaultProcessIdentity,
  staleAfterMs = MAILBOX_LOCK_STALE_AFTER_MS,
  spawnSyncFn = spawnSync,
  faultFn = () => {},
  pathOverrides = null,
} = {}) {
  if (platform !== 'win32') return fail('WINDOWS_REQUIRED');
  const resolved = pathOverrides || resolveProductionPaths({ env, repoRoot });
  const actualRepoRoot = resolve(resolved.actualRepoRoot || repoRoot);
  const expectedRepoRoot = resolve(resolved.expectedRepoRoot || actualRepoRoot);
  if (actualRepoRoot.toLowerCase() !== expectedRepoRoot.toLowerCase()) return fail('CANONICAL_CHECKOUT_REQUIRED');

  const statePath = resolve(resolved.statePath);
  const deferredPath = resolve(resolved.deferredPath);
  const childRunnerPath = resolve(resolved.childRunnerPath);
  if (dirname(statePath).toLowerCase() !== dirname(deferredPath).toLowerCase()
    || basename(statePath).toLowerCase() !== 'state.json'
    || basename(deferredPath).toLowerCase() !== 'receipt-publication-deferred-v1.json') {
    return fail('MAILBOX_OUTBOX_STORE_PATH_INVALID');
  }
  const metrics = createIoMetrics();
  let lock = null;
  try {
    assertRegularUnlinkedFile(childRunnerPath);
    mkdirSync(dirname(statePath), { recursive: true });
    assertUnlinkedDirectory(dirname(statePath));
    const timestamp = now();
    lock = acquireGuardLock(deferredPath, timestamp, {
      tokenFn: lockTokenFn,
      processIdentityFn,
      staleAfterMs,
    });
    const state = readJsonObject(statePath, {
      allowMissing: true,
      missingValue: { consumedRequestIds: [], acceptedRequestIds: [], pendingReceiptPublications: [] },
      maxBytes: MAILBOX_STATE_MAX_BYTES,
      metrics,
    });
    const statePendingBefore = canonicalPendingFromState(state);
    let manifest = loadOrInitializeLedger(deferredPath, timestamp.toISOString(), metrics);
    manifest = appendCanonicalDebt(deferredPath, manifest, statePendingBefore, now().toISOString(), metrics, faultFn);
    const peeked = peekLedgerHead(deferredPath, manifest, now().toISOString(), metrics, faultFn);
    manifest = peeked.manifest;
    const head = peeked.head;
    const pendingBeforeChild = pendingCount(manifest);
    atomicWriteJson(statePath, {
      ...state,
      pendingReceiptPublications: head ? [head.entry] : [],
    }, { maxBytes: MAILBOX_STATE_MAX_BYTES, metrics });
    verifyGuardLock(lock);
    const preIngressIo = snapshotIo(metrics);

    const child = spawnSyncFn(process.execPath, [childRunnerPath], {
      cwd: actualRepoRoot,
      env: createMailboxOutboxGuardChildEnvironment(env, lock),
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 15 * 60 * 1000,
      maxBuffer: 2 * 1024 * 1024,
    });

    verifyGuardLock(lock);
    const stateAfter = readJsonObject(statePath, { maxBytes: MAILBOX_STATE_MAX_BYTES, metrics });
    const statePendingAfter = canonicalPendingFromState(stateAfter);
    manifest = applyPostChildOutcome(
      deferredPath,
      manifest,
      head,
      statePendingAfter,
      now().toISOString(),
      metrics,
      faultFn,
    );
    atomicWriteJson(statePath, {
      ...stateAfter,
      pendingReceiptPublications: [],
    }, { maxBytes: MAILBOX_STATE_MAX_BYTES, metrics });

    const childOk = !child?.error && child?.status === 0;
    return Object.freeze({
      ok: childOk,
      blocker: childOk ? '' : 'MAILBOX_CHILD_RUN_BLOCKED',
      finalVerdict: childOk ? 'MAILBOX_OUTBOX_GUARD_READY' : 'MAILBOX_OUTBOX_GUARD_BLOCKED',
      attemptedPublicationCount: head ? 1 : 0,
      deferredPublicationCountBeforeChild: Math.max(0, pendingBeforeChild - (head ? 1 : 0)),
      pendingPublicationCountAfterChild: pendingCount(manifest),
      deferredLedgerVersion: 3,
      duplicateLegacyPublicationCollapsed: peeked.duplicateCollapsed,
      staleLockRecovered: lock.recoveredStaleLock === true,
      preIngressIo,
      ledgerIo: snapshotIo(metrics),
      childExitStatus: child?.status ?? null,
      childSignal: child?.signal ?? null,
      childError: child?.error?.message || '',
      canonicalRunnerUsed: true,
      commandIngressDelegatedToExistingMailbox: true,
      receiptReplayAllowed: false,
      arbitraryShellAllowed: false,
      arbitraryPathAllowed: false,
      sourceMutationAllowed: false,
    });
  } catch (error) {
    return fail('MAILBOX_OUTBOX_GUARD_FAILED', {
      error: String(error?.message || error).slice(0, 240),
      ledgerIo: snapshotIo(metrics),
    });
  } finally {
    releaseGuardLock(lock);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runMailboxOutboxGuard();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
