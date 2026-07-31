import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname, uptime } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const LOCAL_CODEX_EXEC_INTEGRATION_SCHEMA = 'stephanos.local-codex-exec-integration.v1';
export const LOCAL_CODEX_TASK_SCHEMA = 'stephanos.codex-dispatch-task.v1';
export const LOCAL_CODEX_INTEGRATION_ID = 'battle-bridge-local-codex-exec-v1';
export const LOCAL_CODEX_DISPATCH_LOCK_SCHEMA = 'stephanos.local-codex-dispatch-lock.v2';

const SAFE_JOB_ID = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_LOCK_ID = /^[a-z0-9][a-z0-9-]{7,120}$/i;
const SAFE_PROCESS_IDENTITY = /^[a-z0-9][a-z0-9._:-]{0,239}$/i;
const ACTIVE_STATUSES = new Set(['DISPATCHED', 'CLAIMED', 'RUNNING', 'WAITING_PROOF']);
const TERMINAL_STATUSES = new Set(['BLOCKED', 'FAILED', 'DONE']);
const KNOWN_CURRENT_STATUSES = new Set([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]);
const LOCAL_CODEX_TASK_KIND = 'stephanos.codex_dispatch.local_task';
const LOCAL_CODEX_RESULT_KIND = 'stephanos.codex_dispatch.local_result';
const DEFAULT_DISPATCH_LOCK_LEASE_MS = 60_000;
const MIN_DISPATCH_LOCK_LEASE_MS = 1_000;
const MAX_DISPATCH_LOCK_LEASE_MS = 5 * 60_000;
const DISPATCH_LOCK_FUTURE_SKEW_MS = 30_000;
const LEGACY_DISPATCH_LOCK_STALE_AFTER_MS = MAX_DISPATCH_LOCK_LEASE_MS + DISPATCH_LOCK_FUTURE_SKEW_MS;

function defaultRepoRoot() {
  return resolve(fileURLToPath(new URL('../..', import.meta.url)));
}

function defaultWorkspaceRoot(env = process.env) {
  const explicit = String(env.STEPHANOS_SHARED_WORKSPACE || env.STEPHANOS_SHARED_AGENT_WORKSPACE || '').trim();
  if (explicit) return resolve(explicit);
  const home = env.USERPROFILE || env.HOME;
  if (!home) throw new Error('Unable to resolve the Stephanos shared workspace because USERPROFILE/HOME is missing.');
  return resolve(home, 'Documents', 'Stephanos-openclaw-workspace');
}

