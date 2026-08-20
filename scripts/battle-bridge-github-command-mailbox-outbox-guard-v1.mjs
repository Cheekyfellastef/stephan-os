#!/usr/bin/env node
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAILBOX_OUTBOX_GUARD_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-guard.v1';
export const MAILBOX_OUTBOX_DEFERRED_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-deferred.v1';
export const MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-deferred-manifest.v2';
export const MAILBOX_OUTBOX_DEFERRED_SEGMENT_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-deferred-segment.v2';
export const MAILBOX_OUTBOX_MAX_ATTEMPTS_PER_CYCLE = 1;
export const MAILBOX_OUTBOX_MAX_ENTRIES = 500;
export const MAILBOX_OUTBOX_SEGMENT_MAX_BYTES = 2 * 1024 * 1024;
export const MAILBOX_OUTBOX_MANIFEST_MAX_BYTES = 64 * 1024;

const MAILBOX_STATE_MAX_BYTES = 32 * 1024 * 1024;
const MAILBOX_LEGACY_DEFERRED_MAX_BYTES = 512 * 1024 * 1024;
const MAILBOX_OUTBOX_MAX_SEGMENTS = 1_000_000;

const defaultRepoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const PUBLICATION_ID_LIMIT = 360;
const DEFERRED_SLOT = /^(a|b)$/;
const DEFERRED_GENERATION = /^[a-f0-9]{32}$/;
const DEFERRED_SEGMENT_FILE = /^segment-([0-9]{8,16})\.json$/;

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

export function normalizePendingReceiptPublications(entries = [], { maxEntries = MAILBOX_OUTBOX_MAX_ENTRIES } = {}) {
  if (!Array.isArray(entries)) throw new Error('MAILBOX_OUTBOX_PENDING_ARRAY_REQUIRED');
  const byId = new Map();
  for (const entry of entries) {
    if (!validatePendingEntry(entry)) throw new Error('MAILBOX_OUTBOX_PENDING_ENTRY_INVALID');
    byId.set(String(entry.publicationId), structuredClone(entry));
  }
  const normalized = [...byId.values()];
  if (Number.isSafeInteger(maxEntries) && normalized.length > maxEntries) throw new Error('MAILBOX_OUTBOX_PENDING_LIMIT_EXCEEDED');
  return normalized;
}

function normalizeAccumulatedDebt(entries = []) {
  return normalizePendingReceiptPublications(entries, { maxEntries: null });
}

export function planMailboxOutboxCycle({ statePending = [], deferredPending = [] } = {}) {
  const combined = normalizeAccumulatedDebt([
    ...normalizeAccumulatedDebt(deferredPending),
    ...normalizePendingReceiptPublications(statePending),
  ]);
  return Object.freeze({
    attemptedThisCycle: Object.freeze(combined.slice(0, MAILBOX_OUTBOX_MAX_ATTEMPTS_PER_CYCLE)),
    deferred: Object.freeze(combined.slice(MAILBOX_OUTBOX_MAX_ATTEMPTS_PER_CYCLE)),
    totalPending: combined.length,
    maxAttemptsPerCycle: MAILBOX_OUTBOX_MAX_ATTEMPTS_PER_CYCLE,
  });
}

export function mergeMailboxOutboxAfterCycle({ deferredPending = [], statePending = [] } = {}) {
  // Deferred debt is placed first. A failed publication attempted in this cycle is
  // therefore rotated behind older deferred debt instead of monopolising every run.
  return Object.freeze(normalizeAccumulatedDebt([
    ...normalizeAccumulatedDebt(deferredPending),
    ...normalizePendingReceiptPublications(statePending),
  ]));
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

function readJsonObject(path, { allowMissing = false, missingValue = null, maxBytes = MAILBOX_STATE_MAX_BYTES } = {}) {
  if (!existsSync(path)) {
    if (allowMissing) return missingValue;
    throw new Error('MAILBOX_OUTBOX_JSON_MISSING');
  }
  assertRegularUnlinkedFile(path);
  const text = readFileSync(path, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('MAILBOX_OUTBOX_JSON_TOO_LARGE');
  const value = JSON.parse(text);
  if (!isPlainObject(value)) throw new Error('MAILBOX_OUTBOX_JSON_OBJECT_REQUIRED');
  return value;
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

function atomicWriteJson(path, value, { maxBytes = null, space = 2 } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) assertRegularUnlinkedFile(path);
  const payload = `${JSON.stringify(value, null, space)}\n`;
  if (Number.isSafeInteger(maxBytes) && Buffer.byteLength(payload, 'utf8') > maxBytes) {
    throw new Error('MAILBOX_OUTBOX_JSON_TOO_LARGE');
  }
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, 'wx');
    writeFileSync(descriptor, payload, { encoding: 'utf8' });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
    syncDirectoryBestEffort(dirname(path));
  } catch (error) {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch {}
    }
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

function canonicalPendingFromState(state) {
  if (Object.prototype.hasOwnProperty.call(state, 'pendingReceiptPublications')
    && !Array.isArray(state.pendingReceiptPublications)) {
    throw new Error('MAILBOX_OUTBOX_CANONICAL_PENDING_ARRAY_REQUIRED');
  }
  return normalizePendingReceiptPublications(state.pendingReceiptPublications || []);
}

function deferredSegmentRoot(path) {
  return `${path}.segments`;
}

function deferredSlotRoot(path, slot) {
  if (!DEFERRED_SLOT.test(String(slot || ''))) throw new Error('MAILBOX_OUTBOX_DEFERRED_SLOT_INVALID');
  return join(deferredSegmentRoot(path), slot);
}

function deferredSegmentPath(path, slot, index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= MAILBOX_OUTBOX_MAX_SEGMENTS) {
    throw new Error('MAILBOX_OUTBOX_DEFERRED_SEGMENT_INDEX_INVALID');
  }
  return join(deferredSlotRoot(path, slot), `segment-${String(index).padStart(8, '0')}.json`);
}

