// Shared presentation ordering. Pane and launcher adapters keep their existing
// storage owners; this module owns only reconciliation and bounded movement.
export function reconcilePaneOrder(savedPaneIds, defaultPaneIds) {
  const defaults = Array.isArray(defaultPaneIds)
    ? defaultPaneIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const known = new Set(defaults);
  const seen = new Set();
  const result = [];
  for (const id of [...(Array.isArray(savedPaneIds) ? savedPaneIds : []), ...defaults]) {
    const normalized = String(id || '').trim();
    if (!known.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function moveOrderedId(order, id, targetIndex) {
  const current = reconcilePaneOrder(order, order);
  const index = current.indexOf(id);
  if (index < 0 || !Number.isInteger(targetIndex)) return current;
  const target = Math.min(current.length - 1, Math.max(0, targetIndex));
  if (target === index) return current;
  current.splice(index, 1);
  current.splice(target, 0, id);
  return current;
}
