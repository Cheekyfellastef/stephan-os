import {
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from './stephanosSessionMemory.mjs';

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

const SURFACE_PANEL_STYLE_ID = 'stephanos-surface-panel-shared-styles';
const SURFACE_PANEL_SHARED_STYLES = `
.stephanos-surface-panel {
  padding: 12px;
}
.stephanos-surface-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.stephanos-surface-panel-header .title {
  margin: 0;
}
.stephanos-surface-panel-knob {
  border-radius: 999px;
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 1.05rem;
  line-height: 1;
  border: 1px solid #4b6f94;
  background: rgba(8, 21, 35, 0.95);
  color: #daf3ff;
  cursor: pointer;
}
.stephanos-surface-panel-knob .dial {
  display: inline-block;
  transition: transform 180ms ease;
}
.stephanos-surface-panel-knob .chevron {
  display: inline-block;
  font-size: 0.78rem;
  opacity: 0.9;
  transition: transform 180ms ease;
}
.stephanos-surface-panel-knob:hover,
.stephanos-surface-panel-knob:focus-visible {
  border-color: #8ec9ff;
  background: rgba(15, 34, 54, 0.97);
}
.stephanos-surface-panel-collapsed .stephanos-surface-panel-knob .dial {
  transform: rotate(-90deg);
}
.stephanos-surface-panel-collapsed .stephanos-surface-panel-knob .chevron {
  transform: rotate(-90deg);
}
`;

function readSurfacePanelState(surfaceId, storage = globalThis?.localStorage) {
  const memory = readPersistedStephanosSessionMemory(storage);
  const panels = memory?.session?.ui?.uiLayout?.surfacePanels;
  if (!panels || typeof panels !== 'object') {
    return {};
  }
  const entry = panels[surfaceId];
  return entry && typeof entry === 'object' ? { ...entry } : {};
}

function ensureSurfacePanelStyles(documentRef = globalThis?.document) {
  if (!documentRef?.head || typeof documentRef.createElement !== 'function') {
    return;
  }
  if (documentRef.getElementById(SURFACE_PANEL_STYLE_ID)) {
    return;
  }
  const style = documentRef.createElement('style');
  style.id = SURFACE_PANEL_STYLE_ID;
  style.textContent = SURFACE_PANEL_SHARED_STYLES;
  documentRef.head.appendChild(style);
}

function writeSurfacePanelState(surfaceId, panelId, collapsed, storage = globalThis?.localStorage) {
  const memory = readPersistedStephanosSessionMemory(storage);
  const currentPanels = memory?.session?.ui?.uiLayout?.surfacePanels;
  const panels = currentPanels && typeof currentPanels === 'object' ? { ...currentPanels } : {};
  const surfaceState = panels[surfaceId] && typeof panels[surfaceId] === 'object' ? { ...panels[surfaceId] } : {};
  surfaceState[panelId] = collapsed === true;
  panels[surfaceId] = surfaceState;

  persistStephanosSessionMemory({
    ...memory,
    session: {
      ...memory.session,
      ui: {
        ...memory.session?.ui,
        uiLayout: {
          ...(memory.session?.ui?.uiLayout || {}),
          surfacePanels: panels,
        },
      },
    },
  }, storage);
}

function applyCollapsedState({ panel, body, knob, collapsed }) {
  panel.classList.toggle('stephanos-surface-panel-collapsed', collapsed === true);
  body.hidden = collapsed === true;
  knob.setAttribute('aria-expanded', collapsed === true ? 'false' : 'true');
  knob.setAttribute('aria-label', collapsed === true ? 'Expand panel' : 'Collapse panel');
  knob.setAttribute('title', collapsed === true ? 'Expand panel' : 'Collapse panel');
}

function createPanelShell({ panel, titleNode }) {
  const headingText = safeString(titleNode?.textContent) || 'Panel';
  const originalChildren = Array.from(panel.childNodes);
  panel.innerHTML = '';
  panel.classList.add('stephanos-surface-panel');

  const header = document.createElement('header');
  header.className = 'stephanos-surface-panel-header';

  const heading = document.createElement('h2');
  heading.className = titleNode?.className || 'title';
  heading.textContent = headingText;

  const knob = document.createElement('button');
  knob.type = 'button';
  knob.className = 'stephanos-surface-panel-knob';
  knob.innerHTML = '<span class="dial">◉</span><span class="chevron" aria-hidden="true">⌄</span>';

  header.append(heading, knob);

  const body = document.createElement('div');
  body.className = 'stephanos-surface-panel-body';
  originalChildren
    .filter((node) => node !== titleNode)
    .forEach((node) => body.appendChild(node));

  panel.append(header, body);
  return { knob, body };
}

export function initStephanosSurfacePanels({
  surfaceId,
  panelSelector = '[data-stephanos-collapsible-panel]',
  storage = globalThis?.localStorage,
} = {}) {
  const normalizedSurfaceId = safeString(surfaceId);
  if (!normalizedSurfaceId) {
    throw new Error('initStephanosSurfacePanels requires a non-empty surfaceId.');
  }

  ensureSurfacePanelStyles(globalThis?.document);

  const persistedState = readSurfacePanelState(normalizedSurfaceId, storage);
  const panels = Array.from(document.querySelectorAll(panelSelector));

  panels.forEach((panel) => {
    const panelId = safeString(panel.getAttribute('data-panel-id'));
    if (!panelId) {
      return;
    }

    const titleNode = panel.querySelector('h2.title');
    const { knob, body } = createPanelShell({ panel, titleNode });
    const collapsed = persistedState[panelId] === true;
    applyCollapsedState({ panel, body, knob, collapsed });

    knob.addEventListener('click', () => {
      const nextCollapsed = !panel.classList.contains('stephanos-surface-panel-collapsed');
      applyCollapsedState({ panel, body, knob, collapsed: nextCollapsed });
      writeSurfacePanelState(normalizedSurfaceId, panelId, nextCollapsed, storage);
    });
  });
}

export {
  readSurfacePanelState,
  writeSurfacePanelState,
};
