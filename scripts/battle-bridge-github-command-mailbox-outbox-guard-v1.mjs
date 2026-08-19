#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAILBOX_OUTBOX_GUARD_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-guard.v1';
export const MAILBOX_OUTBOX_DEFERRED_SCHEMA = 'stephanos.battle-bridge-mailbox-outbox-deferred.v1';
export const MAILBOX_OUTBOX_MAX_ATTEMPTS_PER_CYCLE = 1;
export const MAILBOX_OUTBOX_MAX_ENTRIES = 500;

const defaultRepoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const PUBLICATION_ID_LIMIT = 360;

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

export function normalizePendingReceiptPublications(entries = []) {
  if (!Array.isArray(entries)) throw new Error('MAILBOX_OUTBOX_PENDING_ARRAY_REQUIRED');
  const byId = new Map();
  for (const entry of entries) {
    if (!validatePendingEntry(entry)) throw new Error('MAILBOX_OUTBOX_PENDING_ENTRY_INVALID');
    byId.set(String(entry.publicationId), structuredClone(entry));
  }
  const normalized = [...byId.values()];
  if (normalized.length > MAILBOX_OUTBOX_MAX_ENTRIES) throw new Error('MAILBOX_OUTBOX_PENDING_LIMIT_EXCEEDED');
  return normalized;
}

export function planMailboxOutboxCycle({ statePending = [], deferredPending = [] } = {}) {
  const combined = normalizePendingReceiptPublications([
    ...normalizePendingReceiptPublications(deferredPending),
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
  return Object.freeze(normalizePendingReceiptPublications([
    ...normalizePendingReceiptPublications(deferredPending),
    ...normalizePendingReceiptPublications(statePending),
  ]));
}

function assertRegularUnlinkedFile(path, { allowMissing = false } = {}) {
  if (!existsSync(path)) {
    if (allowMissing) return;
    throw new Error('MAILBOX_OUTBOX_FILE_MISSING');
  }
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('MAILBOX_OUTBOX_FILE_IDENTITY_INVALID');
}

function readJsonObject(path, { allowMissing = false, missingValue = null } = {}) {
  if (!existsSync(path)) {
    if (allowMissing) return missingValue;
    throw new Error('MAILBOX_OUTBOX_JSON_MISSING');
  }
  assertRegularUnlinkedFile(path);
  const text = readFileSync(path, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) throw new Error('MAILBOX_OUTBOX_JSON_TOO_LARGE');
  const value = JSON.parse(text);
  if (!isPlainObject(value)) throw new Error('MAILBOX_OUTBOX_JSON_OBJECT_REQUIRED');
  return value;
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) assertRegularUnlinkedFile(path);
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

function readDeferred(path) {
  const record = readJsonObject(path, {
    allowMissing: true,
    missingValue: { schemaVersion: MAILBOX_OUTBOX_DEFERRED_SCHEMA, entries: [] },
  });
  if (record.schemaVersion !== MAILBOX_OUTBOX_DEFERRED_SCHEMA || !Array.isArray(record.entries)) {
    throw new Error('MAILBOX_OUTBOX_DEFERRED_RECORD_INVALID');
  }
  return normalizePendingReceiptPublications(record.entries);
}

function writeDeferred(path, entries, timestampUtc) {
  atomicWriteJson(path, {
    schemaVersion: MAILBOX_OUTBOX_DEFERRED_SCHEMA,
    timestampUtc,
    entries: normalizePendingReceiptPublications(entries),
  });
}

function removeDeferred(path) {
  if (!existsSync(path)) return;
  assertRegularUnlinkedFile(path);
  unlinkSync(path);
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
    });
    const deferredBefore = readDeferred(deferredPath);
    const cycle = planMailboxOutboxCycle({
      statePending: Array.isArray(state.pendingReceiptPublications) ? state.pendingReceiptPublications : [],
      deferredPending: deferredBefore,
    });

    // Crash safety: persist everything not attempted this cycle before shrinking the
    // canonical state outbox. A later guard run always folds this file back in.
    writeDeferred(deferredPath, cycle.deferred, now().toISOString());
    atomicWriteJson(statePath, {
      ...state,
      pendingReceiptPublications: cycle.attemptedThisCycle,
    });

    const child = spawnSyncFn(process.execPath, [childRunnerPath], {
      cwd: actualRepoRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 15 * 60 * 1000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const stateAfter = readJsonObject(statePath);
    const deferredAfter = readDeferred(deferredPath);
    const mergedPending = mergeMailboxOutboxAfterCycle({
      deferredPending: deferredAfter,
      statePending: Array.isArray(stateAfter.pendingReceiptPublications) ? stateAfter.pendingReceiptPublications : [],
    });
    atomicWriteJson(statePath, {
      ...stateAfter,
      pendingReceiptPublications: mergedPending,
    });
    removeDeferred(deferredPath);

    const childOk = !child?.error && child?.status === 0;
    return Object.freeze({
      ok: childOk,
      blocker: childOk ? '' : 'MAILBOX_CHILD_RUN_BLOCKED',
      finalVerdict: childOk ? 'MAILBOX_OUTBOX_GUARD_READY' : 'MAILBOX_OUTBOX_GUARD_BLOCKED',
      attemptedPublicationCount: cycle.attemptedThisCycle.length,
      deferredPublicationCountBeforeChild: cycle.deferred.length,
      pendingPublicationCountAfterChild: mergedPending.length,
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
