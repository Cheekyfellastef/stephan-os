function asText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value)
    ? value.map((entry) => asText(entry)).filter(Boolean)
    : [];
}

function normalizeStatus(value = '') {
  const normalized = asText(value, '').toLowerCase();
  if (['unavailable', 'present', 'present_with_summary', 'degraded', 'blocked', 'unknown'].includes(normalized)) {
    return normalized;
  }
  return '';
}

function normalizeShortcut(entry = {}, index = 0) {
  const present = entry.present === true;
  const statusSummaryAvailable = entry.statusSummaryAvailable === true;
  const status = normalizeStatus(entry.status)
    || (!present
      ? 'unavailable'
      : statusSummaryAvailable
        ? 'present_with_summary'
        : 'present');

  return {
    shortcutId: asText(entry.shortcutId || entry.id, `shortcut-${index + 1}`),
    label: asText(entry.label, `Shortcut ${index + 1}`),
    targetSurface: asText(entry.targetSurface, 'launcher'),
    status,
    statusSummaryAvailable,
    compactStatus: asText(entry.compactStatus),
    nextAction: asText(entry.nextAction),
    blocker: asText(entry.blocker),
    warning: asText(entry.warning),
    evidence: asList(entry.evidence),
    present,
  };
}

export function buildShortcutStatusSummary(shortcuts = []) {
  const source = Array.isArray(shortcuts) ? shortcuts : [];
  return source.map((entry, index) => normalizeShortcut(entry, index));
}