function validateManifest(record) {
  if (record.schemaVersion !== MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA
    || !DEFERRED_SLOT.test(String(record.activeSlot || ''))
    || !DEFERRED_GENERATION.test(String(record.generation || ''))
    || !Number.isSafeInteger(record.segmentCount)
    || record.segmentCount < 0
    || record.segmentCount > MAILBOX_OUTBOX_MAX_SEGMENTS
    || !Number.isSafeInteger(record.entryCount)
    || record.entryCount < 0
    || (record.segmentCount === 0) !== (record.entryCount === 0)
    || record.entryCount < record.segmentCount
    || record.entryCount > record.segmentCount * MAILBOX_OUTBOX_MAX_ENTRIES) {
    throw new Error('MAILBOX_OUTBOX_DEFERRED_MANIFEST_INVALID');
  }
  return record;
}

function readDeferredManifest(path, record) {
  validateManifest(record);
  const segmentRoot = deferredSegmentRoot(path);
  const slotRoot = deferredSlotRoot(path, record.activeSlot);
  if (record.segmentCount > 0) {
    assertUnlinkedDirectory(segmentRoot);
    assertUnlinkedDirectory(slotRoot);
  }
  const entries = [];
  let storedEntryCount = 0;
  for (let index = 0; index < record.segmentCount; index += 1) {
    const segment = readJsonObject(deferredSegmentPath(path, record.activeSlot, index), {
      maxBytes: MAILBOX_OUTBOX_SEGMENT_MAX_BYTES,
    });
    if (segment.schemaVersion !== MAILBOX_OUTBOX_DEFERRED_SEGMENT_SCHEMA
      || segment.generation !== record.generation
      || segment.segmentIndex !== index
      || !Array.isArray(segment.entries)
      || segment.entries.length > MAILBOX_OUTBOX_MAX_ENTRIES) {
      throw new Error('MAILBOX_OUTBOX_DEFERRED_SEGMENT_INVALID');
    }
    storedEntryCount += segment.entries.length;
    entries.push(...normalizePendingReceiptPublications(segment.entries));
  }
  if (storedEntryCount !== record.entryCount) throw new Error('MAILBOX_OUTBOX_DEFERRED_ENTRY_COUNT_INVALID');
  return Object.freeze({
    entries: Object.freeze(normalizeAccumulatedDebt(entries)),
    activeSlot: record.activeSlot,
    storageFormat: 'segmented-v2',
    segmentCount: record.segmentCount,
  });
}

function readLegacyDeferred(record) {
  if (record.schemaVersion !== MAILBOX_OUTBOX_DEFERRED_SCHEMA) {
    throw new Error('MAILBOX_OUTBOX_DEFERRED_RECORD_INVALID');
  }
  if (Array.isArray(record.entries)) {
    return Object.freeze({
      entries: Object.freeze(normalizeAccumulatedDebt(record.entries)),
      activeSlot: null,
      storageFormat: 'legacy-v1',
      segmentCount: 0,
    });
  }
  if (!Array.isArray(record.segments)) throw new Error('MAILBOX_OUTBOX_DEFERRED_RECORD_INVALID');
  const entries = [];
  for (const segment of record.segments) {
    if (!Array.isArray(segment)) throw new Error('MAILBOX_OUTBOX_DEFERRED_SEGMENT_INVALID');
    entries.push(...normalizePendingReceiptPublications(segment));
  }
  return Object.freeze({
    entries: Object.freeze(normalizeAccumulatedDebt(entries)),
    activeSlot: null,
    storageFormat: 'legacy-v1',
    segmentCount: record.segments.length,
  });
}