export function resolveLocalCodexDispatchPaths({
  repoRoot = process.env.STEPHANOS_REPO_ROOT || defaultRepoRoot(),
  workspaceRoot = defaultWorkspaceRoot(),
  jobId = '',
} = {}) {
  const repository = resolve(repoRoot);
  const workspace = resolve(workspaceRoot);
  const dispatchRoot = join(workspace, 'codex-dispatch');
  const tasksRoot = join(dispatchRoot, 'tasks');
  const receiptsRoot = join(workspace, 'receipts');
  const currentPath = join(dispatchRoot, 'current.json');
  const dispatchLockPath = join(dispatchRoot, 'dispatch.lock');
  if (!jobId) return {
    repoRoot: repository,
    workspaceRoot: workspace,
    dispatchRoot,
    tasksRoot,
    receiptsRoot,
    currentPath,
    dispatchLockPath,
  };
  if (!SAFE_JOB_ID.test(jobId)) throw new Error(`Unsafe Codex job id: ${jobId}`);
  const taskRoot = join(tasksRoot, jobId);
  return {
    repoRoot: repository,
    workspaceRoot: workspace,
    dispatchRoot,
    tasksRoot,
    receiptsRoot,
    currentPath,
    dispatchLockPath,
    taskRoot,
    taskPath: join(taskRoot, 'task.json'),
    statusPath: join(taskRoot, 'status.json'),
    resultPath: join(taskRoot, 'result.json'),
    stdoutPath: join(taskRoot, 'codex.stdout.jsonl'),
    stderrPath: join(taskRoot, 'codex.stderr.log'),
    lastMessagePath: join(taskRoot, 'codex-last-message.txt'),
    receiptPath: join(receiptsRoot, `${jobId}.json`),
  };
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function readJsonState(path) {
  let payload;
  try {
    payload = readFileSync(path, 'utf8');
  } catch (error) {
    return error?.code === 'ENOENT'
      ? Object.freeze({ state: 'absent', value: null, errorCode: '' })
      : Object.freeze({ state: 'unverifiable', value: null, errorCode: error?.code || 'READ_FAILED' });
  }
  try {
    return Object.freeze({ state: 'present', value: JSON.parse(payload), errorCode: '' });
  } catch {
    return Object.freeze({ state: 'unverifiable', value: null, errorCode: 'JSON_INVALID' });
  }
}

function isVerifiableCurrentRecord(current) {
  if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
  const jobId = String(current.jobId || '');
  const status = String(current.status || '');
  if (
    current.schemaVersion !== LOCAL_CODEX_TASK_SCHEMA
    || !SAFE_JOB_ID.test(jobId)
    || String(current.taskId || '') !== jobId
    || !KNOWN_CURRENT_STATUSES.has(status)
  ) return false;
  if (ACTIVE_STATUSES.has(status)) return current.kind === LOCAL_CODEX_TASK_KIND;
  return current.kind === LOCAL_CODEX_RESULT_KIND;
}

function writeJson(path, value) {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  try {
    renameSync(tempPath, path);
  } catch (error) {
    try { unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function dispatchLockOwnerFilename(lockId) {
  return `owner-${lockId}.json`;
}

function timestampMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function boundedLockLeaseMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DISPATCH_LOCK_LEASE_MS;
  return Math.max(MIN_DISPATCH_LOCK_LEASE_MS, Math.min(MAX_DISPATCH_LOCK_LEASE_MS, Math.floor(parsed)));
}

function dispatchLockOwnerIsValid(owner, ownerFilename, nowMs = Date.now()) {
  const acquiredAtMs = timestampMs(owner?.acquiredAtUtc);
  const expiresAtMs = timestampMs(owner?.expiresAtUtc);
  const processStartedAtMs = timestampMs(owner?.processStartedAtUtc);
  const bootStartedAtMs = timestampMs(owner?.bootStartedAtUtc);
  const leaseDurationMs = expiresAtMs - acquiredAtMs;
  return Boolean(
    owner
    && typeof owner === 'object'
    && owner.schemaVersion === LOCAL_CODEX_DISPATCH_LOCK_SCHEMA
    && SAFE_LOCK_ID.test(String(owner.lockId || ''))
    && ownerFilename === dispatchLockOwnerFilename(owner.lockId)
    && Number.isSafeInteger(owner.pid)
    && owner.pid > 0
    && String(owner.hostname || '').trim()
    && Number.isFinite(acquiredAtMs)
    && Number.isFinite(expiresAtMs)
    && Number.isFinite(processStartedAtMs)
    && Number.isFinite(bootStartedAtMs)
    && SAFE_PROCESS_IDENTITY.test(String(owner.bootId || ''))
    && SAFE_PROCESS_IDENTITY.test(String(owner.processStartId || ''))
    && Number.isSafeInteger(owner.leaseDurationMs)
    && owner.leaseDurationMs === leaseDurationMs
    && leaseDurationMs >= MIN_DISPATCH_LOCK_LEASE_MS
    && leaseDurationMs <= MAX_DISPATCH_LOCK_LEASE_MS
    && acquiredAtMs <= nowMs + DISPATCH_LOCK_FUTURE_SKEW_MS
    && processStartedAtMs <= acquiredAtMs + DISPATCH_LOCK_FUTURE_SKEW_MS
  );
}

export function parseLinuxDispatchLockProcessIdentity(stat = '', bootId = '') {
  const closeParen = stat.lastIndexOf(')');
  const fields = closeParen >= 0 ? stat.slice(closeParen + 1).trim().split(/\s+/) : [];
  const processState = String(fields[0] || '').toUpperCase();
  const processStartId = String(fields[19] || '');
  if (processState === 'Z' || processState === 'X') {
    return Object.freeze({ state: 'dead' });
  }
  if (!SAFE_PROCESS_IDENTITY.test(bootId) || !SAFE_PROCESS_IDENTITY.test(processStartId)) {
    return Object.freeze({ state: 'unknown' });
  }
  return Object.freeze({ state: 'known', bootId, processStartId });
}

function linuxProcessIdentity(pid) {
  let bootId;
  try {
    bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim().toLowerCase();
  } catch {
    return Object.freeze({ state: 'unknown' });
  }
  let stat;
  try {
    stat = readFileSync(pid === process.pid ? '/proc/self/stat' : `/proc/${pid}/stat`, 'utf8');
  } catch (error) {
    return Object.freeze({ state: error?.code === 'ENOENT' ? 'dead' : 'unknown' });
  }
  return parseLinuxDispatchLockProcessIdentity(stat, bootId);
}

function windowsProcessIdentity(pid) {
  const script = [
    "$ErrorActionPreference='Stop'",
    `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    'if ($null -eq $p) { exit 3 }',
    '$os=Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop',
    "[Console]::Out.Write($os.LastBootUpTime.ToUniversalTime().Ticks.ToString()+'|'+$p.StartTime.ToUniversalTime().Ticks.ToString())",
  ].join('; ');
  let result;
  try {
    result = spawnSync('powershell.exe', [
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
  } catch {
    return Object.freeze({ state: 'unknown' });
  }
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

function defaultDispatchLockProcessIdentityProbe(pid, platform = process.platform) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return Object.freeze({ state: 'unknown' });
  if (platform === 'linux') return linuxProcessIdentity(pid);
  if (platform === 'win32') return windowsProcessIdentity(pid);
  return Object.freeze({ state: 'unknown' });
}

function readDispatchLockEvidence(lockPath, nowMs = Date.now()) {
  let lockStat;
  try {
    lockStat = lstatSync(lockPath);
  } catch (error) {
    return error?.code === 'ENOENT' ? null : { errorCode: error?.code || 'LOCK_STAT_FAILED' };
  }
  if (!lockStat.isDirectory()) {
    return { lockStat, entries: [], ownerEntry: null, owner: null, validOwner: false };
  }
  let entries;
  try {
    entries = readdirSync(lockPath, { withFileTypes: true }).map((entry) => {
      const path = join(lockPath, entry.name);
      const stat = lstatSync(path);
      return { name: entry.name, path, isFile: stat.isFile(), mtimeMs: stat.mtimeMs };
    });
  } catch (error) {
    return { errorCode: error?.code || 'LOCK_READ_FAILED' };
  }
  const ownerEntry = entries.length === 1 && entries[0].isFile ? entries[0] : null;
  let ownerRaw = '';
  if (ownerEntry) {
    try {
      ownerRaw = readFileSync(ownerEntry.path, 'utf8');
    } catch (error) {
      return { errorCode: error?.code || 'LOCK_OWNER_READ_FAILED' };
    }
  }
  let owner = null;
  try {
    owner = ownerRaw ? JSON.parse(ownerRaw) : null;
  } catch {}
  return {
    lockStat,
    entries,
    ownerEntry,
    owner,
    ownerRaw,
    validOwner: Boolean(ownerEntry && dispatchLockOwnerIsValid(owner, ownerEntry.name, nowMs)),
    newestMtimeMs: entries.length
      ? Math.max(lockStat.mtimeMs, ...entries.map((entry) => entry.mtimeMs))
      : lockStat.mtimeMs,
  };
}

function sameDispatchLockOwner(left, right) {
  return Boolean(
    left
    && right
    && left.lockId === right.lockId
    && left.pid === right.pid
    && String(left.hostname || '').toLowerCase() === String(right.hostname || '').toLowerCase()
    && left.acquiredAtUtc === right.acquiredAtUtc
    && left.expiresAtUtc === right.expiresAtUtc
    && left.leaseDurationMs === right.leaseDurationMs
    && left.processStartedAtUtc === right.processStartedAtUtc
    && left.bootStartedAtUtc === right.bootStartedAtUtc
    && left.bootId === right.bootId
    && left.processStartId === right.processStartId
  );
}

function recoveryResult(state, errorCode = '') {
  return Object.freeze({ state, errorCode });
}

function dispatchLockError(code, message, cause = null) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function retryDispatchLockFsOperation(operation, attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      operation();
      return Object.freeze({ ok: true, error: null });
    } catch (error) {
      lastError = error;
    }
  }
  return Object.freeze({ ok: false, error: lastError });
}

function removeOwnedDispatchLock(lockPath, ownerEntry, owner) {
  let currentOwner;
  try {
    currentOwner = JSON.parse(readFileSync(ownerEntry.path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return recoveryResult('owner-changed');
    return recoveryResult('failed', error?.code || 'LOCK_OWNER_READ_FAILED');
  }
  if (!sameDispatchLockOwner(currentOwner, owner)) return recoveryResult('owner-changed');
  const unlink = retryDispatchLockFsOperation(() => unlinkSync(ownerEntry.path));
  if (!unlink.ok) {
    const error = unlink.error;
    if (error?.code === 'ENOENT') return recoveryResult('owner-changed');
    return recoveryResult('failed', error?.code || 'LOCK_OWNER_UNLINK_FAILED');
  }
  const removeDirectory = retryDispatchLockFsOperation(() => rmdirSync(lockPath));
  if (removeDirectory.ok) {
    return recoveryResult('recovered');
  }
  return recoveryResult('failed', removeDirectory.error?.code || 'LOCK_DIRECTORY_REMOVE_FAILED');
}

function reclaimStaleDispatchLock(lockPath, {
  nowMs,
  staleAfterMs,
  localHostname,
  processIdentityProbe,
} = {}) {
  const evidence = readDispatchLockEvidence(lockPath, nowMs);
  if (!evidence) return recoveryResult('absent');
  if (evidence.errorCode) return recoveryResult('failed', evidence.errorCode);
  if (!evidence.lockStat?.isDirectory()) return recoveryResult('failed', 'LOCK_PATH_NOT_DIRECTORY');
  if (!evidence.validOwner) {
    if (evidence.entries.length !== 0) {
      return recoveryResult('invalid', 'LOCK_OWNER_INVALID');
    }
    if (nowMs - evidence.newestMtimeMs <= staleAfterMs) return recoveryResult('contended');
    try {
      rmdirSync(lockPath);
      return recoveryResult('recovered');
    } catch (error) {
      if (error?.code === 'ENOENT') return recoveryResult('recovered');
      if (error?.code === 'ENOTEMPTY' || error?.code === 'EEXIST') return recoveryResult('contended');
      return recoveryResult('failed', error?.code || 'LOCK_LEGACY_REMOVE_FAILED');
    }
  }
  if (timestampMs(evidence.owner.expiresAtUtc) > nowMs) return recoveryResult('contended');
  const sameHost = (
    String(evidence.owner.hostname || '').trim().toLowerCase()
    === String(localHostname || '').trim().toLowerCase()
  );
  if (!sameHost) return recoveryResult('unverifiable', 'LOCK_OWNER_HOST_UNVERIFIABLE');
  let identity = null;
  try {
    identity = processIdentityProbe(evidence.owner.pid);
  } catch {
    return recoveryResult('unverifiable', 'LOCK_OWNER_IDENTITY_UNVERIFIABLE');
  }
  if (identity?.state === 'known') {
    if (
      identity.bootId === evidence.owner.bootId
      && identity.processStartId === evidence.owner.processStartId
    ) {
      return recoveryResult('contended');
    }
  } else if (identity?.state !== 'dead') {
    return recoveryResult('unverifiable', 'LOCK_OWNER_IDENTITY_UNVERIFIABLE');
  }
  return removeOwnedDispatchLock(lockPath, evidence.ownerEntry, evidence.owner);
}

function acquireDispatchLock(lockPath, {
  now,
  lockIdFactory,
  leaseMs,
  localHostname,
  localBootStartedAtUtc,
  processIdentity,
  processIdentityProbe,
  beforePublish,
} = {}) {
  const lockId = String(lockIdFactory() || '');
  if (!SAFE_LOCK_ID.test(lockId)) throw new Error('Local Codex dispatch lock owner id is invalid.');
  const acquiredAtUtc = String(now() || '');
  const acquiredAtMs = timestampMs(acquiredAtUtc);
  if (!Number.isFinite(acquiredAtMs)) throw new Error('Local Codex dispatch lock timestamp is invalid.');
  const localBootStartedAtMs = timestampMs(localBootStartedAtUtc);
  if (!Number.isFinite(localBootStartedAtMs)) throw new Error('Local Codex dispatch lock boot timestamp is invalid.');
  if (
    processIdentity?.state !== 'known'
    || !SAFE_PROCESS_IDENTITY.test(String(processIdentity.bootId || ''))
    || !SAFE_PROCESS_IDENTITY.test(String(processIdentity.processStartId || ''))
  ) {
    throw dispatchLockError(
      'LOCAL_CODEX_DISPATCH_LOCK_OWNER_UNVERIFIABLE',
      'local process identity is unavailable',
    );
  }
  const boundedLeaseMs = boundedLockLeaseMs(leaseMs);
  const owner = Object.freeze({
    schemaVersion: LOCAL_CODEX_DISPATCH_LOCK_SCHEMA,
    lockId,
    pid: process.pid,
    hostname: localHostname,
    acquiredAtUtc: new Date(acquiredAtMs).toISOString(),
    expiresAtUtc: new Date(acquiredAtMs + boundedLeaseMs).toISOString(),
    leaseDurationMs: boundedLeaseMs,
    processStartedAtUtc: new Date(acquiredAtMs - Math.max(0, process.uptime() * 1000)).toISOString(),
    bootStartedAtUtc: new Date(localBootStartedAtMs).toISOString(),
    bootId: processIdentity.bootId,
    processStartId: processIdentity.processStartId,
  });
  const ownerFilename = dispatchLockOwnerFilename(lockId);
  const ownerPath = join(lockPath, ownerFilename);
  const candidatePath = `${lockPath}.candidate-${lockId}`;
  const candidateOwnerPath = join(candidatePath, ownerFilename);
  let candidateCreated = false;
  let candidateOwnerCreated = false;
  try {
    mkdirSync(candidatePath, { mode: 0o700 });
    candidateCreated = true;
    writeFileSync(candidateOwnerPath, `${JSON.stringify(owner)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    candidateOwnerCreated = true;
    beforePublish?.({ lockPath, candidatePath, owner, ownerFilename });
  } catch (error) {
    if (candidateOwnerCreated) {
      try { unlinkSync(candidateOwnerPath); } catch {}
    }
    if (candidateCreated) {
      try { rmdirSync(candidatePath); } catch {}
    }
    throw dispatchLockError(
      'LOCAL_CODEX_DISPATCH_LOCK_IO_FAILED',
      `candidate creation failed (${error?.code || 'UNKNOWN'})`,
      error,
    );
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = reclaimStaleDispatchLock(lockPath, {
      nowMs: acquiredAtMs,
      staleAfterMs: LEGACY_DISPATCH_LOCK_STALE_AFTER_MS,
      localHostname,
      processIdentityProbe,
    });
    if (existing.state === 'contended') {
      try { unlinkSync(candidateOwnerPath); } catch {}
      try { rmdirSync(candidatePath); } catch {}
      throw dispatchLockError(
        'LOCAL_CODEX_DISPATCH_LOCK_CONTENDED',
        'another dispatch is claiming the one-active-job slot',
      );
    }
    if (existing.state === 'failed') {
      try { unlinkSync(candidateOwnerPath); } catch {}
      try { rmdirSync(candidatePath); } catch {}
      throw dispatchLockError(
        'LOCAL_CODEX_DISPATCH_LOCK_IO_FAILED',
        `recovery failed (${existing.errorCode || 'UNKNOWN'})`,
      );
    }
    if (existing.state === 'invalid' || existing.state === 'unverifiable') {
      try { unlinkSync(candidateOwnerPath); } catch {}
      try { rmdirSync(candidatePath); } catch {}
      throw dispatchLockError(
        existing.state === 'invalid'
          ? 'LOCAL_CODEX_DISPATCH_LOCK_INVALID'
          : 'LOCAL_CODEX_DISPATCH_LOCK_OWNER_UNVERIFIABLE',
        existing.errorCode || existing.state,
      );
    }
    try {
      renameSync(candidatePath, lockPath);
      const published = readDispatchLockEvidence(lockPath, acquiredAtMs);
      if (published?.errorCode) {
        removeOwnedDispatchLock(lockPath, { path: ownerPath }, owner);
        throw dispatchLockError(
          'LOCAL_CODEX_DISPATCH_LOCK_IO_FAILED',
          `published ownership could not be read (${published.errorCode})`,
        );
      }
      if (
        !published?.validOwner
        || !published.ownerEntry
        || !sameDispatchLockOwner(published.owner, owner)
      ) {
        removeOwnedDispatchLock(lockPath, { path: ownerPath }, owner);
        throw dispatchLockError(
          'LOCAL_CODEX_DISPATCH_LOCK_PUBLICATION_FAILED',
          'published ownership could not be verified',
        );
      }
      return Object.freeze({
        owner,
        ownerPath,
        release() {
          return removeOwnedDispatchLock(lockPath, { path: ownerPath }, owner);
        },
      });
    } catch (error) {
      if (String(error?.code || '').startsWith('LOCAL_CODEX_DISPATCH_LOCK_')) {
        try { unlinkSync(candidateOwnerPath); } catch {}
        try { rmdirSync(candidatePath); } catch {}
        throw error;
      }
      const recovery = reclaimStaleDispatchLock(lockPath, {
        nowMs: acquiredAtMs,
        staleAfterMs: LEGACY_DISPATCH_LOCK_STALE_AFTER_MS,
        localHostname,
        processIdentityProbe,
      });
      if (recovery.state === 'recovered') continue;
      if (
        recovery.state === 'absent'
        && attempt < 2
        && ['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error?.code)
      ) {
        continue;
      }
      try { unlinkSync(candidateOwnerPath); } catch {}
      try { rmdirSync(candidatePath); } catch {}
      if (recovery.state === 'failed') {
        throw dispatchLockError(
          'LOCAL_CODEX_DISPATCH_LOCK_IO_FAILED',
          `recovery failed (${recovery.errorCode || 'UNKNOWN'})`,
        );
      }
      if (recovery.state === 'invalid' || recovery.state === 'unverifiable') {
        throw dispatchLockError(
          recovery.state === 'invalid'
            ? 'LOCAL_CODEX_DISPATCH_LOCK_INVALID'
            : 'LOCAL_CODEX_DISPATCH_LOCK_OWNER_UNVERIFIABLE',
          recovery.errorCode || recovery.state,
        );
      }
      if (recovery.state === 'absent') {
        throw dispatchLockError(
          'LOCAL_CODEX_DISPATCH_LOCK_IO_FAILED',
          `acquisition failed (${error?.code || 'UNKNOWN'})`,
          error,
        );
      }
      throw dispatchLockError(
        'LOCAL_CODEX_DISPATCH_LOCK_CONTENDED',
        'another dispatch is claiming the one-active-job slot',
      );
    }
  }
  try { unlinkSync(candidateOwnerPath); } catch {}
  try { rmdirSync(candidatePath); } catch {}
  throw dispatchLockError(
    'LOCAL_CODEX_DISPATCH_LOCK_CONTENDED',
    'another dispatch is claiming the one-active-job slot',
  );
}

export function readLocalCodexTaskStatus(jobId, options = {}) {
  const paths = resolveLocalCodexDispatchPaths({ ...options, jobId });
  return readJson(paths.statusPath) || readJson(paths.taskPath) || null;
}

export function readLocalCodexTaskResult(jobId, options = {}) {
  const paths = resolveLocalCodexDispatchPaths({ ...options, jobId });
  return readJson(paths.resultPath) || null;
}

export function createLocalCodexExecIntegration({
  repoRoot = process.env.STEPHANOS_REPO_ROOT || defaultRepoRoot(),
  workspaceRoot = defaultWorkspaceRoot(),
  spawnFn = spawn,
  now = () => new Date().toISOString(),
  idFactory = () => randomUUID(),
  lockIdFactory = () => randomUUID(),
  dispatchLockLeaseMs = DEFAULT_DISPATCH_LOCK_LEASE_MS,
  dispatchLockHostname = hostname(),
  dispatchLockBootStartedAtUtc = new Date(Date.now() - Math.max(0, uptime() * 1000)).toISOString(),
  dispatchLockProcessIdentity = null,
  dispatchLockProcessIdentityProbe = defaultDispatchLockProcessIdentityProbe,
  dispatchLockBeforePublish = null,
  workerPath = resolve(fileURLToPath(new URL('../../scripts/stephanos-codex-dispatch-worker.mjs', import.meta.url))),
} = {}) {
  const basePaths = resolveLocalCodexDispatchPaths({ repoRoot, workspaceRoot });

  return Object.freeze({
    integrationId: LOCAL_CODEX_INTEGRATION_ID,
    capabilities: Object.freeze({
      launchCodexJob: true,
      returnDispatchReceipt: true,
      returnProofMetadata: true,
    }),
    dispatch(packet) {
      if (!packet || !SAFE_JOB_ID.test(String(packet.jobId || ''))) {
        throw new Error('Local Codex dispatch requires a valid canonical queue packet.');
      }
      if (packet.mergeAuthority === true) throw new Error('Local Codex dispatch refuses merge authority.');
      if (!String(packet.prompt || '').trim()) throw new Error('Local Codex dispatch refuses an empty prompt.');

      mkdirSync(basePaths.tasksRoot, { recursive: true });
      mkdirSync(basePaths.receiptsRoot, { recursive: true });

      const dispatchLock = acquireDispatchLock(basePaths.dispatchLockPath, {
        now,
        lockIdFactory,
        leaseMs: dispatchLockLeaseMs,
        localHostname: dispatchLockHostname,
        localBootStartedAtUtc: dispatchLockBootStartedAtUtc,
        processIdentity: dispatchLockProcessIdentity || dispatchLockProcessIdentityProbe(process.pid),
        processIdentityProbe: dispatchLockProcessIdentityProbe,
        beforePublish: dispatchLockBeforePublish,
      });

      let acceptedReceipt = null;
      let acceptedReceiptPath = '';
      try {
        const currentState = readJsonState(basePaths.currentPath);
        if (currentState.state === 'unverifiable') {
          throw dispatchLockError(
            'LOCAL_CODEX_DISPATCH_CURRENT_UNVERIFIABLE',
            `current task state could not be verified (${currentState.errorCode || 'UNKNOWN'})`,
          );
        }
        const current = currentState.value;
        if (
          currentState.state === 'present'
          && !isVerifiableCurrentRecord(current)
        ) {
          throw dispatchLockError(
            'LOCAL_CODEX_DISPATCH_CURRENT_UNVERIFIABLE',
            'current task state is structurally invalid',
          );
        }
        if (current && ACTIVE_STATUSES.has(String(current.status || ''))) {
          throw new Error(`Local Codex dispatch blocked because ${current.jobId} is already ${current.status}.`);
        }

        const paths = resolveLocalCodexDispatchPaths({ repoRoot: basePaths.repoRoot, workspaceRoot: basePaths.workspaceRoot, jobId: packet.jobId });
        if (existsSync(paths.taskPath) || existsSync(paths.statusPath) || existsSync(paths.resultPath)) {
          throw new Error(`Local Codex dispatch blocked because ${packet.jobId} already exists.`);
        }
        mkdirSync(paths.taskRoot, { recursive: true });
        const timestampUtc = now();
        const task = {
          schemaVersion: LOCAL_CODEX_TASK_SCHEMA,
          kind: LOCAL_CODEX_TASK_KIND,
          taskId: packet.jobId,
          jobId: packet.jobId,
          issueNumber: Number(packet.issueNumber || 0),
          branch: String(packet.branch || 'main'),
          taskType: 'battle-bridge-proof',
          prompt: String(packet.prompt),
          requestedProofCommands: Array.isArray(packet.requestedProofCommands) ? packet.requestedProofCommands.map(String) : [],
          exactHeadProof: packet.exactHeadProof ? {
            repository: String(packet.exactHeadProof.repository || ''),
            prNumber: Number(packet.exactHeadProof.prNumber || 0),
            expectedHead: String(packet.exactHeadProof.expectedHead || '').toLowerCase(),
            proofScenario: String(packet.exactHeadProof.proofScenario || ''),
          } : null,
          approvalRequirements: { ...(packet.approvalRequirements || {}) },
          repoRoot: paths.repoRoot,
          workspaceRoot: paths.workspaceRoot,
          createdAt: timestampUtc,
          status: 'DISPATCHED',
          safety: {
            mergeAllowed: false,
            pushAllowed: false,
            branchDeletionAllowed: false,
            hardResetAllowed: false,
            broadProcessKillAllowed: false,
            sourceMutationAllowed: false,
            generatedDistMutationAllowed: false,
            oneActiveJob: true,
            childApprovalPolicy: 'never',
            childSandboxMode: 'read-only',
            childMcpToolsAllowed: false,
          },
          proofRefs: [`proof/${packet.jobId}.json`, `receipts/${packet.jobId}.json`],
        };
        writeJson(paths.taskPath, task);
        writeJson(paths.statusPath, task);
        writeJson(paths.currentPath, task);

        let child;
        try {
          child = spawnFn(process.execPath, [workerPath, '--task', paths.taskPath], {
            cwd: paths.repoRoot,
            detached: true,
            windowsHide: true,
            stdio: 'ignore',
            env: { ...process.env, STEPHANOS_REPO_ROOT: paths.repoRoot, STEPHANOS_SHARED_WORKSPACE: paths.workspaceRoot },
          });
          if (!child || !Number(child.pid || 0)) throw new Error('worker pid unavailable');
        } catch {
          const failedAt = now();
          const failed = {
            ...task,
            kind: LOCAL_CODEX_RESULT_KIND,
            status: 'BLOCKED',
            verdict: 'FAIL',
            resultAvailable: true,
            resultVerdict: 'FAIL',
            workerAlive: false,
            heartbeatUtc: failedAt,
            completedAt: failedAt,
            blocker: 'LOCAL_CODEX_WORKER_LAUNCH_FAILED',
            nextOperatorAction: 'Repair the local Codex worker launch path, then submit a fresh bounded request.',
          };
          writeJson(paths.resultPath, failed);
          writeJson(paths.statusPath, failed);
          writeJson(paths.currentPath, failed);
          writeJson(paths.receiptPath, {
            schemaVersion: LOCAL_CODEX_EXEC_INTEGRATION_SCHEMA,
            kind: 'stephanos.codex_dispatch.local_receipt',
            receiptId: `local-codex-${idFactory()}`,
            jobId: packet.jobId,
            accepted: false,
            started: false,
            timestampUtc: failedAt,
            integrationId: LOCAL_CODEX_INTEGRATION_ID,
            blocker: 'LOCAL_CODEX_WORKER_LAUNCH_FAILED',
            mergeAuthority: false,
            arbitraryShellAllowed: false,
          });
          throw new Error('Local Codex worker failed to launch.');
        }
        if (typeof child.unref === 'function') child.unref();

        const receipt = {
          schemaVersion: LOCAL_CODEX_EXEC_INTEGRATION_SCHEMA,
          kind: 'stephanos.codex_dispatch.local_receipt',
          receiptId: `local-codex-${idFactory()}`,
          jobId: packet.jobId,
          accepted: true,
          started: false,
          workerSpawned: true,
          timestampUtc,
          integrationId: LOCAL_CODEX_INTEGRATION_ID,
          workerPid: Number(child.pid),
          repoRoot: paths.repoRoot,
          taskPath: paths.taskPath,
          proofRefs: [`receipts/${packet.jobId}.json`, `proof/${packet.jobId}.json`],
          mergeAuthority: false,
          arbitraryShellAllowed: false,
        };
        acceptedReceipt = receipt;
        acceptedReceiptPath = paths.receiptPath;
        writeJson(paths.receiptPath, receipt);
        return receipt;
      } finally {
        let releaseResult;
        try {
          releaseResult = dispatchLock.release();
        } catch (error) {
          releaseResult = recoveryResult('failed', error?.code || 'LOCK_RELEASE_FAILED');
        }
        const lockReleased = releaseResult?.state === 'recovered';
        if (acceptedReceipt) {
          acceptedReceipt.lockReleased = lockReleased;
          acceptedReceipt.lockRelease = {
            ok: lockReleased,
            blocker: lockReleased ? '' : 'LOCAL_CODEX_DISPATCH_LOCK_RELEASE_FAILED',
            reason: lockReleased ? '' : (releaseResult?.errorCode || releaseResult?.state || 'UNKNOWN'),
          };
          if (!lockReleased) {
            acceptedReceipt.blocker = 'LOCAL_CODEX_DISPATCH_LOCK_RELEASE_FAILED';
          }
          try {
            writeJson(acceptedReceiptPath, acceptedReceipt);
          } catch {
            acceptedReceipt.lockRelease.receiptPersisted = false;
          }
        } else if (!lockReleased) {
          throw dispatchLockError(
            'LOCAL_CODEX_DISPATCH_LOCK_RELEASE_FAILED',
            releaseResult?.errorCode || releaseResult?.state || 'UNKNOWN',
          );
        }
      }
    },
    readStatus(jobId) { return readLocalCodexTaskStatus(jobId, { repoRoot: basePaths.repoRoot, workspaceRoot: basePaths.workspaceRoot }); },
    readResult(jobId) { return readLocalCodexTaskResult(jobId, { repoRoot: basePaths.repoRoot, workspaceRoot: basePaths.workspaceRoot }); },
    paths: Object.freeze({ ...basePaths }),
  });
}

export function localCodexIntegrationInstalled(options = {}) {
  const paths = resolveLocalCodexDispatchPaths(options);
  return existsSync(paths.workspaceRoot) && existsSync(resolve(fileURLToPath(new URL('../../scripts/stephanos-codex-dispatch-worker.mjs', import.meta.url))));
}
