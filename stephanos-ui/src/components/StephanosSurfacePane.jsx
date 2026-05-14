import { useMemo, useRef } from 'react';
import { resolvePaneCollapsedState } from '../utils/stephanosPaneBehavior';
import StephanosPaneMoveControlsContext from './StephanosPaneMoveControlsContext';

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
  const arrangeModeActive = uiLayout?.arrangeMode === true;
  const wideSurfaceClass = pane.wideSurface ? ' stephanos-tile--wide-capable' : '';
  const wideSurfaceActiveClass = pane.wideSurface && !paneCollapsed ? ' stephanos-tile--wide-active' : '';
  const workspaceShellClass = pane.wideSurface ? ' stephanos-workspace-pane-shell' : '';
  const moveControlGroup = arrangeModeActive ? (
    <div className="pane-order-controls" aria-label={`${pane.title || pane.id} arrangement controls`} data-pane-control-group="move-order" data-pane-control-layer="pane-header" data-pane-control-attached="true" data-testid={`pane-${pane.id}-move-controls`}>
      <button type="button" className="ghost-button pane-order-button" onClick={onMoveUp} disabled={!canMoveUp} aria-label={`Move ${pane.title || pane.id} up`} data-testid={`pane-${pane.id}-move-up`}>Move up</button>
      <button type="button" className="ghost-button pane-order-button" onClick={onMoveDown} disabled={!canMoveDown} aria-label={`Move ${pane.title || pane.id} down`} data-testid={`pane-${pane.id}-move-down`}>Move down</button>
    </div>
  ) : null;

  const moveControlClaimedRef = useRef(false);
  const ownerPanelId = pane.layoutKey || pane.id;
  const moveControlContextValue = useMemo(() => ({
    paneId: pane.id,
    ownerPanelId,
    reorderable: true,
    canMoveUp: Boolean(canMoveUp),
    canMoveDown: Boolean(canMoveDown),
    createdByStephanosSurfacePane: true,
    providerValuePresent: true,
    moveControlGroup,
    claimMoveControls() {
      if (moveControlClaimedRef.current) {
        return { node: null, accepted: false, reason: 'already-claimed' };
      }
      moveControlClaimedRef.current = true;
      return { node: moveControlGroup, accepted: true, reason: null };
    },
  }), [canMoveDown, canMoveUp, moveControlGroup, ownerPanelId, pane.id]);

  const paneNode = pane.render({});

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
      <StephanosPaneMoveControlsContext.Provider value={moveControlContextValue}>
        {moveControlGroup ? (
          <div className="pane-order-controls-shell" data-testid={`pane-${pane.id}-move-controls-shell`}>
            {moveControlGroup}
          </div>
        ) : null}
        {paneNode}
      </StephanosPaneMoveControlsContext.Provider>
    </div>
  );
}
