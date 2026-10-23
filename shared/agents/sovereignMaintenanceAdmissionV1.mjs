// Admission to existing fixed maintenance; this is neither a new execution
// owner nor proof of Windows descendant exclusion or cross-restart custody.
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

export function isSovereignMaintenanceObservationV1(processId) {
  return READ_ONLY_ACTIONS.has(processId);
}

// Terminal parent exit is not descendant exclusion. Share this negative-evidence
// model between scheduled repair and manually reserved fixed maintenance.
export function sovereignMaintenanceCustodyUnprovenV1(execution = {}, receipt = {}) {
  if (!Number.isInteger(execution.status) || execution.signal) return true;
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
    if (Object.hasOwn(row, 'steps')) {
      if (!Array.isArray(row.steps) || row.steps.length > 128) return true;
      pending.push(...row.steps);
    }
  }
  return false;
}

export function readSovereignMaintenanceTerminalReceiptV1(stdout = '') {
  const markers = [
    'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_RESULT=',
    'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=',
    'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_RESULT=',
  ];
  const lines = String(stdout).trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const marker = markers.find(value => line.trim().startsWith(value));
    if (!marker) continue;
    try {
      const receipt = JSON.parse(line.trim().slice(marker.length));
      return receipt && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt : {};
    } catch { return {}; }
  }
  return {};
}