function readMailboxOutboxDeferredStore(path) {
  if (!existsSync(path)) {
    return Object.freeze({ entries: Object.freeze([]), activeSlot: null, storageFormat: 'missing', segmentCount: 0 });
  }
  const info = assertRegularUnlinkedFile(path);
  if (info.size > MAILBOX_LEGACY_DEFERRED_MAX_BYTES) throw new Error('MAILBOX_OUTBOX_JSON_TOO_LARGE');
  const record = readJsonObject(path, { maxBytes: MAILBOX_LEGACY_DEFERRED_MAX_BYTES });
  if (record.schemaVersion === MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA) {
    if (info.size > MAILBOX_OUTBOX_MANIFEST_MAX_BYTES) throw new Error('MAILBOX_OUTBOX_DEFERRED_MANIFEST_TOO_LARGE');
    return readDeferredManifest(path, record);
  }
  return readLegacyDeferred(record);
}

function segmentEnvelopeBytes(generation, segmentIndex) {
  return Buffer.byteLength(`${JSON.stringify({
    schemaVersion: MAILBOX_OUTBOX_DEFERRED_SEGMENT_SCHEMA,
    generation,
    segmentIndex,
    entries: [],
  })}\n`, 'utf8');
}

function buildDeferredSegments(entries, generation) {
  const segments = [];
  let current = [];
  let currentBytes = segmentEnvelopeBytes(generation, 0);
  for (const entry of entries) {
    const entryBytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
    const candidateBytes = currentBytes + entryBytes + (current.length > 0 ? 1 : 0);
    if (current.length < MAILBOX_OUTBOX_MAX_ENTRIES
      && candidateBytes <= MAILBOX_OUTBOX_SEGMENT_MAX_BYTES) {
      current.push(entry);
      currentBytes = candidateBytes;
      continue;
    }
    if (current.length === 0) throw new Error('MAILBOX_OUTBOX_DEFERRED_ENTRY_TOO_LARGE');
    segments.push(current);
    current = [entry];
    currentBytes = segmentEnvelopeBytes(generation, segments.length) + entryBytes;
    if (currentBytes > MAILBOX_OUTBOX_SEGMENT_MAX_BYTES) {
      throw new Error('MAILBOX_OUTBOX_DEFERRED_ENTRY_TOO_LARGE');
    }
  }
  if (current.length > 0) segments.push(current);
  if (segments.length > MAILBOX_OUTBOX_MAX_SEGMENTS) throw new Error('MAILBOX_OUTBOX_DEFERRED_SEGMENT_LIMIT_EXCEEDED');
  return segments;
}

function prepareDeferredSlot(path, slot) {
  const root = deferredSegmentRoot(path);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(root)) assertUnlinkedDirectory(root);
  else {
    mkdirSync(root);
    syncDirectoryBestEffort(dirname(root));
  }
  const slotRoot = deferredSlotRoot(path, slot);
  if (existsSync(slotRoot)) assertUnlinkedDirectory(slotRoot);
  else {
    mkdirSync(slotRoot);
    syncDirectoryBestEffort(root);
  }
  return slotRoot;
}

function removeInactiveSlotRemainder(slotRoot, retainedSegmentCount) {
  for (const name of readdirSync(slotRoot)) {
    const match = DEFERRED_SEGMENT_FILE.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < retainedSegmentCount) continue;
    const stalePath = join(slotRoot, name);
    assertRegularUnlinkedFile(stalePath);
    unlinkSync(stalePath);
  }
}

function writeDeferred(path, entries, timestampUtc, {
  activeSlot = null,
  generationIdFn = () => randomUUID().replaceAll('-', ''),
} = {}) {
  if (activeSlot !== null && !DEFERRED_SLOT.test(String(activeSlot))) {
    throw new Error('MAILBOX_OUTBOX_DEFERRED_SLOT_INVALID');
  }
  const normalized = normalizeAccumulatedDebt(entries);
  const generation = String(generationIdFn() || '').toLowerCase();
  if (!DEFERRED_GENERATION.test(generation)) throw new Error('MAILBOX_OUTBOX_DEFERRED_GENERATION_INVALID');
  const targetSlot = activeSlot === 'a' ? 'b' : 'a';
  const segments = buildDeferredSegments(normalized, generation);
  const slotRoot = prepareDeferredSlot(path, targetSlot);
  for (let index = 0; index < segments.length; index += 1) {
    atomicWriteJson(deferredSegmentPath(path, targetSlot, index), {
      schemaVersion: MAILBOX_OUTBOX_DEFERRED_SEGMENT_SCHEMA,
      generation,
      segmentIndex: index,
      entries: segments[index],
    }, { maxBytes: MAILBOX_OUTBOX_SEGMENT_MAX_BYTES, space: 0 });
  }
  removeInactiveSlotRemainder(slotRoot, segments.length);
  atomicWriteJson(path, {
    schemaVersion: MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA,
    timestampUtc,
    activeSlot: targetSlot,
    generation,
    segmentCount: segments.length,
    entryCount: normalized.length,
  }, { maxBytes: MAILBOX_OUTBOX_MANIFEST_MAX_BYTES });
  return Object.freeze({ activeSlot: targetSlot, segmentCount: segments.length, entryCount: normalized.length });
}

