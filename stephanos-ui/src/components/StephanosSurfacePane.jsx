import { cloneElement, isValidElement } from 'react';
import { resolvePaneCollapsedState } from '../utils/stephanosPaneBehavior';

export default function StephanosSurfacePane({
  pane,
  uiLayout,
  dragPaneId,
  onDragStart,
  onDragEnd,
  onDrop,
  shouldStartPaneDrag,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}) {
  if (!pane?.id || typeof pane?.render !== 'function') {
    return null;
  }
  const paneCollapsed = resolvePaneCollapsedState(pane, uiLayout);
  const wideSurfaceClass = pane.wideSurface ? ' stephanos-tile--wide-capable' : '';
  const wideSurfaceActiveClass = pane.wideSurface && !paneCollapsed ? ' stephanos-tile--wide-active' : '';
  const workspaceShellClass = pane.wideSurface ? ' stephanos-workspace-pane-shell' : '';
  const moveControlGroup = (
    <div className="pane-order-controls" aria-label={`${pane.title || pane.id} arrangement controls`} data-pane-control-group="move-order" data-pane-control-layer="pane-header" data-pane-control-attached="true" data-testid={`pane-${pane.id}-move-controls`}>
      <button type="button" className="ghost-button" onClick={onMoveUp} disabled={!canMoveUp} aria-label={`Move ${pane.title || pane.id} up`}>Move up</button>
      <button type="button" className="ghost-button" onClick={onMoveDown} disabled={!canMoveDown} aria-label={`Move ${pane.title || pane.id} down`}>Move down</button>
    </div>
  );

  const paneNode = paneCollapsed ? null : pane.render({});
  const renderedPane = isValidElement(paneNode)
    ? cloneElement(paneNode, {
      actions: paneNode.props?.actions ? <>{paneNode.props.actions}{moveControlGroup}</> : moveControlGroup,
    })
    : paneNode;

  return (
    <div
      className={`operator-pane-slot${wideSurfaceClass}${wideSurfaceActiveClass}${workspaceShellClass} ${pane.className || ''} ${paneCollapsed ? 'pane-collapsed' : 'pane-expanded'} ${dragPaneId === pane.id ? 'dragging' : ''}`}
      draggable
      data-pane-id={pane.id}
      data-testid={`pane-${pane.id}-shell`}
      data-pane-collapsed={paneCollapsed ? 'true' : 'false'}
      data-workspace-shell={pane.wideSurface ? 'canonical' : undefined}
      onDragStart={(event) => {
        if (!shouldStartPaneDrag(event.target)) {
          event.preventDefault();
          return;
        }
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
    >
      {renderedPane}
    </div>
  );
}
