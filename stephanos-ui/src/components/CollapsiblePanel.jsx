import PaneCollapseDial from './PaneCollapseDial';

export default function CollapsiblePanel({
  as: Component = 'section',
  panelId,
  title,
  description = '',
  isOpen,
  onToggle,
  className = '',
  children,
  actions = null,
  titleAs = 'h2',
  keepMountedWhenClosed = false,
}) {
  const TitleTag = titleAs;
  const rootClassName = ['panel', 'collapsible-panel', className, isOpen ? 'is-open' : 'is-collapsed']
    .filter(Boolean)
    .join(' ');
  const bodyId = `${panelId}-body`;
  const toggleLabel = `${isOpen ? 'Collapse' : 'Expand'} ${title}`;

  const shouldRenderBody = isOpen || keepMountedWhenClosed;
  return (
    <Component className={rootClassName} data-panel-id={panelId} data-panel-open={isOpen ? 'true' : 'false'}>
      <div className="panel-header-row" data-pane-drag-handle="true">
        <div className="panel-heading-wrap" data-pane-drag-handle="true">
          <div className="panel-collapse-toggle" data-pane-drag-handle="true">
            <button
              type="button"
              className="stephanos-canon-rotating-chevron-button panel-collapse-button"
              onClick={onToggle}
              data-no-drag="true"
              aria-expanded={isOpen}
              aria-controls={bodyId}
              aria-label={toggleLabel}
              title={toggleLabel}
            >
              <PaneCollapseDial isOpen={isOpen} />
            </button>
            <span className="panel-heading-copy">
              <TitleTag>{title}</TitleTag>
              {description ? <span className="panel-description">{description}</span> : null}
            </span>
          </div>
        </div>
        {actions ? <div className="panel-header-actions">{actions}</div> : null}
      </div>
      <div id={bodyId} className="panel-body" hidden={!isOpen} aria-hidden={!isOpen}>
        {shouldRenderBody ? children : null}
      </div>
    </Component>
  );
}
