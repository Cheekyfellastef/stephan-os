import {
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from './stephanosSessionMemory.mjs';

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

const SURFACE_PANEL_STYLE_ID = 'stephanos-surface-panel-shared-styles';
const STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS = 'stephanos-canon-rotating-chevron-button';
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
.${STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS} {
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
.${STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS} .dial {
  display: inline-block;
  transition: transform 180ms ease;
}
.${STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS} .chevron {
  display: inline-block;
  font-size: 0.78rem;
  opacity: 0.9;
  transition: transform 180ms ease;
}
.${STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS}:hover,
.${STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS}:focus-visible {
  border-color: #8ec9ff;
  background: rgba(15, 34, 54, 0.97);
}
.stephanos-surface-panel-collapsed .${STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS} .dial {
  transform: rotate(-90deg);
}
.stephanos-surface-panel-collapsed .${STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS} .chevron {
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

function createStephanosCanonRotatingChevronButton({ documentRef = globalThis?.document } = {}) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new Error('createStephanosCanonRotatingChevronButton requires a document-like object.');
  }

  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS;
  button.innerHTML = '<span class="dial">◉</span><span class="chevron" aria-hidden="true">⌄</span>';
  return button;
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

function applyCollapsedState({ panel, body, button, collapsed }) {
  panel.classList.toggle('stephanos-surface-panel-collapsed', collapsed === true);
  body.hidden = collapsed === true;
  button.setAttribute('aria-expanded', collapsed === true ? 'false' : 'true');
  button.setAttribute('aria-label', collapsed === true ? 'Expand panel' : 'Collapse panel');
  button.setAttribute('title', collapsed === true ? 'Expand panel' : 'Collapse panel');
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

  const button = createStephanosCanonRotatingChevronButton({ documentRef: document });

  header.append(heading, button);

  const body = document.createElement('div');
  body.className = 'stephanos-surface-panel-body';
  originalChildren
    .filter((node) => node !== titleNode)
    .forEach((node) => body.appendChild(node));

  panel.append(header, body);
  return { button, body };
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
    const { button, body } = createPanelShell({ panel, titleNode });
    const collapsed = persistedState[panelId] === true;
    applyCollapsedState({ panel, body, button, collapsed });

    button.addEventListener('click', () => {
      const nextCollapsed = !panel.classList.contains('stephanos-surface-panel-collapsed');
      applyCollapsedState({ panel, body, button, collapsed: nextCollapsed });
      writeSurfacePanelState(normalizedSurfaceId, panelId, nextCollapsed, storage);
    });
  });
}

export {
  createStephanosCanonRotatingChevronButton,
  readSurfacePanelState,
  STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS,
  writeSurfacePanelState,
};
