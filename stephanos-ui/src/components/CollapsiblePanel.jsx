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
}) {
  const TitleTag = titleAs;
  const rootClassName = ['panel', 'collapsible-panel', className, isOpen ? 'is-open' : 'is-collapsed']
    .filter(Boolean)
    .join(' ');

  return (
    <Component className={rootClassName} data-panel-id={panelId} data-panel-open={isOpen ? 'true' : 'false'}>
      <div className="panel-header-row">
        <div className="panel-heading-wrap">
          <button
            type="button"
            className="panel-collapse-toggle"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-controls={`${panelId}-body`}
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
      <div id={`${panelId}-body`} className="panel-body" hidden={!isOpen}>
        {children}
      </div>
    </Component>
  );
}