function resolveProductionPaths({ env = process.env, repoRoot = defaultRepoRoot } = {}) {
  const actualRepoRoot = resolve(repoRoot);
  const expectedRepoRoot = resolve(env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = resolve(env.STEPHANOS_SHARED_WORKSPACE_ROOT || join(env.USERPROFILE || homedir(), 'Documents', 'Stephanos', 'shared-agent-workspace'));
  const mailboxStateRoot = join(workspaceRoot, 'github-command-mailbox');
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
  generationIdFn = () => randomUUID().replaceAll('-', ''),
  spawnSyncFn = spawnSync,
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
  try {
    assertRegularUnlinkedFile(childRunnerPath);
    const state = readJsonObject(statePath, {
      allowMissing: true,
      missingValue: { consumedRequestIds: [], acceptedRequestIds: [], pendingReceiptPublications: [] },
      maxBytes: MAILBOX_STATE_MAX_BYTES,
    });
    const statePendingBefore = canonicalPendingFromState(state);
    const deferredBefore = readMailboxOutboxDeferredStore(deferredPath);
    const cycle = planMailboxOutboxCycle({
      statePending: statePendingBefore,
      deferredPending: deferredBefore.entries,
    });

    // Crash safety: persist everything not attempted this cycle before shrinking the
    // canonical state outbox. The inactive slot is complete before the bounded
    // manifest switches, so a crash retains either the old or the new generation.
    writeDeferred(deferredPath, cycle.deferred, now().toISOString(), {
      activeSlot: deferredBefore.activeSlot,
      generationIdFn,
    });
    atomicWriteJson(statePath, {
      ...state,
      pendingReceiptPublications: cycle.attemptedThisCycle,
    }, { maxBytes: MAILBOX_STATE_MAX_BYTES });

    const child = spawnSyncFn(process.execPath, [childRunnerPath], {
      cwd: actualRepoRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 15 * 60 * 1000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const stateAfter = readJsonObject(statePath, { maxBytes: MAILBOX_STATE_MAX_BYTES });
    // Authority-bearing canonical debt is never coerced to an empty array. A child
    // that writes a malformed shape is left untouched for operator recovery.
    const statePendingAfter = canonicalPendingFromState(stateAfter);
    const deferredAfter = readMailboxOutboxDeferredStore(deferredPath);
    const mergedPending = mergeMailboxOutboxAfterCycle({
      deferredPending: deferredAfter.entries,
      statePending: statePendingAfter,
    });
    // Persist the complete union before clearing canonical state. A crash between
    // these writes can only duplicate debt, which is deduplicated next cycle.
    const persistedAfter = writeDeferred(deferredPath, mergedPending, now().toISOString(), {
      activeSlot: deferredAfter.activeSlot,
      generationIdFn,
    });
    atomicWriteJson(statePath, {
      ...stateAfter,
      pendingReceiptPublications: [],
    }, { maxBytes: MAILBOX_STATE_MAX_BYTES });

    const childOk = !child?.error && child?.status === 0;
    return Object.freeze({
      ok: childOk,
      blocker: childOk ? '' : 'MAILBOX_CHILD_RUN_BLOCKED',
      finalVerdict: childOk ? 'MAILBOX_OUTBOX_GUARD_READY' : 'MAILBOX_OUTBOX_GUARD_BLOCKED',
      attemptedPublicationCount: cycle.attemptedThisCycle.length,
      deferredPublicationCountBeforeChild: cycle.deferred.length,
      pendingPublicationCountAfterChild: mergedPending.length,
      deferredSegmentCountAfterChild: persistedAfter.segmentCount,
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
    return fail('MAILBOX_OUTBOX_GUARD_FAILED', { error: String(error?.message || error).slice(0, 240) });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runMailboxOutboxGuard();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
