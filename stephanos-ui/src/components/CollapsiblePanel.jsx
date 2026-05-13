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
  testIdBase = '',
}) {
  const TitleTag = titleAs;
  const resolvedTestIdBase = testIdBase || (panelId ? `pane-${panelId}` : '');
  const rootClassName = ['panel', 'collapsible-panel', className, isOpen ? 'is-open' : 'is-collapsed']
    .filter(Boolean)
    .join(' ');
  const bodyId = `${panelId}-body`;
  const toggleLabel = `${isOpen ? 'Collapse' : 'Expand'} ${title}`;


  const viteEnvFromGlobal = typeof globalThis !== 'undefined' ? globalThis.__STEPHANOS_IMPORT_META_ENV__ : undefined;
  const viteEnvFromImportMeta = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
  const viteEnv = viteEnvFromGlobal || viteEnvFromImportMeta;
  const isViteDev = Boolean(viteEnv && viteEnv.DEV);
  const isNodeDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';
  const isDevMode = Boolean(isViteDev || isNodeDev);
  if (isDevMode) {
    if (!panelId || !String(panelId).trim()) {
      console.warn('[Stephanos Collapse Canon] Missing panelId for collapse target.', { title });
    }
    if (typeof onToggle !== 'function') {
      console.warn('[Stephanos Collapse Canon] Chevron rendered without a valid onToggle handler.', { panelId, title });
    }
  }

  const shouldRenderBody = isOpen || keepMountedWhenClosed;
  return (
    <Component className={rootClassName} data-panel-id={panelId} data-panel-open={isOpen ? 'true' : 'false'} data-testid={resolvedTestIdBase || undefined}>
      <div className="panel-header-row" data-pane-drag-handle="true" data-testid={resolvedTestIdBase ? `${resolvedTestIdBase}-header` : undefined}>
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
              data-testid={resolvedTestIdBase ? `${resolvedTestIdBase}-toggle` : undefined}
            >
              <PaneCollapseDial isOpen={isOpen} />
            </button>
            <span className="panel-heading-copy">
              <TitleTag>{title}</TitleTag>
              {description ? <span className="panel-description">{description}</span> : null}
            </span>
          </div>
        </div>
        {actions ? <div className="panel-header-actions" data-testid={resolvedTestIdBase ? `${resolvedTestIdBase}-actions` : undefined}>{actions}</div> : null}
      </div>
      <div id={bodyId} className="panel-body" hidden={!isOpen} aria-hidden={!isOpen} data-testid={resolvedTestIdBase ? `${resolvedTestIdBase}-body` : undefined}>
        {shouldRenderBody ? children : null}
      </div>
    </Component>
  );
}
