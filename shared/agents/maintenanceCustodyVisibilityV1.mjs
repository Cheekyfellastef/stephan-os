// Read-only observation shared by private and guarded remote visibility.
// A health report is never a custody-release witness or execution grant.
export function projectMaintenanceCustodyVisibilityV1(value = {}) {
  const unknown = Object.freeze({ available: false, state: 'UNKNOWN',
    blocker: 'LIVE_MAINTENANCE_CUSTODY_UNPROVEN', executionAuthority: false });
  if (value?.available !== true || value.executionAuthority !== false
    || value.evidenceSource !== 'LIVE_MAINTENANCE_OWNER_HEALTH'
    || ['timeoutCustodyHeld', 'persistentHeld', 'running', 'maintenanceInFlight']
      .some(key => typeof value[key] !== 'boolean')
    || typeof value.blocker !== 'string' || !/^[A-Z0-9_]{0,120}$/.test(value.blocker)) return unknown;
  const held = value.timeoutCustodyHeld || value.persistentHeld;
  return Object.freeze({ available: true,
    state: held ? 'HELD' : value.blocker ? 'UNKNOWN' : 'NOT_HELD_REPORTED',
    timeoutCustodyHeld: value.timeoutCustodyHeld, persistentHeld: value.persistentHeld,
    running: value.running, maintenanceInFlight: value.maintenanceInFlight,
    lastCycleId: /^[a-zA-Z0-9._:-]{1,120}$/.test(value.lastCycleId || '') ? value.lastCycleId : '',
    blocker: value.blocker || (held ? 'MAINTENANCE_CUSTODY_HELD' : ''),
    evidenceSource: 'LIVE_MAINTENANCE_OWNER_HEALTH', executionAuthority: false,
  });
}

export function maintenanceCustodyVisibilityLightV1(value) {
  const projected = projectMaintenanceCustodyVisibilityV1(value);
  return projected.state === 'HELD' ? 'RED' : projected.state === 'NOT_HELD_REPORTED' ? 'GREEN' : 'AMBER';
}
