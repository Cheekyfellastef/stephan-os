const DEFAULT_SUBSYSTEMS = Object.freeze(['MEMORY', 'TILE', 'PROVIDER', 'CONTINUITY']);
const MAX_RECORD_LIMIT = 10;
const MAX_PAYLOAD_BYTES = 8_000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isNoiseEvent(event = {}) {
  const message = `${normalizeText(event.change)} ${normalizeText(event.reason)} ${normalizeText(event.impact)}`.toLowerCase();
  if (!message) return true;
  if (message.includes('heartbeat')) return true;
  if (message.includes('no-op')) return true;
  if (message.includes('poll')) return true;
  return false;
}

function isMeaningfulChange(event = {}) {
  const message = `${normalizeText(event.change)} ${normalizeText(event.reason)} ${normalizeText(event.impact)}`.toLowerCase();
  if (!message) return false;
  return ['state', 'connected', 'ready', 'persist', 'saved', 'execution', 'fallback', 'sync', 'interaction'].some((signal) => message.includes(signal));
}

function buildTelemetryRecords({ telemetryEntries, nowMs, timeWindowMs, subsystemSet }) {
  return asArray(telemetryEntries)
    .map((entry) => {
      const subsystem = normalizeText(entry?.subsystem).toUpperCase();
      const timestampMs = toTimestamp(entry?.timestamp);
      if (!subsystemSet.has(subsystem) || !Number.isFinite(timestampMs)) {
        return null;
      }
      if ((nowMs - timestampMs) > timeWindowMs) {
        return null;
      }
      if (isNoiseEvent(entry) || !isMeaningfulChange(entry)) {
        return null;
      }

      return {
        id: normalizeText(entry?.id, `telemetry-${timestampMs}`),
        subsystem,
        timestamp: new Date(timestampMs).toISOString(),
        summary: normalizeText(entry?.change, 'continuity transition observed'),
        kind: 'telemetry',
      };
    })
    .filter(Boolean);
}

function buildCommandRecords({ commandHistory, nowMs, timeWindowMs, subsystemSet }) {
  return asArray(commandHistory)
    .map((entry) => {
      const timestampMs = toTimestamp(entry?.timestamp);
      if (!Number.isFinite(timestampMs) || (nowMs - timestampMs) > timeWindowMs) {
        return null;
      }
      const execution = entry?.data_payload?.execution_metadata;
      const inferredSubsystem = execution?.actual_provider_used ? 'PROVIDER' : 'CONTINUITY';
      if (!subsystemSet.has(inferredSubsystem)) {
        return null;
      }

      const summary = execution?.actual_provider_used
        ? `provider execution recorded (${execution.actual_provider_used})`
        : normalizeText(entry?.parsed_command?.command)
          ? `command executed (${entry.parsed_command.command})`
          : '';

      if (!summary || isNoiseEvent({ change: summary }) || !isMeaningfulChange({ change: summary })) {
        return null;
      }

      return {
        id: normalizeText(entry?.id, `command-${timestampMs}`),
        subsystem: inferredSubsystem,
        timestamp: new Date(timestampMs).toISOString(),
        summary,
        kind: 'command',
      };
    })
    .filter(Boolean);
}

function dedupeRecords(records = []) {
  const seen = new Set();
  return records.filter((record) => {
    const key = `${record.subsystem}|${record.summary}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function applyPayloadCap(records = []) {
  const accepted = [];
  let usedBytes = 0;

  for (const record of records) {
    const serialized = JSON.stringify(record);
    const nextBytes = usedBytes + serialized.length;
    if (nextBytes > MAX_PAYLOAD_BYTES) {
      break;
    }
    usedBytes = nextBytes;
    accepted.push(record);
  }

  return accepted;
}

export function buildContinuitySummary(records = []) {
  if (!Array.isArray(records) || records.length === 0) {
    return 'Recent activity: none in retrieval window.';
  }

  const fragments = records.slice(0, 3).map((record) => normalizeText(record.summary, 'state change recorded'));
  return `Recent activity: ${fragments.join(', ')}.`;
}

export function getContinuityContext({
  commandHistory = [],
  telemetryEntries = [],
  limit = 5,
  timeWindowMs = 10 * 60 * 1000,
  subsystems = DEFAULT_SUBSYSTEMS,
  sharedMemorySource = 'backend',
  now = Date.now(),
} = {}) {
  const subsystemSet = new Set(asArray(subsystems).map((item) => String(item || '').trim().toUpperCase()).filter(Boolean));
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 5, MAX_RECORD_LIMIT));
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const effectiveSource = sharedMemorySource === 'backend' ? 'backend' : 'fallback';

  const records = dedupeRecords([
    ...buildTelemetryRecords({ telemetryEntries, nowMs, timeWindowMs, subsystemSet }),
    ...buildCommandRecords({ commandHistory, nowMs, timeWindowMs, subsystemSet }),
  ])
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, boundedLimit);

  const payloadSafeRecords = applyPayloadCap(records);

  if (payloadSafeRecords.length === 0) {
    return {
      records: [],
      source: effectiveSource,
      retrievalState: effectiveSource === 'backend' ? 'empty' : 'degraded',
      reason: effectiveSource === 'backend'
        ? 'No relevant continuity transitions in the requested window.'
        : 'Shared memory source is fallback-only; retrieval disabled.',
    };
  }

  return {
    records: payloadSafeRecords,
    source: effectiveSource,
    retrievalState: effectiveSource === 'backend' ? 'bounded' : 'degraded',
    reason: effectiveSource === 'backend'
      ? `Retrieved ${payloadSafeRecords.length} continuity records.`
      : 'Retrieved continuity records from fallback source only.',
  };
}

export { DEFAULT_SUBSYSTEMS, MAX_RECORD_LIMIT, MAX_PAYLOAD_BYTES };
