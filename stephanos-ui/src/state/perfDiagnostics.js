const MAX_BUCKETS = 120;
const MAX_RECENT_EVENTS = 80;
const MAX_COPY_EVENTS = 40;
const MAX_COPY_COUNTERS = 30;

function nowIso() {
  return new Date().toISOString();
}

function ensureRoot() {
  if (typeof globalThis === 'undefined') return null;
  if (!globalThis.__STEPHANOS_PERF_DIAGNOSTICS__) {
    globalThis.__STEPHANOS_PERF_DIAGNOSTICS__ = {
      version: 1,
      startedAt: nowIso(),
      counters: Object.create(null),
      rates: Object.create(null),
      recent: [],
    };
  }
  return globalThis.__STEPHANOS_PERF_DIAGNOSTICS__;
}

function incrementCounter(group, name, delta = 1) {
  const root = ensureRoot();
  if (!root) return;
  const key = `${group}.${name}`;
  const nextCount = (root.counters[key] || 0) + delta;
  root.counters[key] = nextCount;
  if (!root.rates[key]) {
    root.rates[key] = { count: 0, firstAt: Date.now(), lastAt: Date.now() };
  }
  const rate = root.rates[key];
  rate.count += delta;
  rate.lastAt = Date.now();
  if (Object.keys(root.counters).length > MAX_BUCKETS) {
    const oldest = Object.keys(root.counters)[0];
    delete root.counters[oldest];
    delete root.rates[oldest];
  }
  return nextCount;
}

export function recordPerfCounter(group, name, delta = 1) {
  return incrementCounter(group, name, delta);
}

export function recordPerfEvent(group, name, detail = '') {
  const root = ensureRoot();
  if (!root) return;
  incrementCounter(group, name, 1);
  root.recent.unshift({ at: nowIso(), key: `${group}.${name}`, detail: String(detail || '').slice(0, 120) });
  if (root.recent.length > MAX_RECENT_EVENTS) {
    root.recent.length = MAX_RECENT_EVENTS;
  }
}

export function getPerfDiagnosticsSnapshot() {
  const root = ensureRoot();
  if (!root) return null;
  return {
    ...root,
    recent: root.recent.slice(0, MAX_RECENT_EVENTS),
  };
}

function buildTopCounterEntries(counters = {}) {
  return Object.entries(counters)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, MAX_COPY_COUNTERS);
}

export function buildPerfDiagnosticsCopyPayload() {
  const snapshot = getPerfDiagnosticsSnapshot();
  if (!snapshot) return null;
  return {
    capturedAt: nowIso(),
    pageUrl: typeof window !== 'undefined' ? window.location?.href || '' : '',
    startedAt: snapshot.startedAt,
    topCounters: buildTopCounterEntries(snapshot.counters || {}),
    rates: snapshot.rates || {},
    recentEvents: Array.isArray(snapshot.recent) ? snapshot.recent.slice(0, MAX_COPY_EVENTS) : [],
  };
}

export async function copyPerfDiagnosticsSnapshot() {
  const payload = buildPerfDiagnosticsCopyPayload();
  const text = JSON.stringify(payload, null, 2);
  try {
    if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true, copied: true, text, payload };
    }
  } catch {}
  return { ok: true, copied: false, text, payload };
}

if (typeof globalThis !== 'undefined') {
  globalThis.__STEPHANOS_COPY_PERF_DIAGNOSTICS__ = () => copyPerfDiagnosticsSnapshot();
}
