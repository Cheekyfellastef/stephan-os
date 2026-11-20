// Observation of the existing held owner, never an execution/release capability.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createBattleBridgeMinimalChildEnvironment } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fresh = value => typeof value === 'string' && /Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && Date.now() >= Date.parse(value)
  && Date.now() - Date.parse(value) <= 15_000;
export const MAINTENANCE_OWNER_DIAGNOSTIC_CODES_V1 = Object.freeze([
  'OWNER_CIM_LISTENER_QUERY_FAILED', 'OWNER_LISTENER_UNPROVEN', 'OWNER_LISTENER_NOT_PRIVATE',
  'OWNER_CIM_PROCESS_QUERY_FAILED', 'OWNER_PROCESS_UNPROVEN', 'OWNER_COMMAND_LINE_UNAVAILABLE',
  'OWNER_COMMAND_LINE_MISMATCH', 'OWNER_IMAGE_MISMATCH', 'OWNER_PROCESS_BIRTH_UNAVAILABLE',
  'OWNER_NATIVE_QUERY_UNAVAILABLE', 'OWNER_NATIVE_ACCESS_DENIED', 'OWNER_NATIVE_OPEN_FAILED',
  'OWNER_NATIVE_PROCESS_EXITED', 'OWNER_NATIVE_BIRTH_UNPROVEN', 'OWNER_NATIVE_BIRTH_MISMATCH',
  'OWNER_NATIVE_IMAGE_UNPROVEN', 'OWNER_NATIVE_IMAGE_MISMATCH', 'OWNER_IMAGE_HASH_UNPROVEN',
  'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN',
  'OWNER_OBSERVER_TIMEOUT', 'OWNER_OBSERVER_FAILED', 'OWNER_OBSERVER_INVALID_RECEIPT',
]);
const diagnosticCodes = new Set(MAINTENANCE_OWNER_DIAGNOSTIC_CODES_V1);
export const maintenanceNativeOwnerDiagnosticCodeV2 = value => typeof value === 'string' && diagnosticCodes.has(value)
  ? value : 'OWNER_OBSERVER_INVALID_RECEIPT';
const refuse = diagnosticCode => {
  const error = new Error('MAINTENANCE_MIGRATION_OWNER_UNPROVEN');
  if (diagnosticCode !== undefined) error.diagnosticCode = maintenanceNativeOwnerDiagnosticCodeV2(diagnosticCode);
  throw error;
};
export function readMaintenanceNativeOwnerV2({ platform = process.platform, spawnSyncFn = spawnSync } = {}) {
  // Dependency injection is local to this observer's tests; no remote request
  // supplies the platform, process reader, path, executable or arguments.
  if (platform !== 'win32') refuse('OWNER_OBSERVER_FAILED');
  let r;
  try { r = spawnSyncFn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      fileURLToPath(new URL('./windows/read-sovereign-maintenance-owner-v2.ps1', import.meta.url))],
    { env: createBattleBridgeMinimalChildEnvironment(process.env, { platform: 'win32' }),
      shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: 4096, timeout: 10_000 }); }
  catch { refuse('OWNER_OBSERVER_FAILED'); }
  if (r?.error) refuse(r.error.code === 'ETIMEDOUT' ? 'OWNER_OBSERVER_TIMEOUT' : 'OWNER_OBSERVER_FAILED');
  let n;
  try {
    if (typeof r?.stdout !== 'string' || Buffer.byteLength(r.stdout, 'utf8') > 4096) throw new Error();
    n = JSON.parse(r.stdout);
    if (!n || typeof n !== 'object' || Array.isArray(n)) throw new Error();
  } catch { refuse('OWNER_OBSERVER_INVALID_RECEIPT'); }
  if (r.status !== 0) {
    if (r.status === 2 && Object.keys(n).sort().join(',') === 'diagnosticCode,observationOnly,ok,schemaVersion'
        && n.schemaVersion === 'stephanos.maintenance-owner-native-diagnostic.v1'
        && n.ok === false && n.observationOnly === true) refuse(n.diagnosticCode);
    refuse('OWNER_OBSERVER_INVALID_RECEIPT');
  }
  if (Object.keys(n).sort().join(',') !== 'commandSha256,createdAtUtc,imageSha256,observedAtUtc,pid,schemaVersion'
      || n.schemaVersion !== 'stephanos.maintenance-owner-native-observation.v2'
      || !Number.isSafeInteger(n.pid) || n.pid < 1 || !fresh(n.observedAtUtc)
      || !/^[a-f0-9]{64}$/.test(n.commandSha256 ?? '') || !/^[a-f0-9]{64}$/.test(n.imageSha256 ?? '')
      || typeof n.createdAtUtc !== 'string' || !/Z$/.test(n.createdAtUtc)
      || !Number.isFinite(Date.parse(n.createdAtUtc)) || Date.parse(n.createdAtUtc) > Date.parse(n.observedAtUtc)) refuse('OWNER_OBSERVER_INVALID_RECEIPT');
  return n;
}
export async function readMaintenanceOwnerObservationV2({ nativeReader = readMaintenanceNativeOwnerV2, fetchFn = fetch } = {}) {
  const before = await nativeReader();
  const response = await fetchFn('http://127.0.0.1:18791/health',
    { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok || !response.body?.getReader) refuse();
  const reader = response.body.getReader(); let bytes = 0; const chunks = [];
  try {
    while (true) { const row = await reader.read(); if (row.done) break;
      bytes += row.value.length; if (bytes > 64 * 1024) refuse(); chunks.push(Buffer.from(row.value)); }
  } finally { await reader.cancel(); reader.releaseLock(); }
  let h; try { h = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { refuse(); }
  const after = await nativeReader();
  const identity = n => ({ pid: n.pid, createdAtUtc: n.createdAtUtc, commandSha256: n.commandSha256, imageSha256: n.imageSha256 });
  if (!fresh(before.observedAtUtc) || !fresh(after.observedAtUtc)
      || digest(identity(before)) !== digest(identity(after))) refuse();
  const g = h.continuousRepairGuardian;
  const persistentHeld = g?.persistentCustody?.held === true;
  const liveCycle = /^[a-f0-9-]{36}$/.test(g?.lastCycleId ?? '')
    && typeof g?.lastStartedAtUtc === 'string' && /Z$/.test(g.lastStartedAtUtc)
    && Number.isFinite(Date.parse(g.lastStartedAtUtc)) && Date.parse(g.lastStartedAtUtc) <= Date.now();
  const restartedPersistedHold = g?.lastCycleId === '' && g?.lastStartedAtUtc === '' && persistentHeld;
  if (h.service !== 'stephanos-sovereign-commander' || h.ok !== true
      || !g || g.timeoutCustodyHeld !== true || g.running !== false || g.maintenanceInFlight !== false
      || g.scheduled !== false || g.currentCycleId !== ''
      || g.lastBlocker !== 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN'
      || !persistentHeld || (!liveCycle && !restartedPersistedHold)) refuse();
  const observation = { schemaVersion: 'stephanos.maintenance-held-owner-observation.v2',
    ...identity(after), lastCycleId: g.lastCycleId, lastStartedAtUtc: g.lastStartedAtUtc,
    timeoutCustodyHeld: true, running: false, maintenanceInFlight: false, scheduled: false };
  return Object.freeze({ observation: Object.freeze(observation), digest: digest(observation),
    observedAtUtc: after.observedAtUtc });
}
