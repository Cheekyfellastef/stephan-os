import {
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from '../../shared/runtime/stephanosSessionMemory.mjs';

export const moduleDefinition = {
  id: 'system-panel',
  version: '1.1',
  description: 'Stephanos system control panel',
};

const TOGGLE_DEFINITIONS = Object.freeze([
  { id: 'module-manager-panel', label: 'Modules', type: 'panel' },
  { id: 'agent-console-panel', label: 'Agents Console', type: 'panel' },
  { id: 'command-console-panel', label: 'Debug Console', type: 'panel' },
  { id: 'task-monitor-panel', label: 'Task Monitor', type: 'panel' },
  { id: 'dev-console', label: 'Developer Console', type: 'panel' },
  { id: 'runtime-diagnostics', label: 'Runtime Diagnostics', type: 'surface' },
  { id: 'launcher-fingerprint', label: 'Launcher Runtime Fingerprint', type: 'surface' },
  { id: 'truth-panel', label: 'Truth Panel', type: 'surface' },
  { id: 'reality-sync', label: 'Reality Sync / Auto Truth Refresh', type: 'surface' },
]);

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

export function init() {
  let panel = document.getElementById('stephanos-system-panel');
  if (panel) {
    return;
  }

  const controller = createSystemPanelStateController();
  panel = document.createElement('div');
  panel.id = 'stephanos-system-panel';
  panel.className = 'stephanos-system-panel';
  panel.style.display = 'none';

  const moduleControls = controller.toggleDefinitions
    .filter((entry) => entry.type === 'panel')
    .map((toggle) => renderToggleRow(toggle, controller.getToggleState(toggle.id)))
    .join('');

  const surfaceControls = controller.toggleDefinitions
    .filter((entry) => entry.type === 'surface')
    .map((toggle) => renderToggleRow(toggle, controller.getToggleState(toggle.id)))
    .join('');

  panel.innerHTML = `
    <h3>Stephanos System</h3>
    <p class="system-panel-subtitle">Operational controls</p>
    <section>
      <h4>Module Panels</h4>
      ${moduleControls}
    </section>
    <section>
      <h4>Truth & Diagnostics Surfaces</h4>
      ${surfaceControls}
    </section>
    <hr>
    <button class="system-panel-close" type="button">Close Panel</button>
  `;

  panel.querySelector('.system-panel-close')?.addEventListener('click', () => {
    window.openSystemPanel?.();
  });

  panel.querySelectorAll('input[data-toggle-id]').forEach((input) => {
    input.addEventListener('change', () => {
      const toggleId = input.getAttribute('data-toggle-id');
      controller.setToggleState(toggleId, input.checked);
    });
  });

  document.body.appendChild(panel);

  window.openSystemPanel = function openSystemPanel() {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  };
}

export function dispose() {
  const panel = document.getElementById('stephanos-system-panel');
  if (panel) {
    panel.remove();
  }
}
