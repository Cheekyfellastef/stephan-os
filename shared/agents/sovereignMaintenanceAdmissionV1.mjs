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
