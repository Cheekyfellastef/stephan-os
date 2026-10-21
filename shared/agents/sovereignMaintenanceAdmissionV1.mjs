// Admission to existing fixed maintenance; this is neither a new execution
// owner nor proof of Windows descendant exclusion or cross-restart custody.
const READ_ONLY_ACTIONS = new Set([
  'battle-bridge-status', 'battle-bridge-observe', 'meter-status',
  'controller-lane-status', 'rescue-island-readonly-boundary', 'visibility-snapshot',
  'cpu-pressure-snapshot', 'status-recovery-mesh', 'status-worker-watchdog',
  'status-stephanos-core-daemon', 'gaming-resource-status',
  'status-mission-orchestrator-worker', 'status-stephanos-backend',
  'status-openclaw-whatsapp', 'starfield-vr-telemetry-archive',
]);
export const SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER =
  'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';

export async function readFixedSovereignMaintenanceGuardianV1({ fetchImpl = fetch, nowMs = Date.now() } = {}) {
  // Other local processes (stdio and mailbox adapters) consult the existing
  // Commander owner, rather than a separate process-local empty registry.
  const response = await fetchImpl('http://127.0.0.1:18791/health', {
    redirect: 'error', signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) return null;
  let bytes = 0, body = '';
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 32_768) throw new Error('SOVEREIGN_MAINTENANCE_HEALTH_TOO_LARGE');
    body += Buffer.from(chunk).toString('utf8');
  }
  const health = JSON.parse(body);
  const age = nowMs - Date.parse(health.observedAtUtc);
  if (health.ok !== true || health.service !== 'stephanos-sovereign-commander'
      || !Number.isFinite(age) || age < 0 || age > 30_000) return null;
  return health.continuousRepairGuardian;
}

export async function admitSovereignMaintenanceV1(processId, readGuardian = readFixedSovereignMaintenanceGuardianV1) {
  if (READ_ONLY_ACTIONS.has(processId)) return Object.freeze({ ok: true });
  let guardian;
  try { guardian = await readGuardian(); } catch {}
  if (guardian?.timeoutCustodyHeld === true) return Object.freeze({ ok: false,
    blocker: SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER });
  if (!guardian || !Object.hasOwn(guardian, 'timeoutCustodyHeld') || guardian.timeoutCustodyHeld !== false
      || typeof guardian.enabled !== 'boolean' || typeof guardian.running !== 'boolean') {
    return Object.freeze({ ok: false, blocker: 'SOVEREIGN_MAINTENANCE_CUSTODY_UNPROVEN' });
  }
  return Object.freeze(guardian.running ? { ok: false, blocker: 'SOVEREIGN_MAINTENANCE_OWNER_BUSY' } : { ok: true });
}
