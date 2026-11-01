// Exact local Core lock identity: PID alone is never sufficient because
// Windows may reuse a PID and stale-takeover races can replace a lock file.
export const CORE_LOCK_SCHEMA = 'stephanos.core-daemon-lock.v1';
const SHA = /^[0-9a-f]{40}$/;
export function exactCoreLockOwnerV1(record, expected = {}) {
  return Boolean(
    record && typeof record === 'object' && !Array.isArray(record)
    && record.schemaVersion === CORE_LOCK_SCHEMA
    && Number.isSafeInteger(record.pid) && record.pid > 0
    && Number.isSafeInteger(expected.pid) && record.pid === expected.pid
    && typeof record.sourceHead === 'string' && SHA.test(record.sourceHead)
    && record.sourceHead === expected.sourceHead
    && typeof record.startedAtUtc === 'string'
    && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$/.test(record.startedAtUtc)
    && Number.isFinite(Date.parse(record.startedAtUtc))
    && record.startedAtUtc === expected.startedAtUtc
  );
}
