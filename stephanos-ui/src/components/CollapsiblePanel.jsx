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
      <div className="panel-header-row">
        <div className="panel-heading-wrap">
          <button
            type="button"
            className="panel-collapse-toggle"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-controls={bodyId}
            aria-label={toggleLabel}
            title={toggleLabel}
          >
            <span className={`panel-chevron ${isOpen ? 'open' : ''}`} aria-hidden="true">⌄</span>
            <span className="panel-heading-copy">
              <TitleTag>{title}</TitleTag>
              {description ? <span className="panel-description">{description}</span> : null}
            </span>
          </button>
        </div>
        {actions ? <div className="panel-header-actions">{actions}</div> : null}
      </div>
      <div id={bodyId} className="panel-body" hidden={!isOpen} aria-hidden={!isOpen}>
        {shouldRenderBody ? children : null}
      </div>
    </Component>
  );
}
