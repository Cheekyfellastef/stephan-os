// Admission to existing fixed maintenance; this is neither a new execution
// owner nor proof of Windows descendant exclusion or cross-restart custody.
import {
  FLEET_SUPERVISOR_ACTION, FLEET_SUPERVISOR_SCHEMA, FLEET_SUPERVISOR_MARKER,
} from './sovereignCommanderFleetGoalSupervisorReceiptV1.mjs';
const READ_ONLY_ACTIONS = new Set([
  'battle-bridge-status', 'battle-bridge-observe', 'meter-status',
  'controller-lane-status', 'rescue-island-readonly-boundary', 'visibility-snapshot',
  'cpu-pressure-snapshot', 'status-recovery-mesh', 'status-worker-watchdog',
  'status-stephanos-core-daemon',
  'status-mission-orchestrator-worker', 'status-stephanos-backend',
  'starfield-vr-telemetry-archive',
]);
// Names do not prove observation-only behavior. Gaming Status can reconcile
// missing state and evict Ollama; the opaque OpenClaw CLI can load plugins.
// Both retain ordinary owner admission rather than bypassing a custody hold.
export const SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER =
  'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';
export const SOVEREIGN_MAINTENANCE_OWNER_VERSION = '2026-10-21-guardian-reservation-v1';

// Shared disposition for automatic broad Core repair. Native custody has not
// been enrolled. Neither a healthy worker nor the manual maintenance route
// can turn an automatic caller into an operator-approved repair. There is no
// caller-provided qualification flag and no maintenance reservation to release.
export function unqualifiedCoreWindowsRepairV1() {
  return Object.freeze({
    ok: false, attempted: false, dispatchAllowed: false,
    executionState: 'NOT_STARTED', maintenanceReservationCreated: false,
    nativeCustodyQualified: false,
    blocker: 'SOVEREIGN_CORE_WINDOWS_JOB_CUSTODY_UNAVAILABLE',
    sourceMutationAllowed: false,
    finalVerdict: 'CORE_AUTOMATIC_MAINTENANCE_NOT_STARTED',
  });
}

export function isSovereignMaintenanceObservationV1(processId) {
  return READ_ONLY_ACTIONS.has(processId);
}

// Closed wire contracts: a descendant's receipt cannot substitute for its parent.
const TERMINAL_PROTOCOLS = Object.freeze({
  [FLEET_SUPERVISOR_ACTION]: Object.freeze({ schema: FLEET_SUPERVISOR_SCHEMA,
    marker: FLEET_SUPERVISOR_MARKER, failedExit: 2, uniqueMarker: true, canonicalJson: true }),
  'repair-stephanos': Object.freeze({ schema: 'stephanos.sovereign-commander-stephanos-repair.v1', marker: 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_RESULT=', failedExit: 2 }),
  'repair-goal-builder-flow': Object.freeze({ schema: 'stephanos.sovereign-commander-goal-builder-repair.v1', marker: 'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=', failedExit: 2 }),
  'repair-control-plane': Object.freeze({ schema: 'stephanos.sovereign-commander-control-plane-repair.v1', marker: '', failedExit: 1 }),
});

// Terminal parent exit is not descendant exclusion. Share this negative-evidence
// model between scheduled repair and manually reserved fixed maintenance.
export function sovereignMaintenanceCustodyUnprovenV1(execution = {}, receipt = {}, processId = '') {
  if (!Number.isInteger(execution.status) || execution.signal) return true;
  const protocol = Object.hasOwn(TERMINAL_PROTOCOLS, processId) ? TERMINAL_PROTOCOLS[processId] : null;
  if (protocol && (receipt?.schemaVersion !== protocol.schema || typeof receipt?.ok !== 'boolean'
      || execution.status !== (receipt.ok ? 0 : protocol.failedExit))) return true;
  const pending = [execution, receipt];
  const seen = new Set();
  while (pending.length) {
    const row = pending.pop();
    if (!row || typeof row !== 'object' || Array.isArray(row)) return true;
    if (seen.has(row) || seen.size >= 256) return true;
    seen.add(row);
    if ((Object.hasOwn(row, 'status') && !Number.isInteger(row.status)) || row.signal) return true;
    for (const field of ['errorCode', 'blocker', 'controlPlaneResidualBlocker']) {
      const value = typeof row[field] === 'string' ? row[field] : '';
      if (/(?:^|[^A-Z0-9])(?:ETIMEDOUT|ABORT_ERR)(?:$|[^A-Z0-9])/.test(value)
          || value === SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER) return true;
    }
    for (const field of ['steps', 'tasks', 'executionEvidence']) {
      if (!Object.hasOwn(row, field)) continue;
      if (!Array.isArray(row[field]) || row[field].length > 128) return true;
      pending.push(...row[field]);
    }
    if (Object.hasOwn(row, 'repair')) pending.push(row.repair);
  }
  return false;
}

export function readSovereignMaintenanceTerminalReceiptV1(stdout = '', processId = '') {
  const protocol = Object.hasOwn(TERMINAL_PROTOCOLS, processId) ? TERMINAL_PROTOCOLS[processId] : null;
  if (!protocol) return {};
  const hold = () => ({ status: null });
  const raw = typeof stdout === 'string' ? stdout.trim() : '';
  if (!raw || Buffer.byteLength(raw, 'utf8') > 64 * 1024) return hold();
  // Each established CLI writes its own terminal record last. Never scan back
  // to an earlier descendant record after the requested parent's record is lost.
  const line = raw.split(/\r?\n/).at(-1).trim();
  if (protocol.marker && !line.startsWith(protocol.marker)) return hold();
  if (protocol.uniqueMarker && raw.split(/\r?\n/)
    .filter(value => value.trim().startsWith(protocol.marker)).length !== 1) return hold();
  const candidate = protocol.marker ? line.slice(protocol.marker.length) : line;
  try {
    const receipt = JSON.parse(candidate);
    if (protocol.canonicalJson && JSON.stringify(receipt) !== candidate) return hold();
    if (receipt && typeof receipt === 'object' && !Array.isArray(receipt)
        && receipt.schemaVersion === protocol.schema && typeof receipt.ok === 'boolean') return receipt;
  } catch {}
  return hold();
}
