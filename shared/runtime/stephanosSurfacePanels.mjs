import {
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from './stephanosSessionMemory.mjs';

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function readSurfacePanelState(surfaceId, storage = globalThis?.localStorage) {
  const memory = readPersistedStephanosSessionMemory(storage);
  const panels = memory?.session?.ui?.uiLayout?.surfacePanels;
  if (!panels || typeof panels !== 'object') {
    return {};
  }
  const entry = panels[surfaceId];
  return entry && typeof entry === 'object' ? { ...entry } : {};
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
  knob.innerHTML = '<span class="dial">◉</span>';

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
