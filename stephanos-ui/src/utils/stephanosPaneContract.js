export function buildStephanosPaneContract(pane = {}) {
  const id = String(pane.id || '').trim();
  const title = String(pane.title || pane.panelTitle || id).trim();
  const layoutKey = String(pane.layoutKey || id).trim();
  return {
    id,
    title,
    layoutKey,
    isRegistered: id.length > 0,
    usesCanonicalWrapper: pane.usesCanonicalWrapper !== false,
    hasCollapseSupport: pane.hasCollapseSupport !== false,
    hasCanonicalDragHandle: pane.hasCanonicalDragHandle !== false,
    bodyTextSelectable: pane.bodyTextSelectable !== false,
    supportsOrderPersistence: pane.supportsOrderPersistence !== false,
    supportsCollapsePersistence: pane.supportsCollapsePersistence !== false,
    classification: 'first-class',
  };
}

export function auditStephanosTilePanes(panes = []) {
  return panes.map((pane) => {
    const contract = buildStephanosPaneContract(pane);
    const required = [
      contract.id,
      contract.title,
      contract.layoutKey,
    ];
    const booleans = [
      contract.isRegistered,
      contract.usesCanonicalWrapper,
      contract.hasCollapseSupport,
      contract.hasCanonicalDragHandle,
      contract.bodyTextSelectable,
      contract.supportsOrderPersistence,
      contract.supportsCollapsePersistence,
    ];
    if (required.some((value) => !value) || booleans.some((value) => value !== true)) {
      return { ...contract, classification: 'failing' };
    }
    return contract;
  });
}
