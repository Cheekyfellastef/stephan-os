import PaneCollapseDial from './PaneCollapseDial';
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
  onToggleCollapse,
}) {
  if (!pane?.id || typeof pane?.render !== 'function') {
    return null;
  }

  const paneCollapsed = resolvePaneCollapsedState(pane, uiLayout);
  const wideSurfaceClass = pane.wideSurface ? ' stephanos-tile--wide-capable' : '';
  const wideSurfaceActiveClass = pane.wideSurface && !paneCollapsed ? ' stephanos-tile--wide-active' : '';
  const workspaceShellClass = pane.wideSurface ? ' stephanos-workspace-pane-shell' : '';
  const paneBodyId = `pane-${pane.id}-body`;
  const toggleLabel = `${paneCollapsed ? 'Expand' : 'Collapse'} ${pane.title || pane.id}`;

  return (
    <section
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
      <header className="panel-header-row" data-pane-drag-handle="true" data-testid={`pane-${pane.id}-header`}>
        <div className="panel-heading-wrap" data-pane-drag-handle="true">
          <div className="panel-collapse-toggle" data-pane-drag-handle="true">
            <button
              type="button"
              className="stephanos-canon-rotating-chevron-button panel-collapse-button"
              onClick={onToggleCollapse}
              data-no-drag="true"
              aria-expanded={!paneCollapsed}
              aria-controls={paneBodyId}
              aria-label={toggleLabel}
              title={toggleLabel}
              data-testid={`pane-${pane.id}-toggle`}
            >
              <PaneCollapseDial isOpen={!paneCollapsed} />
            </button>
            <span className="panel-heading-copy">
              <h2>{pane.title || pane.id}</h2>
              {pane.description ? <span className="panel-description">{pane.description}</span> : null}
            </span>
          </div>
        </div>
        <div className="panel-header-actions" data-testid={`pane-${pane.id}-actions`}>
          <div className="pane-order-controls" aria-label={`${pane.title || pane.id} arrangement controls`} data-pane-control-group="move-order" data-pane-control-layer="pane-header" data-pane-control-attached="true" data-testid={`pane-${pane.id}-move-controls`}>
            <button type="button" className="ghost-button" onClick={onMoveUp} disabled={!canMoveUp} aria-label={`Move ${pane.title || pane.id} up`}>Move up</button>
            <button type="button" className="ghost-button" onClick={onMoveDown} disabled={!canMoveDown} aria-label={`Move ${pane.title || pane.id} down`}>Move down</button>
          </div>
          {pane.actions || null}
        </div>
      </header>

      {paneCollapsed ? null : (
        <div id={paneBodyId} className="panel-body" data-testid={`pane-${pane.id}-body`}>
          {pane.render()}
        </div>
      )}
    </section>
  );
}
