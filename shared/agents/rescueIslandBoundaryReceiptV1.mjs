// #3109: the only public representation of a live fixed Island scope probe.
// Physical OS readback is not source custody, approval, or worker admission.
export const RESCUE_ISLAND_BOUNDARY_RESULT_SCHEMA = 'stephanos.rescue-island-boundary-probe.v1';
export const RESCUE_ISLAND_BOUNDARY_MARKER = 'RESCUE_ISLAND_BOUNDARY_PROBE_RESULT=';
const KEYS = Object.freeze([
  'schemaVersion', 'ok', 'blocker', 'observedPathCount', 'physicalScopeReadback',
  'finalVerdict', 'sourceMutationAllowed', 'workerStartAllowed',
  'independentOwnershipAuthenticated', 'gamingBudgetAuthenticated',
  'originalSourceLeaseReleaseAllowed', 'seedForgeQueueAccessAllowed',
  'mergeAllowed', 'publicReceiptSafe',
].sort());
const FLAGS = Object.freeze([
  'sourceMutationAllowed', 'workerStartAllowed',
  'independentOwnershipAuthenticated', 'gamingBudgetAuthenticated',
  'originalSourceLeaseReleaseAllowed', 'seedForgeQueueAccessAllowed',
  'mergeAllowed',
]);

export function projectRescueIslandBoundaryResultV1(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(KEYS)
      || value.schemaVersion !== RESCUE_ISLAND_BOUNDARY_RESULT_SCHEMA
      || value.ok !== true || value.blocker !== ''
      || value.observedPathCount !== 3
      || value.physicalScopeReadback !== 'LOCAL_OS_SCOPE_OBSERVED'
      || value.finalVerdict !== 'RESCUE_ISLAND_OS_SCOPE_READONLY_OBSERVED'
      || value.publicReceiptSafe !== true
      || FLAGS.some((key) => value[key] !== false))
    return null;
  return Object.freeze({
    schemaVersion: RESCUE_ISLAND_BOUNDARY_RESULT_SCHEMA,
    ok: true,
    observedPathCount: 3,
    physicalScopeReadback: 'LOCAL_OS_SCOPE_OBSERVED',
    finalVerdict: 'RESCUE_ISLAND_OS_SCOPE_READONLY_OBSERVED',
    readOnly: true,
    sourceMutationAllowed: false,
    workerStartAllowed: false,
    independentOwnershipAuthenticated: false,
    gamingBudgetAuthenticated: false,
    originalSourceLeaseReleaseAllowed: false,
    seedForgeQueueAccessAllowed: false,
    mergeAllowed: false,
    publicReceiptSafe: true,
    secretMaterialReturned: false,
  });
}

export function parseRescueIslandBoundaryStdoutV1(stdout, processId) {
  if (processId !== 'rescue-island-readonly-boundary'
      || typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > 4096)
    return null;
  const lines = stdout.trimEnd().split(/\r?\n/);
  if (lines.length !== 1 || !lines[0].startsWith(RESCUE_ISLAND_BOUNDARY_MARKER))
    return null;
  try {
    return projectRescueIslandBoundaryResultV1(JSON.parse(lines[0].slice(RESCUE_ISLAND_BOUNDARY_MARKER.length)));
  } catch {
    return null;
  }
}
