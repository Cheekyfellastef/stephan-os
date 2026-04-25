import {
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from '../../shared/runtime/stephanosSessionMemory.mjs';
import {
  createStephanosCanonRotatingChevronButton,
  STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS,
} from '../../shared/runtime/stephanosSurfacePanels.mjs';
import { getSystemPanelToggleDefinitions } from '../../shared/runtime/systemPanelToggleRegistry.mjs';
import { attachPointerDrag } from '../../system/pointer_drag.js';

export const moduleDefinition = {
  id: 'system-panel',
  version: '1.1',
  description: 'Stephanos system control panel',
};

const TOGGLE_DEFINITIONS = getSystemPanelToggleDefinitions();
const SYSTEM_PANEL_POPUP_LAYOUT_KEY = 'systemPanelPopup';
const LEGACY_SYSTEM_PANEL_POPUP_LAYOUT_KEY = 'systemPanelPopupState';
const SYSTEM_PANEL_SURFACE_ID = 'stephanos-system-panel';
const SYSTEM_PANEL_COLLAPSED_LAYOUT_KEY = 'stephanos-system-panel:collapsed';
const PANEL_POSITION_KEY = 'panelPositions';

function normalizePopupState(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const position = source.position && typeof source.position === 'object'
    ? source.position
    : {};

  return {
    visible: source.visible === true,
    collapsed: source.collapsed === true,
    position: {
      x: Number.isFinite(Number(position.x)) ? Number(position.x) : null,
      y: Number.isFinite(Number(position.y)) ? Number(position.y) : null,
    },
  };
}

export function readSystemPanelPopupState(storage = globalThis.localStorage) {
  const layout = readLayoutState(storage);
  const persistedVisibility = layout[SYSTEM_PANEL_SURFACE_ID];
  const persistedCollapsed = layout[SYSTEM_PANEL_COLLAPSED_LAYOUT_KEY];
  const persistedPosition = layout[PANEL_POSITION_KEY]?.[SYSTEM_PANEL_SURFACE_ID];
  const current = normalizePopupState({
    visible: typeof persistedVisibility === 'boolean' ? persistedVisibility : false,
    collapsed: typeof persistedCollapsed === 'boolean' ? persistedCollapsed : false,
    position: persistedPosition,
  });
  if (
    typeof persistedVisibility === 'boolean'
    || typeof persistedCollapsed === 'boolean'
    || (persistedPosition && typeof persistedPosition === 'object')
    || !layout[LEGACY_SYSTEM_PANEL_POPUP_LAYOUT_KEY]
  ) {
    return {
      state: current,
      source: typeof persistedVisibility === 'boolean' ? SYSTEM_PANEL_SURFACE_ID : 'defaults',
      migrated: false,
    };
  }

  const legacy = normalizePopupState(layout[LEGACY_SYSTEM_PANEL_POPUP_LAYOUT_KEY]);
  writeLayoutState(
    {
      [SYSTEM_PANEL_SURFACE_ID]: legacy.visible === true,
      [SYSTEM_PANEL_COLLAPSED_LAYOUT_KEY]: legacy.collapsed === true,
      [PANEL_POSITION_KEY]: {
        ...(layout[PANEL_POSITION_KEY] && typeof layout[PANEL_POSITION_KEY] === 'object' ? layout[PANEL_POSITION_KEY] : {}),
        [SYSTEM_PANEL_SURFACE_ID]: legacy.position,
      },
      [SYSTEM_PANEL_POPUP_LAYOUT_KEY]: undefined,
      [LEGACY_SYSTEM_PANEL_POPUP_LAYOUT_KEY]: undefined,
    },
    storage,
  );
  return {
    state: legacy,
    source: LEGACY_SYSTEM_PANEL_POPUP_LAYOUT_KEY,
    migrated: true,
  };
}

export function writeSystemPanelPopupState(partialPopupState = {}, storage = globalThis.localStorage) {
  const currentPopupState = readSystemPanelPopupState(storage).state;
  const nextPopupState = normalizePopupState({
    ...currentPopupState,
    ...partialPopupState,
    position: {
      ...(currentPopupState.position || {}),
      ...(partialPopupState?.position && typeof partialPopupState.position === 'object'
        ? partialPopupState.position
        : {}),
    },
  });
  const currentLayout = readLayoutState(storage);
  const currentPositions = currentLayout[PANEL_POSITION_KEY] && typeof currentLayout[PANEL_POSITION_KEY] === 'object'
    ? currentLayout[PANEL_POSITION_KEY]
    : {};
  writeLayoutState({
    [SYSTEM_PANEL_SURFACE_ID]: nextPopupState.visible === true,
    [SYSTEM_PANEL_COLLAPSED_LAYOUT_KEY]: nextPopupState.collapsed === true,
    [PANEL_POSITION_KEY]: {
      ...currentPositions,
      [SYSTEM_PANEL_SURFACE_ID]: nextPopupState.position,
    },
    [SYSTEM_PANEL_POPUP_LAYOUT_KEY]: undefined,
    [LEGACY_SYSTEM_PANEL_POPUP_LAYOUT_KEY]: undefined,
  }, storage);
  console.info('[SystemPanel] persisted popup state', nextPopupState);
  return nextPopupState;
}


function readLayoutState(storage = globalThis.localStorage) {
  const memory = readPersistedStephanosSessionMemory(storage);
  return {
    ...(memory?.session?.ui?.uiLayout || {}),
  };
}

function writeLayoutState(partialLayout = {}, storage = globalThis.localStorage) {
  const current = readPersistedStephanosSessionMemory(storage);
  persistStephanosSessionMemory(
    {
      ...current,
      session: {
        ...current.session,
        ui: {
          ...current.session.ui,
          uiLayout: {
            ...(current.session.ui?.uiLayout || {}),
            ...partialLayout,
          },
        },
      },
    },
    storage,
  );
}

export function createSystemPanelStateController({
  setPanelState = globalThis.setPanelState,
  applySurfaceVisibility = globalThis.applyLauncherSurfaceVisibility,
  setRealitySyncEnabled = globalThis.setRealitySyncEnabled,
  storage = globalThis.localStorage,
} = {}) {
  const layout = readLayoutState(storage);

  function setToggleState(toggleId, enabled) {
    const normalizedEnabled = enabled === true;

    if (toggleId === 'runtime-diagnostics') {
      applySurfaceVisibility?.({ runtimeDiagnosticsVisible: normalizedEnabled });
      writeLayoutState({ runtimeDiagnosticsVisible: normalizedEnabled }, storage);
      return;
    }

    if (toggleId === 'launcher-fingerprint') {
      applySurfaceVisibility?.({ launcherRuntimeFingerprintVisible: normalizedEnabled });
      writeLayoutState({ launcherRuntimeFingerprintVisible: normalizedEnabled }, storage);
      return;
    }

    if (toggleId === 'truth-panel') {
      applySurfaceVisibility?.({ truthPanelVisible: normalizedEnabled });
      writeLayoutState({ truthPanelVisible: normalizedEnabled }, storage);
      return;
    }

    if (toggleId === 'build-parity-panel') {
      applySurfaceVisibility?.({ truthPanelVisible: normalizedEnabled });
      writeLayoutState({ buildParityPanelVisible: normalizedEnabled, truthPanelVisible: normalizedEnabled }, storage);
      return;
    }

    if (toggleId === 'reality-sync') {
      setRealitySyncEnabled?.(normalizedEnabled);
      writeLayoutState({ realitySyncEnabled: normalizedEnabled }, storage);
      return;
    }

    setPanelState?.(toggleId, normalizedEnabled);
    writeLayoutState({ [toggleId]: normalizedEnabled }, storage);
  }

  function getToggleState(toggleId) {
    if (toggleId === 'runtime-diagnostics') {
      return layout.runtimeDiagnosticsVisible === true;
    }

    if (toggleId === 'launcher-fingerprint') {
      return layout.launcherRuntimeFingerprintVisible === true;
    }

    if (toggleId === 'truth-panel') {
      return layout.truthPanelVisible === true;
    }

    if (toggleId === 'build-parity-panel') {
      return layout.buildParityPanelVisible === true || layout.truthPanelVisible === true;
    }

    if (toggleId === 'reality-sync') {
      return layout.realitySyncEnabled !== false;
    }

    return layout[toggleId] === true;
  }

  return {
    toggleDefinitions: TOGGLE_DEFINITIONS,
    getToggleState,
    setToggleState,
  };
}

function renderToggleRow(toggle, checked) {
  return `
    <label class="stephanos-system-toggle">
      <span>${toggle.label}</span>
      <input
        type="checkbox"
        data-toggle-id="${toggle.id}"
        ${checked ? 'checked' : ''}
      >
    </label>
  `;
}

export function installDraggablePanel(
  panel,
  handleSelector = '.stephanos-system-panel-header',
  { onPositionCommit = null } = {},
) {
  const handle = panel.querySelector(handleSelector);
  if (!handle) {
    return;
  }
  attachPointerDrag({
    panel,
    handle,
    panelId: panel.id || 'stephanos-system-panel',
    preferViewportSpace: true,
    debug: globalThis.window?.isDeveloperModeEnabled?.() === true,
    interactiveSelector: `.${STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS}, .stephanos-panel-knob, [data-no-drag], [data-stephanos-no-drag]`,
    onDragStart() {
      panel.parentNode?.appendChild?.(panel);
    },
    onPositionCommit,
  });
}

export function init() {
  let panel = document.getElementById(SYSTEM_PANEL_SURFACE_ID);
  if (panel) {
    return;
  }

  const controller = createSystemPanelStateController();
  const popupRestore = readSystemPanelPopupState();
  const popupState = popupRestore.state;
  console.info('[SystemPanel] popup restore', {
    source: popupRestore.source,
    migrated: popupRestore.migrated,
    restored: popupState,
  });
  panel = document.createElement('div');
  panel.id = SYSTEM_PANEL_SURFACE_ID;
  panel.className = 'stephanos-system-panel';
  panel.style.display = popupState.visible ? 'block' : 'none';
  panel.dataset.collapsed = popupState.collapsed ? 'true' : 'false';

  const moduleControls = controller.toggleDefinitions
    .filter((entry) => entry.type === 'panel')
    .map((toggle) => renderToggleRow(toggle, controller.getToggleState(toggle.id)))
    .join('');

  const surfaceControls = controller.toggleDefinitions
    .filter((entry) => entry.type === 'surface')
    .map((toggle) => renderToggleRow(toggle, controller.getToggleState(toggle.id)))
    .join('');

  panel.innerHTML = `
    <header class="stephanos-system-panel-header">
      <button class="stephanos-panel-knob system-panel-knob" type="button" aria-expanded="true" aria-label="Collapse system panel" title="Collapse system panel" data-no-drag="true"></button>
      <div>
        <h3>Stephanos System</h3>
        <p class="system-panel-subtitle">Operational controls</p>
      </div>
    </header>
    <div class="stephanos-system-panel-content">
      <section>
        <h4>Module Panels</h4>
        ${moduleControls}
      </section>
      <section>
        <h4>Truth & Diagnostics Surfaces</h4>
        ${surfaceControls}
      </section>
      <section>
        <h4>Layout & Sync</h4>
        <button class="system-panel-action" data-system-action="reset-layout" type="button">Reset Panel Layout</button>
        <button class="system-panel-action" data-system-action="reality-check" type="button">Run Reality Sync Check</button>
        <button class="system-panel-action" data-system-action="restart-ignition" type="button">Restart Ignition To Sync</button>
        <p class="system-panel-sync-status" data-system-sync-status>Mirror status: loading…</p>
      </section>
      <hr>
      <button class="system-panel-close" type="button">Close Panel</button>
    </div>
  `;

  const content = panel.querySelector('.stephanos-system-panel-content');
  const knobButton = panel.querySelector('.system-panel-knob');
  if (knobButton) {
    const canonKnob = createStephanosCanonRotatingChevronButton({ documentRef: document });
    knobButton.className = `${canonKnob.className} stephanos-panel-knob system-panel-knob`;
    knobButton.innerHTML = canonKnob.innerHTML;
  }
  const syncStatusNode = panel.querySelector('[data-system-sync-status]');
  const refreshMirrorStatus = () => {
    const mirrorStatus = window.getStephanosMirrorStatus?.();
    if (!syncStatusNode) {
      return;
    }
    if (!mirrorStatus) {
      syncStatusNode.textContent = 'Mirror status: unavailable';
      return;
    }
    const drift = mirrorStatus.localhostMirrorDrift ? 'drift detected' : 'in sync';
    const restart = mirrorStatus.ignitionRestartRequired ? 'restart required' : 'restart not required';
    syncStatusNode.textContent = `Mirror status: ${drift} · ${restart}`;
  };

  knobButton?.addEventListener('click', () => {
    const collapsed = panel.dataset.collapsed !== 'true';
    panel.dataset.collapsed = collapsed ? 'true' : 'false';
    content.style.display = collapsed ? 'none' : 'block';
    knobButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    knobButton.setAttribute('aria-label', collapsed ? 'Expand system panel' : 'Collapse system panel');
    knobButton.setAttribute('title', collapsed ? 'Expand system panel' : 'Collapse system panel');
    knobButton.querySelector('.chevron')?.classList.toggle('open', collapsed !== true);
    writeSystemPanelPopupState({ collapsed });
  });

  panel.querySelector('.system-panel-close')?.addEventListener('click', () => {
    window.openSystemPanel?.();
  });

  panel.querySelectorAll('input[data-toggle-id]').forEach((input) => {
    input.addEventListener('change', () => {
      const toggleId = input.getAttribute('data-toggle-id');
      controller.setToggleState(toggleId, input.checked);
    });
  });
  panel.querySelectorAll('button[data-system-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-system-action');
      if (action === 'reset-layout') {
        window.resetStephanosPanelLayout?.();
      } else if (action === 'reality-check') {
        await window.runRealitySyncCheck?.();
      } else if (action === 'restart-ignition') {
        const result = await window.requestStephanosIgnitionRestart?.({ source: 'system-panel' });
        if (syncStatusNode) {
          syncStatusNode.textContent = `Mirror status: restart ${result?.ok ? 'requested' : 'not available'} (${result?.message || 'no details'})`;
        }
      }
      refreshMirrorStatus();
    });
  });

  document.body.appendChild(panel);
  if (popupState.position.x != null && popupState.position.y != null) {
    panel.style.left = `${popupState.position.x}px`;
    panel.style.top = `${popupState.position.y}px`;
    panel.style.transform = 'none';
  }
  content.style.display = popupState.collapsed ? 'none' : 'block';
  knobButton.setAttribute('aria-expanded', popupState.collapsed ? 'false' : 'true');
  knobButton.setAttribute('aria-label', popupState.collapsed ? 'Expand system panel' : 'Collapse system panel');
  knobButton.setAttribute('title', popupState.collapsed ? 'Expand system panel' : 'Collapse system panel');
  knobButton.querySelector('.chevron')?.classList.toggle('open', popupState.collapsed !== true);
  installDraggablePanel(panel, '.stephanos-system-panel-header', {
    onPositionCommit(position) {
      writeSystemPanelPopupState({ position });
    },
  });

  window.openSystemPanel = function openSystemPanel() {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    writeSystemPanelPopupState({ visible: panel.style.display !== 'none' });
    if (panel.style.display !== 'none') {
      refreshMirrorStatus();
    }
  };
}

export function dispose() {
  const panel = document.getElementById('stephanos-system-panel');
  if (panel) {
    panel.remove();
  }
}
