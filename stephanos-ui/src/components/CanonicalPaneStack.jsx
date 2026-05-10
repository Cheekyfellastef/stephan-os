import { useMemo, useState } from 'react';

const STORAGE_KEY_PREFIX = 'stephanos.canonicalPaneLayout.v1';

function readLayout(scope, defaults) {
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}.${scope}`);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      order: Array.isArray(parsed.order) ? parsed.order : defaults.order,
      collapsed: parsed.collapsed && typeof parsed.collapsed === 'object' ? parsed.collapsed : defaults.collapsed,
    };
  } catch {
    return defaults;
  }
}

function writeLayout(scope, layout) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${STORAGE_KEY_PREFIX}.${scope}`, JSON.stringify(layout));
}

export default function CanonicalPaneStack({ scope = 'mission-console', panes = [] }) {
  const defaultLayout = useMemo(() => ({
    order: panes.map((pane) => pane.paneId),
    collapsed: Object.fromEntries(panes.map((pane) => [pane.paneId, false])),
  }), [panes]);
  const [layout, setLayout] = useState(() => readLayout(scope, defaultLayout));
  const paneById = useMemo(() => new Map(panes.map((pane) => [pane.paneId, pane])), [panes]);

  const orderedPanes = layout.order.map((id) => paneById.get(id)).filter(Boolean);

  const updateLayout = (next) => {
    setLayout(next);
    writeLayout(scope, next);
  };

  const move = (paneId, direction) => {
    const idx = layout.order.indexOf(paneId);
    if (idx < 0) return;
    const nextIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= layout.order.length) return;
    const nextOrder = [...layout.order];
    [nextOrder[idx], nextOrder[nextIdx]] = [nextOrder[nextIdx], nextOrder[idx]];
    updateLayout({ ...layout, order: nextOrder });
  };

  const toggleCollapsed = (paneId) => {
    updateLayout({
      ...layout,
      collapsed: { ...layout.collapsed, [paneId]: !layout.collapsed[paneId] },
    });
  };

  return (
    <div className="canonical-pane-stack">
      {orderedPanes.map((pane, index) => {
        const collapsed = layout.collapsed[pane.paneId] === true;
        return (
          <section key={pane.paneId} className={`canonical-pane ${collapsed ? 'canonical-pane--collapsed' : ''}`} data-pane-id={pane.paneId}>
            <header className="canonical-pane__header">
              <button type="button" className="canonical-pane__chevron" onClick={() => toggleCollapsed(pane.paneId)} aria-label={collapsed ? 'Expand pane' : 'Collapse pane'}>
                ▸
              </button>
              <strong>{pane.title}</strong>
              <div className="canonical-pane__move-controls">
                <button type="button" onClick={() => move(pane.paneId, 'up')} disabled={index === 0}>↑</button>
                <button type="button" onClick={() => move(pane.paneId, 'down')} disabled={index === orderedPanes.length - 1}>↓</button>
              </div>
            </header>
            {!collapsed ? <div className="canonical-pane__body">{pane.body}</div> : null}
          </section>
        );
      })}
    </div>
  );
}
