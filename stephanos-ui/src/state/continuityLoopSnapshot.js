const RECENT_EVENT_MAX = 5;
const RECENT_ACTIVITY_WINDOW_MS = 18_000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeTimestamp(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function classifySharedMemorySource(memoryTruth = {}) {
  const source = normalizeText(memoryTruth.sourceUsedOnLoad || memoryTruth.hydrationSource, 'unknown');
  if (source === 'shared-backend') return 'backend';
  if (source === 'local-mirror-fallback' || source === 'local-storage' || source === 'local-mirror') return 'degraded-local';
  return 'unavailable';
}

function classifyHydrationState(memoryTruth = {}) {
  if (memoryTruth.hydrationCompleted !== true) return 'hydrating';
  const degraded = memoryTruth.degraded === true || classifySharedMemorySource(memoryTruth) !== 'backend';
  if (degraded) return 'degraded';
  return 'ready';
}

function deriveAiContinuityMode(commandHistory = []) {
  const entries = asArray(commandHistory);
  const hasSuccessfulAiExecution = entries.some((entry) => {
    const execution = entry?.data_payload?.execution_metadata;
    return Boolean(execution?.actual_provider_used) && entry?.success !== false;
  });
  const hasMemoryHits = entries.some((entry) => asArray(entry?.memory_hits).length > 0);

  if (!hasSuccessfulAiExecution) return 'unavailable';
  if (hasMemoryHits) return 'context-ready';
  return 'recording-only';
}

function buildRecentEvents({ commandHistory = [], telemetryEntries = [] } = {}) {
  const commandEvents = asArray(commandHistory)
    .map((entry) => {
      const parsed = entry?.parsed_command || {};
      const command = normalizeText(parsed.command);
      const subcommand = normalizeText(parsed.subcommand);
      const execution = entry?.data_payload?.execution_metadata || null;
      const timestamp = normalizeTimestamp(entry?.timestamp);

      if (command === 'memory' && subcommand === 'save') {
        return {
          type: 'memory.save.persisted',
          at: timestamp,
          summary: 'memory.save persisted through durable memory route',
        };
      }

      if (execution?.actual_provider_used) {
        return {
          type: 'ai.continuity.persisted',
          at: timestamp,
          summary: `ai continuity artifacts recorded (${execution.actual_provider_used})`,
        };
      }

      return null;
    })
    .filter(Boolean);

  const telemetryEvents = asArray(telemetryEntries)
    .map((event) => {
      const change = normalizeText(event?.change).toLowerCase();
      if (!change.includes('memory') && !change.includes('tile') && !change.includes('continuity')) {
        return null;
      }
      return {
        type: normalizeText(event?.subsystem, 'telemetry').toLowerCase(),
        at: normalizeTimestamp(event?.timestamp),
        summary: normalizeText(event?.change, 'continuity telemetry change observed'),
      };
    })
    .filter(Boolean);

  return [...commandEvents, ...telemetryEvents]
    .filter((event) => event.at)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, RECENT_EVENT_MAX);
}

export function deriveContinuityLoopSnapshot({
  runtimeStatus,
  commandHistory = [],
  telemetryEntries = [],
  now = Date.now(),
} = {}) {
  const runtimeTruth = runtimeStatus?.runtimeTruth || {};
  const memoryTruth = runtimeTruth.memory || {};
  const tileTruth = runtimeTruth.tile || {};
  const sharedMemorySource = classifySharedMemorySource(memoryTruth);
  const sharedMemoryHydrationState = classifyHydrationState(memoryTruth);
  const tileLinkState = tileTruth.ready === true ? 'linked' : (tileTruth.reason ? 'partial' : 'isolated');
  const aiContinuityMode = deriveAiContinuityMode(commandHistory);
  const aiContinuityState = aiContinuityMode === 'unavailable'
    ? 'unavailable'
    : aiContinuityMode === 'recording-only'
      ? 'recording only'
      : 'context ready';

  const recentContinuityEvents = buildRecentEvents({ commandHistory, telemetryEntries });
  const lastEvent = recentContinuityEvents[0] || null;
  const lastContinuityEventAt = lastEvent?.at || '';
  const lastContinuityEventType = lastEvent?.type || 'none';
  const recentActivityActive = lastContinuityEventAt
    ? (now - Date.parse(lastContinuityEventAt)) <= RECENT_ACTIVITY_WINDOW_MS
    : false;

  const continuityLoopState = sharedMemorySource === 'backend'
    && sharedMemoryHydrationState === 'ready'
    && tileLinkState === 'linked'
    && aiContinuityMode !== 'unavailable'
    ? 'live'
    : (sharedMemorySource === 'unavailable' && aiContinuityMode === 'unavailable' ? 'unavailable' : 'degraded');

  return {
    sharedMemorySource,
    sharedMemoryHydrationState,
    sharedMemoryFallbackReason: normalizeText(memoryTruth.fallbackReason, 'none'),
    sharedMemoryRecordCount: Number.isFinite(Number(memoryTruth.recordCount)) ? Number(memoryTruth.recordCount) : -1,
    tileLinkState,
    executionLoopState: tileTruth.ready === true ? 'linked' : 'degraded',
    aiContinuityState,
    aiContinuityMode,
    recentContinuityEvents,
    continuityLoopState,
    lastContinuityEventAt,
    lastContinuityEventType,
    recentActivityActive,
  };
}

export { RECENT_EVENT_MAX, RECENT_ACTIVITY_WINDOW_MS };
