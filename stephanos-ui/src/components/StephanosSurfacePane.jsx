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
  const paneCollapsed = resolvePaneCollapsedState(pane, uiLayout);
  return (
    <div
      className={`operator-pane-slot ${pane.className || ''} ${paneCollapsed ? 'pane-collapsed' : 'pane-expanded'} ${dragPaneId === pane.id ? 'dragging' : ''}`}
      draggable
      data-pane-id={pane.id}
      data-pane-collapsed={paneCollapsed ? 'true' : 'false'}
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
      <div className="pane-order-controls" aria-label={`${pane.title || pane.id} arrangement controls`}>
        <button type="button" className="ghost-button" onClick={onMoveUp} disabled={!canMoveUp} aria-label={`Move ${pane.title || pane.id} up`}>Move up</button>
        <button type="button" className="ghost-button" onClick={onMoveDown} disabled={!canMoveDown} aria-label={`Move ${pane.title || pane.id} down`}>Move down</button>
      </div>
      {pane.render()}
    </div>
  );
}
