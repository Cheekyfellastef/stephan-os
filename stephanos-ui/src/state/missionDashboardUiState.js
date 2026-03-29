function normalizeString(value, fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

export function createDefaultMissionDashboardUiState() {
  return {
    selectedMilestoneId: '',
    expandedMilestoneIds: [],
    showBlockedOnly: false,
  };
}

export function normalizeMissionDashboardUiState(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const expandedMilestoneIds = Array.isArray(source.expandedMilestoneIds)
    ? [...new Set(source.expandedMilestoneIds.map((entry) => normalizeString(entry)).filter(Boolean))].slice(0, 20)
    : [];

  return {
    selectedMilestoneId: normalizeString(source.selectedMilestoneId),
    expandedMilestoneIds,
    showBlockedOnly: source.showBlockedOnly === true,
  };
}
