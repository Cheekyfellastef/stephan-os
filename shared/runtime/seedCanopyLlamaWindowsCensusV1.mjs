// Read-only Windows process census assessment for seed #3096.
// No process control, trust-root minting, residency certification or HOLD bypass.
export const LLAMA_WINDOWS_CENSUS_SCHEMA = 'stephanos.llama-windows-census.v1';
export const LLAMA_WINDOWS_CENSUS_MAX_AGE_MS = 5000;
const utc = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const pid = value => Number.isSafeInteger(value) && value > 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function assessLlamaWindowsProcessCensusV1(snapshot, registration, nowMs = Date.now()) {
  const reasons = [];
  if (snapshot?.schemaVersion !== LLAMA_WINDOWS_CENSUS_SCHEMA)
    reasons.push('CENSUS_SCHEMA_UNKNOWN');
  if (!registration || !pid(registration.routerPid)
    || !utc(registration.routerStartedAtUtc)
    || !digest(registration.routerExecutableSha256)
    || !Array.isArray(registration.registeredDescendants)
    || registration.registeredDescendants.length > 2048
    || registration.registeredDescendants.some(d => !d || !pid(d.pid) || !utc(d.startedAtUtc))
    || registration.registeredDescendants.some(d => Date.parse(d.startedAtUtc) < Date.parse(registration.routerStartedAtUtc))
    || registration.registeredDescendants.some(d => d.pid === registration.routerPid)
    || new Set(registration.registeredDescendants.map(d => d.pid)).size !== registration.registeredDescendants.length)
    reasons.push('LAUNCH_REGISTRATION_INCOMPLETE');

  const observed = Date.parse(snapshot?.observedAtUtc || '');
  if (!Number.isFinite(nowMs) || !utc(snapshot?.observedAtUtc)
    || !Number.isFinite(observed) || observed > nowMs
    || nowMs - observed > LLAMA_WINDOWS_CENSUS_MAX_AGE_MS)
    reasons.push('CENSUS_NOT_FRESH');
  // A late completion timestamp must never hide a slow/racing enumeration.
  // This is still an unsigned, read-only candidate and cannot authorize inference.
  const started = Date.parse(snapshot?.enumerationStartedAtUtc || '');
  const finished = Date.parse(snapshot?.enumerationFinishedAtUtc || '');
  if (!utc(snapshot?.enumerationStartedAtUtc)
    || !utc(snapshot?.enumerationFinishedAtUtc)
    || !Number.isFinite(started) || !Number.isFinite(finished)
    || started > finished || finished !== observed
    || started > nowMs || nowMs - started > LLAMA_WINDOWS_CENSUS_MAX_AGE_MS
    || finished - started > LLAMA_WINDOWS_CENSUS_MAX_AGE_MS)
    reasons.push('CENSUS_OBSERVATION_WINDOW_INVALID');
  if (snapshot?.enumerationComplete !== true)
    reasons.push('PROCESS_ENUMERATION_INCOMPLETE');

  const processes = snapshot?.processes;
  if (!Array.isArray(processes) || processes.length === 0 || processes.length > 8192
    || processes.some(p => !p || !pid(p.pid)
      || !Number.isSafeInteger(p.parentPid) || p.parentPid < 0
      || !utc(p.startedAtUtc)))
    reasons.push('PROCESS_CENSUS_INVALID');

  if (reasons.includes('LAUNCH_REGISTRATION_INCOMPLETE')
    || reasons.includes('PROCESS_CENSUS_INVALID')) {
    return Object.freeze({
      processTreeAbsentCandidate: false,
      independentlyQualified: false,
      zeroResidencyProven: false,
      mayLiftInferenceHold: false,
      reasonCodes: Object.freeze(reasons),
    });
  }

  // A router or registered child launched during enumeration may escape the
  // initial scan. Require the entire registered launch tree to predate it.
  if (Number.isFinite(started)
    && (Date.parse(registration.routerStartedAtUtc) > started
      || registration.registeredDescendants.some(d => Date.parse(d.startedAtUtc) > started)))
    reasons.push('LAUNCH_OVERLAPS_CENSUS');
  const byPid = new Map();
  for (const process of processes) {
    if (byPid.has(process.pid)) reasons.push('DUPLICATE_PROCESS_PID');
    byPid.set(process.pid, process);
  }
  const root = byPid.get(registration.routerPid);
  if (root) {
    reasons.push(root.startedAtUtc === registration.routerStartedAtUtc
      ? 'REGISTERED_ROUTER_STILL_RUNNING' : 'ROUTER_PID_REUSED');
    if (typeof snapshot.routerExecutableSha256 !== 'string'
      || snapshot.routerExecutableSha256 !== registration.routerExecutableSha256)
      reasons.push('ROUTER_EXECUTABLE_MISMATCH_OR_UNOBSERVED');
  }
  for (const child of registration.registeredDescendants) {
    const observedChild = byPid.get(child.pid);
    if (observedChild) {
      reasons.push(observedChild.startedAtUtc === child.startedAtUtc
        ? 'REGISTERED_DESCENDANT_STILL_RUNNING' : 'DESCENDANT_PID_REUSED');
    }
  }

  // A child's recorded parent PID can survive after its parent exits. Treat
  // every reachable descendant as live, even if the root has disappeared.
  // Parent PID reuse is treated conservatively: it may over-block, never clear.
  for (const process of processes) {
    const visited = new Set([process.pid]);
    let ancestor = process.parentPid;
    for (let hops = 0; ancestor > 0 && hops < 8192; hops++) {
      if (ancestor === registration.routerPid) {
        reasons.push('ROUTER_DESCENDANT_STILL_RUNNING');
        break;
      }
      if (visited.has(ancestor)) {
        reasons.push('PROCESS_PARENT_CYCLE');
        break;
      }
      visited.add(ancestor);
      const parent = byPid.get(ancestor);
      if (!parent) break;
      ancestor = parent.parentPid;
    }
  }
  return Object.freeze({
    // Read-only process snapshots are neither independently signed custody
    // evidence nor verified Windows Job / GPU residency measurements.
    processTreeAbsentCandidate: reasons.length === 0,
    independentlyQualified: false,
    zeroResidencyProven: false,
    mayLiftInferenceHold: false,
    reasonCodes: Object.freeze([...new Set(reasons)]),
  });
}
