export function resolvePaneCollapsedState(pane, uiLayout) {
  const layout = uiLayout && typeof uiLayout === 'object' ? uiLayout : {};
  const layoutKey = String(pane?.layoutKey || pane?.id || '').trim();
  if (!layoutKey) {
    return false;
  }
  return layout[layoutKey] === false;
}

export function getPaneMoveAvailability(order = [], paneId = '') {
  const index = order.indexOf(paneId);
  if (index < 0) {
    return { canMoveUp: false, canMoveDown: false };
  }
  return {
    canMoveUp: index > 0,
    canMoveDown: index < order.length - 1,
  };
}
